import { getMongoClient, getMongoDatabaseName } from "./mongodb.ts";
import type { WorkoutRecord, WorkoutSaveInput } from "./workout-record.ts";

export type WorkoutDocument = Omit<WorkoutRecord, "id"> & { _id: string };
type Filter = Partial<WorkoutDocument>;
type Update = {
  $setOnInsert?: WorkoutDocument;
  $set?: Partial<WorkoutDocument>;
  $inc?: { revision: number };
};

export type WorkoutCollection = {
  updateOne(filter: Filter, update: Update, options?: { upsert?: boolean }): Promise<unknown>;
  findOne(filter: Filter): Promise<WorkoutDocument | null>;
  findOneAndUpdate(filter: Filter, update: Update, options: { returnDocument: "after" }): Promise<WorkoutDocument | null>;
  findOneAndDelete(filter: Filter): Promise<WorkoutDocument | null>;
  find(filter: Filter): { sort(sort: Record<string, 1 | -1>): { toArray(): Promise<WorkoutDocument[]> } };
};

export type WorkoutSaveOutcome =
  | { kind: "created" | "updated"; record: WorkoutRecord }
  | { kind: "deleted"; record: null }
  | { kind: "conflict"; record: WorkoutRecord | null };

function toRecord(document: WorkoutDocument): WorkoutRecord {
  const { _id, ...record } = document;
  return { id: _id, ...record };
}

function samePayload(left: WorkoutRecord["payload"], right: WorkoutRecord["payload"]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function mongoCollection(): Promise<WorkoutCollection> {
  const client = await getMongoClient();
  return client.db(getMongoDatabaseName()).collection<WorkoutDocument>("specialRecords");
}

export class WorkoutStore {
  private readonly getCollection: () => Promise<WorkoutCollection>;
  private readonly now: () => Date;

  constructor(
    getCollection: () => Promise<WorkoutCollection> = mongoCollection,
    now: () => Date = () => new Date(),
  ) {
    this.getCollection = getCollection;
    this.now = now;
  }

  async get(journalDate: string): Promise<WorkoutRecord | null> {
    const document = await (await this.getCollection()).findOne({
      _id: `workout:${journalDate}`,
      moduleId: "workout",
    });
    return document ? toRecord(document) : null;
  }

  async list(): Promise<WorkoutRecord[]> {
    const documents = await (await this.getCollection())
      .find({ moduleId: "workout" })
      .sort({ journalDate: -1, _id: 1 })
      .toArray();
    return documents.map(toRecord);
  }

  async save(input: WorkoutSaveInput): Promise<WorkoutSaveOutcome> {
    const collection = await this.getCollection();
    const id = `workout:${input.journalDate}`;
    const current = await collection.findOne({ _id: id, moduleId: "workout" });
    if (input.payload.sessions.length === 0) {
      if (current === null) return { kind: "deleted", record: null };
      if (input.expectedRevision !== current.revision) return { kind: "conflict", record: toRecord(current) };
      const deleted = await collection.findOneAndDelete({ _id: id, moduleId: "workout", revision: current.revision });
      return deleted ? { kind: "deleted", record: null } : { kind: "conflict", record: await this.get(input.journalDate) };
    }

    const timestamp = this.now().toISOString();
    if (current === null) {
      if (input.expectedRevision !== null) return { kind: "conflict", record: null };
      const document: WorkoutDocument = {
        _id: id,
        moduleId: "workout",
        journalDate: input.journalDate,
        payload: input.payload,
        revision: 0,
        processingState: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
        lockedAt: null,
      };
      await collection.updateOne({ _id: id }, { $setOnInsert: document }, { upsert: true });
      const stored = await collection.findOne({ _id: id, moduleId: "workout" });
      return stored && stored.revision === 0 && samePayload(stored.payload, input.payload)
        ? { kind: "created", record: toRecord(stored) }
        : { kind: "conflict", record: stored ? toRecord(stored) : null };
    }

    if (input.expectedRevision !== current.revision) return { kind: "conflict", record: toRecord(current) };
    const updated = await collection.findOneAndUpdate(
      { _id: id, moduleId: "workout", revision: current.revision },
      { $set: { payload: input.payload, processingState: "pending", updatedAt: timestamp }, $inc: { revision: 1 } },
      { returnDocument: "after" },
    );
    return updated ? { kind: "updated", record: toRecord(updated) } : { kind: "conflict", record: await this.get(input.journalDate) };
  }
}

export const workoutStore = new WorkoutStore();
