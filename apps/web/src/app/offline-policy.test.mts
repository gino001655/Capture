import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const policySource = readFileSync(
  new URL("../../public/sw-policy.js", import.meta.url),
  "utf8",
);

function loadPolicy() {
  const context = vm.createContext({});
  vm.runInContext(policySource, context);
  return context.CaptureOfflinePolicy as {
    classifyRequest(input: {
      method: string;
      mode?: string;
      origin: string;
      appOrigin: string;
      pathname: string;
    }): "network" | "navigation" | "static";
  };
}

test("offline policy never caches writes, APIs, auth, or cross-origin requests", () => {
  const { classifyRequest } = loadPolicy();
  const base = {
    method: "GET",
    origin: "https://capture.example",
    appOrigin: "https://capture.example",
  };

  assert.equal(
    classifyRequest({ ...base, method: "POST", pathname: "/api/journal-records" }),
    "network",
  );
  assert.equal(
    classifyRequest({ ...base, pathname: "/api/journal-records" }),
    "network",
  );
  assert.equal(
    classifyRequest({ ...base, pathname: "/api/auth/session" }),
    "network",
  );
  assert.equal(
    classifyRequest({ ...base, pathname: "/sign-in" }),
    "network",
  );
  assert.equal(
    classifyRequest({
      method: "GET",
      origin: "https://cdn.example",
      appOrigin: base.appOrigin,
      pathname: "/font.woff2",
    }),
    "network",
  );
});

test("offline policy caches only the root shell and same-origin static assets", () => {
  const { classifyRequest } = loadPolicy();
  const base = {
    method: "GET",
    origin: "https://capture.example",
    appOrigin: "https://capture.example",
  };

  assert.equal(
    classifyRequest({ ...base, mode: "navigate", pathname: "/" }),
    "navigation",
  );
  assert.equal(
    classifyRequest({ ...base, pathname: "/_next/static/chunks/app.js" }),
    "static",
  );
  assert.equal(
    classifyRequest({ ...base, pathname: "/capture-logo.png" }),
    "static",
  );
  assert.equal(
    classifyRequest({ ...base, mode: "navigate", pathname: "/settings" }),
    "network",
  );
});
