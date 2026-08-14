import { captureStore } from "../../../../lib/capture-store.ts";
import {
  authorizationFailureResponse,
  authorizeWebRequest,
} from "../../../../lib/authorization.ts";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const authorization = await authorizeWebRequest(request);

  if (authorization.status !== "authorized") {
    return authorizationFailureResponse(authorization);
  }

  const { id } = await context.params;
  const capture = await captureStore.find(id);

  if (capture === undefined) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Capture was not found." } },
      { status: 404 },
    );
  }

  return Response.json({ capture });
}
