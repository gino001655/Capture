import {
  isValidUuid,
  validateJournalDeleteRequest,
} from "../../../../../lib/journal-record.ts";
import { journalStore, type JournalStore } from "../../../../../lib/journal-store.ts";
import {
  authorizationFailureResponse,
  authorizeClientRequest,
  type AuthorizationResult,
} from "../../../../../lib/authorization.ts";

type JournalRestorer = Pick<JournalStore, "restore">;
type ClientAuthorizer = (request: Request) => Promise<AuthorizationResult>;
type RouteContext = { params: Promise<{ id: string }> };

function invalid(message: string, status = 400) {
  return Response.json({ error: { code: "INVALID_JOURNAL_RECORD", message } }, { status });
}

export function createJournalRestorePostHandler(
  store: JournalRestorer,
  authorize: ClientAuthorizer = authorizeClientRequest,
) {
  return async function POST(request: Request, context: RouteContext) {
    const authorization = await authorize(request);
    if (authorization.status !== "authorized") {
      return authorizationFailureResponse(authorization);
    }
    const { id } = await context.params;
    if (!isValidUuid(id)) return invalid("id must be a UUID.");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } },
        { status: 400 },
      );
    }
    const validation = validateJournalDeleteRequest(body);
    if (!validation.success) return invalid(validation.message);

    const outcome = await store.restore(id, validation.value.expectedRevision);
    if (outcome.kind === "restored") return Response.json({ record: outcome.record });
    if (outcome.kind === "missing") {
      return Response.json(
        { error: { code: "NOT_FOUND", message: "Trash record was not found." } },
        { status: 404 },
      );
    }
    return Response.json(
      {
        error: { code: "REVISION_CONFLICT", message: "Trash record changed before restore." },
        record: outcome.record,
      },
      { status: 409 },
    );
  };
}

export const POST = createJournalRestorePostHandler(journalStore);
