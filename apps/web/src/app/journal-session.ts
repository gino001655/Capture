import {
  emptyJournalAreas,
  hasJournalContent,
  isValidUuid,
  JOURNAL_AREA_KEYS,
  validateJournalDate,
  type EditingState,
  type JournalAreaKey,
  type JournalAreas,
  type JournalCreateInput,
  type JournalRecord,
} from "../lib/journal-record.ts";

export const AUTOSAVE_DELAY_MS = 1_500;
export const BACKGROUND_ROLLOVER_MS = 600_000;
export const JOURNAL_LOCAL_STORAGE_KEY = "capture.journal.v1";

export type LocalJournalDraft = JournalCreateInput & {
  revision: number | null;
  editingState: EditingState;
  conflictRecordId: string;
  backgroundedAt: number | null;
};

export type JournalLocalState = {
  schemaVersion: 1;
  deviceId: string;
  active: LocalJournalDraft;
  pending: LocalJournalDraft[];
};

type IdFactory = () => string;

const MAX_ID_ALLOCATION_ATTEMPTS = 32;

const TAIPEI_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function createBlankDraft(
  deviceId: string,
  now: Date,
  idFactory: IdFactory,
  occupiedIdentifiers: Set<string>,
): LocalJournalDraft {
  const id = takeDistinctId(idFactory, occupiedIdentifiers);
  return {
    id,
    deviceId,
    journalDate: toTaipeiJournalDate(now),
    areas: emptyJournalAreas(),
    revision: null,
    editingState: "active",
    conflictRecordId: takeDistinctId(idFactory, occupiedIdentifiers),
    backgroundedAt: null,
  };
}

function takeDistinctId(idFactory: IdFactory, occupiedIdentifiers: Set<string>): string {
  for (let attempt = 0; attempt < MAX_ID_ALLOCATION_ATTEMPTS; attempt += 1) {
    const candidate = idFactory();
    if (isValidUuid(candidate) && !occupiedIdentifiers.has(candidate)) {
      occupiedIdentifiers.add(candidate);
      return candidate;
    }
  }

  throw new Error("Could not allocate a distinct Journal identifier.");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === keys.length &&
    keys.every((key) => Object.prototype.propertyIsEnumerable.call(value, key))
  );
}

function isJournalAreas(value: unknown): value is JournalAreas {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, JOURNAL_AREA_KEYS) &&
    JOURNAL_AREA_KEYS.every((key) => typeof value[key] === "string")
  );
}

function isLocalJournalDraft(value: unknown): value is LocalJournalDraft {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "id",
      "deviceId",
      "journalDate",
      "areas",
      "revision",
      "editingState",
      "conflictRecordId",
      "backgroundedAt",
    ])
  ) {
    return false;
  }

  return (
    isValidUuid(value.id) &&
    isValidUuid(value.deviceId) &&
    validateJournalDate(value.journalDate) &&
    isJournalAreas(value.areas) &&
    (value.revision === null ||
      (typeof value.revision === "number" &&
        Number.isSafeInteger(value.revision) &&
        value.revision >= 0)) &&
    (value.editingState === "active" || value.editingState === "idle") &&
    isValidUuid(value.conflictRecordId) &&
    (value.backgroundedAt === null ||
      (typeof value.backgroundedAt === "number" &&
        Number.isSafeInteger(value.backgroundedAt)))
  );
}

function isJournalLocalStateStructure(value: unknown): value is JournalLocalState {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["schemaVersion", "deviceId", "active", "pending"]) ||
    value.schemaVersion !== 1 ||
    !isValidUuid(value.deviceId) ||
    !isLocalJournalDraft(value.active) ||
    !Array.isArray(value.pending) ||
    !value.pending.every(isLocalJournalDraft)
  ) {
    return false;
  }

  const drafts = [value.active, ...value.pending];
  const ids = new Set<string>();
  return drafts.every((draft) => {
    if (draft.deviceId !== value.deviceId || ids.has(draft.id)) return false;
    ids.add(draft.id);
    return true;
  });
}

function hasDistinctConflictReservations(state: JournalLocalState): boolean {
  const identifiers = new Set<string>();
  for (const draft of [state.active, ...state.pending]) {
    if (identifiers.has(draft.id)) return false;
    identifiers.add(draft.id);
  }

  for (const draft of [state.active, ...state.pending]) {
    if (identifiers.has(draft.conflictRecordId)) return false;
    identifiers.add(draft.conflictRecordId);
  }

  return true;
}

