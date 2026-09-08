import { authorizationFailureResponse, authorizeClientRequest, type AuthorizationResult } from "../../../../../lib/authorization.ts";
import { validateFoodLibrarySaveRequest } from "../../../../../lib/food-library.ts";
import { foodLibraryStore, type FoodLibraryStore } from "../../../../../lib/food-library-store.ts";
import { foodStore, type FoodStore } from "../../../../../lib/food-store.ts";
type Authorizer = (request: Request) => Promise<AuthorizationResult>;
export function createFoodLibraryHandler(library: Pick<FoodLibraryStore, "get" | "save">, foods: Pick<FoodStore, "list">, authorize: Authorizer = authorizeClientRequest) {
  return async function handle(request: Request) {
    const authorization = await authorize(request); if (authorization.status !== "authorized") return authorizationFailureResponse(authorization);
    if (request.method === "GET") return Response.json({ record: await library.get() }); if (request.method !== "PUT") return new Response(null, { status: 405 });
    let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 }); }
    const validation = validateFoodLibrarySaveRequest(body); if (!validation.success) return Response.json({ error: { code: "INVALID_FOOD_LIBRARY", message: validation.message } }, { status: 400 });
    const current = await library.get(); if (current) { const retained = new Set(validation.value.payload.entries.map((entry) => entry.id)); const removed = current.payload.entries.filter((entry) => !retained.has(entry.id)); if (removed.length) { const records = await foods.list(); const used = removed.find((entry) => records.some((record) => record.payload.entries.some((food) => food.libraryEntryId === entry.id || (!food.libraryEntryId && food.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase())))); if (used) return Response.json({ error: { code: "LIBRARY_ENTRY_IN_USE", message: `${used.name} has food history and can only be archived.` } }, { status: 409 }); } }
    const outcome = await library.save(validation.value); if (outcome.kind === "conflict") return Response.json({ error: { code: "REVISION_CONFLICT", message: "Food library changed on another device." }, record: outcome.record }, { status: 409 }); return Response.json(outcome, { status: outcome.kind === "created" ? 201 : 200 });
  };
}
export const dynamic = "force-dynamic"; const handler = createFoodLibraryHandler(foodLibraryStore, foodStore); export const GET = handler; export const PUT = handler;
