import { validateJobReport } from "../../../../lib/capture.ts";
import { captureStore, type CaptureStore } from "../../../../lib/capture-store.ts";
import {
  authorizationFailureResponse,
  authorizeDesktopRequest,
} from "../../../../lib/authorization.ts";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type Store = Pick<CaptureStore, "complete" | "fail">;

export function createJobUpdateHandler(store: Store = captureStore) {
return async function PATCH(request: Request, context: RouteContext) {
  const authorization = authorizeDesktopRequest(request);

  if (authorization.status !== "authorized") {
    return authorizationFailureResponse(authorization);
  }

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

  const validation = validateJobReport(requestBody);

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

  const { id } = await context.params;
  const capture = validation.value.outcome === "completed"
    ? await store.complete(id, validation.value.result)
    : await store.fail(id, validation.value.error);

  if (capture === undefined) {
    return Response.json(
      {
        error: {
          code: "NOT_PROCESSING",
          message: "Job does not exist or is not currently processing.",
        },
      },
      { status: 409 },
    );
  }

  return Response.json({ capture });
};
}

export const PATCH = createJobUpdateHandler();
