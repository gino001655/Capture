import assert from "node:assert/strict";
import test from "node:test";

import {
  clampRecorderDate,
  createDateBoundDebounce,
} from "@capture/recorder-kit";

test("a delayed recorder save keeps the date and candidate present when it was queued", async () => {
  let callback: (() => void) | undefined;
  const cleared: unknown[] = [];
  const debounce = createDateBoundDebounce<{ text: string }>({
    delayMs: 800,
    schedule(next) {
      callback = next;
      return 17;
    },
    cancel(handle) {
      cleared.push(handle);
    },
  });
  const saves: Array<{ date: string; text: string }> = [];
  const candidate = { text: "8/20 的內容" };

  debounce.queue("2026-08-20", candidate, async (date, queued) => {
    saves.push({ date, text: queued.text });
  });
  candidate.text = "呼叫端之後改變的內容";
  callback?.();
  await Promise.resolve();

  assert.deepEqual(saves, [{ date: "2026-08-20", text: "8/20 的內容" }]);
  assert.deepEqual(cleared, []);
});

test("replacing a delayed save cancels the earlier timer and keeps the latest immutable candidate", async () => {
  const callbacks = new Map<number, () => void>();
  const cancelled: number[] = [];
  let nextHandle = 1;
  const debounce = createDateBoundDebounce<{ value: number }>({
    delayMs: 800,
    schedule(callback) {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      cancelled.push(handle as number);
      callbacks.delete(handle as number);
    },
  });
  const saves: Array<[string, number]> = [];

  debounce.queue("2026-08-20", { value: 1 }, async (date, candidate) => {
    saves.push([date, candidate.value]);
  });
  debounce.queue("2026-08-20", { value: 2 }, async (date, candidate) => {
    saves.push([date, candidate.value]);
  });
  callbacks.get(2)?.();
  await Promise.resolve();

  assert.deepEqual(cancelled, [1]);
  assert.deepEqual(saves, [["2026-08-20", 2]]);
});

test("recorder date navigation never advances beyond today", () => {
  assert.equal(clampRecorderDate("2026-08-21", "2026-08-20"), "2026-08-20");
  assert.equal(clampRecorderDate("2026-08-19", "2026-08-20"), "2026-08-19");
});
