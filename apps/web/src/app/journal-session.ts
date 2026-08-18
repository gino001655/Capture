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
): LocalJournalDraft {
  return {
    id: idFactory(),
    deviceId,
    journalDate: toTaipeiJournalDate(now),
    areas: emptyJournalAreas(),
    revision: null,
    editingState: "active",
    conflictRecordId: idFactory(),
    backgroundedAt: null,
  };
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

export function isJournalLocalState(value: unknown): value is JournalLocalState {
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

  return [
    String(shifted.getUTCFullYear()).padStart(4, "0"),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function createLocalState(now: Date, idFactory: IdFactory): JournalLocalState {
  const deviceId = idFactory();
  return {
    schemaVersion: 1,
    deviceId,
    active: createBlankDraft(deviceId, now, idFactory),
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
    return isJournalLocalState(parsed) ? parsed : createLocalState(now, idFactory);
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

  return {
    ...state,
    active: createBlankDraft(state.deviceId, now, idFactory),
    pending,
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
): JournalLocalState {
  if (state.active.id === localId) {
    return {
      ...state,
      active: {
        ...state.active,
        id: record.id,
        revision: record.revision,
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
