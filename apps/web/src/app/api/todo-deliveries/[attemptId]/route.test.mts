import assert from "node:assert/strict";
import test from "node:test";

import { createTodoDeliveryReportHandler } from "./route.ts";

const TOKEN = "todo-delivery-test-token-that-is-long-enough";
const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";

test("records a completed Todo append", async () => {
  const previous = process.env.CAPTURE_DEVICE_TOKEN;
  process.env.CAPTURE_DEVICE_TOKEN = TOKEN;
  try {
    let completed: unknown;
    const PATCH = createTodoDeliveryReportHandler({
      async completeTodoDelivery(attemptId, result) {
        completed = { attemptId, result };
        return { recordId: "22222222-2222-4222-8222-222222222222" };
      },
      async failTodoDelivery() { throw new Error("wrong outcome"); },
    });
    const response = await PATCH(new Request("http://capture.test", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ outcome: "completed", result: "Capture·222222222222" }),
    }), { params: Promise.resolve({ attemptId: ATTEMPT_ID }) });

    assert.equal(response.status, 200);
    assert.deepEqual(completed, { attemptId: ATTEMPT_ID, result: "Capture·222222222222" });
  } finally {
    if (previous === undefined) delete process.env.CAPTURE_DEVICE_TOKEN;
    else process.env.CAPTURE_DEVICE_TOKEN = previous;
  }
});

test("returns conflict for an expired Todo attempt", async () => {
  const previous = process.env.CAPTURE_DEVICE_TOKEN;
  process.env.CAPTURE_DEVICE_TOKEN = TOKEN;
  try {
    const PATCH = createTodoDeliveryReportHandler({
      async completeTodoDelivery() { return undefined; },
      async failTodoDelivery() { return undefined; },
    });
    const response = await PATCH(new Request("http://capture.test", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ outcome: "failed", error: "offline" }),
    }), { params: Promise.resolve({ attemptId: ATTEMPT_ID }) });
    assert.equal(response.status, 409);
  } finally {
    if (previous === undefined) delete process.env.CAPTURE_DEVICE_TOKEN;
    else process.env.CAPTURE_DEVICE_TOKEN = previous;
  }
});
