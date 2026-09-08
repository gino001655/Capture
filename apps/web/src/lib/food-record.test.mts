import assert from "node:assert/strict";
import test from "node:test";
import { emptyFoodPayload, validateFoodSaveRequest } from "./food-record.ts";

const valid = { journalDate: "2026-09-08", expectedRevision: null, clientUpdatedAt: "2026-09-08T03:00:00Z", payload: { ...emptyFoodPayload(), entries: [{ id: "11111111-1111-4111-8111-111111111111", name: "雞胸肉", quantity: 1, unit: "份", calories: 220, proteinGrams: 40, note: "", occurredAt: "2026-09-08T02:00:00Z" }] } };
test("accepts complete food entries and rejects blank names", () => {
  assert.equal(validateFoodSaveRequest(valid).success, true);
  assert.equal(validateFoodSaveRequest({ ...valid, payload: { ...valid.payload, entries: [{ ...valid.payload.entries[0], name: "" }] } }).success, false);
});
