import { getMongoClient, getMongoDatabaseName } from "./mongodb.ts";
import type { WorkoutLibraryRecord, WorkoutLibrarySaveInput } from "./workout-library.ts";

type Document = Omit<WorkoutLibraryRecord, "id"> & { _id: "workout:library" };
type Collection = {
  findOne(filter: Partial<Document>): Promise<Document | null>;
  updateOne(filter: Partial<Document>, update: { $setOnInsert: Document }, options: { upsert: true }): Promise<unknown>;
  findOneAndUpdate(filter: Partial<Document>, update: { $set: Partial<Document>; $inc: { revision: number } }, options: { returnDocument: "after" }): Promise<Document | null>;
};

function record(document: Document): WorkoutLibraryRecord {
  const { _id, ...rest } = document;
  return { id: _id, ...rest };
}

async function collection(): Promise<Collection> {
  const client = await getMongoClient();
  return client.db(getMongoDatabaseName()).collection<Document>("specialRecorderSettings");
}

export class WorkoutLibraryStore {
  private readonly getCollection: () => Promise<Collection>;
  private readonly now: () => Date;

  constructor(getCollection: () => Promise<Collection> = collection, now: () => Date = () => new Date()) {
    this.getCollection = getCollection;
    this.now = now;
  }

  async get() {
    const found = await (await this.getCollection()).findOne({ _id: "workout:library", moduleId: "workout" });
    return found ? record(found) : null;
  }

  async save(input: WorkoutLibrarySaveInput): Promise<{ kind: "created" | "updated"; record: WorkoutLibraryRecord } | { kind: "conflict"; record: WorkoutLibraryRecord | null }> {
    const target = await this.getCollection();
    const current = await target.findOne({ _id: "workout:library", moduleId: "workout" });
    const timestamp = this.now().toISOString();
    if (!current) {
      if (input.expectedRevision !== null) return { kind: "conflict", record: null };
      const document: Document = { _id: "workout:library", moduleId: "workout", payload: input.payload, revision: 0, createdAt: timestamp, updatedAt: timestamp };
      await target.updateOne({ _id: document._id }, { $setOnInsert: document }, { upsert: true });
      const stored = await target.findOne({ _id: document._id, moduleId: "workout" });
      return stored && stored.revision === 0 && JSON.stringify(stored.payload) === JSON.stringify(input.payload)
        ? { kind: "created", record: record(stored) }
        : { kind: "conflict", record: stored ? record(stored) : null };
    }
    if (input.expectedRevision !== current.revision) return { kind: "conflict", record: record(current) };
    const updated = await target.findOneAndUpdate(
      { _id: current._id, moduleId: "workout", revision: current.revision },
      { $set: { payload: input.payload, updatedAt: timestamp }, $inc: { revision: 1 } },
      { returnDocument: "after" },
    );
    return updated ? { kind: "updated", record: record(updated) } : { kind: "conflict", record: await this.get() };
  }
}

export const workoutLibraryStore = new WorkoutLibraryStore();
