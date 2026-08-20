import {
  hasJournalContent,
  type JournalAreaKey,
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
  if (hasJournalContent(state.active.areas)) return state;
  const today = toTaipeiJournalDate(now);
  if (state.active.journalDate === today) return state;
  return {
    ...state,
    active: { ...state.active, journalDate: today },
  };
}