function normalizeConflictReservations(
  state: JournalLocalState,
  idFactory: IdFactory,
): JournalLocalState {
  const drafts = [state.active, ...state.pending];
  const draftIds = new Set(drafts.map((draft) => draft.id));
  const allIdentifiers = new Set<string>();
  for (const draft of drafts) {
    allIdentifiers.add(draft.id);
    allIdentifiers.add(draft.conflictRecordId);
  }

  const reserved = new Set<string>();
  let changed = false;
  const normalizedDrafts = drafts.map((draft) => {
    if (
      draftIds.has(draft.conflictRecordId) ||
      reserved.has(draft.conflictRecordId)
    ) {
      changed = true;
      return {
        ...draft,
        conflictRecordId: takeDistinctId(idFactory, allIdentifiers),
      };
    }

    reserved.add(draft.conflictRecordId);
    return draft;
  });

  if (!changed) return state;

  return {
    ...state,
    active: normalizedDrafts[0]!,
    pending: normalizedDrafts.slice(1),
  };
}

export function isJournalLocalState(value: unknown): value is JournalLocalState {
  return (
    isJournalLocalStateStructure(value) && hasDistinctConflictReservations(value)
  );
}

function collectDraftIdentifiers(state: JournalLocalState): Set<string> {
  const identifiers = new Set<string>();
  for (const draft of [state.active, ...state.pending]) {
    identifiers.add(draft.id);
    identifiers.add(draft.conflictRecordId);
  }
  return identifiers;
}

export function toTaipeiJournalDate(date: Date): string {
  const parts = TAIPEI_DATE_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError("Could not format a Taipei Journal date.");
  }

  return `${year}-${month}-${day}`;
}

export function shiftJournalDate(journalDate: string, delta: number): string {
  if (!validateJournalDate(journalDate) || !Number.isSafeInteger(delta)) {
    throw new RangeError("Journal date and delta must be valid.");
  }

  const [year, month, day] = journalDate.split("-").map(Number);
  const shifted = new Date(0);
  shifted.setUTCHours(0, 0, 0, 0);
  shifted.setUTCFullYear(year!, month! - 1, day! + delta);

  if (!Number.isFinite(shifted.getTime())) {
    throw new RangeError("Journal date arithmetic must produce a finite date.");
  }

  const result = [
    String(shifted.getUTCFullYear()).padStart(4, "0"),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");

  if (!validateJournalDate(result)) {
    throw new RangeError("Journal date arithmetic must produce a valid date.");
  }

  return result;
}

export function createLocalState(now: Date, idFactory: IdFactory): JournalLocalState {
  const occupiedIdentifiers = new Set<string>();
  const deviceId = takeDistinctId(idFactory, occupiedIdentifiers);
  return {
    schemaVersion: 1,
    deviceId,
    active: createBlankDraft(deviceId, now, idFactory, occupiedIdentifiers),
    pending: [],
  };
}

export function readLocalState(
  raw: string | null,
  now: Date,
  idFactory: IdFactory,
): JournalLocalState {
  if (raw === null) return createLocalState(now, idFactory);

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isJournalLocalStateStructure(parsed)) {
      return createLocalState(now, idFactory);
    }
    return normalizeConflictReservations(parsed, idFactory);
  } catch {
    return createLocalState(now, idFactory);
  }
}

export function editActiveArea(
  state: JournalLocalState,
  key: JournalAreaKey,
  value: string,
): JournalLocalState {
  return {
    ...state,
    active: {
      ...state.active,
      areas: { ...state.active.areas, [key]: value },
      editingState: "active",
    },
  };
}

export function finishActive(
  state: JournalLocalState,
  now: Date,
  idFactory: IdFactory,
): JournalLocalState {
  const pending = hasJournalContent(state.active.areas)
    ? [
        ...state.pending,
        {
          ...state.active,
          areas: { ...state.active.areas },
          editingState: "idle" as const,
          backgroundedAt: null,
        },
      ]
    : [...state.pending];
  const occupiedIdentifiers = collectDraftIdentifiers(state);

  return {
    ...state,
    active: createBlankDraft(
      state.deviceId,
      now,
      idFactory,
      occupiedIdentifiers,
    ),
    pending,
  };
}

export function startNewForDate(
  state: JournalLocalState,
  journalDate: string,
  now: Date,
  idFactory: IdFactory,
): JournalLocalState {
  if (!validateJournalDate(journalDate)) {
    throw new RangeError("Journal date must be valid.");
  }

  const next = hasJournalContent(state.active.areas)
    ? finishActive(state, now, idFactory)
    : state;
  return {
    ...next,
    active: { ...next.active, journalDate },
  };
}

