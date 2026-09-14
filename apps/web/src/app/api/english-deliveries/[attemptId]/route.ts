import { authorizationFailureResponse, authorizeDesktopRequest, type AuthorizationResult } from "../../../../lib/authorization.ts";
import { validateEnglishAttemptId, validateEnglishDeliveryReport } from "../../../../lib/english-delivery.ts";
import { specialRecordStore, type SpecialRecordStore } from "../../../../lib/special-record-store.ts";

type Authorizer = (request: Request) => AuthorizationResult | Promise<AuthorizationResult>;
type Store = Pick<SpecialRecordStore, "reportEnglish">;

export function createEnglishDeliveryReportHandler(
  store: Store,
  authorize: Authorizer = authorizeDesktopRequest,
) {
  return async function PATCH(
    request: Request,
    context: { params: Promise<{ attemptId: string }> },
  ) {
    const authorization = await authorize(request);
    if (authorization.status !== "authorized") return authorizationFailureResponse(authorization);
    const { attemptId } = await context.params;
    if (!validateEnglishAttemptId(attemptId)) {
      return Response.json({ error: { code: "INVALID_ATTEMPT", message: "attemptId must be a UUID." } }, { status: 400 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
    }
    const validation = validateEnglishDeliveryReport(body);
    if (!validation.success) {
      return Response.json({ error: { code: "INVALID_DELIVERY", message: validation.message } }, { status: 400 });
    }
    const record = await store.reportEnglish(attemptId, validation.value);
    if (!record) {
      return Response.json({ error: { code: "DELIVERY_EXPIRED", message: "The English delivery attempt is no longer active." } }, { status: 409 });
    }
    return Response.json({ record });
  };
}

export const dynamic = "force-dynamic";
export const PATCH = createEnglishDeliveryReportHandler(specialRecordStore);
