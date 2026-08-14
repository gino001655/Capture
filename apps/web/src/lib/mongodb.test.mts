import assert from "node:assert/strict";
import test from "node:test";

import { getMongoDatabaseName } from "./mongodb.ts";

test("reads and trims the configured MongoDB database name", () => {
  const previousValue = process.env.MONGODB_DB;
  process.env.MONGODB_DB = "  capture_test  ";

  try {
    assert.equal(getMongoDatabaseName(), "capture_test");
  } finally {
    if (previousValue === undefined) {
      delete process.env.MONGODB_DB;
    } else {
      process.env.MONGODB_DB = previousValue;
    }
  }
});

test("rejects a missing MongoDB database name", () => {
  const previousValue = process.env.MONGODB_DB;
  delete process.env.MONGODB_DB;

  try {
    assert.throws(
      () => getMongoDatabaseName(),
      /MONGODB_DB must be set in the server environment/,
    );
  } finally {
    if (previousValue !== undefined) {
      process.env.MONGODB_DB = previousValue;
    }
  }
});
