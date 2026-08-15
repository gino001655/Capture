import assert from "node:assert/strict";
import test from "node:test";

import type { Capture } from "../../../lib/capture.ts";
import {
  authorizeCaptureCreateRequest,
  createCapturePostHandler,
} from "./route.ts";

const store = {
  async create(content: string): Promise<Capture> {
    return {
      id: "test-capture-id",
      content,
      status: "pending" as const,
      createdAt: "2026-08-14T00:00:00.000Z",
    };
  },
};

const POST = createCapturePostHandler(store, async () => ({
  status: "authorized",
}));

function createRequest(body: string, authorization?: string) {
  return new Request("http://localhost/api/captures", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
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

test("returns 401 before creating a capture without a Web session", async () => {
  const unauthorizedPost = createCapturePostHandler(store, async () => ({
    status: "unauthorized",
  }));
  const response = await unauthorizedPost(
    createRequest(JSON.stringify({ content: "Private capture" })),
  );
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.error.code, "UNAUTHORIZED");
});

test("creates a capture for an authorized Desktop request", async () => {
  const previousToken = process.env.CAPTURE_DEVICE_TOKEN;
  process.env.CAPTURE_DEVICE_TOKEN =
    "desktop-capture-token-that-is-at-least-32-characters";

  try {
    const desktopPost = createCapturePostHandler(
      store,
      authorizeCaptureCreateRequest,
    );
    const response = await desktopPost(
      createRequest(
        JSON.stringify({ content: "Captured from a shortcut" }),
        "Bearer desktop-capture-token-that-is-at-least-32-characters",
      ),
    );
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.capture.content, "Captured from a shortcut");
    assert.equal(payload.capture.status, "pending");
  } finally {
    if (previousToken === undefined) {
      delete process.env.CAPTURE_DEVICE_TOKEN;
    } else {
      process.env.CAPTURE_DEVICE_TOKEN = previousToken;
    }
  }
});
