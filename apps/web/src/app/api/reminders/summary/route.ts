import {
  authorizationFailureResponse,
  authorizeDesktopRequest,
} from "../../../../lib/authorization.ts";
import { getReminderSummary } from "../../../../lib/reminder-store.ts";

export async function GET(request: Request) {
  const authorization = authorizeDesktopRequest(request);
  if (authorization.status !== "authorized") return authorizationFailureResponse(authorization);
  return Response.json({ summary: await getReminderSummary() });
}

export const dynamic = "force-dynamic";
