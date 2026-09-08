import assert from "node:assert/strict";
import test from "node:test";

import { WorkoutStore, type WorkoutCollection, type WorkoutDocument } from "./workout-store.ts";
import type { WorkoutSaveInput } from "./workout-record.ts";

const input: WorkoutSaveInput = {
  journalDate: "2026-09-08",
  expectedRevision: null,
  clientUpdatedAt: "2026-09-08T02:00:00.000Z",
  payload: {
    schemaVersion: 1,
    sessions: [{
      id: "11111111-1111-4111-8111-111111111111",
      name: "",
      note: "",
      startedAt: "2026-09-08T02:00:00.000Z",
      completedAt: null,
      restTimer: { startedAt: null, elapsedSeconds: 0, running: false },
      exercises: [],
    }],
  },
};

function harness() {
  const documents = new Map<string, WorkoutDocument>();
  const matches = (document: WorkoutDocument, filter: Partial<WorkoutDocument>) =>
    Object.entries(filter).every(([key, value]) => document[key as keyof WorkoutDocument] === value);
  const collection: WorkoutCollection = {
    async updateOne(_filter, update) {
      if (update.$setOnInsert) documents.set(update.$setOnInsert._id, structuredClone(update.$setOnInsert));
      return {};
    },
    async findOne(filter) {
      return structuredClone([...documents.values()].find((document) => matches(document, filter)) ?? null);
    },
    async findOneAndUpdate(filter, update) {
      const current = [...documents.values()].find((document) => matches(document, filter));
      if (!current) return null;
      const next = structuredClone(current);
      if (update.$set) Object.assign(next, update.$set);
      if (update.$inc) next.revision += update.$inc.revision;
      documents.set(next._id, next);
      return structuredClone(next);
    },
    async findOneAndDelete(filter) {
      const current = [...documents.values()].find((document) => matches(document, filter));
      if (!current) return null;
      documents.delete(current._id);
      return structuredClone(current);
    },
    find(filter) {
      return { sort() { return { async toArray() {
        return [...documents.values()]
          .filter((document) => matches(document, filter))
          .sort((left, right) => right.journalDate.localeCompare(left.journalDate))
          .map((document) => structuredClone(document));
      } }; } };
    },
  };
  return { store: new WorkoutStore(async () => collection, () => new Date("2026-09-08T03:00:00Z")), documents };
}

test("creates, revision-updates, lists, and clears a workout day", async () => {
  const { store, documents } = harness();
  const created = await store.save(input);
  assert.equal(created.kind, "created");
  const updated = await store.save({ ...input, expectedRevision: 0, payload: {
    ...input.payload,
    sessions: [{ ...input.payload.sessions[0], name: "Evening" }],
  } });
  assert.equal(updated.kind, "updated");
  assert.equal((await store.list())[0].payload.sessions[0].name, "Evening");
  assert.equal((await store.save({ ...input, expectedRevision: 0 })).kind, "conflict");
  assert.equal((await store.save({ ...input, expectedRevision: 1, payload: { schemaVersion: 1, sessions: [] } })).kind, "deleted");
  assert.equal(documents.size, 0);
});
