import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CAPTURE_LENGTH,
  validateCaptureRequest,
  validateJobReport,
  validateJobResult,
} from "./capture.ts";

test("accepts and trims valid capture content", () => {
  assert.deepEqual(validateCaptureRequest({ content: "  Read this later  " }), {
    success: true,
    content: "Read this later",
  });
});

test("rejects an empty capture", () => {
  assert.deepEqual(validateCaptureRequest({ content: "   " }), {
    success: false,
    code: "INVALID_CONTENT",
    message: "Content cannot be empty.",
  });
});

test("rejects a non-string capture", () => {
  assert.deepEqual(validateCaptureRequest({ content: 123 }), {
    success: false,
    code: "INVALID_CONTENT",
    message: "Content must be a string.",
  });
});

test("rejects content over the maximum length", () => {
  const result = validateCaptureRequest({
    content: "a".repeat(MAX_CAPTURE_LENGTH + 1),
  });

  assert.equal(result.success, false);
  assert.equal(result.code, "INVALID_CONTENT");
});

test("accepts and trims a processing result", () => {
  assert.deepEqual(validateJobResult({ result: "  Processed note  " }), {
    success: true,
    result: "Processed note",
  });
});

test("rejects an empty processing result", () => {
  assert.equal(validateJobResult({ result: "   " }).success, false);
});

test("validates completed and failed legacy worker reports", () => {
  assert.deepEqual(validateJobReport({ outcome: "completed", result: "  card  " }), {
    success: true,
    value: { outcome: "completed", result: "card" },
  });
  assert.deepEqual(validateJobReport({ outcome: "failed", error: "  offline  " }), {
    success: true,
    value: { outcome: "failed", error: "offline" },
  });
  assert.deepEqual(validateJobReport({ result: "legacy" }), {
    success: true,
    value: { outcome: "completed", result: "legacy" },
  });
  assert.equal(validateJobReport({ outcome: "failed", error: " " }).success, false);
  assert.equal(validateJobReport({ outcome: "completed", error: "wrong" }).success, false);
});
