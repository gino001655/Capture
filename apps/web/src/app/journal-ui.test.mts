import assert from "node:assert/strict";
import test from "node:test";

import { emptyJournalAreas, type JournalRecord } from "../lib/journal-record.ts";
import { createLocalState, editActiveArea } from "./journal-session.ts";

const uiModule = await import("./journal-ui.ts").catch(() => ({}));
const {
  formatJournalDateLabel,
  parseJournalRecordList,
  persistJournalTheme,
  reconcileJournalRecordList,
  readJournalTheme,
} = uiModule as Record<string, ((...args: never[]) => unknown) | undefined>;

function record(overrides: Partial<JournalRecord>): JournalRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    deviceId: "00000000-0000-4000-8000-000000000002",
    journalDate: "2026-08-18",
    areas: { ...emptyJournalAreas(), event: "walked" },
    deliveryState: "undelivered",
    editingState: "idle",
    revision: 0,
    createdAt: "2026-08-18T01:00:00.000Z",
    updatedAt: "2026-08-18T01:00:00.000Z",
    ...overrides,
  };
}

test("the toolbar date label uses compact month.day text", () => {
  assert.equal(typeof formatJournalDateLabel, "function");
  if (formatJournalDateLabel === undefined) return;
  assert.equal(formatJournalDateLabel("2026-08-03"), "8.3");
});

test("a Journal list accepts only the selected date and normalizes newest first", () => {
  assert.equal(typeof parseJournalRecordList, "function");
  if (parseJournalRecordList === undefined) return;
  const older = record({
    id: "00000000-0000-4000-8000-000000000003",
    createdAt: "2026-08-18T01:00:00.000Z",
  });
  const newer = record({
    id: "00000000-0000-4000-8000-000000000004",
    createdAt: "2026-08-18T02:00:00.000Z",
  });

  const records = parseJournalRecordList(
    { records: [older, newer] },
    "2026-08-18",
  ) as JournalRecord[];

  assert.deepEqual(records.map(({ id }) => id), [newer.id, older.id]);
  assert.throws(() =>
    parseJournalRecordList(
      { records: [record({ journalDate: "2026-08-17" })] },
      "2026-08-18",
    ),
  );
});

test("a same-date local active draft appears first and is selected before Cloud acknowledgement", () => {
  assert.equal(typeof reconcileJournalRecordList, "function");
  if (reconcileJournalRecordList === undefined) return;
  const active = editActiveArea(
    createLocalState(
      new Date("2026-08-18T01:00:00.000Z"),
      (() => {
        let next = 10;
        return () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
      })(),
    ),
    "question",
    "visible while offline",
  ).active;
  const cloud = record({
    id: "00000000-0000-4000-8000-000000000020",
    createdAt: "2026-08-18T03:00:00.000Z",
  });

  const result = reconcileJournalRecordList(
    [cloud],
    active,
    "2026-08-18",
    null,
  ) as {
    entries: Array<{ id: string; areas: JournalRecord["areas"]; serverRecord: JournalRecord | null }>;
    selectedId: string | null;
  };

  assert.deepEqual(result.entries.map(({ id }) => id), [active.id, cloud.id]);
  assert.equal(result.entries[0]?.areas.question, "visible while offline");
  assert.equal(result.entries[0]?.serverRecord, null);
  assert.equal(result.selectedId, active.id);
});

test("empty or different-date active drafts are absent and do not disturb selection", () => {
  assert.equal(typeof reconcileJournalRecordList, "function");
  if (reconcileJournalRecordList === undefined) return;
  const state = createLocalState(
    new Date("2026-08-18T01:00:00.000Z"),
    (() => {
      let next = 30;
      return () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
    })(),
  );
  const cloud = record({ id: "00000000-0000-4000-8000-000000000040" });

  const emptyResult = reconcileJournalRecordList(
    [cloud],
    state.active,
    "2026-08-18",
    cloud.id,
  ) as { entries: Array<{ id: string }>; selectedId: string | null };
  const otherDateResult = reconcileJournalRecordList(
    [cloud],
    { ...editActiveArea(state, "event", "tomorrow").active, journalDate: "2026-08-19" },
    "2026-08-18",
    null,
  ) as { entries: Array<{ id: string }>; selectedId: string | null };

  assert.deepEqual(emptyResult.entries.map(({ id }) => id), [cloud.id]);
  assert.equal(emptyResult.selectedId, cloud.id);
  assert.deepEqual(otherDateResult.entries.map(({ id }) => id), [cloud.id]);
  assert.equal(otherDateResult.selectedId, null);
});

test("same-id reconciliation deduplicates while newer or delivered Cloud state wins", () => {
  assert.equal(typeof reconcileJournalRecordList, "function");
  if (reconcileJournalRecordList === undefined) return;
  const state = createLocalState(
    new Date("2026-08-18T01:00:00.000Z"),
    (() => {
      let next = 50;
      return () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
    })(),
  );
  const local = {
    ...editActiveArea(state, "insight", "local unsynced").active,
    revision: 4,
  };
  const sameRevision = record({
    id: local.id,
    revision: 4,
    areas: { ...emptyJournalAreas(), insight: "server acknowledged" },
  });
  const newer = record({
    ...sameRevision,
    revision: 5,
    areas: { ...emptyJournalAreas(), insight: "newer server" },
  });
  const delivered = record({
    ...sameRevision,
    deliveryState: "delivered",
    areas: { ...emptyJournalAreas(), insight: "delivered server" },
  });

  const localResult = reconcileJournalRecordList(
    [sameRevision, record({ id: "00000000-0000-4000-8000-000000000060" })],
    local,
    "2026-08-18",
    null,
  ) as { entries: Array<{ id: string; areas: JournalRecord["areas"] }> };
  const newerResult = reconcileJournalRecordList(
    [newer],
    local,
    "2026-08-18",
    null,
  ) as { entries: Array<{ id: string; areas: JournalRecord["areas"] }> };
  const deliveredResult = reconcileJournalRecordList(
    [delivered],
    local,
    "2026-08-18",
    null,
  ) as { entries: Array<{ id: string; areas: JournalRecord["areas"]; deliveryState: string }> };

  assert.equal(localResult.entries.filter(({ id }) => id === local.id).length, 1);
  assert.equal(localResult.entries[0]?.areas.insight, "local unsynced");
  assert.equal(newerResult.entries[0]?.areas.insight, "newer server");
  assert.equal(deliveredResult.entries[0]?.areas.insight, "delivered server");
  assert.equal(deliveredResult.entries[0]?.deliveryState, "delivered");
});

test("theme preferences accept only light or dark and tolerate denied storage", () => {
  assert.equal(typeof readJournalTheme, "function");
  assert.equal(typeof persistJournalTheme, "function");
  if (readJournalTheme === undefined || persistJournalTheme === undefined) return;

  assert.equal(readJournalTheme({ getItem: () => "dark" }), "dark");
  assert.equal(readJournalTheme({ getItem: () => "sepia" }), "light");
  assert.equal(
    readJournalTheme({ getItem: () => { throw new Error("denied"); } }),
    "light",
  );
  assert.equal(
    persistJournalTheme({ setItem: () => { throw new Error("full"); } }, "dark"),
    false,
  );
});
