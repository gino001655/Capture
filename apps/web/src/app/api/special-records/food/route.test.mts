import assert from "node:assert/strict";
import test from "node:test";
import { createFoodHandler } from "./route.ts";
import { emptyFoodPayload } from "../../../../lib/food-record.ts";

const authorized = async () => ({ status: "authorized" as const });
test("food locks past edits but accepts an offline write made on that date", async () => {
  let saves = 0;
  const handler = createFoodHandler({ async get() { return null; }, async list() { return []; }, async save() { saves += 1; return { kind: "deleted" as const, record: null }; } }, authorized, () => new Date("2026-09-08T04:00:00Z"));
  const request = (journalDate: string, clientUpdatedAt = "2026-09-07T03:00:00Z") => new Request("http://capture.test/api/special-records/food", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ journalDate, payload: emptyFoodPayload(), expectedRevision: null, clientUpdatedAt }) });
  assert.equal((await handler(request("2026-09-08"))).status, 200);
  assert.equal((await handler(request("2026-09-07"))).status, 200);
  assert.equal((await handler(request("2026-09-06"))).status, 409);
  assert.equal(saves, 2);
});
