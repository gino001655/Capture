import { isValidUuid, validateJournalDate } from "./journal-record.ts";

export type WorkoutSetType = "working" | "warmup" | "drop" | "failure";

export type WorkoutSet = {
  id: string;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  type: WorkoutSetType;
  note: string;
  confirmed: boolean;
};

export type RunningSegment = {
  id: string;
  distanceKm: number | null;
  durationSeconds: number | null;
};

export type StrengthExercise = {
  id: string;
  kind: "strength";
  libraryEntryId?: string;
  name: string;
  note: string;
  sets: WorkoutSet[];
};

export type RunningExercise = {
  id: string;
  kind: "running";
  name: string;
  note: string;
  distanceKm: number | null;
  durationSeconds: number | null;
  averageHeartRate: number | null;
  maximumHeartRate: number | null;
  temperatureC: number | null;
  elevationGainM: number | null;
  rpe: number | null;
  segments: RunningSegment[];
};

export type WorkoutExercise = StrengthExercise | RunningExercise;

export type RestTimer = {
  startedAt: string | null;
  elapsedSeconds: number;
  running: boolean;
};

export type WorkoutSession = {
  id: string;
  name: string;
  note: string;
  startedAt: string;
  completedAt: string | null;
  restTimer: RestTimer;
  exercises: WorkoutExercise[];
};

export type WorkoutPayload = {
  schemaVersion: 1;
  sessions: WorkoutSession[];
};

export type WorkoutRecord = {
  id: string;
  moduleId: "workout";
  journalDate: string;
  payload: WorkoutPayload;
  revision: number;
  processingState: "pending" | "processed";
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
};

export type WorkoutSaveInput = {
  journalDate: string;
  payload: WorkoutPayload;
  expectedRevision: number | null;
  clientUpdatedAt: string;
};

const LIMITS = {
  sessions: 10,
  exercises: 30,
  sets: 30,
  segments: 100,
  name: 120,
  note: 5_000,
} as const;

type ValidationResult =
  | { success: true; value: WorkoutSaveInput }
  | { success: false; message: string };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, limit: number) {
  return typeof value === "string" && value.length <= limit;
}

function optionalNumber(value: unknown, minimum: number, maximum: number) {
  return value === null || (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function isoOrNull(value: unknown) {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function validSet(value: unknown): value is WorkoutSet {
  if (!object(value)) return false;
  return isValidUuid(value.id) &&
    optionalNumber(value.weightKg, -1_000, 10_000) &&
    optionalNumber(value.reps, 0, 100_000) &&
    optionalNumber(value.rpe, 0, 10) &&
    optionalNumber(value.rir, 0, 100) &&
    ["working", "warmup", "drop", "failure"].includes(String(value.type)) &&
    text(value.note, LIMITS.note) &&
    typeof value.confirmed === "boolean";
}

function validSegment(value: unknown): value is RunningSegment {
  return object(value) && isValidUuid(value.id) &&
    optionalNumber(value.distanceKm, 0, 10_000) &&
    optionalNumber(value.durationSeconds, 0, 10_000_000);
}

function validExercise(value: unknown): value is WorkoutExercise {
  if (!object(value) || !isValidUuid(value.id) || typeof value.name !== "string" || !text(value.name, LIMITS.name) || !value.name.trim() || !text(value.note, LIMITS.note)) {
    return false;
  }
  if (value.kind === "strength") {
    return (value.libraryEntryId === undefined || isValidUuid(value.libraryEntryId)) && Array.isArray(value.sets) && value.sets.length <= LIMITS.sets && value.sets.every(validSet);
  }
  if (value.kind !== "running") return false;
  return optionalNumber(value.distanceKm, 0, 10_000) &&
    optionalNumber(value.durationSeconds, 0, 10_000_000) &&
    optionalNumber(value.averageHeartRate, 0, 300) &&
    optionalNumber(value.maximumHeartRate, 0, 300) &&
    optionalNumber(value.temperatureC, -100, 100) &&
    optionalNumber(value.elevationGainM, -1_000, 100_000) &&
    optionalNumber(value.rpe, 0, 10) &&
    Array.isArray(value.segments) && value.segments.length <= LIMITS.segments && value.segments.every(validSegment);
}

function validSession(value: unknown): value is WorkoutSession {
  if (!object(value)) return false;
  const timer = value.restTimer;
  return isValidUuid(value.id) && text(value.name, LIMITS.name) && text(value.note, LIMITS.note) &&
    typeof value.startedAt === "string" && Number.isFinite(Date.parse(value.startedAt)) &&
    isoOrNull(value.completedAt) && object(timer) && isoOrNull(timer.startedAt) &&
    typeof timer.elapsedSeconds === "number" && Number.isSafeInteger(timer.elapsedSeconds) && timer.elapsedSeconds >= 0 &&
    typeof timer.running === "boolean" && Array.isArray(value.exercises) &&
    value.exercises.length <= LIMITS.exercises && value.exercises.every(validExercise);
}

export function validateWorkoutSaveRequest(input: unknown): ValidationResult {
  if (!object(input)) return { success: false, message: "Workout request must be an object." };
  if (!validateJournalDate(input.journalDate)) {
    return { success: false, message: "journalDate must be a valid YYYY-MM-DD date." };
  }
  if (!object(input.payload) || input.payload.schemaVersion !== 1 || !Array.isArray(input.payload.sessions) ||
      input.payload.sessions.length > LIMITS.sessions || !input.payload.sessions.every(validSession)) {
    return { success: false, message: "payload must be a valid Workout schemaVersion 1 document." };
  }
  if (input.expectedRevision !== null && (
    typeof input.expectedRevision !== "number" || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
  )) {
    return { success: false, message: "expectedRevision must be null or a non-negative integer." };
  }
  if (typeof input.clientUpdatedAt !== "string" || !Number.isFinite(Date.parse(input.clientUpdatedAt))) {
    return { success: false, message: "clientUpdatedAt must be an ISO date-time." };
  }
  return { success: true, value: input as WorkoutSaveInput };
}

export function emptyWorkoutPayload(): WorkoutPayload {
  return { schemaVersion: 1, sessions: [] };
}

export function nextWorkoutSetIndex(currentIndex: number, setCount: number): number | null {
  if (!Number.isSafeInteger(currentIndex) || currentIndex < 0 || currentIndex + 1 >= setCount) {
    return null;
  }
  return currentIndex + 1;
}
