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

  constructor(
    getCollection: CaptureCollectionProvider = getMongoCaptureCollection,
  ) {
    this.getCollection = getCollection;
  }

  async create(content: string): Promise<Capture> {
    const document: CaptureDocument = {
      _id: crypto.randomUUID(),
      content,
      status: "pending",
      createdAt: new Date().toISOString(),
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
    const document = await collection.findOneAndUpdate(
      { status: "pending" },
      { $set: { status: "processing" } },
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
          completedAt: new Date().toISOString(),
        },
      },
      { returnDocument: "after" },
    );

    return document === null ? undefined : toCapture(document);
  }
}

export const captureStore = new CaptureStore();
