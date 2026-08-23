import assert from "node:assert/strict";
import test from "node:test";

import {
  createElement,
  isValidElement,
  type ReactElement,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { emptyJournalAreas, type JournalAreas } from "../lib/journal-record.ts";

type ViewProps = {
  areas: JournalAreas;
  canFinalize: boolean;
  issueMessages: readonly string[];
  onEdit(key: string, value: string): void;
  onNewRecord(): void;
};

const viewModule = await import("./journal-view.ts").catch(() => ({}));
const JournalEditorView = (
  viewModule as { JournalEditorView?: (props: ViewProps) => ReactElement }
).JournalEditorView;
const JournalToolbar = (
  viewModule as { JournalToolbar?: (props: Record<string, unknown>) => ReactElement }
).JournalToolbar;
const JournalRecordListView = (
  viewModule as { JournalRecordListView?: (props: Record<string, unknown>) => ReactElement }
).JournalRecordListView;
const JournalRecordEditorView = (
  viewModule as { JournalRecordEditorView?: (props: Record<string, unknown>) => ReactElement }
).JournalRecordEditorView;

function render(overrides: Partial<ViewProps> = {}): string {
  assert.equal(typeof JournalEditorView, "function");
  if (JournalEditorView === undefined) return "";

  return renderToStaticMarkup(
    createElement(JournalEditorView, {
      areas: emptyJournalAreas(),
      canFinalize: true,
      issueMessages: [],
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
    issueMessages: ["Journal changes are currently stored in memory only."],
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

test("all distinct actionable issues are rendered as accessible compact alerts", () => {
  const markup = render({
    issueMessages: [
      "Journal content is too long.",
      "Journal changes are stored in memory only.",
    ],
  });

  assert.equal((markup.match(/role="alert"/g) ?? []).length, 2);
  assert.ok(markup.includes('aria-label="Journal content is too long."'));
  assert.ok(
    markup.includes(
      'aria-label="Journal changes are stored in memory only."',
    ),
  );
});

test("the real view keeps every textarea controlled and dispatches its own area value", () => {
  assert.equal(typeof JournalEditorView, "function");
  if (JournalEditorView === undefined) return;
  const edits: Array<[string, string]> = [];
  const areaEntries = [
    ["unclassified", "zero"],
    ["event", "one"],
    ["question", "two"],
    ["insight", "three"],
    ["next", "four"],
    ["feeling", "five"],
  ] as const;
  const tree = JournalEditorView({
    areas: Object.fromEntries(areaEntries) as JournalAreas,
    canFinalize: true,
    issueMessages: [],
    onEdit(key, value) {
      edits.push([key, value]);
    },
    onNewRecord() {},
  });
  const fieldElements = (tree.props as { children: unknown[] }).children.slice(0, 6);

  for (const [index, [key, value]] of areaEntries.entries()) {
    const field = fieldElements[index];
    assert.ok(isValidElement(field));
    const children = (field.props as { children: unknown[] }).children;
    const textarea = children[1];
    assert.ok(isValidElement(textarea));
    const props = textarea.props as Record<string, unknown>;
    assert.equal(props.value, value);
    assert.equal(Object.hasOwn(props, "defaultValue"), false);
    assert.equal(typeof props.onChange, "function");
    (props.onChange as (event: { currentTarget: { value: string } }) => void)({
      currentTarget: { value: `edited ${key}` },
    });
  }

  assert.deepEqual(
    edits,
    areaEntries.map(([key]) => [key, `edited ${key}`]),
  );
});

test("the compact toolbar exposes icon-only Chinese-labelled controls and a native date input", () => {
  assert.equal(typeof JournalToolbar, "function");
  if (JournalToolbar === undefined) return;
  const markup = renderToStaticMarkup(
    createElement(JournalToolbar, {
      date: "2026-08-18",
      mode: "capture",
      onOpenSettings() {},
      onDateChange() {},
      onPrimaryAction() {},
    }),
  );

  for (const label of ["設定", "選擇日期", "紀錄列表"]) {
    assert.ok(markup.includes(`aria-label="${label}"`));
  }
  assert.ok(markup.includes('type="date"'));
  assert.ok(markup.includes('value="2026-08-18"'));
  assert.ok(markup.includes("8.18"));
  assert.equal(markup.includes(">設定<"), false);
  assert.equal(markup.includes('aria-label="前一天"'), false);
  assert.equal(markup.includes('aria-label="後一天"'), false);
});

test("the record stream previews only non-empty raw areas without content cards", () => {
  assert.equal(typeof JournalRecordListView, "function");
  if (JournalRecordListView === undefined) return;
  const markup = renderToStaticMarkup(
    createElement(JournalRecordListView, {
      records: [{
        id: "00000000-0000-4000-8000-000000000001",
        deviceId: "00000000-0000-4000-8000-000000000002",
        journalDate: "2026-08-18",
        areas: {
          ...emptyJournalAreas(),
          event: "  raw event\nsecond line",
          question: "   ",
        },
        deliveryState: "undelivered",
        editingState: "idle",
        revision: 1,
        createdAt: "2026-08-18T01:00:00.000Z",
        updatedAt: "2026-08-18T01:00:00.000Z",
      }],
      selectedId: null,
      deleteMode: false,
      onToggleDeleteMode() {},
      onSelect() {},
    }),
  );

  assert.ok(markup.includes("  raw event\nsecond line"));
  assert.equal(markup.includes("Question"), false);
  assert.equal(markup.includes("journalCard"), false);
});

test("the record stream exposes an explicit delete mode without opening an editor", () => {
  assert.equal(typeof JournalRecordListView, "function");
  if (JournalRecordListView === undefined) return;
  const markup = renderToStaticMarkup(
    createElement(JournalRecordListView, {
      records: [{
        id: "00000000-0000-4000-8000-000000000001",
        journalDate: "2026-08-18",
        areas: { ...emptyJournalAreas(), event: "remove me" },
        deliveryState: "undelivered",
      }],
      selectedId: null,
      deleteMode: true,
      onToggleDeleteMode() {},
      onSelect() {},
    }),
  );
  assert.ok(markup.includes(">完成<"));
  assert.ok(markup.includes('aria-label="移到垃圾桶"'));
  assert.ok(markup.includes("journalDeleteMode"));
});

test("record editing shows six fields when undelivered and only non-empty disabled fields when delivered", () => {
  assert.equal(typeof JournalRecordEditorView, "function");
  if (JournalRecordEditorView === undefined) return;
  const baseRecord = {
    id: "00000000-0000-4000-8000-000000000001",
    deviceId: "00000000-0000-4000-8000-000000000002",
    journalDate: "2026-08-18",
    areas: { ...emptyJournalAreas(), feeling: "calm" },
    editingState: "idle" as const,
    revision: 1,
    createdAt: "2026-08-18T01:00:00.000Z",
    updatedAt: "2026-08-18T01:00:00.000Z",
  };
  const editable = renderToStaticMarkup(
    createElement(JournalRecordEditorView, {
      record: { ...baseRecord, deliveryState: "undelivered" },
      areas: baseRecord.areas,
      issueMessages: [],
      onEdit() {},
      onBack() {},
    }),
  );
  const locked = renderToStaticMarkup(
    createElement(JournalRecordEditorView, {
      record: { ...baseRecord, deliveryState: "delivered" },
      areas: baseRecord.areas,
      issueMessages: [],
      onEdit() {},
      onBack() {},
    }),
  );

  assert.equal((editable.match(/<textarea/g) ?? []).length, 6);
  assert.equal(editable.includes("disabled"), false);
  assert.equal((locked.match(/<textarea/g) ?? []).length, 1);
  assert.ok(locked.includes("disabled"));
  assert.ok(locked.includes('aria-label="已送出，唯讀"'));
  assert.equal(editable.includes('aria-label="移到垃圾桶"'), false);
});
