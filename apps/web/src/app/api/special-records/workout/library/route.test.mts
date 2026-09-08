import assert from "node:assert/strict";
import test from "node:test";

import { createWorkoutLibraryHandler } from "./route.ts";

const entry = { id: "11111111-1111-4111-8111-111111111111", name: "深蹲", order: 0, archived: false };
const current = { id: "workout:library" as const, moduleId: "workout" as const, payload: { schemaVersion: 1 as const, entries: [entry] }, revision: 0, createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z" };
const authorized = async () => ({ status: "authorized" as const });

test("a library entry used by workout history can be archived but not deleted", async () => {
  let saved = 0;
  const handler = createWorkoutLibraryHandler({
    async get() { return current; },
    async save(input) { saved += 1; return { kind: "updated" as const, record: { ...current, payload: input.payload, revision: 1 } }; },
  }, {
    async list() { return [{ id: "workout:2026-09-08", moduleId: "workout" as const, journalDate: "2026-09-08", payload: { schemaVersion: 1 as const, sessions: [{ id: "22222222-2222-4222-8222-222222222222", name: "", note: "", startedAt: "2026-09-08T00:00:00Z", completedAt: null, restTimer: { startedAt: null, elapsedSeconds: 0, running: false }, exercises: [{ id: "33333333-3333-4333-8333-333333333333", kind: "strength" as const, libraryEntryId: entry.id, name: "深蹲", note: "", sets: [] }] } ] }, revision: 0, processingState: "pending" as const, createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z", lockedAt: null }]; },
  }, authorized);
  const request = (entries: typeof current.payload.entries) => new Request("http://capture.test/api/special-records/workout/library", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: { schemaVersion: 1, entries }, expectedRevision: 0 }) });

  assert.equal((await handler(request([]))).status, 409);
  assert.equal((await handler(request([{ ...entry, archived: true }]))).status, 200);
  assert.equal(saved, 1);
});
