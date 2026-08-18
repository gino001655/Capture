import assert from "node:assert/strict";
import test from "node:test";

import {
  JOURNAL_AREA_KEYS,
  emptyJournalAreas,
  hasJournalContent,
  validateJournalCreateRequest,
  validateJournalDate,
  validateJournalUpdateRequest,
  type JournalCreateInput,
  type JournalUpdateInput,
} from "./journal-record.ts";
import { MAX_CAPTURE_LENGTH } from "./capture.ts";

function validCreate(
  overrides: Partial<JournalCreateInput> = {},
): JournalCreateInput {
  return {
    id: "8b52495a-a8b7-4d99-a2c8-30be915dc95b",
    deviceId: "0cd30ab8-3000-42de-bf56-dcb4526b2461",
    journalDate: "2026-08-18",
    areas: { ...emptyJournalAreas(), insight: "A useful idea" },
    ...overrides,
  };
}

function validUpdate(
  overrides: Partial<JournalUpdateInput> = {},
): JournalUpdateInput {
  return {
    deviceId: "0cd30ab8-3000-42de-bf56-dcb4526b2461",
    journalDate: "2026-08-18",
    areas: { ...emptyJournalAreas(), insight: "A useful idea" },
    editingState: "idle",
    expectedRevision: 0,
    conflictRecordId: "8b52495a-a8b7-4d99-a2c8-30be915dc95b",
    ...overrides,
  };
}

test("keeps Journal area keys in their declared order", () => {
  assert.deepEqual(JOURNAL_AREA_KEYS, [
    "unclassified",
    "event",
    "question",
    "insight",
    "next",
    "feeling",
  ]);
  assert.deepEqual(Object.keys(emptyJournalAreas()), JOURNAL_AREA_KEYS);
});

test("accepts a six-area Journal record without trimming its prose", () => {
  const areas = { ...emptyJournalAreas(), insight: " first line\n  detail" };
  const result = validateJournalCreateRequest(validCreate({ areas }));
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.value.areas.insight, areas.insight);
});

test("rejects an empty Journal record", () => {
  assert.equal(
    validateJournalCreateRequest(validCreate({ areas: emptyJournalAreas() }))
      .success,
    false,
  );
  assert.equal(hasJournalContent(emptyJournalAreas()), false);
});

test("accepts a valid leap-day and rejects an impossible date", () => {
  assert.equal(validateJournalDate("2024-02-29"), true);
  assert.equal(validateJournalDate("2026-02-30"), false);
  assert.equal(validateJournalDate("2026-2-03"), false);
});

test("rejects combined area content over the capture limit", () => {
  const areas = {
    ...emptyJournalAreas(),
    insight: "a".repeat(MAX_CAPTURE_LENGTH + 1),
  };
  assert.equal(validateJournalCreateRequest(validCreate({ areas })).success, false);
});

test("validates update revision and conflict identifier", () => {
  assert.equal(validateJournalUpdateRequest(validUpdate({ expectedRevision: -1 })).success, false);
  assert.equal(
    validateJournalUpdateRequest(validUpdate({ conflictRecordId: "not-a-uuid" })).success,
    false,
  );
  assert.equal(validateJournalUpdateRequest(validUpdate()).success, true);
});
