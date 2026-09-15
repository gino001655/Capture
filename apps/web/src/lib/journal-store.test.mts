import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyJournalAreas,
  type DeliveryState,
  type JournalAreaKey,
  type JournalAreas,
  type JournalCreateInput,
  type JournalUpdateInput,
} from "./journal-record.ts";
import {
  JournalStore,
  type JournalCollection,
  type JournalDocument,
} from "./journal-store.ts";

type InitializeJournalCollection = (
  getCollection: (name: string) => JournalCollection,
) => Promise<JournalCollection>;

const { initializeJournalCollection } = (await import("./journal-store.ts")) as {
  initializeJournalCollection?: InitializeJournalCollection;
};

const IDS = {
  older: "11111111-1111-4111-8111-111111111111",
  newer: "22222222-2222-4222-8222-222222222222",
  conflict: "33333333-3333-4333-8333-333333333333",
  device: "44444444-4444-4444-8444-444444444444",
};

function areasWith(key: JournalAreaKey, text: string): JournalAreas {
  return { ...emptyJournalAreas(), [key]: text };
}

function createInput(id: string): JournalCreateInput {
  return {
    id,
    deviceId: IDS.device,
    journalDate: "2026-08-18",
    areas: areasWith("insight", "An enduring observation"),
  };
}

function updateInput(
  overrides: Partial<JournalUpdateInput> = {},
): JournalUpdateInput {
  return {
    deviceId: IDS.device,
    journalDate: "2026-08-18",
    areas: areasWith("insight", "A revised observation"),
    editingState: "idle",
    expectedRevision: 0,
    conflictRecordId: IDS.conflict,
    ...overrides,
  };
}

function createHarness() {
  const documents = new Map<string, JournalDocument>();
  const indexCalls: Array<{
    keys: Record<string, 1 | -1>;
    options: { name: string };
  }> = [];
  let currentTime = new Date("2026-08-18T00:00:00.000Z");

  const clock = {
    now: () => new Date(currentTime),
    advance: (milliseconds: number) => {
      currentTime = new Date(currentTime.getTime() + milliseconds);
    },
  };

  const collection: JournalCollection = {
    async createIndex(keys, options) {
      indexCalls.push({ keys, options });
      return "journal_date_newest_first";
    },
    async updateOne(filter, update, options) {
      const existing = findMatchingDocument(documents, filter);

      if (existing !== undefined) {
        return { matchedCount: 1, modifiedCount: 0, upsertedCount: 0 };
      }

      if (options?.upsert && update.$setOnInsert !== undefined) {
        const inserted = structuredClone(update.$setOnInsert);
        documents.set(inserted._id, inserted);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }

      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    },
    async updateMany(filter, update) {
      let modifiedCount = 0;
      for (const [id, existing] of documents) {
        if (!matches(existing, filter)) continue;
        const next = structuredClone(existing);
        if (update.$set !== undefined) Object.assign(next, update.$set);
        if (update.$unset !== undefined) {
          for (const key of Object.keys(update.$unset)) {
            delete (next as unknown as Record<string, unknown>)[key];
          }
        }
        if (update.$inc?.revision !== undefined) next.revision += update.$inc.revision;
        if (update.$inc?.deliveryAttempts !== undefined) {
          next.deliveryAttempts = (next.deliveryAttempts ?? 0) + update.$inc.deliveryAttempts;
        }
        if (update.$inc?.todoDeliveryAttempts !== undefined) {
          next.todoDeliveryAttempts = (next.todoDeliveryAttempts ?? 0) + update.$inc.todoDeliveryAttempts;
        }
        documents.set(id, next);
        modifiedCount += 1;
      }
      return { modifiedCount };
    },
    async findOne(filter) {
      return structuredClone(findMatchingDocument(documents, filter) ?? null);
    },
    async findOneAndUpdate(filter, update) {
      const existing = findMatchingDocument(documents, filter);

      if (existing === undefined) return null;

      const next = structuredClone(existing);
      if (update.$set !== undefined) Object.assign(next, update.$set);
      if (update.$unset !== undefined) {
        for (const key of Object.keys(update.$unset)) {
          delete (next as unknown as Record<string, unknown>)[key];
        }
      }
      if (update.$inc?.revision !== undefined) next.revision += update.$inc.revision;
      if (update.$inc?.todoDeliveryAttempts !== undefined) {
        next.todoDeliveryAttempts = (next.todoDeliveryAttempts ?? 0) + update.$inc.todoDeliveryAttempts;
      }
      documents.set(next._id, next);
      return structuredClone(next);
    },
    find(filter) {
      return {
        sort(sort) {
          const sorted = () => [...documents.values()]
            .filter((document) => matches(document, filter))
            .sort((left, right) => compareDocuments(left, right, sort))
            .map((document) => structuredClone(document));
          return {
            limit(limit) {
              return { async toArray() { return sorted().slice(0, limit); } };
            },
            async toArray() {
              return sorted();
            },
          };
        },
      };
    },
  };

  return {
    store: new JournalStore(async () => collection, { now: clock.now }),
    collection,
    documents,
    indexCalls,
    clock,
    setDeliveryState(id: string, deliveryState: DeliveryState) {
      const document = documents.get(id);
      assert.ok(document);
      document.deliveryState = deliveryState;
    },
  };
}

