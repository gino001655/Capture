import type { PushSubscription } from "web-push";

import { authorizationFailureResponse, authorizeWebRequest } from "../../../../lib/authorization.ts";
import { removePushSubscription, savePushSubscription } from "../../../../lib/reminder-store.ts";

function parseSubscription(value: unknown): PushSubscription | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const keys = candidate.keys as Record<string, unknown> | undefined;
  if (typeof candidate.endpoint !== "string" || candidate.endpoint.length > 4_096
    || !keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
  return {
    endpoint: candidate.endpoint,
    expirationTime: typeof candidate.expirationTime === "number" ? candidate.expirationTime : null,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
}

export async function POST(request: Request) {
  const authorization = await authorizeWebRequest(request);
  if (authorization.status !== "authorized" || !authorization.email) return authorizationFailureResponse(authorization);
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: { code: "INVALID_JSON" } }, { status: 400 }); }
  const record = body as Record<string, unknown>;
  const subscription = parseSubscription(record.subscription);
  if (!subscription) return Response.json({ error: { code: "INVALID_SUBSCRIPTION" } }, { status: 400 });
  await savePushSubscription(authorization.email, subscription, record.includeContent !== false);
  return Response.json({ enabled: true });
}

export async function DELETE(request: Request) {
  const authorization = await authorizeWebRequest(request);
  if (authorization.status !== "authorized" || !authorization.email) return authorizationFailureResponse(authorization);
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: { code: "INVALID_JSON" } }, { status: 400 }); }
  const endpoint = (body as Record<string, unknown>).endpoint;
  if (typeof endpoint !== "string") return Response.json({ error: { code: "INVALID_ENDPOINT" } }, { status: 400 });
  await removePushSubscription(authorization.email, endpoint);
  return Response.json({ enabled: false });
}
