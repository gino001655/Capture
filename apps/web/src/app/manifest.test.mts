import assert from "node:assert/strict";
import test from "node:test";

import manifest from "./manifest.ts";

test("the install manifest uses the approved monochrome standalone identity", () => {
  const value = manifest();

  assert.equal(value.display, "standalone");
  assert.equal(value.start_url, "/");
  assert.equal(value.scope, "/");
  assert.equal(value.background_color, "#ffffff");
  assert.equal(value.theme_color, "#000000");
  assert.deepEqual(
    value.icons?.map(({ sizes, type, purpose }) => ({ sizes, type, purpose })),
    [
      { sizes: "512x512", type: "image/png", purpose: "any" },
      { sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  );
});
