import { validateCaptureRequest } from "../../../lib/capture.ts";
import { captureStore } from "../../../lib/capture-store.ts";

export async function POST(request: Request) {
  let requestBody: unknown;

  try {
    requestBody = await request.json();
  } catch {
    return Response.json(
      {
        error: {
          code: "INVALID_JSON",
          message: "Request body must be valid JSON.",
        },
      },
      { status: 400 },
    );
  }

  const validation = validateCaptureRequest(requestBody);

  if (!validation.success) {
    return Response.json(
      {
        error: {
          code: validation.code,
          message: validation.message,
        },
      },
      { status: 400 },
    );
  }

  const capture = captureStore.create(validation.content);

  return Response.json({ capture }, { status: 201 });
}
