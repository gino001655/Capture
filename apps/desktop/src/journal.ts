import type { JournalAreaKey } from "../../web/src/lib/journal-record.ts";

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

export type QuickCaptureConfirmation = "none" | "complete" | "hide" | "full";
export type QuickCaptureAction =
  | "none"
  | "hide"
  | "open-full"
  | "confirm-complete"
  | "confirm-hide"
  | "confirm-full"
  | "finish"
  | "discard-hide"
  | "discard-full"
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
    return "discard-full";
  }

  if (ctrlKey && key === "ArrowLeft") {
    return hasContent ? "confirm-full" : "open-full";
  }
  if (key === "Escape") return hasContent ? "confirm-hide" : "hide";
  if (key === "Enter" && !shiftKey) {
    return hasContent ? "confirm-complete" : "hide";
  }
  return "none";
}
