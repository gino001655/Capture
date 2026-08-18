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
import * as JournalRecordRoute from "./route.ts";
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

test("rejects an unauthorized PATCH before reading JSON, params, or accessing the store", async () => {
  let paramsAwaited = false;
  const PATCH = createJournalRecordPatchHandler(
    {
      async update() {
        assert.fail("the store must not be accessed before authorization");
      },
    },
    async () => ({ status: "unauthorized" }),
  );
  const input = request("{not-json");
  const params = {
    then() {
      paramsAwaited = true;
      throw new Error("params must not be awaited before authorization");
    },
  } as unknown as Promise<{ id: string }>;

  const response = await PATCH(input, { params });
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.error.code, "UNAUTHORIZED");
  assert.equal(input.bodyUsed, false);
  assert.equal(paramsAwaited, false);
});

test("rejects an invalid Journal route id before parsing or accessing the store", async () => {
  let storeCalls = 0;
  const PATCH = createJournalRecordPatchHandler(
    {
      async update() {
        storeCalls += 1;
        assert.fail("an invalid route id must not reach the store");
      },
    },
    authorized,
  );
  const input = request(JSON.stringify(updateInput()));

  const response = await PATCH(input, context("not-a-uuid"));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "INVALID_JOURNAL_RECORD");
  assert.equal(storeCalls, 0);
});

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

type DeleteHandler = (
  request: Request,
  context: ReturnType<typeof context>,
) => Promise<Response>;

function createDeleteHandler(
  store: { delete(id: string): Promise<unknown> },
  authorize = authorized,
): DeleteHandler {
  const factory = (
    JournalRecordRoute as Record<string, unknown>
  ).createJournalRecordDeleteHandler;
  assert.equal(typeof factory, "function");
  if (typeof factory !== "function") {
    return async () => new Response(null, { status: 500 });
  }
  return factory(store, authorize) as DeleteHandler;
}

test("rejects an unauthorized DELETE before awaiting params or accessing the store", async () => {
  let paramsAwaited = false;
  const DELETE = createDeleteHandler(
    {
      async delete() {
        assert.fail("the store must not be accessed before authorization");
      },
    },
    async () => ({ status: "unauthorized" }),
  );
  const params = {
    then() {
      paramsAwaited = true;
      throw new Error("params must not be awaited before authorization");
    },
  } as unknown as Promise<{ id: string }>;

  const response = await DELETE(
    new Request(`http://localhost/api/journal-records/${IDS.record}`, {
      method: "DELETE",
    }),
    { params },
  );
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.error.code, "UNAUTHORIZED");
  assert.equal(paramsAwaited, false);
});

test("rejects an invalid DELETE route id before accessing the store", async () => {
  const DELETE = createDeleteHandler({
    async delete() {
      assert.fail("invalid ids must not reach the store");
    },
  });

  const response = await DELETE(
    new Request("http://localhost/api/journal-records/not-a-uuid", {
      method: "DELETE",
    }),
    context("not-a-uuid"),
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "INVALID_JOURNAL_RECORD");
});

test("maps deleted and already-missing store outcomes to idempotent 204", async () => {
  for (const alreadyMissing of [false, true]) {
    const DELETE = createDeleteHandler({
      async delete(id) {
        assert.equal(id, IDS.record);
        return { kind: "deleted", alreadyMissing };
      },
    });

    const response = await DELETE(
      new Request(`http://localhost/api/journal-records/${IDS.record}`, {
        method: "DELETE",
      }),
      context(),
    );

    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
  }
});

test("maps a delivered DELETE outcome to RECORD_LOCKED without claiming deletion", async () => {
  const lockedRecord = record({ deliveryState: "delivered" });
  const DELETE = createDeleteHandler({
    async delete(id) {
      assert.equal(id, IDS.record);
      return { kind: "locked", record: lockedRecord };
    },
  });

  const response = await DELETE(
    new Request(`http://localhost/api/journal-records/${IDS.record}`, {
      method: "DELETE",
    }),
    context(),
  );
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "RECORD_LOCKED");
  assert.deepEqual(payload.record, lockedRecord);
});
