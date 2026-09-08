import assert from "node:assert/strict";
import test from "node:test";

import { createWorkoutHandler } from "./route.ts";
import type { WorkoutSaveInput } from "../../../../lib/workout-record.ts";

const authorized = async () => ({ status: "authorized" as const });
const body: WorkoutSaveInput = {
  journalDate: "2026-09-07",
  expectedRevision: null,
  clientUpdatedAt: "2026-09-07T10:00:00Z",
  payload: { schemaVersion: 1, sessions: [] },
};

test("allows yesterday but locks older workout edits", async () => {
  let saves = 0;
  const handler = createWorkoutHandler({
    async get() { return null; },
    async list() { return []; },
    async save() { saves += 1; return { kind: "deleted" as const, record: null }; },
  }, authorized, () => new Date("2026-09-08T04:00:00Z"));
  const request = (journalDate: string) => new Request("http://capture.test/api/special-records/workout", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, journalDate }),
  });

  assert.equal((await handler(request("2026-09-07"))).status, 200);
  assert.equal((await handler(request("2026-09-06"))).status, 409);
  assert.equal(saves, 1);
});