function findMatchingDocument(
  documents: Map<string, JournalDocument>,
  filter: Record<string, unknown>,
): JournalDocument | undefined {
  return [...documents.values()].find((document) => matches(document, filter));
}

function matches(
  document: JournalDocument,
  filter: Record<string, unknown>,
): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$or") {
      return (value as Record<string, unknown>[]).some((entry) => matches(document, entry));
    }
    if (typeof value === "object" && value !== null && "$exists" in value) {
      return Object.hasOwn(document, key) === (value as { $exists: boolean }).$exists;
    }
    if (typeof value === "object" && value !== null && "$lt" in value) {
      return String(document[key as keyof JournalDocument]) < String((value as { $lt: unknown }).$lt);
    }
    if (typeof value === "object" && value !== null && "$lte" in value) {
      return String(document[key as keyof JournalDocument]) <= String((value as { $lte: unknown }).$lte);
    }
    if (typeof value === "object" && value !== null && "$in" in value) {
      return (value as { $in: unknown[] }).$in.includes(document[key as keyof JournalDocument]);
    }
    return document[key as keyof JournalDocument] === value;
  });
}

function compareDocuments(
  left: JournalDocument,
  right: JournalDocument,
  sort: Record<string, 1 | -1>,
): number {
  for (const [key, direction] of Object.entries(sort)) {
    const leftValue = String(left[key as keyof JournalDocument] ?? "");
    const rightValue = String(right[key as keyof JournalDocument] ?? "");
    const comparison = leftValue.localeCompare(rightValue);
    if (comparison !== 0) return comparison * direction;
  }
  return 0;
}

test("lists one date newest-first without moving edited records", async () => {
  const { store, clock } = createHarness();
  const older = await store.create(createInput(IDS.older));
  clock.advance(1_000);
  const newer = await store.create(createInput(IDS.newer));
  const outcome = await store.update(
    older.id,
    updateInput({ expectedRevision: 0 }),
  );

  assert.equal(outcome.kind, "updated");
  assert.deepEqual(
    (await store.listDate("2026-08-18")).map(({ id }) => id),
    [newer.id, older.id],
  );
});

test("replaying create with the same id returns the original record", async () => {
  const { store, documents } = createHarness();
  const first = await store.create(createInput(IDS.older));
  const replay = await store.create(createInput(IDS.older));

  assert.deepEqual(replay, first);
  assert.equal(documents.size, 1);
});