export function markBackgrounded(
  state: JournalLocalState,
  now: Date,
): JournalLocalState {
  return {
    ...state,
    active: { ...state.active, backgroundedAt: now.getTime() },
  };
}

export function decideForegroundAction(
  draft: LocalJournalDraft,
  now: number,
): "resume" | "finish-and-new" {
  if (
    draft.backgroundedAt === null ||
    !hasJournalContent(draft.areas) ||
    now - draft.backgroundedAt < BACKGROUND_ROLLOVER_MS
  ) {
    return "resume";
  }

  return "finish-and-new";
}

export function applyServerRecord(
  state: JournalLocalState,
  localId: string,
  record: JournalRecord,
  idFactory: IdFactory,
): JournalLocalState {
  if (state.active.id === localId) {
    const occupiedIdentifiers = collectDraftIdentifiers(state);
    occupiedIdentifiers.add(record.id);
    const conflictRecordId =
      record.id === localId
        ? state.active.conflictRecordId
        : takeDistinctId(idFactory, occupiedIdentifiers);
    return {
      ...state,
      active: {
        ...state.active,
        id: record.id,
        revision: record.revision,
        conflictRecordId,
      },
    };
  }

  const pendingIndex = state.pending.findIndex((draft) => draft.id === localId);
  if (pendingIndex === -1) return state;

  return {
    ...state,
    pending: state.pending.filter((draft) => draft.id !== localId),
  };
}

export function activateServerRecord(
  state: JournalLocalState,
  record: JournalRecord,
  idFactory: IdFactory,
): JournalLocalState {
  if (state.active.id === record.id) {
    if (
      state.active.revision === null ||
      record.revision <= state.active.revision
    ) {
      return state;
    }
    return {
      ...state,
      active: {
        ...state.active,
        deviceId: record.deviceId,
        journalDate: record.journalDate,
        areas: { ...record.areas },
        revision: record.revision,
        editingState: record.editingState,
        backgroundedAt: null,
      },
    };
  }

  const occupiedIdentifiers = collectDraftIdentifiers(state);
  occupiedIdentifiers.add(record.id);
  const preservedActive = hasJournalContent(state.active.areas)
    ? [{ ...state.active, areas: { ...state.active.areas } }]
    : [];

  return {
    ...state,
    active: {
      id: record.id,
      deviceId: record.deviceId,
      journalDate: record.journalDate,
      areas: { ...record.areas },
      revision: record.revision,
      editingState: record.editingState,
      conflictRecordId: takeDistinctId(idFactory, occupiedIdentifiers),
      backgroundedAt: null,
    },
    pending: [
      ...state.pending.filter((draft) => draft.id !== record.id),
      ...preservedActive,
    ],
  };
}

function replaceDraft(
  state: JournalLocalState,
  localId: string,
  replace: (draft: LocalJournalDraft) => LocalJournalDraft,
): JournalLocalState {
  if (state.active.id === localId) {
    return { ...state, active: replace(state.active) };
  }

  const pendingIndex = state.pending.findIndex((draft) => draft.id === localId);
  if (pendingIndex === -1) return state;

  return {
    ...state,
    pending: state.pending.map((draft, index) =>
      index === pendingIndex ? replace(draft) : draft,
    ),
  };
}

export function rotateConflictReservation(
  state: JournalLocalState,
  localId: string,
  idFactory: IdFactory,
): JournalLocalState {
  const occupiedIdentifiers = collectDraftIdentifiers(state);
  return replaceDraft(state, localId, (draft) => ({
    ...draft,
    conflictRecordId: takeDistinctId(idFactory, occupiedIdentifiers),
  }));
}

export function rebaseDraftForCreate(
  state: JournalLocalState,
  localId: string,
): JournalLocalState {
  return replaceDraft(state, localId, (draft) => ({ ...draft, revision: null }));
}

export function forkLockedDraft(
  state: JournalLocalState,
  localId: string,
  idFactory: IdFactory,
): JournalLocalState {
  const occupiedIdentifiers = collectDraftIdentifiers(state);
  return replaceDraft(state, localId, (draft) => ({
    ...draft,
    id: takeDistinctId(idFactory, occupiedIdentifiers),
    conflictRecordId: takeDistinctId(idFactory, occupiedIdentifiers),
    revision: null,
  }));
}
