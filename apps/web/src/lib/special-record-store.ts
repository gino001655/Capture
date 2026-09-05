import { getMongoClient, getMongoDatabaseName } from "./mongodb.ts";
import type { EnglishRecord, EnglishSaveInput } from "./special-record.ts";

export type SpecialRecordDocument = Omit<EnglishRecord, "id"> & { _id: string };

type SpecialFilter = Partial<SpecialRecordDocument>;
type SpecialUpdate = {
  $setOnInsert?: SpecialRecordDocument;
  $set?: Partial<SpecialRecordDocument>;
  $inc?: { revision: number };
};

export type SpecialRecordCollection = {
  createIndex(keys: Record<string, 1 | -1>, options: { name: string }): Promise<string>;
  updateOne(
    filter: SpecialFilter,
    update: SpecialUpdate,
    options?: { upsert?: boolean },
  ): Promise<unknown>;
  findOne(filter: SpecialFilter): Promise<SpecialRecordDocument | null>;
  findOneAndUpdate(
    filter: SpecialFilter,
    update: SpecialUpdate,
    options: { returnDocument: "after" },
  ): Promise<SpecialRecordDocument | null>;
  findOneAndDelete(filter: SpecialFilter): Promise<SpecialRecordDocument | null>;
  find(filter: SpecialFilter): {
    sort(sort: Record<string, 1 | -1>): { toArray(): Promise<SpecialRecordDocument[]> };
  };
};

export type EnglishSaveOutcome =
  | { kind: "created" | "updated"; record: EnglishRecord }
  | { kind: "deleted"; record: null }
  | { kind: "conflict"; record: EnglishRecord | null };

const COLLECTION_NAME = "specialRecords";
let indexPromise: Promise<void> | undefined;

function toRecord(document: SpecialRecordDocument): EnglishRecord {
  const { _id, ...record } = document;
  return { id: _id, ...record };
}

async function mongoCollection(): Promise<SpecialRecordCollection> {
  const client = await getMongoClient();
  const database = client.db(getMongoDatabaseName());
  const collection = database.collection<SpecialRecordDocument>(COLLECTION_NAME);
  indexPromise ??= collection.createIndex(
    { moduleId: 1, journalDate: -1 },
    { name: "special_module_date" },
  ).then(() => undefined);
  await indexPromise;
  return collection;
}

export class SpecialRecordStore {
  private readonly getCollection: () => Promise<SpecialRecordCollection>;
  private readonly now: () => Date;

  constructor(
    getCollection: () => Promise<SpecialRecordCollection> = mongoCollection,
    now: () => Date = () => new Date(),
  ) {
    this.getCollection = getCollection;
    this.now = now;
  }

  async getEnglish(journalDate: string): Promise<EnglishRecord | null> {
    const document = await (await this.getCollection()).findOne({
      _id: `english:${journalDate}`,
      moduleId: "english",
    });
    return document ? toRecord(document) : null;
  }

  async listEnglish(): Promise<EnglishRecord[]> {
    const documents = await (await this.getCollection())
      .find({ moduleId: "english" })
      .sort({ journalDate: -1, _id: 1 })
      .toArray();
    return documents.map(toRecord);
  }

  async saveEnglish(input: EnglishSaveInput): Promise<EnglishSaveOutcome> {
    const collection = await this.getCollection();
    const id = `english:${input.journalDate}`;
    const current = await collection.findOne({ _id: id, moduleId: "english" });

    if (!input.text.trim()) {
      if (current === null) return { kind: "deleted", record: null };
      if (input.expectedRevision !== current.revision) {
        return { kind: "conflict", record: toRecord(current) };
      }
      const deleted = await collection.findOneAndDelete({
        _id: id,
        moduleId: "english",
        revision: current.revision,
      });
      return deleted
        ? { kind: "deleted", record: null }
        : { kind: "conflict", record: await this.getEnglish(input.journalDate) };
    }

    const timestamp = this.now().toISOString();
    if (current === null) {
      if (input.expectedRevision !== null) return { kind: "conflict", record: null };
      const document: SpecialRecordDocument = {
        _id: id,
        moduleId: "english",
        journalDate: input.journalDate,
        payload: { schemaVersion: 1, text: input.text },
        revision: 0,
        processingState: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
        lockedAt: null,
      };
      await collection.updateOne({ _id: id }, { $setOnInsert: document }, { upsert: true });
      const stored = await collection.findOne({ _id: id, moduleId: "english" });
      if (stored && stored.payload.text === input.text && stored.revision === 0) {
        return { kind: "created", record: toRecord(stored) };
      }
      return { kind: "conflict", record: stored ? toRecord(stored) : null };
    }

    if (input.expectedRevision !== current.revision) {
      return { kind: "conflict", record: toRecord(current) };
    }
    const updated = await collection.findOneAndUpdate(
      { _id: id, moduleId: "english", revision: current.revision },
      {
        $set: {
          payload: { schemaVersion: 1, text: input.text },
          processingState: "pending",
          updatedAt: timestamp,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: "after" },
    );
    return updated
      ? { kind: "updated", record: toRecord(updated) }
      : { kind: "conflict", record: await this.getEnglish(input.journalDate) };
  }
}

export const specialRecordStore = new SpecialRecordStore();