test("preserves a stale edit as one idempotent conflict copy", async () => {
  const { store, documents } = createHarness();
  const original = await store.create(createInput(IDS.older));
  const first = await store.update(
    original.id,
    updateInput({ expectedRevision: 0 }),
  );
  assert.equal(first.kind, "updated");

  const staleInput = updateInput({
    expectedRevision: 0,
    conflictRecordId: IDS.conflict,
    areas: areasWith("feeling", "stale device text"),
  });
  const conflict = await store.update(original.id, staleInput);
  const retry = await store.update(original.id, staleInput);

  assert.equal(conflict.kind, "conflict");
  assert.equal(retry.kind, "conflict");
  if (conflict.kind === "conflict") {
    assert.equal(conflict.record.conflictOf, original.id);
    assert.equal(conflict.record.areas.feeling, "stale device text");
  }
  assert.deepEqual(retry, conflict);
  assert.equal(documents.size, 2);
});

test("rejects a stale mutation whose conflict id is the source id", async () => {
  const { store, documents } = createHarness();
  const original = await store.create(createInput(IDS.older));
  await store.update(original.id, updateInput({ expectedRevision: 0 }));

  await assert.rejects(
    store.update(
      original.id,
      updateInput({
        expectedRevision: 0,
        conflictRecordId: original.id,
        areas: areasWith("feeling", "stale device text"),
      }),
    ),
    { name: "JournalConflictRecordCollisionError" },
  );
  assert.equal(documents.size, 1);
  assert.equal(documents.get(original.id)?.conflictOf, undefined);
});

test("rejects a stale mutation whose conflict id belongs to another record", async () => {
  const { store, documents } = createHarness();
  const original = await store.create(createInput(IDS.older));
  const occupied = await store.create(createInput(IDS.newer));
  await store.update(original.id, updateInput({ expectedRevision: 0 }));
  const occupiedBefore = structuredClone(documents.get(occupied.id));

  await assert.rejects(
    store.update(
      original.id,
      updateInput({
        expectedRevision: 0,
        conflictRecordId: occupied.id,
        areas: areasWith("feeling", "stale device text"),
      }),
    ),
    { name: "JournalConflictRecordCollisionError" },
  );
  assert.deepEqual(documents.get(occupied.id), occupiedBefore);
});

test("rejects incompatible reuse of an existing conflict id", async () => {
  const { store, documents } = createHarness();
  const original = await store.create(createInput(IDS.older));
  await store.update(original.id, updateInput({ expectedRevision: 0 }));
  const firstStaleInput = updateInput({
    expectedRevision: 0,
    areas: areasWith("feeling", "first stale device text"),
  });
  await store.update(original.id, firstStaleInput);

  await assert.rejects(
    store.update(
      original.id,
      updateInput({
        expectedRevision: 0,
        areas: areasWith("feeling", "different stale device text"),
      }),
    ),
    { name: "JournalConflictRecordCollisionError" },
  );
  assert.equal(
    documents.get(IDS.conflict)?.areas.feeling,
    "first stale device text",
  );
});

test("initializes the journalRecords collection with its newest-first index", async () => {
  const { collection, indexCalls } = createHarness();
  let requestedName: string | undefined;

  assert.equal(typeof initializeJournalCollection, "function");
  if (initializeJournalCollection === undefined) return;

  const initialized = await initializeJournalCollection((name) => {
    requestedName = name;
    return collection;
  });

  assert.equal(initialized, collection);
  assert.equal(requestedName, "journalRecords");
  assert.deepEqual(indexCalls, [
    {
      keys: { journalDate: 1, createdAt: -1, _id: 1 },
      options: { name: "journal_date_newest_first" },
    },
    {
      keys: {
        deliveryState: 1,
        editingState: 1,
        journalDate: 1,
        nextDeliveryAttemptAt: 1,
        createdAt: 1,
      },
      options: { name: "journal_delivery_claim" },
    },
  ]);
});

test("refuses to edit a delivered record", async () => {
  const { store, setDeliveryState } = createHarness();
  const record = await store.create(createInput(IDS.older));
  setDeliveryState(record.id, "delivered");

  const outcome = await store.update(
    record.id,
    updateInput({ expectedRevision: 0 }),
  );

  assert.equal(outcome.kind, "locked");
});

