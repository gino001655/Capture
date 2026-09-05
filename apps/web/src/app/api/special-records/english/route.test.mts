import assert from "node:assert/strict";
import test from "node:test";

import { createEnglishHandler } from "./route.ts";

const authorized = async () => ({ status: "authorized" as const });
const now = () => new Date("2026-09-06T04:00:00.000Z");

test("English API rejects a newly edited past date", async () => {
  let saves = 0;
  const handler = createEnglishHandler({
    async getEnglish() { return null; },
    async listEnglish() { return []; },
    async saveEnglish() { saves += 1; return { kind: "deleted", record: null }; },
  }, authorized, now);
  const response = await handler(new Request("https://capture.test/api/special-records/english", {
    method: "PUT",
    body: JSON.stringify({
      journalDate: "2026-09-05",
      text: "late edit",
      expectedRevision: null,
      clientUpdatedAt: "2026-09-06T03:00:00.000Z",
    }),
  }));
  assert.equal(response.status, 409);
  assert.equal(saves, 0);
});

test("English API accepts delayed sync that was edited on its journal date", async () => {
  let saves = 0;
  const handler = createEnglishHandler({
    async getEnglish() { return null; },
    async listEnglish() { return []; },
    async saveEnglish() { saves += 1; return { kind: "deleted", record: null }; },
  }, authorized, now);
  const response = await handler(new Request("https://capture.test/api/special-records/english", {
    method: "PUT",
    body: JSON.stringify({
      journalDate: "2026-09-05",
      text: "offline text",
      expectedRevision: null,
      clientUpdatedAt: "2026-09-05T12:00:00.000Z",
    }),
  }));
  assert.equal(response.status, 200);
  assert.equal(saves, 1);
});
