import { getAuth, getMissingWebAuthConfiguration } from "../../../../lib/auth.ts";

async function handleAuthRequest(request: Request) {
  if (getMissingWebAuthConfiguration().length > 0) {
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

  return getAuth().handler(request);
}

export const GET = handleAuthRequest;
export const POST = handleAuthRequest;
