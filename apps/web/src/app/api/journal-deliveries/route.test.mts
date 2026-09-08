import assert from "node:assert/strict";
import test from "node:test";

import {
  createJournalDeliveryRetryHandler,
  createJournalDeliveryStatusHandler,
} from "./route.ts";

const TOKEN = "journal-delivery-test-token-that-is-long-enough";

test("returns queue status and enables manual retry for the Desktop worker", async () => {
  const previous = process.env.CAPTURE_DEVICE_TOKEN;
  process.env.CAPTURE_DEVICE_TOKEN = TOKEN;
  try {
    const delivery = {
      pendingRecordCount: 1,
      processingRecordCount: 0,
      failedRecordCount: 1,
      dates: [],
    };
    let retryCalls = 0;
    const store = {
      async getDeliveryStatus() { return delivery; },
      async retryFailedDeliveries() { retryCalls += 1; return 1; },
    };
    const request = () => new Request("http://capture.test/api/journal-deliveries", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    const GET = createJournalDeliveryStatusHandler(store);
    const getResponse = await GET(request());
    assert.deepEqual(await getResponse.json(), { delivery });

    const POST = createJournalDeliveryRetryHandler(store);
    const postResponse = await POST(new Request(request(), { method: "POST" }));
    assert.deepEqual(await postResponse.json(), { retriedRecordCount: 1 });
    assert.equal(retryCalls, 1);
  } finally {
    if (previous === undefined) delete process.env.CAPTURE_DEVICE_TOKEN;
    else process.env.CAPTURE_DEVICE_TOKEN = previous;
  }
});
