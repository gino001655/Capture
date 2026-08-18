import { validateCaptureRequest } from "../../../lib/capture.ts";
import {
  captureStore,
  type CaptureStore,
} from "../../../lib/capture-store.ts";
import {
  authorizationFailureResponse,
  authorizeClientRequest,
  type AuthorizationResult,
} from "../../../lib/authorization.ts";

type CaptureCreator = Pick<CaptureStore, "create">;
type WebAuthorizer = (request: Request) => Promise<AuthorizationResult>;

export function createCapturePostHandler(
  store: CaptureCreator,
  authorize: WebAuthorizer = authorizeClientRequest,
) {
  return async function POST(request: Request) {
    const authorization = await authorize(request);

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

    const capture = await store.create(validation.content);

    return Response.json({ capture }, { status: 201 });
  };
}

export const POST = createCapturePostHandler(captureStore);
