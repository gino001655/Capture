import assert from "node:assert/strict";
import test from "node:test";

import { createJournalDeliveryReportHandler } from "./route.ts";

const TOKEN = "journal-delivery-test-token-that-is-long-enough";
const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";

test("records a completed Journal delivery", async () => {
  const previous = process.env.CAPTURE_DEVICE_TOKEN;
  process.env.CAPTURE_DEVICE_TOKEN = TOKEN;
  try {
    let completed: unknown;
    const PATCH = createJournalDeliveryReportHandler({
      async completeDelivery(attemptId, result) {
        completed = { attemptId, result };
        return { journalDate: "2026-09-07", recordCount: 2 };
      },
      async failDelivery() { throw new Error("wrong outcome"); },
    });
    const response = await PATCH(new Request("http://capture.test", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ outcome: "completed", result: "contentMd5:next" }),
    }), { params: Promise.resolve({ attemptId: ATTEMPT_ID }) });

    assert.equal(response.status, 200);
    assert.deepEqual(completed, { attemptId: ATTEMPT_ID, result: "contentMd5:next" });
  } finally {
    if (previous === undefined) delete process.env.CAPTURE_DEVICE_TOKEN;
    else process.env.CAPTURE_DEVICE_TOKEN = previous;
  }
});

test("returns conflict for an expired delivery attempt", async () => {
  const previous = process.env.CAPTURE_DEVICE_TOKEN;
  process.env.CAPTURE_DEVICE_TOKEN = TOKEN;
  try {
    const PATCH = createJournalDeliveryReportHandler({
      async completeDelivery() { return undefined; },
      async failDelivery() { return undefined; },
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
