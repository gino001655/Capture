import { isValidUuid } from "./journal-record.ts";
import type { EnglishDeliveryReport } from "./special-record-store.ts";

export function validateEnglishDeliveryReport(value: unknown):
  | { success: true; value: EnglishDeliveryReport }
  | { success: false; message: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { success: false, message: "Delivery report must be an object." };
  }
  const report = value as Record<string, unknown>;
  if (report.outcome === "completed" && typeof report.result === "string"
    && report.result.trim() && report.result.length <= 200_000) {
    return { success: true, value: { outcome: "completed", result: report.result.trim() } };
  }
  if (report.outcome === "failed" && typeof report.error === "string" && report.error.trim()) {
    if (report.result !== undefined && (typeof report.result !== "string"
      || !report.result.trim() || report.result.length > 200_000)) {
      return { success: false, message: "A failed delivery result must be a non-empty string." };
    }
    return {
      success: true,
      value: {
        outcome: "failed",
        error: report.error.trim(),
        ...(typeof report.result === "string" ? { result: report.result.trim() } : {}),
      },
    };
  }
  return { success: false, message: "outcome must contain a non-empty completed result or failed error." };
}

export function validateEnglishAttemptId(value: unknown): value is string {
  return isValidUuid(value);
}
