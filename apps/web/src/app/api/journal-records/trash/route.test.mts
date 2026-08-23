import assert from "node:assert/strict";
import test from "node:test";

import { emptyJournalAreas, type TrashedJournalRecord } from "../../../../lib/journal-record.ts";
import { createJournalTrashGetHandler } from "./route.ts";

const record: TrashedJournalRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  journalDate: "2026-08-23",
  areas: { ...emptyJournalAreas(), insight: "recover me" },
  deliveryState: "undelivered",
  editingState: "idle",
  revision: 1,
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T01:00:00.000Z",
  deletedAt: "2026-08-23T01:00:00.000Z",
};

test("lists authorized soft-deleted Journal records", async () => {
  const GET = createJournalTrashGetHandler(
    { async listTrash() { return [record]; } },
    async () => ({ status: "authorized" }),
  );
  const response = await GET(new Request("http://localhost/api/journal-records/trash"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { records: [record] });
});

test("does not expose trash without authorization", async () => {
  const GET = createJournalTrashGetHandler(
    { async listTrash() { assert.fail("store must not be called"); } },
    async () => ({ status: "unauthorized" }),
  );
  assert.equal((await GET(new Request("http://localhost/api/journal-records/trash"))).status, 401);
});
