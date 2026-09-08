import assert from "node:assert/strict";
import test from "node:test";

import { createJobUpdateHandler } from "./route.ts";

const TOKEN = "legacy-job-test-token-that-is-long-enough";

test("legacy job PATCH reports either completion or a retryable failure", async () => {
  const previous = process.env.CAPTURE_DEVICE_TOKEN;
  process.env.CAPTURE_DEVICE_TOKEN = TOKEN;
  try {
    const reports: unknown[] = [];
    const PATCH = createJobUpdateHandler({
      async complete(id, result) {
        reports.push({ outcome: "completed", id, result });
        return { id, content: "x", status: "completed", createdAt: "2026-09-08T00:00:00Z", result } as const;
      },
      async fail(id, error) {
        reports.push({ outcome: "failed", id, error });
        return { id, content: "x", status: "failed", createdAt: "2026-09-08T00:00:00Z", lastError: error } as const;
      },
    });
    const context = { params: Promise.resolve({ id: "capture-1" }) };

    const completed = await PATCH(new Request("http://capture.test/api/jobs/capture-1", {
      method: "PATCH",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ outcome: "completed", result: "card" }),
    }), context);
    const failed = await PATCH(new Request("http://capture.test/api/jobs/capture-1", {
      method: "PATCH",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ outcome: "failed", error: "processor unavailable" }),
    }), context);

    assert.equal(completed.status, 200);
    assert.equal(failed.status, 200);
    assert.deepEqual(reports, [
      { outcome: "completed", id: "capture-1", result: "card" },
      { outcome: "failed", id: "capture-1", error: "processor unavailable" },
    ]);
  } finally {
    if (previous === undefined) delete process.env.CAPTURE_DEVICE_TOKEN;
    else process.env.CAPTURE_DEVICE_TOKEN = previous;
  }
});
