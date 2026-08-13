export const MAX_CAPTURE_LENGTH = 5_000;

export type Capture = {
  id: string;
  content: string;
  status: "pending";
  createdAt: string;
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
