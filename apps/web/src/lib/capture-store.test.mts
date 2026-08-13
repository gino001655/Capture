import assert from "node:assert/strict";
import test from "node:test";

import { CaptureStore } from "./capture-store.ts";

test("moves a capture through pending, processing, and completed", () => {
  const store = new CaptureStore();
  const pending = store.create("Test capture");

  assert.equal(pending.status, "pending");

  const processing = store.claimNext();
  assert.equal(processing?.id, pending.id);
  assert.equal(processing?.status, "processing");

  const completed = store.complete(pending.id, "Processed: Test capture");
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.result, "Processed: Test capture");
  assert.equal(store.find(pending.id), completed);
});

test("does not claim the same capture twice", () => {
  const store = new CaptureStore();
  store.create("Only once");

  assert.ok(store.claimNext());
  assert.equal(store.claimNext(), undefined);
});

test("does not complete a job before it is claimed", () => {
  const store = new CaptureStore();
  const pending = store.create("Not claimed");

  assert.equal(store.complete(pending.id, "Result"), undefined);
  assert.equal(store.find(pending.id)?.status, "pending");
});
