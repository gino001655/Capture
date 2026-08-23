import { journalStore, type JournalStore } from "../../../../lib/journal-store.ts";
import {
  authorizationFailureResponse,
  authorizeClientRequest,
  type AuthorizationResult,
} from "../../../../lib/authorization.ts";

type TrashLister = Pick<JournalStore, "listTrash">;
type ClientAuthorizer = (request: Request) => Promise<AuthorizationResult>;

export function createJournalTrashGetHandler(
  store: TrashLister,
  authorize: ClientAuthorizer = authorizeClientRequest,
) {
  return async function GET(request: Request) {
    const authorization = await authorize(request);
    if (authorization.status !== "authorized") {
      return authorizationFailureResponse(authorization);
    }
    return Response.json({ records: await store.listTrash() });
  };
}

export const dynamic = "force-dynamic";
export const GET = createJournalTrashGetHandler(journalStore);
