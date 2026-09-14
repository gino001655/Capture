import { isValidUuid, validateJournalDate } from "./journal-record.ts";

export type FoodEntry = {
  id: string;
  libraryEntryId?: string;
  name: string;
  quantity: number | null;
  unit: string;
  calories: number | null;
  proteinGrams: number | null;
  note: string;
  occurredAt: string;
};

export type FoodPayload = {
  schemaVersion: 1;
  calorieTarget: number | null;
  proteinTargetGrams: number | null;
  entries: FoodEntry[];
};

export type FoodRecord = {
  id: string;
  moduleId: "food";
  journalDate: string;
  payload: FoodPayload;
  revision: number;
  processingState: "pending" | "processed";
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
};

export function foodEntryIsExpanded(expandedId: string | null, entryId: string): boolean {
  return expandedId === entryId;
}

export type FoodSaveInput = { journalDate: string; payload: FoodPayload; expectedRevision: number | null; clientUpdatedAt: string };

function optionalNumber(value: unknown, max: number) { return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max); }
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function emptyFoodPayload(): FoodPayload { return { schemaVersion: 1, calorieTarget: 2000, proteinTargetGrams: 120, entries: [] }; }

export function isFoodPayloadReady(payload: FoodPayload): boolean {
  return payload.entries.every((entry) => entry.name.trim().length > 0);
}

export function hasCustomFoodTargets(payload: FoodPayload): boolean {
  const defaults = emptyFoodPayload();
  return payload.calorieTarget !== defaults.calorieTarget
    || payload.proteinTargetGrams !== defaults.proteinTargetGrams;
}

export function validateFoodSaveRequest(input: unknown): { success: true; value: FoodSaveInput } | { success: false; message: string } {
  if (!object(input) || !validateJournalDate(input.journalDate) || !object(input.payload) || input.payload.schemaVersion !== 1 || !Array.isArray(input.payload.entries) || input.payload.entries.length > 300) return { success: false, message: "Food request must contain a valid date and schemaVersion 1 payload." };
  if (!optionalNumber(input.payload.calorieTarget, 100_000) || !optionalNumber(input.payload.proteinTargetGrams, 10_000)) return { success: false, message: "Food targets must be non-negative numbers or null." };
  for (const raw of input.payload.entries) {
    if (!object(raw) || !isValidUuid(raw.id) || (raw.libraryEntryId !== undefined && !isValidUuid(raw.libraryEntryId)) || typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 200 || !optionalNumber(raw.quantity, 100_000) || typeof raw.unit !== "string" || raw.unit.length > 40 || !optionalNumber(raw.calories, 1_000_000) || !optionalNumber(raw.proteinGrams, 100_000) || typeof raw.note !== "string" || raw.note.length > 5_000 || typeof raw.occurredAt !== "string" || !Number.isFinite(Date.parse(raw.occurredAt))) return { success: false, message: "Each food entry must have valid food, serving, nutrition, note, and time fields." };
  }
  if (input.expectedRevision !== null && (typeof input.expectedRevision !== "number" || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) || typeof input.clientUpdatedAt !== "string" || !Number.isFinite(Date.parse(input.clientUpdatedAt))) return { success: false, message: "Food revision and edit timestamp are invalid." };
  return { success: true, value: input as FoodSaveInput };
}
