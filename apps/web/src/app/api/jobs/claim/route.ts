import { captureStore } from "../../../../lib/capture-store.ts";
import {
  authorizationFailureResponse,
  authorizeDesktopRequest,
} from "../../../../lib/authorization.ts";

export async function POST(request: Request) {
  const authorization = authorizeDesktopRequest(request);

  if (authorization.status !== "authorized") {
    return authorizationFailureResponse(authorization);
  }

  const job = await captureStore.claimNext();

  return Response.json({ job: job ?? null });
}
