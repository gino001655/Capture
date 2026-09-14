import { validateJournalDate } from "./journal-record.ts";

export const MAX_ENGLISH_DOCUMENT_LENGTH = 50_000;

export type EnglishPayload = {
  schemaVersion: 1;
  text: string;
};

export type EnglishRecord = {
  id: string;
  moduleId: "english";
  journalDate: string;
  payload: EnglishPayload;
  revision: number;
  processingState: "pending" | "processing" | "processed" | "failed";
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
  processingAttemptId?: string | null;
  processingClaimedAt?: string | null;
  processingAttempts?: number;
  processingError?: string | null;
  nextProcessingAttemptAt?: string | null;
  processedAt?: string | null;
  processingResult?: string | null;
};

export type EnglishSaveInput = {
  journalDate: string;
  text: string;
  expectedRevision: number | null;
  clientUpdatedAt: string;
};

type ValidationFailure = { success: false; message: string };

export type EnglishSaveValidationResult =
  | { success: true; value: EnglishSaveInput }
  | ValidationFailure;

export function validateEnglishSaveRequest(input: unknown): EnglishSaveValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { success: false, message: "English request must be an object." };
  }
  const value = input as Record<string, unknown>;
  if (!validateJournalDate(value.journalDate)) {
    return { success: false, message: "journalDate must be a valid YYYY-MM-DD date." };
  }
  if (typeof value.text !== "string") {
    return { success: false, message: "text must be a string." };
  }
  if (value.text.length > MAX_ENGLISH_DOCUMENT_LENGTH) {
    return {
      success: false,
      message: `text must be ${MAX_ENGLISH_DOCUMENT_LENGTH.toLocaleString()} characters or fewer.`,
    };
  }
  if (
    value.expectedRevision !== null &&
    (typeof value.expectedRevision !== "number" ||
      !Number.isSafeInteger(value.expectedRevision) ||
      value.expectedRevision < 0)
  ) {
    return { success: false, message: "expectedRevision must be null or a non-negative integer." };
  }
  if (
    typeof value.clientUpdatedAt !== "string" ||
    !Number.isFinite(new Date(value.clientUpdatedAt).getTime())
  ) {
    return { success: false, message: "clientUpdatedAt must be an ISO date-time." };
  }
  return { success: true, value: input as EnglishSaveInput };
}

export function toTaipeiDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
