import {
  authorizationFailureResponse,
  authorizeDesktopRequest,
} from "../../../lib/authorization.ts";
import { journalStore, type JournalStore } from "../../../lib/journal-store.ts";

type DeliveryControl = Pick<JournalStore, "getDeliveryStatus" | "retryFailedDeliveries">;

function authorize(request: Request) {
  const authorization = authorizeDesktopRequest(request);
  return authorization.status === "authorized"
    ? undefined
    : authorizationFailureResponse(authorization);
}

export function createJournalDeliveryStatusHandler(store: DeliveryControl) {
  return async function GET(request: Request) {
    const failure = authorize(request);
    if (failure !== undefined) return failure;
    return Response.json({ delivery: await store.getDeliveryStatus() });
  };
}

export function createJournalDeliveryRetryHandler(store: DeliveryControl) {
  return async function POST(request: Request) {
    const failure = authorize(request);
    if (failure !== undefined) return failure;
    return Response.json({ retriedRecordCount: await store.retryFailedDeliveries() });
  };
}

export const dynamic = "force-dynamic";
export const GET = createJournalDeliveryStatusHandler(journalStore);
export const POST = createJournalDeliveryRetryHandler(journalStore);
