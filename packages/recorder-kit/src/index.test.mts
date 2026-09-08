import assert from "node:assert/strict";
import test from "node:test";

import { RECORDER_CATALOG, recorderDefinition } from "./index.ts";

test("recorder ids and ordering are stable and unique", () => {
  assert.deepEqual(
    RECORDER_CATALOG.map(({ id }) => id),
    ["journal", "english", "workout", "food"],
  );
  assert.equal(new Set(RECORDER_CATALOG.map(({ id }) => id)).size, RECORDER_CATALOG.length);
  assert.equal(recorderDefinition("english").symbol, "Aa");
});
