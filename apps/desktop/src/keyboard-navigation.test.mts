import assert from "node:assert/strict";
import test from "node:test";

import { nextDirectionalFocusIndex } from "./keyboard-navigation.ts";

test("vertical arrows move through controls without wrapping", () => {
  assert.equal(nextDirectionalFocusIndex(1, 4, "ArrowDown"), 2);
  assert.equal(nextDirectionalFocusIndex(1, 4, "ArrowUp"), 0);
  assert.equal(nextDirectionalFocusIndex(3, 4, "ArrowDown"), 3);
  assert.equal(nextDirectionalFocusIndex(0, 4, "ArrowUp"), 0);
});

test("horizontal arrows use the same predictable control order", () => {
  assert.equal(nextDirectionalFocusIndex(1, 4, "ArrowRight"), 2);
  assert.equal(nextDirectionalFocusIndex(1, 4, "ArrowLeft"), 0);
});
