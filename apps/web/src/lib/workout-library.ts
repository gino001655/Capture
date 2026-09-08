import { isValidUuid } from "./journal-record.ts";

export type WorkoutLibraryEntry = {
  id: string;
  name: string;
  order: number;
  archived: boolean;
};

export type WorkoutLibraryPayload = {
  schemaVersion: 1;
  entries: WorkoutLibraryEntry[];
};

export type WorkoutLibraryRecord = {
  id: "workout:library";
  moduleId: "workout";
  payload: WorkoutLibraryPayload;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkoutLibrarySaveInput = {
  payload: WorkoutLibraryPayload;
  expectedRevision: number | null;
};

export function emptyWorkoutLibrary(): WorkoutLibraryPayload {
  return { schemaVersion: 1, entries: [] };
}

export function validateWorkoutLibrarySaveRequest(input: unknown):
  | { success: true; value: WorkoutLibrarySaveInput }
  | { success: false; message: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { success: false, message: "Library request must be an object." };
  const value = input as Record<string, unknown>;
  const payload = value.payload as Record<string, unknown> | null;
  if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.entries) || payload.entries.length > 500) {
    return { success: false, message: "payload must be a valid Workout library document." };
  }
  const ids = new Set<string>();
  for (const raw of payload.entries) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { success: false, message: "Each library entry must be an object." };
    const entry = raw as Record<string, unknown>;
    if (!isValidUuid(entry.id) || ids.has(entry.id as string) || typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 120 ||
        typeof entry.order !== "number" || !Number.isSafeInteger(entry.order) || entry.order < 0 || typeof entry.archived !== "boolean") {
      return { success: false, message: "Each library entry must have a unique id, name, order, and archived state." };
    }
    ids.add(entry.id as string);
  }
  if (value.expectedRevision !== null && (typeof value.expectedRevision !== "number" || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0)) {
    return { success: false, message: "expectedRevision must be null or a non-negative integer." };
  }
  return { success: true, value: input as WorkoutLibrarySaveInput };
}