async function deleteFromStore(
  store: JournalStore,
  id: string,
  expectedRevision: number,
): Promise<{ kind: string; record?: unknown }> {
  const deleteRecord = (
    store as unknown as {
      delete?: (
        id: string,
        expectedRevision: number,
      ) => Promise<{ kind: string; record?: unknown }>;
    }
  ).delete;
  assert.equal(typeof deleteRecord, "function");
  if (deleteRecord === undefined) return { kind: "missing-method" };
  return deleteRecord.call(store, id, expectedRevision);
}

test("moves an undelivered Journal record to the trash", async () => {
  const { store, documents } = createHarness();
  const record = await store.create(createInput(IDS.older));

  const outcome = await deleteFromStore(store, record.id, 0);

  assert.deepEqual(outcome, { kind: "deleted" });
  assert.equal(documents.has(record.id), true);
  assert.equal(typeof documents.get(record.id)?.deletedAt, "string");
  assert.equal(documents.get(record.id)?.revision, 1);
  assert.deepEqual(await store.listDate("2026-08-18"), []);
});

test("lists trashed records and restores one revision-safely", async () => {
  const { store, documents } = createHarness();
  const record = await store.create(createInput(IDS.older));
  await store.delete(record.id, 0);

  const trashed = await store.listTrash();
  assert.equal(trashed.length, 1);
  assert.equal(trashed[0]?.id, record.id);
  assert.equal(trashed[0]?.revision, 1);

  const outcome = await store.restore(record.id, 1);
  assert.equal(outcome.kind, "restored");
  assert.equal(documents.get(record.id)?.deletedAt, undefined);
  assert.equal(documents.get(record.id)?.revision, 2);
  assert.equal((await store.listDate("2026-08-18")).length, 1);
});

test("deleting an already-missing Journal record is idempotently successful", async () => {
  const { store } = createHarness();

  const outcome = await deleteFromStore(store, IDS.older, 0);

  assert.deepEqual(outcome, { kind: "missing" });
});

test("refuses to delete a delivered Journal record and returns the locked record", async () => {
  const { store, documents, setDeliveryState } = createHarness();
  const record = await store.create(createInput(IDS.older));
  setDeliveryState(record.id, "delivered");

  const outcome = await deleteFromStore(store, record.id, 0);

  assert.equal(outcome.kind, "locked");
  assert.equal((outcome.record as { id: string }).id, record.id);
  assert.equal(documents.has(record.id), true);
  assert.equal(documents.get(record.id)?.deliveryState, "delivered");
});

test("a stale DELETE returns the newer undelivered record without removing it", async () => {
  const { store, documents } = createHarness();
  const original = await store.create(createInput(IDS.older));
  const update = await store.update(
    original.id,
    updateInput({
      expectedRevision: 0,
      areas: areasWith("event", "newer server text"),
    }),
  );
  assert.equal(update.kind, "updated");

  const outcome = await deleteFromStore(store, original.id, 0);

  assert.equal(outcome.kind, "conflict");
  assert.equal((outcome.record as JournalDocument).revision, 1);
  assert.equal(
    (outcome.record as JournalDocument).areas.event,
    "newer server text",
  );
  assert.equal(documents.get(original.id)?.revision, 1);
  assert.equal(documents.get(original.id)?.areas.event, "newer server text");
});

