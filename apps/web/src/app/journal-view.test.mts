import assert from "node:assert/strict";
import test from "node:test";

import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { emptyJournalAreas, type JournalAreas } from "../lib/journal-record.ts";

type ViewProps = {
  areas: JournalAreas;
  canFinalize: boolean;
  issueMessage: string | null;
  onEdit(key: string, value: string): void;
  onNewRecord(): void;
};

const viewModule = await import("./journal-view.ts").catch(() => ({}));
const JournalEditorView = (
  viewModule as { JournalEditorView?: ComponentType<ViewProps> }
).JournalEditorView;

function render(overrides: Partial<ViewProps> = {}): string {
  assert.equal(typeof JournalEditorView, "function");
  if (JournalEditorView === undefined) return "";

  return renderToStaticMarkup(
    createElement(JournalEditorView, {
      areas: emptyJournalAreas(),
      canFinalize: true,
      issueMessage: null,
      onEdit() {},
      onNewRecord() {},
      ...overrides,
    }),
  );
}

test("the real editor view renders six controlled values with canonical symbols and aria-only names", () => {
  const markup = render({
    areas: {
      unclassified: "zero",
      event: "one",
      question: "two",
      insight: "three",
      next: "four",
      feeling: "five",
    },
  });

  assert.equal((markup.match(/<textarea/g) ?? []).length, 6);
  for (const [label, value] of [
    ["Unclassified", "zero"],
    ["Event", "one"],
    ["Question", "two"],
    ["Insight", "three"],
    ["Next", "four"],
    ["Feeling", "five"],
  ]) {
    assert.match(
      markup,
      new RegExp(`<textarea aria-label="${label}">${value}</textarea>`),
    );
  }
  for (const symbol of ["○", "*", "?", "!", "+", "~"]) {
    assert.ok(markup.includes(`<span aria-hidden="true">${symbol}</span>`));
  }
});

test("the empty editor has no placeholder instruction submit control counter or new-record control", () => {
  const markup = render();

  assert.equal(markup.includes("placeholder="), false);
  assert.equal(markup.includes("type=\"submit\""), false);
  assert.equal(markup.includes("aria-label=\"New record\""), false);
  assert.equal(markup.includes("character"), false);
  assert.equal(markup.includes("Get it out of your head"), false);
});

test("new-record appears only for non-empty content and is disabled while recovery is required", () => {
  const areas = { ...emptyJournalAreas(), insight: "non-empty" };
  const readyMarkup = render({ areas, canFinalize: true });
  const blockedMarkup = render({ areas, canFinalize: false });

  assert.match(readyMarkup, /<button type="button" aria-label="New record">/);
  assert.equal(readyMarkup.includes("disabled"), false);
  assert.match(
    blockedMarkup,
    /<button type="button" aria-label="New record" disabled="">/,
  );
});

test("a recoverable issue renders a compact accessible alert while text remains selectable", () => {
  const markup = render({
    areas: { ...emptyJournalAreas(), feeling: "copyable text" },
    canFinalize: false,
    issueMessage: "Journal changes are currently stored in memory only.",
  });

  assert.match(
    markup,
    /role="alert" aria-label="Journal changes are currently stored in memory only\."/,
  );
  assert.ok(markup.includes("<textarea aria-label=\"Feeling\">copyable text</textarea>"));
  assert.equal(
    markup.includes(">Journal changes are currently stored in memory only.<"),
    false,
  );
});
