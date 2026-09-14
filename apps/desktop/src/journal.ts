import {
  JOURNAL_AREA_KEYS,
  type JournalAreaKey,
  type JournalAreas,
} from "../../web/src/lib/journal-record.ts";
import {
  toTaipeiJournalDate,
  type JournalLocalState,
} from "../../web/src/app/journal-session.ts";

export {
  JOURNAL_AREA_KEYS,
  emptyJournalAreas,
  hasJournalContent,
  type DeliveryState,
  type EditingState,
  type JournalAreaKey,
  type JournalAreas,
  type JournalRecord,
} from "../../web/src/lib/journal-record.ts";

export {
  AUTOSAVE_DELAY_MS,
  JOURNAL_LOCAL_STORAGE_KEY,
  activateServerRecord,
  applyServerRecord,
  createLocalState,
  editActiveArea,
  finishActive,
  readLocalState,
  shiftJournalDate,
  startNewForDate,
  toTaipeiJournalDate,
  type JournalLocalState,
  type LocalJournalDraft,
} from "../../web/src/app/journal-session.ts";

export const AREA_SYMBOLS: Record<JournalAreaKey, string> = {
  unclassified: "○",
  event: "+",
  question: "?",
  insight: "~",
  next: "!",
  feeling: "*",
};

export type QuickCaptureConfirmation =
  | "none"
  | "complete"
  | "hide"
  | "full"
  | "special";
export type QuickCaptureAction =
  | "none"
  | "hide"
  | "open-full"
  | "open-special"
  | "confirm-complete"
  | "confirm-hide"
  | "confirm-full"
  | "confirm-special"
  | "finish"
  | "discard-hide"
  | "discard-full"
  | "discard-special"
  | "cancel";

export type TextEditDiff = {
  before: string;
  added: string;
  removed: string;
  after: string;
};

export type JournalEditCounts = {
  added: number;
  removed: number;
};

export function hasJournalInput(areas: JournalAreas) {
  return JOURNAL_AREA_KEYS.some((key) => areas[key].length > 0);
}

export function journalAreasEqual(left: JournalAreas, right: JournalAreas) {
  return JOURNAL_AREA_KEYS.every((key) => left[key] === right[key]);
}

/**
 * A deliberately small session diff: it finds the unchanged prefix/suffix and
 * treats the middle as one edited region. It is predictable for live editing
 * and does not claim to be a permanent version-history diff.
 */
export function textEditDiff(original: string, current: string): TextEditDiff {
  let prefixLength = 0;
  const sharedLength = Math.min(original.length, current.length);
  while (
    prefixLength < sharedLength &&
    original[prefixLength] === current[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < original.length - prefixLength &&
    suffixLength < current.length - prefixLength &&
    original[original.length - 1 - suffixLength] ===
      current[current.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return {
    before: current.slice(0, prefixLength),
    added: current.slice(prefixLength, current.length - suffixLength),
    removed: original.slice(prefixLength, original.length - suffixLength),
    after: current.slice(current.length - suffixLength),
  };
}

export function journalEditCounts(
  original: JournalAreas,
  current: JournalAreas,
): JournalEditCounts {
  return JOURNAL_AREA_KEYS.reduce<JournalEditCounts>(
    (counts, key) => {
      const diff = textEditDiff(original[key], current[key]);
      counts.added += Array.from(diff.added).length;
      counts.removed += Array.from(diff.removed).length;
      return counts;
    },
    { added: 0, removed: 0 },
  );
}

export function quickCaptureKeyAction(
  hasContent: boolean,
  confirmation: QuickCaptureConfirmation,
  key: string,
  shiftKey: boolean,
  ctrlKey: boolean,
): QuickCaptureAction {
  if (confirmation !== "none") {
    if (key === "Escape") return "cancel";
    if (key !== "Enter") return "none";
    if (confirmation === "complete") return "finish";
    if (confirmation === "hide") return "discard-hide";
    if (confirmation === "full") return "discard-full";
    return "discard-special";
  }

  if (ctrlKey && key === "ArrowLeft") {
    return hasContent ? "confirm-full" : "open-full";
  }
  if (ctrlKey && key === "ArrowRight") {
    return hasContent ? "confirm-special" : "open-special";
  }
  if (key === "Escape") return hasContent ? "confirm-hide" : "hide";
  if (key === "Enter" && !shiftKey) {
    return hasContent ? "confirm-complete" : "hide";
  }
  return "none";
}

export function refreshBlankDraftDate(
  state: JournalLocalState,
  now: Date,
): JournalLocalState {
  if (hasJournalInput(state.active.areas)) return state;
  const today = toTaipeiJournalDate(now);
  if (state.active.journalDate === today) return state;
  return {
    ...state,
    active: { ...state.active, journalDate: today },
  };
}
