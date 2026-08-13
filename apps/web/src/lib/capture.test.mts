import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CAPTURE_LENGTH,
  validateCaptureRequest,
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
