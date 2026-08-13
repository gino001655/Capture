import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "./route.ts";

function createRequest(body: string) {
  return new Request("http://localhost/api/captures", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

test("creates a pending capture", async () => {
  const response = await POST(
    createRequest(JSON.stringify({ content: "  Test capture  " })),
  );
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.capture.content, "Test capture");
  assert.equal(payload.capture.status, "pending");
  assert.equal(typeof payload.capture.id, "string");
  assert.equal(typeof payload.capture.createdAt, "string");
});

test("returns 400 for empty content", async () => {
  const response = await POST(
    createRequest(JSON.stringify({ content: "   " })),
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "INVALID_CONTENT");
});

test("returns 400 for malformed JSON", async () => {
  const response = await POST(createRequest("{not-json"));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "INVALID_JSON");
});
