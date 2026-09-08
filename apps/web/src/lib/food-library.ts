import { isValidUuid } from "./journal-record.ts";
export type FoodLibraryEntry = { id: string; name: string; quantity: number | null; unit: string; calories: number | null; proteinGrams: number | null; order: number; archived: boolean };
export type FoodLibraryPayload = { schemaVersion: 1; entries: FoodLibraryEntry[] };
export type FoodLibraryRecord = { id: "food:library"; moduleId: "food"; payload: FoodLibraryPayload; revision: number; createdAt: string; updatedAt: string };
export type FoodLibrarySaveInput = { payload: FoodLibraryPayload; expectedRevision: number | null };
export function emptyFoodLibrary(): FoodLibraryPayload { return { schemaVersion: 1, entries: [] }; }
function optionalNumber(value: unknown, maximum: number) { return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum); }
export function validateFoodLibrarySaveRequest(input: unknown): { success: true; value: FoodLibrarySaveInput } | { success: false; message: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { success: false, message: "Food library request must be an object." };
  const value = input as Record<string, unknown>; const payload = value.payload as Record<string, unknown> | undefined;
  if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.entries) || payload.entries.length > 1000) return { success: false, message: "payload must be a valid Food library document." };
  const ids = new Set<string>();
  for (const raw of payload.entries) { if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { success: false, message: "Food library entry is invalid." }; const entry = raw as Record<string, unknown>; if (!isValidUuid(entry.id) || ids.has(entry.id as string) || typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 200 || !optionalNumber(entry.quantity, 100_000) || typeof entry.unit !== "string" || entry.unit.length > 40 || !optionalNumber(entry.calories, 1_000_000) || !optionalNumber(entry.proteinGrams, 100_000) || typeof entry.order !== "number" || !Number.isSafeInteger(entry.order) || entry.order < 0 || typeof entry.archived !== "boolean") return { success: false, message: "Food library entry is invalid." }; ids.add(entry.id as string); }
  if (value.expectedRevision !== null && (typeof value.expectedRevision !== "number" || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0)) return { success: false, message: "expectedRevision is invalid." };
  return { success: true, value: input as FoodLibrarySaveInput };
}
