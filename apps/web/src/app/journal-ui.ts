import {
  hasJournalContent,
  isValidUuid,
  validateJournalCreateRequest,
  validateJournalDate,
  type JournalRecord,
  type JournalAreas,
  type TrashedJournalRecord,
} from "../lib/journal-record.ts";
import type { LocalJournalDraft } from "./journal-session.ts";

export const JOURNAL_THEME_STORAGE_KEY = "capture.journal.theme";

export type JournalTheme = "light" | "dark";

export type JournalListEntry = Pick<
  JournalRecord,
  "id" | "journalDate" | "areas" | "deliveryState"
> & {
  createdAt: string | null;
  serverRecord: JournalRecord | null;
};

export type ReconciledJournalList = {
  entries: JournalListEntry[];
  selectedId: string | null;
};

export type TextEditDiff = {
  before: string;
  added: string;
  removed: string;
  after: string;
};

type ThemeReader = Pick<Storage, "getItem">;
type ThemeWriter = Pick<Storage, "setItem">;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJournalRecord(value: unknown): value is JournalRecord {
  if (!isPlainObject(value) || !validateJournalCreateRequest(value).success) {
    return false;
  }

  return (
    (value.deliveryState === "undelivered" || value.deliveryState === "delivered") &&
    (value.editingState === "active" || value.editingState === "idle") &&
    typeof value.revision === "number" &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    (value.conflictOf === undefined || isValidUuid(value.conflictOf))
  );
}

function isTrashedJournalRecord(value: unknown): value is TrashedJournalRecord {
  if (!isPlainObject(value) || !isJournalRecord(value)) return false;
  const deletedAt = (value as Record<string, unknown>).deletedAt;
  return typeof deletedAt === "string" && Number.isFinite(Date.parse(deletedAt));
}

export function formatJournalDateLabel(journalDate: string): string {
  if (!validateJournalDate(journalDate)) {
    throw new RangeError("Journal date must be valid.");
  }
  const [, month, day] = journalDate.split("-").map(Number);
  return `${month}.${day}`;
}

export function formatJournalTimeLabel(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function parseJournalRecordList(
  payload: unknown,
  selectedDate: string,
): JournalRecord[] {
  if (
    !validateJournalDate(selectedDate) ||
    !isPlainObject(payload) ||
    !Array.isArray(payload.records) ||
    !payload.records.every(
      (record) => isJournalRecord(record) && record.journalDate === selectedDate,
    )
  ) {
    throw new TypeError("Journal list response is invalid.");
  }

  return [...payload.records].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

export function parseJournalTrashList(payload: unknown): TrashedJournalRecord[] {
  if (
    !isPlainObject(payload) ||
    !Array.isArray(payload.records) ||
    !payload.records.every(isTrashedJournalRecord)
  ) {
    throw new TypeError("Journal trash response is invalid.");
  }
  return [...payload.records].sort(
    (left, right) => Date.parse(right.deletedAt) - Date.parse(left.deletedAt),
  ) as TrashedJournalRecord[];
}

export function textEditDiff(original: string, current: string): TextEditDiff {
  let prefix = 0;
  const shared = Math.min(original.length, current.length);
  while (prefix < shared && original[prefix] === current[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < original.length - prefix &&
    suffix < current.length - prefix &&
    original[original.length - 1 - suffix] === current[current.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    before: current.slice(0, prefix),
    added: current.slice(prefix, current.length - suffix),
    removed: original.slice(prefix, original.length - suffix),
    after: current.slice(current.length - suffix),
  };
}

export function journalEditCounts(original: JournalAreas, current: JournalAreas) {
  return Object.keys(original).reduce(
    (counts, key) => {
      const area = key as keyof JournalAreas;
      const diff = textEditDiff(original[area], current[area]);
      counts.added += Array.from(diff.added).length;
      counts.removed += Array.from(diff.removed).length;
      return counts;
    },
    { added: 0, removed: 0 },
  );
}

function serverEntry(record: JournalRecord): JournalListEntry {
  return {
    id: record.id,
    journalDate: record.journalDate,
    areas: record.areas,
    deliveryState: record.deliveryState,
    createdAt: record.createdAt,
    serverRecord: record,
  };
}

export function reconcileJournalRecordList(
  serverRecords: readonly JournalRecord[],
  active: LocalJournalDraft,
  selectedDate: string,
  selectedId: string | null,
): ReconciledJournalList {
  const cloudEntries = serverRecords.map(serverEntry);
  if (
    active.journalDate !== selectedDate ||
    !hasJournalContent(active.areas)
  ) {
    return {
      entries: cloudEntries,
      selectedId: cloudEntries.some((entry) => entry.id === selectedId)
        ? selectedId
        : null,
    };
  }

  const matchingServer = serverRecords.find((record) => record.id === active.id);
  const serverWins =
    matchingServer !== undefined &&
    (matchingServer.deliveryState === "delivered" ||
      (active.revision !== null && matchingServer.revision > active.revision));
  const activeEntry = serverWins
    ? serverEntry(matchingServer)
    : {
        id: active.id,
        journalDate: active.journalDate,
        areas: active.areas,
        deliveryState: matchingServer?.deliveryState ?? "undelivered",
        createdAt: matchingServer?.createdAt ?? null,
        serverRecord: matchingServer ?? null,
      } satisfies JournalListEntry;
  const entries = [
    activeEntry,
    ...cloudEntries.filter((entry) => entry.id !== active.id),
  ];

  return {
    entries,
    selectedId: entries.some((entry) => entry.id === selectedId)
      ? selectedId
      : active.id,
  };
}

export function readJournalTheme(storage: ThemeReader): JournalTheme {
  try {
    return storage.getItem(JOURNAL_THEME_STORAGE_KEY) === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export function persistJournalTheme(
  storage: ThemeWriter,
  theme: JournalTheme,
): boolean {
  try {
    storage.setItem(JOURNAL_THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}
