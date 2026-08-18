import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyJournalAreas,
  type JournalRecord,
  type JournalUpdateInput,
} from "../../../../lib/journal-record.ts";
import {
  JournalConflictRecordCollisionError,
} from "../../../../lib/journal-store.ts";
import { createJournalRecordPatchHandler } from "./route.ts";

const IDS = {
  record: "11111111-1111-4111-8111-111111111111",
  conflict: "22222222-2222-4222-8222-222222222222",
  device: "33333333-3333-4333-8333-333333333333",
};

function record(overrides: Partial<JournalRecord> = {}): JournalRecord {
  return {
    id: IDS.record,
    deviceId: IDS.device,
    journalDate: "2026-08-18",
    areas: { ...emptyJournalAreas(), insight: "A durable observation" },
    deliveryState: "undelivered",
    editingState: "active",
    revision: 0,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

function updateInput(overrides: Partial<JournalUpdateInput> = {}) {
  return {
    deviceId: IDS.device,
    journalDate: "2026-08-18",
    areas: { ...emptyJournalAreas(), insight: "A revised observation" },
    editingState: "idle" as const,
    expectedRevision: 0,
    conflictRecordId: IDS.conflict,
    ...overrides,
  };
}

function request(body: string) {
  return new Request(`http://localhost/api/journal-records/${IDS.record}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function context(id = IDS.record) {
  return { params: Promise.resolve({ id }) };
}

const authorized = async () => ({ status: "authorized" as const });

test("returns INVALID_JSON for malformed Journal update JSON", async () => {
  const PATCH = createJournalRecordPatchHandler(
    { async update() { assert.fail("invalid JSON must not reach the store"); } },
    authorized,
  );

  const response = await PATCH(request("{not-json"), context());
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "INVALID_JSON");
});

test("returns INVALID_JOURNAL_RECORD for an invalid Journal update", async () => {
  const PATCH = createJournalRecordPatchHandler(
    { async update() { assert.fail("invalid input must not reach the store"); } },
    authorized,
  );

  const response = await PATCH(
    request(JSON.stringify(updateInput({ journalDate: "2026-02-30" }))),
    context(),
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "INVALID_JOURNAL_RECORD");
});

test("returns an updated Journal record", async () => {
  const updated = record({ revision: 1, editingState: "idle" });
  const PATCH = createJournalRecordPatchHandler(
    {
      async update(id, input) {
        assert.equal(id, IDS.record);
        assert.equal(input.expectedRevision, 0);
        return { kind: "updated", record: updated };
      },
    },
    authorized,
  );

  const response = await PATCH(request(JSON.stringify(updateInput())), context());
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.kind, "updated");
  assert.deepEqual(payload.record, updated);
});

test("returns a stale Journal conflict with its conflict record", async () => {
  const current = record({ revision: 1 });
  const conflict = record({
    id: IDS.conflict,
    conflictOf: IDS.record,
    areas: { ...emptyJournalAreas(), feeling: "Stale device text" },
  });
  const PATCH = createJournalRecordPatchHandler(
    { async update() { return { kind: "conflict", record: conflict, current }; } },
    authorized,
  );

  const response = await PATCH(request(JSON.stringify(updateInput())), context());
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.kind, "conflict");
  assert.deepEqual(payload.record, conflict);
  assert.deepEqual(payload.current, current);
});

test("refuses to update a delivered Journal record", async () => {
  const locked = record({ deliveryState: "delivered" });
  const PATCH = createJournalRecordPatchHandler(
    { async update() { return { kind: "locked", record: locked }; } },
    authorized,
  );

  const response = await PATCH(request(JSON.stringify(updateInput())), context());
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "RECORD_LOCKED");
  assert.deepEqual(payload.record, locked);
});

test("returns NOT_FOUND for a Journal record absent from the store", async () => {
  const PATCH = createJournalRecordPatchHandler(
    { async update() { return { kind: "notFound" }; } },
    authorized,
  );

  const response = await PATCH(request(JSON.stringify(updateInput())), context());
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.error.code, "NOT_FOUND");
});

test("maps conflict-record identifier collisions to 409 without acknowledging the mutation", async () => {
  const PATCH = createJournalRecordPatchHandler(
    {
      async update() {
        throw new JournalConflictRecordCollisionError();
      },
    },
    authorized,
  );

  const response = await PATCH(request(JSON.stringify(updateInput())), context());
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "CONFLICT_ID_COLLISION");
  assert.equal(payload.record, undefined);
  assert.equal(payload.kind, undefined);
});
