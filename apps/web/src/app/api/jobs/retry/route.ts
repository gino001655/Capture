import {
  authorizationFailureResponse,
  authorizeDesktopRequest,
} from "../../../../lib/authorization.ts";
import { captureStore, type CaptureStore } from "../../../../lib/capture-store.ts";

type Store = Pick<CaptureStore, "retryFailed">;

export function createLegacyJobRetryHandler(store: Store = captureStore) {
  return async function POST(request: Request) {
    const authorization = authorizeDesktopRequest(request);
    if (authorization.status !== "authorized") {
      return authorizationFailureResponse(authorization);
    }
    return Response.json({ retriedJobCount: await store.retryFailed() });
  };
}

export const POST = createLegacyJobRetryHandler();
