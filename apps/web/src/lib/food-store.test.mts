import assert from "node:assert/strict";
import test from "node:test";
import { FoodStore, type FoodCollection, type FoodDocument } from "./food-store.ts";
import { emptyFoodPayload, type FoodSaveInput } from "./food-record.ts";

function harness() {
  const documents = new Map<string, FoodDocument>();
  const matches = (document: FoodDocument, filter: Partial<FoodDocument>) => Object.entries(filter).every(([key, value]) => document[key as keyof FoodDocument] === value);
  const collection: FoodCollection = {
    async updateOne(_filter, update) { if (update.$setOnInsert && !documents.has(update.$setOnInsert._id)) documents.set(update.$setOnInsert._id, structuredClone(update.$setOnInsert)); return {}; },
    async findOne(filter) { return structuredClone([...documents.values()].find((item) => matches(item, filter)) ?? null); },
    async findOneAndUpdate(filter, update) { const current = [...documents.values()].find((item) => matches(item, filter)); if (!current) return null; const next = structuredClone(current); if (update.$set) Object.assign(next, update.$set); if (update.$inc) next.revision += update.$inc.revision; documents.set(next._id, next); return structuredClone(next); },
    async findOneAndDelete(filter) { const current = [...documents.values()].find((item) => matches(item, filter)); if (!current) return null; documents.delete(current._id); return structuredClone(current); },
    find(filter) { return { sort() { return { async toArray() { return [...documents.values()].filter((item) => matches(item, filter)); } }; } }; },
  };
  return new FoodStore(async () => collection, () => new Date("2026-09-08T03:00:00Z"));
}

test("food daily record creates, revision-updates, and clears", async () => {
  const store = harness(); const entry = { id: "11111111-1111-4111-8111-111111111111", name: "蛋", quantity: 2, unit: "顆", calories: 140, proteinGrams: 12, note: "", occurredAt: "2026-09-08T02:00:00Z" };
  const input: FoodSaveInput = { journalDate: "2026-09-08", payload: { ...emptyFoodPayload(), entries: [entry] }, expectedRevision: null, clientUpdatedAt: "2026-09-08T02:00:00Z" };
  assert.equal((await store.save(input)).kind, "created");
  assert.equal((await store.save({ ...input, expectedRevision: 0, payload: { ...input.payload, entries: [{ ...entry, calories: 150 }] } })).kind, "updated");
  assert.equal((await store.save({ ...input, expectedRevision: 1, payload: emptyFoodPayload() })).kind, "deleted");
});
