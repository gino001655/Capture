import assert from "node:assert/strict";
import test from "node:test";

import { toTaipeiDate, validateEnglishSaveRequest } from "./special-record.ts";

test("Taipei date crosses midnight at 16:00 UTC", () => {
  assert.equal(toTaipeiDate(new Date("2026-09-05T15:59:59.000Z")), "2026-09-05");
  assert.equal(toTaipeiDate(new Date("2026-09-05T16:00:00.000Z")), "2026-09-06");
});

test("English save accepts empty text so clearing today can remove the document", () => {
  const result = validateEnglishSaveRequest({
    journalDate: "2026-09-06",
    text: "",
    expectedRevision: 2,
    clientUpdatedAt: "2026-09-06T03:00:00.000Z",
  });
  assert.equal(result.success, true);
});

test("English save rejects invalid revision and edit timestamp", () => {
  assert.equal(validateEnglishSaveRequest({
    journalDate: "2026-09-06",
    text: "text",
    expectedRevision: -1,
    clientUpdatedAt: "2026-09-06T03:00:00.000Z",
  }).success, false);
  assert.equal(validateEnglishSaveRequest({
    journalDate: "2026-09-06",
    text: "text",
    expectedRevision: null,
    clientUpdatedAt: "not-a-date",
  }).success, false);
});
