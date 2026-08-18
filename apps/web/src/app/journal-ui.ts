import {
  hasJournalContent,
  isValidUuid,
  validateJournalCreateRequest,
  validateJournalDate,
  type JournalRecord,
} from "../lib/journal-record.ts";
import type { LocalJournalDraft } from "./journal-session.ts";

export const JOURNAL_THEME_STORAGE_KEY = "capture.journal.theme";

export type JournalTheme = "light" | "dark";

export type JournalListEntry = Pick<
  JournalRecord,
  "id" | "journalDate" | "areas" | "deliveryState"
> & {
  serverRecord: JournalRecord | null;
};

export type ReconciledJournalList = {
  entries: JournalListEntry[];
  selectedId: string | null;
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

export function formatJournalDateLabel(journalDate: string): string {
  if (!validateJournalDate(journalDate)) {
    throw new RangeError("Journal date must be valid.");
  }
  const [, month, day] = journalDate.split("-").map(Number);
  return `${month}.${day}`;
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

function serverEntry(record: JournalRecord): JournalListEntry {
  return {
    id: record.id,
    journalDate: record.journalDate,
    areas: record.areas,
    deliveryState: record.deliveryState,
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
