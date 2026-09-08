import { authorizationFailureResponse, authorizeClientRequest, type AuthorizationResult } from "../../../../lib/authorization.ts";
import { validateJournalDate } from "../../../../lib/journal-record.ts";
import { toTaipeiDate } from "../../../../lib/special-record.ts";
import { validateWorkoutSaveRequest } from "../../../../lib/workout-record.ts";
import { workoutStore, type WorkoutStore } from "../../../../lib/workout-store.ts";

type Authorizer = (request: Request) => Promise<AuthorizationResult>;
type Store = Pick<WorkoutStore, "get" | "list" | "save">;

function previousDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

function invalid(message: string) {
  return Response.json({ error: { code: "INVALID_WORKOUT_RECORD", message } }, { status: 400 });
}

export function createWorkoutHandler(
  store: Store,
  authorize: Authorizer = authorizeClientRequest,
  now: () => Date = () => new Date(),
) {
  return async function handle(request: Request) {
    const authorization = await authorize(request);
    if (authorization.status !== "authorized") return authorizationFailureResponse(authorization);
    if (request.method === "GET") {
      const dates = new URL(request.url).searchParams.getAll("date");
      if (dates.length === 0) return Response.json({ records: await store.list() });
      if (dates.length !== 1 || !validateJournalDate(dates[0])) return invalid("date must be exactly one valid YYYY-MM-DD date.");
      return Response.json({ record: await store.get(dates[0]) });
    }
    if (request.method !== "PUT") return new Response(null, { status: 405 });

    let body: unknown;
    try { body = await request.json(); }
    catch { return Response.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 }); }
    const validation = validateWorkoutSaveRequest(body);
    if (!validation.success) return invalid(validation.message);

    const today = toTaipeiDate(now());
    const editableDates = new Set([today, previousDate(today)]);
    if (!editableDates.has(validation.value.journalDate)) {
      return Response.json(
        { error: { code: "RECORD_LOCKED", message: "Only today's and yesterday's workouts can be changed." } },
        { status: 409 },
      );
    }
    const outcome = await store.save(validation.value);
    if (outcome.kind === "conflict") {
      return Response.json(
        { error: { code: "REVISION_CONFLICT", message: "The workout changed on another device." }, record: outcome.record },
        { status: 409 },
      );
    }
    return Response.json(outcome, { status: outcome.kind === "created" ? 201 : 200 });
  };
}

export const dynamic = "force-dynamic";
const handler = createWorkoutHandler(workoutStore);
export const GET = handler;
export const PUT = handler;
