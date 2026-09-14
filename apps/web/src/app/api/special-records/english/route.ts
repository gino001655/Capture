import { authorizationFailureResponse, authorizeClientRequest, type AuthorizationResult } from "../../../../lib/authorization.ts";
import { validateJournalDate } from "../../../../lib/journal-record.ts";
import { specialRecordStore, type SpecialRecordStore } from "../../../../lib/special-record-store.ts";
import { toTaipeiDate, validateEnglishSaveRequest } from "../../../../lib/special-record.ts";

type Authorizer = (request: Request) => Promise<AuthorizationResult>;
type EnglishStore = Pick<SpecialRecordStore, "getEnglish" | "listEnglish" | "saveEnglish">;

function invalid(message: string) {
  return Response.json({ error: { code: "INVALID_ENGLISH_RECORD", message } }, { status: 400 });
}

export function createEnglishHandler(
  store: EnglishStore,
  authorize: Authorizer = authorizeClientRequest,
  now: () => Date = () => new Date(),
) {
  return async function handle(request: Request) {
    const authorization = await authorize(request);
    if (authorization.status !== "authorized") return authorizationFailureResponse(authorization);

    if (request.method === "GET") {
      const dates = new URL(request.url).searchParams.getAll("date");
      if (dates.length === 0) {
        return Response.json({ records: await store.listEnglish() });
      }
      if (dates.length !== 1 || !validateJournalDate(dates[0])) {
        return invalid("date must be exactly one valid YYYY-MM-DD date.");
      }
      return Response.json({ record: await store.getEnglish(dates[0]) });
    }

    if (request.method !== "PUT") return new Response(null, { status: 405 });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
    }
    const validation = validateEnglishSaveRequest(body);
    if (!validation.success) return invalid(validation.message);
    const editedDate = toTaipeiDate(new Date(validation.value.clientUpdatedAt));
    if (
      validation.value.journalDate !== toTaipeiDate(now()) &&
      validation.value.journalDate !== editedDate
    ) {
      return Response.json(
        { error: { code: "RECORD_LOCKED", message: "Only today's English document can be changed." } },
        { status: 409 },
      );
    }
    const outcome = await store.saveEnglish(validation.value);
    if (outcome.kind === "locked") {
      return Response.json(
        { error: { code: "RECORD_LOCKED", message: "This English document is already processing or processed." }, record: outcome.record },
        { status: 409 },
      );
    }
    if (outcome.kind === "conflict") {
      return Response.json(
        { error: { code: "REVISION_CONFLICT", message: "The English document changed on another device." }, record: outcome.record },
        { status: 409 },
      );
    }
    return Response.json(outcome, { status: outcome.kind === "created" ? 201 : 200 });
  };
}

export const dynamic = "force-dynamic";
const handler = createEnglishHandler(specialRecordStore);
export const GET = handler;
export const PUT = handler;
