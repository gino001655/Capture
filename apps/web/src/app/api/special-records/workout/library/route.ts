import { authorizationFailureResponse, authorizeClientRequest, type AuthorizationResult } from "../../../../../lib/authorization.ts";
import { validateWorkoutLibrarySaveRequest } from "../../../../../lib/workout-library.ts";
import { workoutLibraryStore, type WorkoutLibraryStore } from "../../../../../lib/workout-library-store.ts";
import { workoutStore, type WorkoutStore } from "../../../../../lib/workout-store.ts";

type Authorizer = (request: Request) => Promise<AuthorizationResult>;

export function createWorkoutLibraryHandler(
  library: Pick<WorkoutLibraryStore, "get" | "save">,
  workouts: Pick<WorkoutStore, "list">,
  authorize: Authorizer = authorizeClientRequest,
) {
  return async function handle(request: Request) {
    const authorization = await authorize(request);
    if (authorization.status !== "authorized") return authorizationFailureResponse(authorization);
    if (request.method === "GET") return Response.json({ record: await library.get() });
    if (request.method !== "PUT") return new Response(null, { status: 405 });
    let body: unknown;
    try { body = await request.json(); }
    catch { return Response.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 }); }
    const validation = validateWorkoutLibrarySaveRequest(body);
    if (!validation.success) return Response.json({ error: { code: "INVALID_WORKOUT_LIBRARY", message: validation.message } }, { status: 400 });

    const current = await library.get();
    if (current) {
      const retained = new Set(validation.value.payload.entries.map((entry) => entry.id));
      const removed = current.payload.entries.filter((entry) => !retained.has(entry.id));
      if (removed.length) {
        const records = await workouts.list();
        const used = removed.find((entry) => records.some((record) => record.payload.sessions.some((session) =>
          session.exercises.some((exercise) => exercise.kind === "strength" && (exercise.libraryEntryId === entry.id || (!exercise.libraryEntryId && exercise.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase()))),
        )));
        if (used) return Response.json({ error: { code: "LIBRARY_ENTRY_IN_USE", message: `${used.name} has workout history and can only be archived.` } }, { status: 409 });
      }
    }

    const outcome = await library.save(validation.value);
    if (outcome.kind === "conflict") return Response.json({ error: { code: "REVISION_CONFLICT", message: "The workout library changed on another device." }, record: outcome.record }, { status: 409 });
    return Response.json(outcome, { status: outcome.kind === "created" ? 201 : 200 });
  };
}

export const dynamic = "force-dynamic";
const handler = createWorkoutLibraryHandler(workoutLibraryStore, workoutStore);
export const GET = handler;
export const PUT = handler;
