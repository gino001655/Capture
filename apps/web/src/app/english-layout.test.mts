import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generic centered pages do not override full-height capture modules", async () => {
  const css = await readFile(new URL("./globals.css", import.meta.url), "utf8");
  const genericPageSelectors = css.match(/main:not\([^}]+\)\s*\{/g) ?? [];

  assert.ok(genericPageSelectors.length >= 2, "expected base and mobile generic-page rules");
  for (const selector of genericPageSelectors) {
    assert.match(selector, /:not\(\.englishShell\)/);
    assert.match(selector, /:not\(\.specialPlaceholder\)/);
  }

  const editorRule = css.match(/\.englishEditor\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  assert.match(editorRule, /text-align:\s*start\s*;/);
});

test("mobile recorder date swipes ignore vertical scrolling and animate the transition", async () => {
  for (const filename of ["english-app.tsx", "workout-app.tsx", "food-app.tsx"]) {
    const source = await readFile(new URL(`./${filename}`, import.meta.url), "utf8");
    assert.match(source, /clientY/, `${filename} must distinguish horizontal swipes from scrolling`);
    assert.match(source, /dateSlide-/, `${filename} must animate a date change`);
  }
});
