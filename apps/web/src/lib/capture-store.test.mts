import assert from "node:assert/strict";
import test from "node:test";

import {
  CaptureStore,
  type CaptureCollection,
  type CaptureDocument,
} from "./capture-store.ts";

function createCollection() {
  const documents = new Map<string, CaptureDocument>();

  function matches(candidate: CaptureDocument, filter: Record<string, unknown>): boolean {
    if (Array.isArray(filter.$or)) {
      return filter.$or.some((branch) => matches(candidate, branch as Record<string, unknown>));
    }
    return Object.entries(filter).every(([key, expected]) => {
      const actual = candidate[key as keyof CaptureDocument];
      if (typeof expected === "object" && expected !== null) {
        const operator = expected as { $lte?: string; $in?: string[] };
        if (operator.$lte !== undefined) return typeof actual === "string" && actual <= operator.$lte;
        if (operator.$in !== undefined) return operator.$in.includes(String(actual));
      }
      return actual === expected;
    });
  }

  function applyUpdate(document: CaptureDocument, update: Record<string, unknown>) {
    const next = structuredClone(document) as CaptureDocument & Record<string, unknown>;
    if (typeof update.$set === "object" && update.$set !== null) Object.assign(next, update.$set);
    if (typeof update.$unset === "object" && update.$unset !== null) {
      for (const key of Object.keys(update.$unset)) delete next[key];
    }
    return next;
  }

  const collection = {
    async insertOne(document) {
      documents.set(document._id, structuredClone(document));
      return {};
    },
    async findOne(filter) {
      return structuredClone([...documents.values()].find((candidate) => matches(candidate, filter)) ?? null);
    },
    async findOneAndUpdate(filter, update) {
      const document = [...documents.values()]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .find((candidate) => {
          return matches(candidate, filter);
        });

      if (document === undefined) {
        return null;
      }

      const updated = applyUpdate(document, update);
      documents.set(document._id, updated);
      return structuredClone(updated);
    },
    async updateMany(filter, update) {
      let modifiedCount = 0;
      for (const document of documents.values()) {
        if (!matches(document, filter)) continue;
        documents.set(document._id, applyUpdate(document, update));
        modifiedCount += 1;
      }
      return { modifiedCount };
    },
  } as unknown as CaptureCollection;

  return collection;
}

test("moves a capture through pending, processing, and completed", async () => {
  const collection = createCollection();
  const store = new CaptureStore(async () => collection);
  const pending = await store.create("Test capture");

  assert.equal(pending.status, "pending");

  const processing = await store.claimNext();
  assert.equal(processing?.id, pending.id);
  assert.equal(processing?.status, "processing");

  const completed = await store.complete(pending.id, "Processed: Test capture");
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.result, "Processed: Test capture");
  assert.deepEqual(await store.find(pending.id), completed);
});

test("does not claim the same capture twice", async () => {
  const collection = createCollection();
  const store = new CaptureStore(async () => collection);
  await store.create("Only once");

  assert.ok(await store.claimNext());
  assert.equal(await store.claimNext(), undefined);
});

test("does not complete a job before it is claimed", async () => {
  const collection = createCollection();
  const store = new CaptureStore(async () => collection);
  const pending = await store.create("Not claimed");

  assert.equal(await store.complete(pending.id, "Result"), undefined);
  assert.equal((await store.find(pending.id))?.status, "pending");
});

test("failed captures wait fifteen minutes before being claimed again", async () => {
  let now = new Date("2026-09-08T01:00:00.000Z");
  const collection = createCollection();
  const store = new CaptureStore(async () => collection, () => now);
  const capture = await store.create("Retry me");
  await store.claimNext();

  const failed = await store.fail(capture.id, "processor unavailable");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.lastError, "processor unavailable");
  assert.equal(await store.claimNext(), undefined);

  now = new Date("2026-09-08T01:15:00.000Z");
  assert.equal((await store.claimNext())?.id, capture.id);
});

test("an expired processing lease is reclaimed after thirty minutes", async () => {
  let now = new Date("2026-09-08T01:00:00.000Z");
  const collection = createCollection();
  const store = new CaptureStore(async () => collection, () => now);
  const capture = await store.create("Worker crashed");
  await store.claimNext();

  now = new Date("2026-09-08T01:30:00.000Z");
  assert.equal((await store.claimNext())?.id, capture.id);
});

test("manual retry makes failed captures immediately claimable", async () => {
  const collection = createCollection();
  const store = new CaptureStore(async () => collection, () => new Date("2026-09-08T01:00:00.000Z"));
  const capture = await store.create("Retry now");
  await store.claimNext();
  await store.fail(capture.id, "temporary failure");

  assert.equal(await store.retryFailed(), 1);
  assert.equal((await store.claimNext())?.id, capture.id);
});
