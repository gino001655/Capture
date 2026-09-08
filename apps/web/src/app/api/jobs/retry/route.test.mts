import assert from "node:assert/strict";
import test from "node:test";

import { createLegacyJobRetryHandler } from "./route.ts";

const TOKEN = "legacy-retry-test-token-that-is-long-enough";

test("Desktop can make failed legacy jobs immediately retryable", async () => {
  const previous = process.env.CAPTURE_DEVICE_TOKEN;
  process.env.CAPTURE_DEVICE_TOKEN = TOKEN;
  try {
    let calls = 0;
    const POST = createLegacyJobRetryHandler({ async retryFailed() { calls += 1; return 3; } });
    const response = await POST(new Request("http://capture.test/api/jobs/retry", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { retriedJobCount: 3 });
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.CAPTURE_DEVICE_TOKEN;
    else process.env.CAPTURE_DEVICE_TOKEN = previous;
  }
});
