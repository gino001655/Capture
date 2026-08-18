import {
  validateJournalCreateRequest,
  validateJournalDate,
} from "../../../lib/journal-record.ts";
import {
  journalStore,
  type JournalStore,
} from "../../../lib/journal-store.ts";
import {
  authorizationFailureResponse,
  authorizeClientRequest,
  type AuthorizationResult,
} from "../../../lib/authorization.ts";

type JournalCreator = Pick<JournalStore, "create">;
type JournalDateLister = Pick<JournalStore, "listDate">;
type ClientAuthorizer = (request: Request) => Promise<AuthorizationResult>;

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

export function createJournalRecordsPostHandler(
  store: JournalCreator,
  authorize: ClientAuthorizer = authorizeClientRequest,
) {
  return async function POST(request: Request) {
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

    const validation = validateJournalCreateRequest(requestBody);

    if (!validation.success) {
      return invalidJournalRecordResponse(validation.message);
    }

    const record = await store.create(validation.value);
    return Response.json({ record }, { status: 201 });
  };
}

export function createJournalRecordsGetHandler(
  store: JournalDateLister,
  authorize: ClientAuthorizer = authorizeClientRequest,
) {
  return async function GET(request: Request) {
    const authorization = await authorize(request);

    if (authorization.status !== "authorized") {
      return authorizationFailureResponse(authorization);
    }

    const dates = new URL(request.url).searchParams.getAll("date");

    if (dates.length !== 1 || !validateJournalDate(dates[0])) {
      return invalidJournalRecordResponse(
        "date must be exactly one valid YYYY-MM-DD date.",
      );
    }

    const records = await store.listDate(dates[0]);
    return Response.json({ records });
  };
}

export const dynamic = "force-dynamic";
export const GET = createJournalRecordsGetHandler(journalStore);
export const POST = createJournalRecordsPostHandler(journalStore);
