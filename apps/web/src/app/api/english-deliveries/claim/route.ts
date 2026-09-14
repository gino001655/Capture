import { authorizationFailureResponse, authorizeDesktopRequest, type AuthorizationResult } from "../../../../lib/authorization.ts";
import { taipeiDeliveryBoundary } from "../../../../lib/journal-delivery.ts";
import { specialRecordStore, type SpecialRecordStore } from "../../../../lib/special-record-store.ts";

type Authorizer = (request: Request) => AuthorizationResult | Promise<AuthorizationResult>;
type Store = Pick<SpecialRecordStore, "claimEnglish">;

export function createEnglishDeliveryClaimHandler(
  store: Store,
  authorize: Authorizer = authorizeDesktopRequest,
  now: () => Date = () => new Date(),
) {
  return async function POST(request: Request) {
    const authorization = await authorize(request);
    if (authorization.status !== "authorized") return authorizationFailureResponse(authorization);
    const record = await store.claimEnglish(taipeiDeliveryBoundary(now()));
    return Response.json({ delivery: record });
  };
}

export const dynamic = "force-dynamic";
export const POST = createEnglishDeliveryClaimHandler(specialRecordStore);
