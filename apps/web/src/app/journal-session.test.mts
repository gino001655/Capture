import assert from "node:assert/strict";
import test from "node:test";

import {
  applyServerRecord,
  createLocalState,
  decideForegroundAction,
  editActiveArea,
  finishActive,
  JOURNAL_LOCAL_STORAGE_KEY,
  markBackgrounded,
  readLocalState,
  shiftJournalDate,
  toTaipeiJournalDate,
  type LocalJournalDraft,
} from "./journal-session.ts";
import {
  emptyJournalAreas,
  hasJournalContent,
  type JournalRecord,
} from "../lib/journal-record.ts";

const IDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
  "00000000-0000-4000-8000-000000000006",
  "00000000-0000-4000-8000-000000000007",
  "00000000-0000-4000-8000-000000000008",
  "00000000-0000-4000-8000-000000000009",
] as const;

function fixedIdFactory(start = 0): () => string {
  let index = start;
  return () => {
    const id = IDS[index];
    if (id === undefined) throw new Error("test ID factory exhausted");
    index += 1;
    return id;
  };
}

function nonEmptyDraft(backgroundedAt: number | null): LocalJournalDraft {
  return {
    id: IDS[1],
    deviceId: IDS[0],
    journalDate: "2026-08-18",
    areas: { ...emptyJournalAreas(), insight: "A useful idea" },
    revision: null,
    editingState: "active",
    conflictRecordId: IDS[2],
    backgroundedAt,
  };
}

function serverRecord(overrides: Partial<JournalRecord> = {}): JournalRecord {
  return {
    id: IDS[1],
    deviceId: IDS[0],
    journalDate: "2026-08-18",
    areas: { ...emptyJournalAreas(), insight: "A useful idea" },
    deliveryState: "undelivered",
    editingState: "active",
    revision: 1,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

test("formats the Journal date in Asia/Taipei", () => {
  assert.equal(
    toTaipeiJournalDate(new Date("2026-08-17T16:30:00Z")),
    "2026-08-18",
  );
  assert.equal(
    toTaipeiJournalDate(new Date("2026-08-17T15:59:59.999Z")),
    "2026-08-17",
  );
});

test("shifts Taipei Journal dates without UTC date parsing", () => {
  assert.equal(shiftJournalDate("2026-08-18", -1), "2026-08-17");
  assert.equal(shiftJournalDate("2024-02-28", 1), "2024-02-29");
  assert.equal(shiftJournalDate("2024-02-29", 1), "2024-03-01");
});

test("resumes at 9:59 but rolls over at 10:00", () => {
  assert.equal(decideForegroundAction(nonEmptyDraft(0), 599_999), "resume");
  assert.equal(
    decideForegroundAction(nonEmptyDraft(0), 600_000),
    "finish-and-new",
  );
});

test("empty or never-backgrounded drafts always resume", () => {
  assert.equal(
    decideForegroundAction({ ...nonEmptyDraft(null), areas: emptyJournalAreas() }, 600_000),
    "resume",
  );
  assert.equal(decideForegroundAction(nonEmptyDraft(null), 600_000), "resume");
});

test("finishing offline queues the old record and creates an empty active sheet", () => {
  const initial = createLocalState(
    new Date("2026-08-18T01:00:00Z"),
    fixedIdFactory(),
  );
  const edited = editActiveArea(initial, "event", "trained legs");
  const finished = finishActive(
    edited,
    new Date("2026-08-18T01:01:00Z"),
    fixedIdFactory(3),
  );

  assert.equal(finished.pending.length, 1);
  assert.equal(finished.pending[0]?.editingState, "idle");
  assert.equal(finished.pending[0]?.areas.event, "trained legs");
  assert.equal(hasJournalContent(finished.active.areas), false);
  assert.equal(finished.active.editingState, "active");
  assert.equal(finished.active.id, IDS[3]);
  assert.equal(finished.active.conflictRecordId, IDS[4]);
});

test("finishing an empty draft creates no pending mutation", () => {
  const state = createLocalState(
    new Date("2026-08-18T01:00:00Z"),
    fixedIdFactory(),
  );
  const finished = finishActive(
    state,
    new Date("2026-08-18T01:01:00Z"),
    fixedIdFactory(3),
  );

  assert.equal(finished.pending.length, 0);
  assert.equal(hasJournalContent(finished.active.areas), false);
});

test("backgrounding records an epoch timestamp without mutating the draft content", () => {
  const state = editActiveArea(
    createLocalState(new Date("2026-08-18T01:00:00Z"), fixedIdFactory()),
    "feeling",
    "calm",
  );
  const next = markBackgrounded(state, new Date("2026-08-18T01:02:03.000Z"));

  assert.equal(next.active.backgroundedAt, Date.parse("2026-08-18T01:02:03.000Z"));
  assert.equal(next.active.areas.feeling, "calm");
  assert.equal(state.active.backgroundedAt, null);
});

test("acknowledging a conflict switches the active id to the conflict copy", () => {
  const initial = editActiveArea(
    createLocalState(new Date("2026-08-18T01:00:00Z"), fixedIdFactory()),
    "question",
    "why?",
  );
  const conflict = serverRecord({
    id: initial.active.conflictRecordId,
    conflictOf: initial.active.id,
    revision: 0,
  });
  const next = applyServerRecord(initial, initial.active.id, conflict);

  assert.equal(next.active.id, conflict.id);
  assert.equal(next.active.revision, 0);
  assert.equal(next.active.areas.question, "why?");
  assert.equal(next.active.editingState, "active");
});

test("acknowledging a pending record removes only that pending mutation", () => {
  const initial = editActiveArea(
    createLocalState(new Date("2026-08-18T01:00:00Z"), fixedIdFactory()),
    "event",
    "walked",
  );
  const finished = finishActive(
    initial,
    new Date("2026-08-18T01:01:00Z"),
    fixedIdFactory(3),
  );
  const next = applyServerRecord(
    finished,
    finished.pending[0]!.id,
    serverRecord({ id: finished.pending[0]!.id, editingState: "idle" }),
  );

  assert.equal(next.pending.length, 0);
  assert.equal(next.active.id, finished.active.id);
});

test("invalid localStorage JSON falls back to a clean session", () => {
  const state = readLocalState(
    "{broken",
    new Date("2026-08-18T01:00:00Z"),
    fixedIdFactory(),
  );
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.pending.length, 0);
  assert.equal(hasJournalContent(state.active.areas), false);
});

test("invalid, old, and malformed serialized states fall back to clean sessions", () => {
  const malformedDraft = JSON.stringify({
    schemaVersion: 1,
    deviceId: IDS[0],
    active: { ...nonEmptyDraft(null), areas: { ...emptyJournalAreas(), extra: "no" } },
    pending: [],
  });

  for (const raw of ["null", "[]", JSON.stringify({ schemaVersion: 0 }), malformedDraft]) {
    const state = readLocalState(
      raw,
      new Date("2026-08-18T01:00:00Z"),
      fixedIdFactory(),
    );
    assert.equal(state.schemaVersion, 1);
    assert.equal(state.pending.length, 0);
    assert.equal(hasJournalContent(state.active.areas), false);
  }
});

test("the local storage key is a versioned, stable name", () => {
  assert.equal(JOURNAL_LOCAL_STORAGE_KEY, "capture.journal.v1");
});
