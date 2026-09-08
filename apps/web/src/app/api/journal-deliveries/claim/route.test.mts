import assert from "node:assert/strict";
import test from "node:test";

import { createJournalDeliveryClaimHandler } from "./route.ts";

const TOKEN = "journal-delivery-test-token-that-is-long-enough";

test("the Desktop worker can claim a Journal delivery batch", async () => {
  const previous = process.env.CAPTURE_DEVICE_TOKEN;
  process.env.CAPTURE_DEVICE_TOKEN = TOKEN;
  try {
    const delivery = {
      attemptId: "11111111-1111-4111-8111-111111111111",
      journalDate: "2026-09-07",
      records: [],
    };
    const POST = createJournalDeliveryClaimHandler({
      async claimDelivery() { return delivery; },
    });
    const response = await POST(new Request("http://capture.test/api/journal-deliveries/claim", {
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

test("the Journal delivery claim endpoint rejects browsers", async () => {
  const previous = process.env.CAPTURE_DEVICE_TOKEN;
  process.env.CAPTURE_DEVICE_TOKEN = TOKEN;
  try {
    const POST = createJournalDeliveryClaimHandler({
      async claimDelivery() { throw new Error("must not be called"); },
    });
    const response = await POST(new Request("http://capture.test/api/journal-deliveries/claim", {
      method: "POST",
    }));
    assert.equal(response.status, 401);
  } finally {
    if (previous === undefined) delete process.env.CAPTURE_DEVICE_TOKEN;
    else process.env.CAPTURE_DEVICE_TOKEN = previous;
  }
});
