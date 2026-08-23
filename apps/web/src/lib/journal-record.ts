import { MAX_CAPTURE_LENGTH } from "./capture.ts";

export const JOURNAL_AREA_KEYS = [
  "unclassified",
  "event",
  "question",
  "insight",
  "next",
  "feeling",
] as const;

export type JournalAreaKey = (typeof JOURNAL_AREA_KEYS)[number];
export type JournalAreas = Record<JournalAreaKey, string>;
export type DeliveryState = "undelivered" | "delivered";
export type EditingState = "active" | "idle";

export type JournalRecord = {
  id: string;
  deviceId: string;
  journalDate: string;
  areas: JournalAreas;
  deliveryState: DeliveryState;
  editingState: EditingState;
  revision: number;
  createdAt: string;
  updatedAt: string;
  conflictOf?: string;
};

export type TrashedJournalRecord = JournalRecord & {
  deletedAt: string;
};

export type JournalCreateInput = Pick<
  JournalRecord,
  "id" | "deviceId" | "journalDate" | "areas"
>;

export type JournalUpdateInput = Pick<
  JournalRecord,
  "deviceId" | "journalDate" | "areas" | "editingState"
> & { expectedRevision: number; conflictRecordId: string };

export type JournalDeleteInput = { expectedRevision: number };

type ValidationFailure = {
  success: false;
  code: "INVALID_JOURNAL";
  message: string;
};

export type JournalCreateValidationResult =
  | { success: true; value: JournalCreateInput }
  | ValidationFailure;

export type JournalUpdateValidationResult =
  | { success: true; value: JournalUpdateInput }
  | ValidationFailure;

export type JournalDeleteValidationResult =
  | { success: true; value: JournalDeleteInput }
  | ValidationFailure;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function emptyJournalAreas(): JournalAreas {
  return Object.fromEntries(
    JOURNAL_AREA_KEYS.map((key) => [key, ""]),
  ) as JournalAreas;
}

export function hasJournalContent(areas: JournalAreas): boolean {
  return JOURNAL_AREA_KEYS.some((key) => areas[key].trim().length > 0);
}

export function validateJournalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function failure(message: string): ValidationFailure {
  return { success: false, code: "INVALID_JOURNAL", message };
}

function validateAreas(value: unknown): value is JournalAreas {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return false;
  }

  const areas = value as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(areas);
  return (
    ownKeys.length === JOURNAL_AREA_KEYS.length &&
    JOURNAL_AREA_KEYS.every(
      (key) =>
        Object.prototype.propertyIsEnumerable.call(areas, key) &&
        typeof areas[key] === "string",
    )
  );
}

function validateCommonFields(
  input: unknown,
): { valid: true; input: Record<string, unknown> } | { valid: false; message: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, message: "Journal request must be an object." };
  }

  const record = input as Record<string, unknown>;
  if (typeof record.id === "string" && !isValidUuid(record.id)) {
    return { valid: false, message: "id must be a UUID." };
  }
  if (!isValidUuid(record.deviceId)) {
    return { valid: false, message: "deviceId must be a UUID." };
  }
  if (!validateJournalDate(record.journalDate)) {
    return { valid: false, message: "journalDate must be a valid YYYY-MM-DD date." };
  }
  if (!validateAreas(record.areas)) {
    return { valid: false, message: "areas must contain six string fields." };
  }
  if (!hasJournalContent(record.areas)) {
    return { valid: false, message: "Journal content cannot be empty." };
  }
  const areas = record.areas as JournalAreas;
  const totalLength = JOURNAL_AREA_KEYS.reduce(
    (total, key) => total + areas[key].length,
    0,
  );
  if (totalLength > MAX_CAPTURE_LENGTH) {
    return {
      valid: false,
      message: `Journal content must be ${MAX_CAPTURE_LENGTH.toLocaleString()} characters or fewer.`,
    };
  }
  return { valid: true, input: record };
}

export function validateJournalCreateRequest(
  input: unknown,
): JournalCreateValidationResult {
  const common = validateCommonFields(input);
  if (!common.valid) return failure(common.message);
  if (!isValidUuid(common.input.id)) {
    return failure("id must be a UUID.");
  }
  return { success: true, value: input as JournalCreateInput };
}

export function validateJournalUpdateRequest(
  input: unknown,
): JournalUpdateValidationResult {
  const common = validateCommonFields(input);
  if (!common.valid) return failure(common.message);
  if (common.input.id !== undefined) return failure("Update must not contain id.");
  if (
    common.input.editingState !== "active" &&
    common.input.editingState !== "idle"
  ) {
    return failure("editingState must be active or idle.");
  }
  if (
    typeof common.input.expectedRevision !== "number" ||
    !Number.isSafeInteger(common.input.expectedRevision) ||
    common.input.expectedRevision < 0
  ) {
    return failure("expectedRevision must be a non-negative integer.");
  }
  if (
    !isValidUuid(common.input.conflictRecordId)
  ) {
    return failure("conflictRecordId must be a UUID.");
  }
  return { success: true, value: input as JournalUpdateInput };
}

export function validateJournalDeleteRequest(
  input: unknown,
): JournalDeleteValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return failure("Journal delete request must be an object.");
  }
  const expectedRevision = (input as Record<string, unknown>).expectedRevision;
  if (
    typeof expectedRevision !== "number" ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0
  ) {
    return failure("expectedRevision must be a non-negative integer.");
  }
  return { success: true, value: { expectedRevision } };
}
