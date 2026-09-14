import assert from "node:assert/strict";
import test from "node:test";

import {
  SpecialRecordStore,
  type SpecialRecordCollection,
  type SpecialRecordDocument,
} from "./special-record-store.ts";

function harness() {
  const documents = new Map<string, SpecialRecordDocument>();
  const matches = (document: SpecialRecordDocument, filter: Partial<SpecialRecordDocument>) =>
    Object.entries(filter).every(([key, value]) => document[key as keyof SpecialRecordDocument] === value);
  const collection: SpecialRecordCollection = {
    async createIndex() { return "special_module_date"; },
    async updateOne(filter, update, options) {
      const current = [...documents.values()].find((item) => matches(item, filter));
      if (!current && options?.upsert && update.$setOnInsert) {
        documents.set(update.$setOnInsert._id, structuredClone(update.$setOnInsert));
      }
      return {};
    },
    async findOne(filter) {
      return structuredClone([...documents.values()].find((item) => matches(item, filter)) ?? null);
    },
    async findOneAndUpdate(filter, update) {
      const current = [...documents.values()].find((item) => matches(item, filter));
      if (!current) return null;
      if (update.$set) Object.assign(current, structuredClone(update.$set));
      if (update.$inc) current.revision += update.$inc.revision;
      return structuredClone(current);
    },
    async findOneAndDelete(filter) {
      const current = [...documents.values()].find((item) => matches(item, filter));
      if (!current) return null;
      documents.delete(current._id);
      return structuredClone(current);
    },
    find(filter) {
      return {
        sort() {
          return {
            async toArray() {
              return [...documents.values()]
                .filter((item) => matches(item, filter))
                .sort((left, right) => right.journalDate.localeCompare(left.journalDate))
                .map((item) => structuredClone(item));
            },
          };
        },
      };
    },
  };
  return {
    documents,
    store: new SpecialRecordStore(
      async () => collection,
      () => new Date("2026-09-06T04:00:00.000Z"),
    ),
  };
}

const base = {
  journalDate: "2026-09-06",
  clientUpdatedAt: "2026-09-06T03:00:00.000Z",
};

test("English daily document creates, revises, and disappears when cleared", async () => {
  const { store, documents } = harness();
  const created = await store.saveEnglish({ ...base, text: "first", expectedRevision: null });
  assert.equal(created.kind, "created");
  assert.equal(created.record?.revision, 0);

  const updated = await store.saveEnglish({ ...base, text: "second", expectedRevision: 0 });
  assert.equal(updated.kind, "updated");
  assert.equal(updated.record?.revision, 1);

  const deleted = await store.saveEnglish({ ...base, text: " \n", expectedRevision: 1 });
  assert.equal(deleted.kind, "deleted");
  assert.equal(documents.size, 0);
});

test("English revision conflict preserves the Cloud value", async () => {
  const { store } = harness();
  await store.saveEnglish({ ...base, text: "cloud", expectedRevision: null });
  const outcome = await store.saveEnglish({ ...base, text: "stale", expectedRevision: 4 });
  assert.equal(outcome.kind, "conflict");
  assert.equal(outcome.record?.payload.text, "cloud");
});

test("English history lists only stored documents newest first", async () => {
  const { store } = harness();
  await store.saveEnglish({ ...base, journalDate: "2026-09-05", text: "older", expectedRevision: null });
  await store.saveEnglish({ ...base, text: "newer", expectedRevision: null });
  assert.deepEqual((await store.listEnglish()).map((record) => record.payload.text), ["newer", "older"]);
});

test("English delivery claims oldest first, locks it, and completes once", async () => {
  const { store } = harness();
  await store.saveEnglish({ ...base, journalDate: "2026-09-04", text: "older", expectedRevision: null });
  await store.saveEnglish({ ...base, journalDate: "2026-09-05", text: "newer", expectedRevision: null });

  const claimed = await store.claimEnglish("2026-09-06");
  assert.equal(claimed?.journalDate, "2026-09-04");
  assert.equal(claimed?.processingState, "processing");
  assert.ok(claimed?.processingAttemptId);

  const locked = await store.saveEnglish({
    ...base,
    journalDate: "2026-09-04",
    text: "late overwrite",
    expectedRevision: claimed!.revision,
  });
  assert.equal(locked.kind, "locked");

  const completed = await store.reportEnglish(claimed!.processingAttemptId!, {
    outcome: "completed",
    result: "Anki added 2",
  });
  assert.equal(completed?.processingState, "processed");
  assert.ok(completed?.lockedAt);
  assert.equal(await store.reportEnglish(claimed!.processingAttemptId!, {
    outcome: "completed",
    result: "duplicate",
  }), null);
});

test("failed English delivery waits until manual retry", async () => {
  const { store } = harness();
  await store.saveEnglish({ ...base, journalDate: "2026-09-05", text: "notes", expectedRevision: null });
  const claimed = await store.claimEnglish("2026-09-06");
  const failed = await store.reportEnglish(claimed!.processingAttemptId!, {
    outcome: "failed",
    error: "Anki is closed",
    result: "partial receipt",
  });
  assert.equal(failed?.processingState, "failed");
  assert.equal(failed?.processingResult, "partial receipt");
  assert.equal((await store.englishDeliveryStatus("2026-09-06")).failed, 1);
  assert.equal(await store.claimEnglish("2026-09-06"), null);
  assert.equal(await store.retryFailedEnglish(), 1);
  const retried = await store.claimEnglish("2026-09-06");
  assert.equal(retried?.processingState, "processing");
  const completed = await store.reportEnglish(retried!.processingAttemptId!, {
    outcome: "completed",
    result: "final receipt",
  });
  assert.deepEqual(JSON.parse(completed!.processingResult!), {
    attempts: ["partial receipt", "final receipt"],
  });
});
