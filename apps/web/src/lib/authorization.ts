import { timingSafeEqual } from "node:crypto";

import { getAuth, getMissingWebAuthConfiguration } from "./auth.ts";

export type AuthorizationResult =
  | { status: "authorized"; email?: string; name?: string }
  | { status: "unauthorized" }
  | { status: "misconfigured"; missing: string[] };

export function isAllowedEmail(
  candidateEmail: string | null | undefined,
  allowedEmail: string | null | undefined,
) {
  return (
    typeof candidateEmail === "string" &&
    typeof allowedEmail === "string" &&
    candidateEmail.trim().toLowerCase() === allowedEmail.trim().toLowerCase()
  );
}

export async function authorizeWebHeaders(
  requestHeaders: Headers,
): Promise<AuthorizationResult> {
  const missing = getMissingWebAuthConfiguration();

  if (missing.length > 0) {
    return { status: "misconfigured", missing: [...missing] };
  }

  const session = await getAuth().api.getSession({ headers: requestHeaders });

  if (!isAllowedEmail(session?.user.email, process.env.AUTHORIZED_EMAIL)) {
    return { status: "unauthorized" };
  }

  return {
    status: "authorized",
    email: session?.user.email,
    name: session?.user.name,
  };
}

export function authorizeWebRequest(request: Request) {
  return authorizeWebHeaders(request.headers);
}

export function isValidBearerToken(
  authorizationHeader: string | null,
  expectedToken: string | null | undefined,
) {
  if (!authorizationHeader || !expectedToken) {
    return false;
  }

  const [scheme, token, extra] = authorizationHeader.trim().split(/\s+/);

  if (scheme?.toLowerCase() !== "bearer" || !token || extra !== undefined) {
    return false;
  }

  const actual = Buffer.from(token);
  const expected = Buffer.from(expectedToken.trim());

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function authorizeDesktopRequest(request: Request): AuthorizationResult {
  const expectedToken = process.env.CAPTURE_DEVICE_TOKEN?.trim();

  if (!expectedToken || expectedToken.length < 32) {
    return { status: "misconfigured", missing: ["CAPTURE_DEVICE_TOKEN"] };
  }

  return isValidBearerToken(
    request.headers.get("authorization"),
    expectedToken,
  )
    ? { status: "authorized" }
    : { status: "unauthorized" };
}

export function authorizeClientRequest(
  request: Request,
): Promise<AuthorizationResult> {
  if (request.headers.has("authorization")) {
    return Promise.resolve(authorizeDesktopRequest(request));
  }

  return authorizeWebRequest(request);
}

export function authorizationFailureResponse(result: AuthorizationResult) {
  if (result.status === "misconfigured") {
    return Response.json(
      {
        error: {
          code: "AUTH_NOT_CONFIGURED",
          message: "Server authentication is not configured.",
        },
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      error: {
        code: "UNAUTHORIZED",
        message: "Valid authentication is required.",
      },
    },
    { status: 401 },
  );
}
