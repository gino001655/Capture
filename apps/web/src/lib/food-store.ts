import { getMongoClient, getMongoDatabaseName } from "./mongodb.ts";
import { hasCustomFoodTargets, type FoodRecord, type FoodSaveInput } from "./food-record.ts";

export type FoodDocument = Omit<FoodRecord, "id"> & { _id: string };
type Filter = Partial<FoodDocument>;
type Update = { $setOnInsert?: FoodDocument; $set?: Partial<FoodDocument>; $inc?: { revision: number } };
export type FoodCollection = {
  updateOne(filter: Filter, update: Update, options?: { upsert?: boolean }): Promise<unknown>;
  findOne(filter: Filter): Promise<FoodDocument | null>;
  findOneAndUpdate(filter: Filter, update: Update, options: { returnDocument: "after" }): Promise<FoodDocument | null>;
  findOneAndDelete(filter: Filter): Promise<FoodDocument | null>;
  find(filter: Filter): { sort(sort: Record<string, 1 | -1>): { toArray(): Promise<FoodDocument[]> } };
};
type Outcome = { kind: "created" | "updated"; record: FoodRecord } | { kind: "deleted"; record: null } | { kind: "conflict"; record: FoodRecord | null };
function record(document: FoodDocument): FoodRecord { const { _id, ...rest } = document; return { id: _id, ...rest }; }
async function collection(): Promise<FoodCollection> { const client = await getMongoClient(); return client.db(getMongoDatabaseName()).collection<FoodDocument>("specialRecords"); }

export class FoodStore {
  private readonly getCollection: () => Promise<FoodCollection>;
  private readonly now: () => Date;
  constructor(getCollection: () => Promise<FoodCollection> = collection, now: () => Date = () => new Date()) { this.getCollection = getCollection; this.now = now; }
  async get(journalDate: string) { const found = await (await this.getCollection()).findOne({ _id: `food:${journalDate}`, moduleId: "food" }); return found ? record(found) : null; }
  async list() { return (await (await this.getCollection()).find({ moduleId: "food" }).sort({ journalDate: -1, _id: 1 }).toArray()).map(record); }
  async save(input: FoodSaveInput): Promise<Outcome> {
    const target = await this.getCollection(); const id = `food:${input.journalDate}`; const current = await target.findOne({ _id: id, moduleId: "food" });
    if (!input.payload.entries.length && !hasCustomFoodTargets(input.payload)) {
      if (!current) return { kind: "deleted", record: null };
      if (input.expectedRevision !== current.revision) return { kind: "conflict", record: record(current) };
      const deleted = await target.findOneAndDelete({ _id: id, moduleId: "food", revision: current.revision });
      return deleted ? { kind: "deleted", record: null } : { kind: "conflict", record: await this.get(input.journalDate) };
    }
    const timestamp = this.now().toISOString();
    if (!current) {
      if (input.expectedRevision !== null) return { kind: "conflict", record: null };
      const document: FoodDocument = { _id: id, moduleId: "food", journalDate: input.journalDate, payload: input.payload, revision: 0, processingState: "pending", createdAt: timestamp, updatedAt: timestamp, lockedAt: null };
      await target.updateOne({ _id: id }, { $setOnInsert: document }, { upsert: true });
      const stored = await target.findOne({ _id: id, moduleId: "food" });
      return stored && stored.revision === 0 && JSON.stringify(stored.payload) === JSON.stringify(input.payload) ? { kind: "created", record: record(stored) } : { kind: "conflict", record: stored ? record(stored) : null };
    }
    if (input.expectedRevision !== current.revision) return { kind: "conflict", record: record(current) };
    const updated = await target.findOneAndUpdate({ _id: id, moduleId: "food", revision: current.revision }, { $set: { payload: input.payload, processingState: "pending", updatedAt: timestamp }, $inc: { revision: 1 } }, { returnDocument: "after" });
    return updated ? { kind: "updated", record: record(updated) } : { kind: "conflict", record: await this.get(input.journalDate) };
  }
}
export const foodStore = new FoodStore();
