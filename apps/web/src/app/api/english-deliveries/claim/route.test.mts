import assert from "node:assert/strict";
import test from "node:test";

import { createEnglishDeliveryClaimHandler } from "./route.ts";

test("Desktop claims an eligible English document", async () => {
  let boundary = "";
  const handler = createEnglishDeliveryClaimHandler(
    { async claimEnglish(value) { boundary = value; return null; } },
    async () => ({ status: "authorized" as const }),
    () => new Date("2026-09-06T20:00:00.000Z"),
  );
  const response = await handler(new Request("https://capture.test/api/english-deliveries/claim", { method: "POST" }));
  assert.equal(response.status, 200);
  assert.equal(boundary, "2026-09-07");
  assert.deepEqual(await response.json(), { delivery: null });
});
