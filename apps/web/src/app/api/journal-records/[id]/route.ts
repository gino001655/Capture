import { validateJournalUpdateRequest } from "../../../../lib/journal-record.ts";
import {
  JournalConflictRecordCollisionError,
  journalStore,
  type JournalStore,
} from "../../../../lib/journal-store.ts";
import {
  authorizationFailureResponse,
  authorizeClientRequest,
  type AuthorizationResult,
} from "../../../../lib/authorization.ts";

type JournalUpdater = Pick<JournalStore, "update">;
type ClientAuthorizer = (request: Request) => Promise<AuthorizationResult>;
type RouteContext = { params: Promise<{ id: string }> };

function invalidJsonResponse() {
  return Response.json(
    {
      error: {
        code: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      },
    },
    { status: 400 },
  );
}

function invalidJournalRecordResponse(message: string) {
  return Response.json(
    {
      error: {
        code: "INVALID_JOURNAL_RECORD",
        message,
      },
    },
    { status: 400 },
  );
}

export function createJournalRecordPatchHandler(
  store: JournalUpdater,
  authorize: ClientAuthorizer = authorizeClientRequest,
) {
  return async function PATCH(request: Request, context: RouteContext) {
    const authorization = await authorize(request);

    if (authorization.status !== "authorized") {
      return authorizationFailureResponse(authorization);
    }

    let requestBody: unknown;

    try {
      requestBody = await request.json();
    } catch {
      return invalidJsonResponse();
    }

    const validation = validateJournalUpdateRequest(requestBody);

    if (!validation.success) {
      return invalidJournalRecordResponse(validation.message);
    }

    const { id } = await context.params;

    try {
      const outcome = await store.update(id, validation.value);

      if (outcome.kind === "updated") {
        return Response.json(outcome);
      }

      if (outcome.kind === "conflict") {
        return Response.json(outcome);
      }

      if (outcome.kind === "locked") {
        return Response.json(
          {
            error: {
              code: "RECORD_LOCKED",
              message: "Delivered Journal records cannot be edited.",
            },
            record: outcome.record,
          },
          { status: 409 },
        );
      }

      return Response.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Journal record was not found.",
          },
        },
        { status: 404 },
      );
    } catch (error) {
      if (error instanceof JournalConflictRecordCollisionError) {
        return Response.json(
          {
            error: {
              code: "CONFLICT_ID_COLLISION",
              message: "conflictRecordId is already assigned to another Journal record.",
            },
          },
          { status: 409 },
        );
      }

      throw error;
    }
  };
}

export const PATCH = createJournalRecordPatchHandler(journalStore);
