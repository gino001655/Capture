import assert from "node:assert/strict";
import test from "node:test";

import {
  clampRecorderDate,
  createDateBoundDebounce,
  RECORDER_CATALOG,
  rebaseConflictCandidate,
  recorderDefinition,
} from "./index.ts";

test("recorder ids and ordering are stable and unique", () => {
  assert.deepEqual(
    RECORDER_CATALOG.map(({ id }) => id),
    ["journal", "english", "workout", "food"],
  );
  assert.equal(new Set(RECORDER_CATALOG.map(({ id }) => id)).size, RECORDER_CATALOG.length);
  assert.equal(recorderDefinition("english").symbol, "Aa");
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
