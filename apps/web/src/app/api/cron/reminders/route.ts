import { isValidBearerToken } from "../../../../lib/authorization.ts";
import { sendScheduledPush } from "../../../../lib/reminder-store.ts";

export async function GET(request: Request) {
  if (!isValidBearerToken(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }
  return Response.json(await sendScheduledPush());
}

export const dynamic = "force-dynamic";
