import { isValidUuid } from "./journal-record.ts";

export const JOURNAL_DELIVERY_RETRY_MS = 15 * 60 * 1_000;
export const JOURNAL_DELIVERY_LEASE_MS = 30 * 60 * 1_000;

export type JournalDeliveryReport =
  | { outcome: "completed"; result: string }
  | { outcome: "failed"; error: string };

export function taipeiDeliveryBoundary(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const date = `${values.year}-${values.month}-${values.day}`;

  if (Number(values.hour) >= 4) return date;

  const [year, month, day] = date.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return previous.toISOString().slice(0, 10);
}

export function validateDeliveryReport(value: unknown):
  | { success: true; value: JournalDeliveryReport }
  | { success: false; message: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { success: false, message: "Delivery report must be an object." };
  }

  const report = value as Record<string, unknown>;
  if (report.outcome === "completed") {
    if (typeof report.result !== "string" || report.result.trim().length === 0) {
      return { success: false, message: "A completed delivery requires a result." };
    }
    return { success: true, value: { outcome: "completed", result: report.result.trim() } };
  }

  if (report.outcome === "failed") {
    if (typeof report.error !== "string" || report.error.trim().length === 0) {
      return { success: false, message: "A failed delivery requires an error." };
    }
    return { success: true, value: { outcome: "failed", error: report.error.trim().slice(0, 2_000) } };
  }

  return { success: false, message: "outcome must be completed or failed." };
}

export function validateAttemptId(value: unknown): value is string {
  return isValidUuid(value);
}
