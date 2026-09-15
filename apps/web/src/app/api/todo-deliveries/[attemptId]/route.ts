import { validateAttemptId, validateDeliveryReport } from "../../../../lib/journal-delivery.ts";
import {
  authorizationFailureResponse,
  authorizeDesktopRequest,
} from "../../../../lib/authorization.ts";
import { journalStore, type JournalStore } from "../../../../lib/journal-store.ts";

type TodoReporter = Pick<JournalStore, "completeTodoDelivery" | "failTodoDelivery">;
type RouteContext = { params: Promise<{ attemptId: string }> };

export function createTodoDeliveryReportHandler(store: TodoReporter) {
  return async function PATCH(request: Request, context: RouteContext) {
    const authorization = authorizeDesktopRequest(request);
    if (authorization.status !== "authorized") return authorizationFailureResponse(authorization);
    const { attemptId } = await context.params;
    if (!validateAttemptId(attemptId)) {
      return Response.json({ error: { code: "INVALID_ATTEMPT_ID", message: "attemptId must be a UUID." } }, { status: 400 });
    }
    let body: unknown;
    try { body = await request.json(); } catch {
      return Response.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
    }
    const validation = validateDeliveryReport(body);
    if (!validation.success) {
      return Response.json({ error: { code: "INVALID_DELIVERY_REPORT", message: validation.message } }, { status: 400 });
    }
    const result = validation.value.outcome === "completed"
      ? await store.completeTodoDelivery(attemptId, validation.value.result)
      : await store.failTodoDelivery(attemptId, validation.value.error);
    if (!result) {
      return Response.json({ error: { code: "DELIVERY_NOT_PROCESSING", message: "The Todo attempt is no longer processing." } }, { status: 409 });
    }
    return Response.json({ delivery: result });
  };
}

export const PATCH = createTodoDeliveryReportHandler(journalStore);
