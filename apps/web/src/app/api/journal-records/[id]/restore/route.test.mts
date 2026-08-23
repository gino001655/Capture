import assert from "node:assert/strict";
import test from "node:test";

import { emptyJournalAreas, type JournalRecord } from "../../../../../lib/journal-record.ts";
import { createJournalRestorePostHandler } from "./route.ts";

const id = "11111111-1111-4111-8111-111111111111";
const restored: JournalRecord = {
  id,
  deviceId: "22222222-2222-4222-8222-222222222222",
  journalDate: "2026-08-23",
  areas: { ...emptyJournalAreas(), insight: "restored" },
  deliveryState: "undelivered",
  editingState: "idle",
  revision: 2,
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T02:00:00.000Z",
};

test("restores a matching trash revision", async () => {
  const POST = createJournalRestorePostHandler(
    {
      async restore(recordId, revision) {
        assert.equal(recordId, id);
        assert.equal(revision, 1);
        return { kind: "restored", record: restored };
      },
    },
    async () => ({ status: "authorized" }),
  );
  const response = await POST(
    new Request(`http://localhost/api/journal-records/${id}/restore`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision: 1 }),
    }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { record: restored });
});

test("returns a conflict instead of overwriting a changed trash record", async () => {
  const POST = createJournalRestorePostHandler(
    {
      async restore() {
        return {
          kind: "conflict",
          record: { ...restored, revision: 3, deletedAt: restored.updatedAt },
        };
      },
    },
    async () => ({ status: "authorized" }),
  );
  const response = await POST(
    new Request(`http://localhost/api/journal-records/${id}/restore`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision: 1 }),
    }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 409);
});
