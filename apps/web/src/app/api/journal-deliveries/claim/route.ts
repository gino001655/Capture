import {
  authorizationFailureResponse,
  authorizeDesktopRequest,
} from "../../../../lib/authorization.ts";
import {
  journalStore,
  type JournalStore,
} from "../../../../lib/journal-store.ts";

type DeliveryClaimer = Pick<JournalStore, "claimDelivery">;

export function createJournalDeliveryClaimHandler(store: DeliveryClaimer) {
  return async function POST(request: Request) {
    const authorization = authorizeDesktopRequest(request);
    if (authorization.status !== "authorized") {
      return authorizationFailureResponse(authorization);
    }

    const delivery = await store.claimDelivery();
    return Response.json({ delivery: delivery ?? null });
  };
}

export const dynamic = "force-dynamic";
export const POST = createJournalDeliveryClaimHandler(journalStore);
