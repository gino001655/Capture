import { authorizationFailureResponse, authorizeClientRequest, type AuthorizationResult } from "../../../../lib/authorization.ts";
import { validateFoodSaveRequest } from "../../../../lib/food-record.ts";
import { foodStore, type FoodStore } from "../../../../lib/food-store.ts";
import { validateJournalDate } from "../../../../lib/journal-record.ts";
import { toTaipeiDate } from "../../../../lib/special-record.ts";

type Authorizer = (request: Request) => Promise<AuthorizationResult>;
function previousDate(date: string) { const [year, month, day] = date.split("-").map(Number); return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10); }
export function createFoodHandler(store: Pick<FoodStore, "get" | "list" | "save">, authorize: Authorizer = authorizeClientRequest, now: () => Date = () => new Date()) {
  return async function handle(request: Request) {
    const authorization = await authorize(request); if (authorization.status !== "authorized") return authorizationFailureResponse(authorization);
    if (request.method === "GET") { const dates = new URL(request.url).searchParams.getAll("date"); if (!dates.length) return Response.json({ records: await store.list() }); if (dates.length !== 1 || !validateJournalDate(dates[0])) return Response.json({ error: { code: "INVALID_FOOD_RECORD", message: "date must be one valid YYYY-MM-DD value." } }, { status: 400 }); return Response.json({ record: await store.get(dates[0]) }); }
    if (request.method !== "PUT") return new Response(null, { status: 405 });
    let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 }); }
    const validation = validateFoodSaveRequest(body); if (!validation.success) return Response.json({ error: { code: "INVALID_FOOD_RECORD", message: validation.message } }, { status: 400 });
    const today = toTaipeiDate(now()); if (![today, previousDate(today)].includes(validation.value.journalDate)) return Response.json({ error: { code: "RECORD_LOCKED", message: "Only today's and yesterday's food can be changed." } }, { status: 409 });
    const outcome = await store.save(validation.value); if (outcome.kind === "conflict") return Response.json({ error: { code: "REVISION_CONFLICT", message: "Food changed on another device." }, record: outcome.record }, { status: 409 });
    return Response.json(outcome, { status: outcome.kind === "created" ? 201 : 200 });
  };
}
export const dynamic = "force-dynamic"; const handler = createFoodHandler(foodStore); export const GET = handler; export const PUT = handler;
