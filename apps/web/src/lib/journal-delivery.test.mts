import assert from "node:assert/strict";
import test from "node:test";

import {
  taipeiDeliveryBoundary,
  validateDeliveryReport,
} from "./journal-delivery.ts";

test("uses 04:00 Asia/Taipei as the Journal delivery boundary", () => {
  assert.equal(
    taipeiDeliveryBoundary(new Date("2026-09-07T19:59:59.000Z")),
    "2026-09-07",
  );
  assert.equal(
    taipeiDeliveryBoundary(new Date("2026-09-07T20:00:00.000Z")),
    "2026-09-08",
  );
});

test("validates completed and failed worker reports", () => {
  assert.deepEqual(validateDeliveryReport({ outcome: "completed", result: "md5:abc" }), {
    success: true,
    value: { outcome: "completed", result: "md5:abc" },
  });
  assert.deepEqual(validateDeliveryReport({ outcome: "failed", error: "offline" }), {
    success: true,
    value: { outcome: "failed", error: "offline" },
  });
  assert.equal(validateDeliveryReport({ outcome: "completed", result: "" }).success, false);
});
