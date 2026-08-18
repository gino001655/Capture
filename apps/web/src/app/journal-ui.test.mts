import assert from "node:assert/strict";
import test from "node:test";

import { emptyJournalAreas, type JournalRecord } from "../lib/journal-record.ts";

const uiModule = await import("./journal-ui.ts").catch(() => ({}));
const {
  formatJournalDateLabel,
  parseJournalRecordList,
  persistJournalTheme,
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
