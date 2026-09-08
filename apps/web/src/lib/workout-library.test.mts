import assert from "node:assert/strict";
import test from "node:test";

import { validateWorkoutLibrarySaveRequest } from "./workout-library.ts";

const valid = {
  expectedRevision: null,
  payload: { schemaVersion: 1, entries: [{ id: "11111111-1111-4111-8111-111111111111", name: "深蹲", order: 0, archived: false }] },
};

test("validates a versioned workout library with stable unique ids", () => {
  assert.equal(validateWorkoutLibrarySaveRequest(valid).success, true);
  assert.equal(validateWorkoutLibrarySaveRequest({ ...valid, payload: { ...valid.payload, entries: [...valid.payload.entries, valid.payload.entries[0]] } }).success, false);
  assert.equal(validateWorkoutLibrarySaveRequest({ ...valid, payload: { ...valid.payload, entries: [{ ...valid.payload.entries[0], name: "" }] } }).success, false);
});
