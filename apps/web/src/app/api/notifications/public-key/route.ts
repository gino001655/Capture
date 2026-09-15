import { authorizationFailureResponse, authorizeWebRequest } from "../../../../lib/authorization.ts";

export async function GET(request: Request) {
  const authorization = await authorizeWebRequest(request);
  if (authorization.status !== "authorized") return authorizationFailureResponse(authorization);
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  if (!publicKey) {
    return Response.json({ error: { code: "PUSH_NOT_CONFIGURED", message: "Web Push is not configured." } }, { status: 503 });
  }
  return Response.json({ publicKey });
}
