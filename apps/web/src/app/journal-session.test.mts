import assert from "node:assert/strict";
import test from "node:test";

import * as JournalSession from "./journal-session.ts";

import {
  applyServerRecord,
  activateServerRecord,
  createLocalState,
  decideForegroundAction,
  editActiveArea,
  finishActive,
  isJournalLocalState,
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

function sequenceIdFactory(ids: readonly string[]): () => string {
  let index = 0;
  return () => {
    const id = ids[index];
    if (id === undefined) throw new Error("test ID factory exhausted");
    index += 1;
    return id;
  };
}

function stateWithPending() {
  const initial = editActiveArea(
    createLocalState(new Date("2026-08-18T01:00:00Z"), fixedIdFactory()),
    "event",
    "walked",
  );
  return finishActive(
    initial,
    new Date("2026-08-18T01:01:00Z"),
    fixedIdFactory(3),
  );
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

test("rejects Journal date arithmetic outside the four-digit date contract", () => {
  assert.throws(() => shiftJournalDate("9999-12-31", 1), RangeError);
  assert.throws(
    () => shiftJournalDate("2026-01-01", Number.MAX_SAFE_INTEGER),
    RangeError,
  );
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

test("fresh drafts skip identifiers already used by queued work", () => {
  const state = stateWithPending();
  const next = finishActive(
    state,
    new Date("2026-08-18T01:02:00Z"),
    sequenceIdFactory([
      state.pending[0]!.id,
      state.pending[0]!.conflictRecordId,
      IDS[5],
      IDS[6],
    ]),
  );

  assert.equal(next.active.id, IDS[5]);
  assert.equal(next.active.conflictRecordId, IDS[6]);
  assert.equal(isJournalLocalState(next), true);
});

test("a broken identifier factory fails after bounded allocation attempts", () => {
  const state = stateWithPending();
  assert.throws(
    () =>
      finishActive(
        state,
        new Date("2026-08-18T01:02:00Z"),
        () => state.pending[0]!.id,
      ),
    /Could not allocate a distinct Journal identifier/,
  );
});

test("initial state skips an invalid device identifier and remains valid", () => {
  const state = createLocalState(
    new Date("2026-08-18T01:00:00Z"),
    sequenceIdFactory(["not-a-uuid", IDS[0], IDS[1], IDS[2]]),
  );

  assert.equal(state.deviceId, IDS[0]);
  assert.equal(state.active.id, IDS[1]);
  assert.equal(state.active.conflictRecordId, IDS[2]);
  assert.equal(isJournalLocalState(state), true);
});

test("initial state fails deterministically when no valid device id is supplied", () => {
  assert.throws(
    () =>
      createLocalState(
        new Date("2026-08-18T01:00:00Z"),
        () => "not-a-uuid",
      ),
    /Could not allocate a distinct Journal identifier/,
  );
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
  const next = applyServerRecord(
    initial,
    initial.active.id,
    conflict,
    sequenceIdFactory([conflict.id, initial.active.id, IDS[3]]),
  );

  assert.equal(next.active.id, conflict.id);
  assert.equal(next.active.revision, 0);
  assert.equal(next.active.areas.question, "why?");
  assert.equal(next.active.editingState, "active");
  assert.equal(next.active.conflictRecordId, IDS[3]);
  assert.notEqual(next.active.id, next.active.conflictRecordId);

  const laterConflict = serverRecord({
    id: next.active.conflictRecordId,
    conflictOf: next.active.id,
    revision: 0,
  });
  const afterLaterConflict = applyServerRecord(
    next,
    next.active.id,
    laterConflict,
    fixedIdFactory(4),
  );
  assert.equal(afterLaterConflict.active.id, laterConflict.id);
  assert.equal(afterLaterConflict.active.conflictRecordId, IDS[4]);
  assert.notEqual(
    afterLaterConflict.active.id,
    afterLaterConflict.active.conflictRecordId,
  );
});

test("activating a Cloud record preserves the current draft and adopts the server revision", () => {
  const initial = editActiveArea(
    createLocalState(new Date("2026-08-18T01:00:00Z"), fixedIdFactory()),
    "event",
    "keep the current sheet",
  );
  const record = serverRecord({
    id: IDS[5],
    journalDate: "2026-08-17",
    areas: { ...emptyJournalAreas(), insight: "edit this older record" },
    editingState: "idle",
    revision: 4,
  });

  const next = activateServerRecord(initial, record, fixedIdFactory(6));

  assert.equal(next.pending.length, 1);
  assert.equal(next.pending[0]?.id, initial.active.id);
  assert.equal(next.pending[0]?.areas.event, "keep the current sheet");
  assert.equal(next.active.id, record.id);
  assert.equal(next.active.journalDate, "2026-08-17");
  assert.deepEqual(next.active.areas, record.areas);
  assert.equal(next.active.editingState, "idle");
  assert.equal(next.active.revision, 4);
  assert.equal(next.active.conflictRecordId, IDS[6]);
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
    fixedIdFactory(5),
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

test("repairs an active draft whose conflict reservation is its own id", () => {
  const source = stateWithPending();
  const repaired = readLocalState(
    JSON.stringify({
      ...source,
      active: { ...source.active, conflictRecordId: source.active.id },
    }),
    new Date("2026-08-18T01:02:00Z"),
    fixedIdFactory(5),
  );

  assert.equal(isJournalLocalState(repaired), true);
  assert.equal(repaired.deviceId, source.deviceId);
  assert.equal(repaired.active.id, source.active.id);
  assert.equal(repaired.active.revision, source.active.revision);
  assert.deepEqual(repaired.active.areas, source.active.areas);
  assert.deepEqual(repaired.pending, source.pending);
  assert.equal(repaired.active.conflictRecordId, IDS[5]);
});

test("repairs a conflict reservation that collides with another draft id", () => {
  const source = stateWithPending();
  const repaired = readLocalState(
    JSON.stringify({
      ...source,
      active: {
        ...source.active,
        conflictRecordId: source.pending[0]!.id,
      },
    }),
    new Date("2026-08-18T01:02:00Z"),
    fixedIdFactory(5),
  );

  assert.equal(isJournalLocalState(repaired), true);
  assert.equal(repaired.deviceId, source.deviceId);
  assert.equal(repaired.active.id, source.active.id);
  assert.equal(repaired.active.revision, source.active.revision);
  assert.deepEqual(repaired.active.areas, source.active.areas);
  assert.deepEqual(repaired.pending, source.pending);
  assert.equal(repaired.active.conflictRecordId, IDS[5]);
});

test("repairs a shared pending conflict reservation without losing pending content", () => {
  const source = stateWithPending();
  const repaired = readLocalState(
    JSON.stringify({
      ...source,
      pending: [
        {
          ...source.pending[0]!,
          conflictRecordId: source.active.conflictRecordId,
        },
      ],
    }),
    new Date("2026-08-18T01:02:00Z"),
    fixedIdFactory(5),
  );

  assert.equal(isJournalLocalState(repaired), true);
  assert.equal(repaired.deviceId, source.deviceId);
  assert.deepEqual(repaired.active, source.active);
  assert.equal(repaired.pending[0]!.id, source.pending[0]!.id);
  assert.equal(repaired.pending[0]!.revision, source.pending[0]!.revision);
  assert.equal(repaired.pending[0]!.editingState, source.pending[0]!.editingState);
  assert.deepEqual(repaired.pending[0]!.areas, source.pending[0]!.areas);
  assert.equal(repaired.pending[0]!.conflictRecordId, IDS[5]);
});

test("the local storage key is a versioned, stable name", () => {
  assert.equal(JOURNAL_LOCAL_STORAGE_KEY, "capture.journal.v1");
});

test("collision recovery rotates only the target draft conflict reservation", () => {
  const rotateConflictReservation = (
    JournalSession as Record<string, unknown>
  ).rotateConflictReservation;
  assert.equal(typeof rotateConflictReservation, "function");
  if (typeof rotateConflictReservation !== "function") return;

  const source = stateWithPending();
  const next = rotateConflictReservation(
    source,
    source.pending[0]!.id,
    fixedIdFactory(5),
  ) as ReturnType<typeof stateWithPending>;

  assert.equal(next.pending[0]!.id, source.pending[0]!.id);
  assert.equal(next.pending[0]!.revision, source.pending[0]!.revision);
  assert.deepEqual(next.pending[0]!.areas, source.pending[0]!.areas);
  assert.equal(next.pending[0]!.conflictRecordId, IDS[5]);
  assert.deepEqual(next.active, source.active);
});

test("missing-record recovery resets only revision and preserves draft identity and position", () => {
  const rebaseDraftForCreate = (
    JournalSession as Record<string, unknown>
  ).rebaseDraftForCreate;
  assert.equal(typeof rebaseDraftForCreate, "function");
  if (typeof rebaseDraftForCreate !== "function") return;

  const source = stateWithPending();
  const withRevision = {
    ...source,
    pending: [{ ...source.pending[0]!, revision: 4 }],
  };
  const next = rebaseDraftForCreate(
    withRevision,
    withRevision.pending[0]!.id,
  ) as typeof withRevision;

  assert.equal(next.pending[0]!.revision, null);
  assert.equal(next.pending[0]!.id, withRevision.pending[0]!.id);
  assert.equal(
    next.pending[0]!.conflictRecordId,
    withRevision.pending[0]!.conflictRecordId,
  );
  assert.deepEqual(next.pending[0]!.areas, withRevision.pending[0]!.areas);
  assert.deepEqual(next.active, withRevision.active);
});

test("locked-record recovery preserves local content under fresh active identity and reservation", () => {
  const forkLockedDraft = (
    JournalSession as Record<string, unknown>
  ).forkLockedDraft;
  assert.equal(typeof forkLockedDraft, "function");
  if (typeof forkLockedDraft !== "function") return;

  const source = editActiveArea(
    createLocalState(new Date("2026-08-18T01:00:00Z"), fixedIdFactory()),
    "insight",
    "keep this local edit",
  );
  const acknowledged = {
    ...source,
    active: { ...source.active, revision: 3 },
  };
  const next = forkLockedDraft(
    acknowledged,
    acknowledged.active.id,
    fixedIdFactory(3),
  ) as typeof acknowledged;

  assert.equal(next.active.id, IDS[3]);
  assert.equal(next.active.conflictRecordId, IDS[4]);
  assert.equal(next.active.revision, null);
  assert.equal(next.active.areas.insight, "keep this local edit");
  assert.equal(next.active.editingState, "active");
  assert.deepEqual(next.pending, acknowledged.pending);
});
