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
  let currentTime = new Date("2026-08-18T00:00:00.000Z");

  const clock = {
    now: () => new Date(currentTime),
    advance: (milliseconds: number) => {
      currentTime = new Date(currentTime.getTime() + milliseconds);
    },
  };

  const collection: JournalCollection = {
    async createIndex() {
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
    async findOne(filter) {
      return structuredClone(findMatchingDocument(documents, filter) ?? null);
    },
    async findOneAndUpdate(filter, update) {
      const existing = findMatchingDocument(documents, filter);

      if (existing === undefined) return null;

      const next = structuredClone(existing);
      if (update.$set !== undefined) Object.assign(next, update.$set);
      if (update.$inc?.revision !== undefined) next.revision += update.$inc.revision;
      documents.set(next._id, next);
      return structuredClone(next);
    },
    find(filter) {
      return {
        sort(sort) {
          assert.deepEqual(sort, { createdAt: -1, _id: 1 });
          return {
            async toArray() {
              return [...documents.values()]
                .filter((document) => matches(document, filter))
                .sort((left, right) => {
                  const createdAtComparison = right.createdAt.localeCompare(left.createdAt);
                  if (createdAtComparison !== 0) return createdAtComparison;
                  return left._id.localeCompare(right._id);
                })
                .map((document) => structuredClone(document));
            },
          };
        },
      };
    },
  };

  return {
    store: new JournalStore(async () => collection, { now: clock.now }),
    documents,
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
  filter: Partial<JournalDocument>,
): JournalDocument | undefined {
  return [...documents.values()].find((document) => matches(document, filter));
}

function matches(
  document: JournalDocument,
  filter: Partial<JournalDocument>,
): boolean {
  return Object.entries(filter).every(
    ([key, value]) => document[key as keyof JournalDocument] === value,
  );
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
  }
  assert.equal(documents.size, 2);
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
