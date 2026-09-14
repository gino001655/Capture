import assert from "node:assert/strict";
import test from "node:test";

import { validateEnglishAttemptId, validateEnglishDeliveryReport } from "./english-delivery.ts";

test("validates English delivery reports and attempt ids", () => {
  assert.equal(validateEnglishDeliveryReport({ outcome: "completed", result: "ok" }).success, true);
  assert.equal(validateEnglishDeliveryReport({ outcome: "failed", error: "offline" }).success, true);
  assert.deepEqual(
    validateEnglishDeliveryReport({ outcome: "failed", error: "offline", result: "partial receipt" }),
    { success: true, value: { outcome: "failed", error: "offline", result: "partial receipt" } },
  );
  assert.equal(validateEnglishDeliveryReport({ outcome: "failed", error: "offline", result: "" }).success, false);
  assert.equal(validateEnglishDeliveryReport({ outcome: "completed", result: "" }).success, false);
  assert.equal(validateEnglishAttemptId("00000000-0000-4000-8000-000000000001"), true);
  assert.equal(validateEnglishAttemptId("nope"), false);
});
