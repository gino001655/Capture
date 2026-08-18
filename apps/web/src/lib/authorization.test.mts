import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeClientRequest,
  authorizeDesktopRequest,
  authorizationFailureResponse,
  isAllowedEmail,
  isValidBearerToken,
} from "./authorization.ts";

test("allows only the configured email without case sensitivity", () => {
  assert.equal(isAllowedEmail("Me@Example.com", "me@example.com"), true);
  assert.equal(isAllowedEmail("other@example.com", "me@example.com"), false);
  assert.equal(isAllowedEmail(undefined, "me@example.com"), false);
});

test("accepts a matching bearer token", () => {
  const token = "a-secure-device-token-that-is-long-enough";

  assert.equal(isValidBearerToken(`Bearer ${token}`, token), true);
  assert.equal(isValidBearerToken(`bearer ${token}`, token), true);
  assert.equal(isValidBearerToken("Bearer wrong-token", token), false);
  assert.equal(isValidBearerToken(null, token), false);
});

test("authorizes a Desktop request only with the configured token", () => {
  const previousValue = process.env.CAPTURE_DEVICE_TOKEN;
  const token = "a-secure-device-token-that-is-long-enough";
  process.env.CAPTURE_DEVICE_TOKEN = token;

  try {
    assert.equal(
      authorizeDesktopRequest(
        new Request("http://localhost/api/jobs/claim", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ).status,
      "authorized",
    );
    assert.equal(
      authorizeDesktopRequest(
        new Request("http://localhost/api/jobs/claim"),
      ).status,
      "unauthorized",
    );
  } finally {
    if (previousValue === undefined) {
      delete process.env.CAPTURE_DEVICE_TOKEN;
    } else {
      process.env.CAPTURE_DEVICE_TOKEN = previousValue;
    }
  }
});

test("selects Desktop bearer authentication when Authorization is present", async () => {
  const previousToken = process.env.CAPTURE_DEVICE_TOKEN;
  const token = "a-secure-device-token-that-is-long-enough";
  process.env.CAPTURE_DEVICE_TOKEN = token;

  try {
    const result = await authorizeClientRequest(
      new Request("http://localhost/api/journal-records", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    assert.equal(result.status, "authorized");
  } finally {
    if (previousToken === undefined) {
      delete process.env.CAPTURE_DEVICE_TOKEN;
    } else {
      process.env.CAPTURE_DEVICE_TOKEN = previousToken;
    }
  }
});

test("selects Web session authentication when Authorization is absent", async () => {
  const previousToken = process.env.CAPTURE_DEVICE_TOKEN;
  process.env.CAPTURE_DEVICE_TOKEN =
    "a-secure-device-token-that-is-long-enough";

  try {
    const result = await authorizeClientRequest(
      new Request("http://localhost/api/journal-records"),
    );

    assert.equal(result.status, "misconfigured");
    if (result.status === "misconfigured") {
      assert.ok(result.missing.includes("AUTHORIZED_EMAIL"));
    }
  } finally {
    if (previousToken === undefined) {
      delete process.env.CAPTURE_DEVICE_TOKEN;
    } else {
      process.env.CAPTURE_DEVICE_TOKEN = previousToken;
    }
  }
});

test("returns distinct unauthorized and misconfigured responses", async () => {
  const unauthorized = authorizationFailureResponse({
    status: "unauthorized",
  });
  const misconfigured = authorizationFailureResponse({
    status: "misconfigured",
    missing: ["CAPTURE_DEVICE_TOKEN"],
  });

  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error.code, "UNAUTHORIZED");
  assert.equal(misconfigured.status, 503);
  assert.equal(
    (await misconfigured.json()).error.code,
    "AUTH_NOT_CONFIGURED",
  );
});
