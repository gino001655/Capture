import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyJournalAreas,
  type JournalCreateInput,
  type JournalRecord,
} from "../../../lib/journal-record.ts";
import {
  createJournalRecordsGetHandler,
  createJournalRecordsPostHandler,
} from "./route.ts";

const IDS = {
  first: "11111111-1111-4111-8111-111111111111",
  second: "22222222-2222-4222-8222-222222222222",
  device: "33333333-3333-4333-8333-333333333333",
};

function record(overrides: Partial<JournalRecord> = {}): JournalRecord {
  return {
    id: IDS.first,
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

function createInput(overrides: Partial<JournalCreateInput> = {}) {
  return {
    id: IDS.first,
    deviceId: IDS.device,
    journalDate: "2026-08-18",
    areas: { ...emptyJournalAreas(), insight: "A durable observation" },
    ...overrides,
  };
}

function request(body: string) {
  return new Request("http://localhost/api/journal-records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

const authorized = async () => ({ status: "authorized" as const });

test("rejects an unauthorized POST before reading JSON or accessing the store", async () => {
  const POST = createJournalRecordsPostHandler(
    {
      async create() {
        assert.fail("the store must not be accessed before authorization");
      },
    },
    async () => ({ status: "unauthorized" }),
  );
  const input = request("{not-json");

  const response = await POST(input);
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.error.code, "UNAUTHORIZED");
  assert.equal(input.bodyUsed, false);
});

test("returns INVALID_JSON for malformed Journal creation JSON", async () => {
  const POST = createJournalRecordsPostHandler(
    { async create() { assert.fail("invalid JSON must not reach the store"); } },
    authorized,
  );

  const response = await POST(request("{not-json"));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "INVALID_JSON");
});

test("returns INVALID_JOURNAL_RECORD for invalid Journal content", async () => {
  const POST = createJournalRecordsPostHandler(
    { async create() { assert.fail("invalid content must not reach the store"); } },
    authorized,
  );

  const response = await POST(
    request(JSON.stringify(createInput({ areas: emptyJournalAreas() }))),
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "INVALID_JOURNAL_RECORD");
});

test("returns the same record with 201 when a Journal creation is replayed", async () => {
  const records = new Map<string, JournalRecord>();
  const POST = createJournalRecordsPostHandler(
    {
      async create(input) {
        const existing = records.get(input.id);
        if (existing !== undefined) return existing;
        const created = record({ ...input });
        records.set(created.id, created);
        return created;
      },
    },
    authorized,
  );
  const body = JSON.stringify(createInput());

  const first = await POST(request(body));
  const replay = await POST(request(body));

  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  assert.deepEqual((await replay.json()).record, await first.clone().json().then((payload) => payload.record));
  assert.equal(records.size, 1);
});

test("lists exactly one valid Journal date in newest-first order", async () => {
  const GET = createJournalRecordsGetHandler(
    {
      async listDate(date) {
        assert.equal(date, "2026-08-18");
        return [
          record({ id: IDS.second, createdAt: "2026-08-18T00:01:00.000Z" }),
          record(),
        ];
      },
    },
    authorized,
  );

  const response = await GET(
    new Request("http://localhost/api/journal-records?date=2026-08-18"),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.records.map(({ id }: JournalRecord) => id), [
    IDS.second,
    IDS.first,
  ]);
});

test("rejects missing, repeated, and impossible Journal dates", async () => {
  const GET = createJournalRecordsGetHandler(
    { async listDate() { assert.fail("invalid dates must not reach the store"); } },
    authorized,
  );

  for (const url of [
    "http://localhost/api/journal-records",
    "http://localhost/api/journal-records?date=2026-08-18&date=2026-08-19",
    "http://localhost/api/journal-records?date=2026-02-30",
  ]) {
    const response = await GET(new Request(url));
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.error.code, "INVALID_JOURNAL_RECORD");
  }
});
