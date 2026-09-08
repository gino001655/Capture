export const MAX_CAPTURE_LENGTH = 5_000;

export type CaptureStatus = "pending" | "processing" | "failed" | "completed";

export type Capture = {
  id: string;
  content: string;
  status: CaptureStatus;
  createdAt: string;
  result?: string;
  completedAt?: string;
  processingAt?: string;
  leaseExpiresAt?: string;
  failedAt?: string;
  nextAttemptAt?: string;
  lastError?: string;
};

export type CaptureValidationResult =
  | { success: true; content: string }
  | { success: false; code: "INVALID_CONTENT"; message: string };

export function validateCaptureRequest(
  input: unknown,
): CaptureValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      success: false,
      code: "INVALID_CONTENT",
      message: "Request body must contain a content field.",
    };
  }

  const content = (input as Record<string, unknown>).content;

  if (typeof content !== "string") {
    return {
      success: false,
      code: "INVALID_CONTENT",
      message: "Content must be a string.",
    };
  }

  const normalizedContent = content.trim();

  if (normalizedContent.length === 0) {
    return {
      success: false,
      code: "INVALID_CONTENT",
      message: "Content cannot be empty.",
    };
  }

  if (normalizedContent.length > MAX_CAPTURE_LENGTH) {
    return {
      success: false,
      code: "INVALID_CONTENT",
      message: `Content must be ${MAX_CAPTURE_LENGTH.toLocaleString()} characters or fewer.`,
    };
  }

  return { success: true, content: normalizedContent };
}

export function validateJobResult(
  input: unknown,
):
  | { success: true; result: string }
  | { success: false; code: "INVALID_RESULT"; message: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      success: false,
      code: "INVALID_RESULT",
      message: "Request body must contain a result field.",
    };
  }

  const result = (input as Record<string, unknown>).result;

  if (typeof result !== "string" || result.trim().length === 0) {
    return {
      success: false,
      code: "INVALID_RESULT",
      message: "Result must be a non-empty string.",
    };
  }

  return { success: true, result: result.trim() };
}

export type JobReport =
  | { outcome: "completed"; result: string }
  | { outcome: "failed"; error: string };

export function validateJobReport(input: unknown):
  | { success: true; value: JobReport }
  | { success: false; code: "INVALID_JOB_REPORT"; message: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { success: false, code: "INVALID_JOB_REPORT", message: "Worker report must be an object." };
  }
  const candidate = input as Record<string, unknown>;
  if (candidate.outcome === undefined) {
    const legacy = validateJobResult(input);
    return legacy.success
      ? { success: true, value: { outcome: "completed", result: legacy.result } }
      : { success: false, code: "INVALID_JOB_REPORT", message: legacy.message };
  }
  if (candidate.outcome === "completed" && typeof candidate.result === "string" && candidate.result.trim()) {
    return { success: true, value: { outcome: "completed", result: candidate.result.trim() } };
  }
  if (candidate.outcome === "failed" && typeof candidate.error === "string" && candidate.error.trim()) {
    return { success: true, value: { outcome: "failed", error: candidate.error.trim().slice(0, 5_000) } };
  }
  return {
    success: false,
    code: "INVALID_JOB_REPORT",
    message: "Report must contain a completed result or a failed error.",
  };
}
