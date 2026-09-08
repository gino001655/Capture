import type {
  Filter,
  FindOneAndUpdateOptions,
  UpdateFilter,
} from "mongodb";

import type { Capture } from "./capture.ts";
import { getMongoClient, getMongoDatabaseName } from "./mongodb.ts";

export type CaptureDocument = Omit<Capture, "id"> & {
  _id: string;
};

export type CaptureCollection = {
  insertOne(document: CaptureDocument): Promise<unknown>;
  findOne(filter: Filter<CaptureDocument>): Promise<CaptureDocument | null>;
  findOneAndUpdate(
    filter: Filter<CaptureDocument>,
    update: UpdateFilter<CaptureDocument>,
    options: FindOneAndUpdateOptions,
  ): Promise<CaptureDocument | null>;
  updateMany(
    filter: Filter<CaptureDocument>,
    update: UpdateFilter<CaptureDocument>,
  ): Promise<{ modifiedCount: number }>;
};

type CaptureCollectionProvider = () => Promise<CaptureCollection>;

let claimIndexPromise: Promise<string> | undefined;

async function getMongoCaptureCollection() {
  const client = await getMongoClient();
  const collection = client
    .db(getMongoDatabaseName())
    .collection<CaptureDocument>("captures");

  claimIndexPromise ??= collection.createIndex(
    { status: 1, createdAt: 1 },
    { name: "claim_pending_capture" },
  );
  await claimIndexPromise;

  return collection;
}

function toCapture(document: CaptureDocument): Capture {
  const { _id, ...capture } = document;
  return { id: _id, ...capture };
}

export class CaptureStore {
  private readonly getCollection: CaptureCollectionProvider;
  private readonly now: () => Date;

  constructor(
    getCollection: CaptureCollectionProvider = getMongoCaptureCollection,
    now: () => Date = () => new Date(),
  ) {
    this.getCollection = getCollection;
    this.now = now;
  }

  async create(content: string): Promise<Capture> {
    const document: CaptureDocument = {
      _id: crypto.randomUUID(),
      content,
      status: "pending",
      createdAt: this.now().toISOString(),
    };

    const collection = await this.getCollection();
    await collection.insertOne(document);
    return toCapture(document);
  }

  async find(id: string): Promise<Capture | undefined> {
    const collection = await this.getCollection();
    const document = await collection.findOne({ _id: id });
    return document === null ? undefined : toCapture(document);
  }

  async claimNext(): Promise<Capture | undefined> {
    const collection = await this.getCollection();
    const timestamp = this.now();
    const timestampIso = timestamp.toISOString();
    await collection.updateMany(
      { status: "failed", nextAttemptAt: { $lte: timestampIso } },
      { $set: { status: "pending" }, $unset: { nextAttemptAt: "", failedAt: "" } },
    );
    await collection.updateMany(
      { status: "processing", leaseExpiresAt: { $lte: timestampIso } },
      { $set: { status: "pending" }, $unset: { processingAt: "", leaseExpiresAt: "" } },
    );
    const leaseExpiresAt = new Date(timestamp.getTime() + 30 * 60 * 1_000).toISOString();
    const document = await collection.findOneAndUpdate(
      { status: "pending" },
      {
        $set: { status: "processing", processingAt: timestampIso, leaseExpiresAt },
        $unset: { lastError: "", failedAt: "", nextAttemptAt: "" },
      },
      {
        sort: { createdAt: 1, _id: 1 },
        returnDocument: "after",
      },
    );

    return document === null ? undefined : toCapture(document);
  }

  async complete(id: string, result: string): Promise<Capture | undefined> {
    const collection = await this.getCollection();
    const document = await collection.findOneAndUpdate(
      { _id: id, status: "processing" },
      {
        $set: {
          status: "completed",
          result,
          completedAt: this.now().toISOString(),
        },
        $unset: { processingAt: "", leaseExpiresAt: "", lastError: "", failedAt: "", nextAttemptAt: "" },
      },
      { returnDocument: "after" },
    );

    return document === null ? undefined : toCapture(document);
  }

  async fail(id: string, error: string): Promise<Capture | undefined> {
    const collection = await this.getCollection();
    const timestamp = this.now();
    const document = await collection.findOneAndUpdate(
      { _id: id, status: "processing" },
      {
        $set: {
          status: "failed",
          lastError: error,
          failedAt: timestamp.toISOString(),
          nextAttemptAt: new Date(timestamp.getTime() + 15 * 60 * 1_000).toISOString(),
        },
        $unset: { processingAt: "", leaseExpiresAt: "" },
      },
      { returnDocument: "after" },
    );
    return document === null ? undefined : toCapture(document);
  }

  async retryFailed(): Promise<number> {
    const collection = await this.getCollection();
    const result = await collection.updateMany(
      { status: "failed" },
      { $set: { status: "pending" }, $unset: { failedAt: "", nextAttemptAt: "" } },
    );
    return result.modifiedCount;
  }
}

export const captureStore = new CaptureStore();
