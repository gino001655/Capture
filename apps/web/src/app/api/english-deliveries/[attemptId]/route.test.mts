import assert from "node:assert/strict";
import test from "node:test";

import { createEnglishDeliveryReportHandler } from "./route.ts";

test("rejects an expired English delivery report", async () => {
  const handler = createEnglishDeliveryReportHandler(
    { async reportEnglish() { return null; } },
    async () => ({ status: "authorized" as const }),
  );
  const response = await handler(
    new Request("https://capture.test/api/english-deliveries/00000000-0000-4000-8000-000000000001", {
      method: "PATCH",
      body: JSON.stringify({ outcome: "completed", result: "ok" }),
    }),
    { params: Promise.resolve({ attemptId: "00000000-0000-4000-8000-000000000001" }) },
  );
  assert.equal(response.status, 409);
});
