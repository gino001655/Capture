import { captureStore } from "../../../../lib/capture-store.ts";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const capture = await captureStore.find(id);

  if (capture === undefined) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Capture was not found." } },
      { status: 404 },
    );
  }

  return Response.json({ capture });
}
