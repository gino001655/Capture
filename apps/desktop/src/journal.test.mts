import assert from "node:assert/strict";
import test from "node:test";

import {
  AREA_SYMBOLS,
  JOURNAL_AREA_KEYS,
  createLocalState,
  editActiveArea,
  finishActive,
  hasJournalContent,
  hasJournalInput,
  journalEditCounts,
  journalAreasEqual,
  refreshBlankDraftDate,
  quickCaptureKeyAction,
  shiftJournalDate,
  textEditDiff,
} from "./journal.ts";

const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
];

test("Desktop Journal keeps the approved six-area order and symbols", () => {
  assert.deepEqual(JOURNAL_AREA_KEYS, [
    "unclassified",
    "event",
    "question",
    "insight",
    "next",
    "feeling",
  ]);
  assert.deepEqual(JOURNAL_AREA_KEYS.map((key) => AREA_SYMBOLS[key]), [
    "○",
    "+",
    "?",
    "~",
    "!",
    "*",
  ]);
});

test("finishing a non-empty Desktop draft queues it idle and opens a blank active draft", () => {
  let index = 0;
  const idFactory = () => ids[index++]!;
  const initial = createLocalState(new Date("2026-08-18T03:00:00Z"), idFactory);
  const edited = editActiveArea(initial, "unclassified", "desktop thought");
  const finished = finishActive(
    edited,
    new Date("2026-08-18T03:01:00Z"),
    idFactory,
  );

  assert.equal(finished.pending.length, 1);
  assert.equal(finished.pending[0]?.editingState, "idle");
  assert.equal(finished.pending[0]?.areas.unclassified, "desktop thought");
  assert.equal(hasJournalContent(finished.active.areas), false);
  assert.equal(finished.active.editingState, "active");
});

test("Desktop date navigation crosses month boundaries without UTC drift", () => {
  assert.equal(shiftJournalDate("2026-08-01", -1), "2026-07-31");
  assert.equal(shiftJournalDate("2026-08-31", 1), "2026-09-01");
});

test("Quick Capture requires two Enters and Escape cancels completion", () => {
  assert.equal(quickCaptureKeyAction(true, "none", "Enter", false, false), "confirm-complete");
  assert.equal(quickCaptureKeyAction(true, "complete", "Enter", false, false), "finish");
  assert.equal(quickCaptureKeyAction(true, "complete", "Escape", false, false), "cancel");
});

test("blank Quick Capture exits directly while content asks before leaving", () => {
  assert.equal(quickCaptureKeyAction(false, "none", "Escape", false, false), "hide");
  assert.equal(quickCaptureKeyAction(false, "none", "ArrowLeft", false, true), "open-full");
  assert.equal(quickCaptureKeyAction(true, "none", "Escape", false, false), "confirm-hide");
  assert.equal(quickCaptureKeyAction(true, "none", "ArrowLeft", false, true), "confirm-full");
  assert.equal(quickCaptureKeyAction(false, "none", "ArrowRight", false, true), "open-special");
  assert.equal(quickCaptureKeyAction(true, "none", "ArrowRight", false, true), "confirm-special");
});

test("an old blank draft follows today's Taipei date without moving written content", () => {
  let index = 0;
  const idFactory = () => ids[index++]!;
  const oldBlank = createLocalState(new Date("2026-08-18T03:00:00Z"), idFactory);
  const refreshed = refreshBlankDraftDate(oldBlank, new Date("2026-08-20T03:00:00Z"));
  assert.equal(refreshed.active.journalDate, "2026-08-20");

  const written = editActiveArea(oldBlank, "event", "keep the assigned date");
  assert.equal(
    refreshBlankDraftDate(written, new Date("2026-08-20T03:00:00Z")).active.journalDate,
    "2026-08-18",
  );
});

test("record editing compares all six areas without storing permanent history", () => {
  let index = 0;
  const state = createLocalState(new Date("2026-08-20T03:00:00Z"), () => ids[index++]!);
  assert.equal(journalAreasEqual(state.active.areas, { ...state.active.areas }), true);
  assert.equal(
    journalAreasEqual(state.active.areas, { ...state.active.areas, event: "changed" }),
    false,
  );
});

test("live edit diff identifies added and removed middle text", () => {
  assert.deepEqual(textEditDiff("before old after", "before new after"), {
    before: "before ",
    added: "new",
    removed: "old",
    after: " after",
  });
  assert.deepEqual(textEditDiff("keep deleted", "keep "), {
    before: "keep ",
    added: "",
    removed: "deleted",
    after: "",
  });
});

test("Desktop treats line breaks as input so they can be completed or discarded", () => {
  let index = 0;
  const state = createLocalState(new Date("2026-08-20T03:00:00Z"), () => ids[index++]!);
  const lineBreaks = { ...state.active.areas, question: "\n\n" };
  assert.equal(hasJournalContent(lineBreaks), false);
  assert.equal(hasJournalInput(lineBreaks), true);

  const preserved = refreshBlankDraftDate(
    { ...state, active: { ...state.active, areas: lineBreaks } },
    new Date("2026-08-21T03:00:00Z"),
  );
  assert.equal(preserved.active.journalDate, "2026-08-20");
});

test("save confirmation counts added and removed Unicode characters", () => {
  let index = 0;
  const state = createLocalState(new Date("2026-08-20T03:00:00Z"), () => ids[index++]!);
  const original = { ...state.active.areas, event: "abc", feeling: "old" };
  const current = { ...original, event: "abc🙂", feeling: "new" };
  assert.deepEqual(journalEditCounts(original, current), { added: 4, removed: 3 });
});
