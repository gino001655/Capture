import assert from "node:assert/strict";
import test from "node:test";

import { createEnglishDeliveriesHandler } from "./route.ts";

test("reports and retries the English queue", async () => {
  const handler = createEnglishDeliveriesHandler({
    async englishDeliveryStatus() { return { pending: 2, processing: 1, failed: 1 }; },
    async retryFailedEnglish() { return 1; },
  }, async () => ({ status: "authorized" as const }));
  assert.deepEqual(await (await handler(new Request("https://capture.test/api/english-deliveries"))).json(), {
    delivery: { pending: 2, processing: 1, failed: 1 },
  });
  assert.deepEqual(await (await handler(new Request("https://capture.test/api/english-deliveries", { method: "POST" }))).json(), { retried: 1 });
});
