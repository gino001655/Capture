import assert from "node:assert/strict";
import test from "node:test";

import manifest from "./manifest.ts";

test("the install manifest uses the supplied standalone app identity", () => {
  const value = manifest();

  assert.equal(value.display, "standalone");
  assert.equal(value.start_url, "/");
  assert.equal(value.scope, "/");
  assert.equal(value.background_color, "#ffffff");
  assert.equal(value.theme_color, "#000000");
  assert.deepEqual(
    value.icons?.map(({ src, sizes, type, purpose }) => ({ src, sizes, type, purpose })),
    [
      { src: "/capture-logo.png", sizes: "1254x1254", type: "image/png", purpose: "any" },
      { src: "/capture-logo.png", sizes: "1254x1254", type: "image/png", purpose: "maskable" },
    ],
  );
});
