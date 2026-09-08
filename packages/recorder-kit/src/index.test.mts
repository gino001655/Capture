import assert from "node:assert/strict";
import test from "node:test";

import {
  clampRecorderDate,
  createDateBoundDebounce,
  RECORDER_CATALOG,
  rebaseConflictCandidate,
  resolveVersionedPayloadConflict,
  recorderDefinition,
  validateRecorderCatalog,
} from "./index.ts";

test("recorder ids and ordering are stable and unique", () => {
  assert.deepEqual(
    RECORDER_CATALOG.map(({ id }) => id),
    ["journal", "english", "workout", "food"],
  );
  assert.equal(new Set(RECORDER_CATALOG.map(({ id }) => id)).size, RECORDER_CATALOG.length);
  assert.equal(recorderDefinition("english").symbol, "Aa");
});

test("recorder catalog validation explains contributor mistakes", () => {
  assert.throws(
    () => validateRecorderCatalog([
      { id: "reading", order: 10, label: "Reading", symbol: "R", kind: "special" },
      { id: "reading", order: 20, label: "Duplicate", symbol: "D", kind: "special" },
    ]),
    /duplicate id.*reading/i,
  );
  assert.throws(
    () => validateRecorderCatalog([
      { id: "bad id", order: 10, label: "Bad", symbol: "toolong", kind: "special" },
    ]),
    /lowercase kebab-case/i,
  );
  assert.throws(
    () => validateRecorderCatalog([
      { id: "one", order: 10, label: "One", symbol: "1", kind: "special" },
      { id: "two", order: 10, label: "Two", symbol: "2", kind: "special" },
    ]),
    /duplicate order.*10/i,
  );
});

test("shared recorder autosave binds the queued date and a value snapshot", async () => {
  let callback: (() => void) | undefined;
  const saved: Array<[string, string]> = [];
  const debounce = createDateBoundDebounce<{ text: string }>({
    delayMs: 800,
    schedule(next) {
      callback = next;
      return 1;
    },
    cancel() {},
  });
  const candidate = { text: "original" };

  debounce.queue("2026-09-08", candidate, async (date, value) => {
    saved.push([date, value.text]);
  });
  candidate.text = "changed";
  callback?.();
  await Promise.resolve();

  assert.deepEqual(saved, [["2026-09-08", "original"]]);
  assert.equal(clampRecorderDate("2026-09-09", "2026-09-08"), "2026-09-08");
});

test("keeping a local conflict preserves its value and rebases only the Cloud revision", () => {
  const local = {
    payload: { entries: [{ id: "local", note: "do not lose" }] },
    revision: 2,
    pending: true,
    clientUpdatedAt: "2026-09-08T01:00:00.000Z",
  };

  assert.deepEqual(rebaseConflictCandidate(local, 5), {
    payload: { entries: [{ id: "local", note: "do not lose" }] },
    revision: 5,
    pending: true,
    clientUpdatedAt: "2026-09-08T01:00:00.000Z",
  });
  assert.notEqual(rebaseConflictCandidate(local, null), local);
  assert.equal(rebaseConflictCandidate(local, null).revision, null);
});

test("library conflicts keep the complete local payload until the user chooses", () => {
  const local = { schemaVersion: 1 as const, entries: [{ id: "local", name: "本機名稱" }] };
  const cloud = {
    payload: { schemaVersion: 1 as const, entries: [{ id: "cloud", name: "雲端名稱" }] },
    revision: 7,
  };
  const empty = { schemaVersion: 1 as const, entries: [] as Array<{ id: string; name: string }> };

  const keepLocal = resolveVersionedPayloadConflict(local, cloud, "local", empty);
  assert.deepEqual(keepLocal, { payload: local, revision: 7, retry: true });
  assert.notEqual(keepLocal.payload, local);

  assert.deepEqual(
    resolveVersionedPayloadConflict(local, cloud, "cloud", empty),
    { payload: cloud.payload, revision: 7, retry: false },
  );
  assert.deepEqual(
    resolveVersionedPayloadConflict(local, null, "cloud", empty),
    { payload: empty, revision: null, retry: false },
  );
});
