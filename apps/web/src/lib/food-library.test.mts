import assert from "node:assert/strict";
import test from "node:test";
import { validateFoodLibrarySaveRequest } from "./food-library.ts";
const entry = { id: "11111111-1111-4111-8111-111111111111", name: "燕麥", quantity: 50, unit: "g", calories: 190, proteinGrams: 6, order: 0, archived: false };
test("food library entries require unique stable ids and nutrition defaults", () => { assert.equal(validateFoodLibrarySaveRequest({ payload: { schemaVersion: 1, entries: [entry] }, expectedRevision: null }).success, true); assert.equal(validateFoodLibrarySaveRequest({ payload: { schemaVersion: 1, entries: [entry, entry] }, expectedRevision: null }).success, false); });
