import assert from "node:assert/strict";
import test from "node:test";

import {
  CaptureStore,
  type CaptureCollection,
  type CaptureDocument,
} from "./capture-store.ts";

function createCollection() {
  const documents = new Map<string, CaptureDocument>();

  const collection: CaptureCollection = {
    async insertOne(document) {
      documents.set(document._id, structuredClone(document));
      return {};
    },
    async findOne(filter) {
      if (typeof filter._id !== "string") {
        return null;
      }

      return structuredClone(documents.get(filter._id) ?? null);
    },
    async findOneAndUpdate(filter, update) {
      const document = [...documents.values()]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .find((candidate) => {
          const idMatches =
            filter._id === undefined || candidate._id === filter._id;
          const statusMatches =
            filter.status === undefined || candidate.status === filter.status;
          return idMatches && statusMatches;
        });

      if (document === undefined || update.$set === undefined) {
        return null;
      }

      const updated = { ...document, ...update.$set } as CaptureDocument;
      documents.set(document._id, updated);
      return structuredClone(updated);
    },
  };

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