test("claims one eligible date oldest-first and delivers the claimed records together", async () => {
  const { store, clock, documents } = createHarness();
  const older = await store.create(createInput(IDS.older));
  await store.update(older.id, updateInput({ expectedRevision: 0 }));
  clock.advance(1_000);
  const newer = await store.create(createInput(IDS.newer));
  await store.update(newer.id, updateInput({
    expectedRevision: 0,
    conflictRecordId: "55555555-5555-4555-8555-555555555555",
  }));
  clock.advance(24 * 60 * 60 * 1_000);

  const claim = await store.claimDelivery(clock.now());

  assert.ok(claim);
  assert.equal(claim.journalDate, "2026-08-18");
  assert.deepEqual(claim.records.map(({ id }) => id), [older.id, newer.id]);
  assert.equal(documents.get(older.id)?.deliveryState, "processing");

  const completed = await store.completeDelivery(claim.attemptId, "contentMd5:next");
  assert.deepEqual(completed, { journalDate: "2026-08-18", recordCount: 2 });
  assert.equal(documents.get(older.id)?.deliveryState, "delivered");
  assert.equal(documents.get(newer.id)?.deliveryState, "delivered");
  assert.equal(documents.get(older.id)?.deliveryAttemptId, undefined);
});

test("queues only explicit continuation fields for independent Todo delivery", async () => {
  const { store, clock, documents } = createHarness();
  const action = await store.create({ ...createInput(IDS.older), areas: areasWith("event", "寄出文件") });
  await store.update(action.id, updateInput({
    expectedRevision: 0,
    areas: areasWith("event", "寄出文件"),
  }));
  clock.advance(24 * 60 * 60 * 1_000);
  const journal = await store.claimDelivery(clock.now());
  assert.ok(journal);
  await store.completeDelivery(journal.attemptId, "journal-ok");
  assert.equal(documents.get(action.id)?.todoDeliveryState, "pending");

  const todo = await store.claimTodoDelivery(clock.now());
  assert.equal(todo?.record.id, action.id);
  assert.equal(todo?.record.areas.event, "寄出文件");
  assert.equal(documents.get(action.id)?.todoDeliveryState, "processing");

  const completed = await store.completeTodoDelivery(todo!.attemptId, "todo-ok");
  assert.equal(completed?.todoDeliveryState, "delivered");
  assert.equal(await store.claimTodoDelivery(clock.now()), undefined);
});

test("returns a failed delivery to the queue with a fifteen-minute retry time", async () => {
  const { store, clock, documents } = createHarness();
  const record = await store.create(createInput(IDS.older));
  await store.update(record.id, updateInput({ expectedRevision: 0 }));
  clock.advance(24 * 60 * 60 * 1_000);
  const claim = await store.claimDelivery(clock.now());
  assert.ok(claim);

  const failedAt = clock.now();
  const failed = await store.failDelivery(claim.attemptId, "Heptabase is offline");

  assert.deepEqual(failed, { journalDate: "2026-08-18", recordCount: 1 });
  assert.equal(documents.get(record.id)?.deliveryState, "undelivered");
  assert.equal(documents.get(record.id)?.deliveryError, "Heptabase is offline");
  assert.equal(
    documents.get(record.id)?.nextDeliveryAttemptAt,
    new Date(failedAt.getTime() + 15 * 60 * 1_000).toISOString(),
  );
  assert.equal(await store.claimDelivery(clock.now()), undefined);
  clock.advance(15 * 60 * 1_000);
  assert.ok(await store.claimDelivery(clock.now()));
});

test("summarizes pending and failed dates and makes failures immediately retryable", async () => {
  const { store, clock } = createHarness();
  const record = await store.create(createInput(IDS.older));
  await store.update(record.id, updateInput({ expectedRevision: 0 }));
  clock.advance(24 * 60 * 60 * 1_000);
  const claim = await store.claimDelivery(clock.now());
  assert.ok(claim);
  await store.failDelivery(claim.attemptId, "Heptabase conflict");

  assert.deepEqual(await store.getDeliveryStatus(), {
    pendingRecordCount: 1,
    processingRecordCount: 0,
    failedRecordCount: 1,
    dates: [{
      journalDate: "2026-08-18",
      pending: 1,
      processing: 0,
      failed: 1,
      lastError: "Heptabase conflict",
      nextAttemptAt: "2026-08-19T00:15:00.000Z",
    }],
  });
  assert.equal(await store.retryFailedDeliveries(), 1);
  assert.ok(await store.claimDelivery(clock.now()));
});
