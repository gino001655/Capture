import assert from "node:assert/strict";
import test from "node:test";

import { createTodoDeliveryClaimHandler } from "./route.ts";

const TOKEN = "todo-delivery-test-token-that-is-long-enough";

test("the Desktop worker can claim one explicit continuation", async () => {
  const previous = process.env.CAPTURE_DEVICE_TOKEN;
  process.env.CAPTURE_DEVICE_TOKEN = TOKEN;
  try {
    const delivery = {
      attemptId: "11111111-1111-4111-8111-111111111111",
      recordId: "22222222-2222-4222-8222-222222222222",
      journalDate: "2026-09-15",
      text: "寄出文件",
    };
    const POST = createTodoDeliveryClaimHandler({
      async claimTodoDelivery() { return delivery; },
    });
    const response = await POST(new Request("http://capture.test/api/todo-deliveries/claim", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { delivery });
  } finally {
    if (previous === undefined) delete process.env.CAPTURE_DEVICE_TOKEN;
    else process.env.CAPTURE_DEVICE_TOKEN = previous;
  }
});

test("the Todo claim endpoint rejects browsers", async () => {
  const previous = process.env.CAPTURE_DEVICE_TOKEN;
  process.env.CAPTURE_DEVICE_TOKEN = TOKEN;
  try {
    const POST = createTodoDeliveryClaimHandler({
      async claimTodoDelivery() { throw new Error("must not be called"); },
    });
    const response = await POST(new Request("http://capture.test/api/todo-deliveries/claim", {
      method: "POST",
    }));
    assert.equal(response.status, 401);
  } finally {
    if (previous === undefined) delete process.env.CAPTURE_DEVICE_TOKEN;
    else process.env.CAPTURE_DEVICE_TOKEN = previous;
  }
});
