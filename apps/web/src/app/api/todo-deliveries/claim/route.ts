import {
  authorizationFailureResponse,
  authorizeDesktopRequest,
} from "../../../../lib/authorization.ts";
import { journalStore, type JournalStore } from "../../../../lib/journal-store.ts";

type TodoClaimer = Pick<JournalStore, "claimTodoDelivery">;

export function createTodoDeliveryClaimHandler(store: TodoClaimer) {
  return async function POST(request: Request) {
    const authorization = authorizeDesktopRequest(request);
    if (authorization.status !== "authorized") return authorizationFailureResponse(authorization);
    return Response.json({ delivery: await store.claimTodoDelivery() ?? null });
  };
}

export const dynamic = "force-dynamic";
export const POST = createTodoDeliveryClaimHandler(journalStore);
