import { authorizationFailureResponse, authorizeDesktopRequest, type AuthorizationResult } from "../../../lib/authorization.ts";
import { specialRecordStore, type SpecialRecordStore } from "../../../lib/special-record-store.ts";
import { taipeiDeliveryBoundary } from "../../../lib/journal-delivery.ts";

type Authorizer = (request: Request) => AuthorizationResult | Promise<AuthorizationResult>;
type Store = Pick<SpecialRecordStore, "englishDeliveryStatus" | "retryFailedEnglish">;

export function createEnglishDeliveriesHandler(
  store: Store,
  authorize: Authorizer = authorizeDesktopRequest,
  now: () => Date = () => new Date(),
) {
  return async function handle(request: Request) {
    const authorization = await authorize(request);
    if (authorization.status !== "authorized") return authorizationFailureResponse(authorization);
    if (request.method === "GET") {
      return Response.json({ delivery: await store.englishDeliveryStatus(taipeiDeliveryBoundary(now())) });
    }
    if (request.method === "POST") {
      return Response.json({ retried: await store.retryFailedEnglish() });
    }
    return new Response(null, { status: 405 });
  };
}

export const dynamic = "force-dynamic";
const handler = createEnglishDeliveriesHandler(specialRecordStore);
export const GET = handler;
export const POST = handler;
