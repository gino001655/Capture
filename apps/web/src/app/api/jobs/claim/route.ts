import { captureStore } from "../../../../lib/capture-store.ts";

export async function POST() {
  const job = await captureStore.claimNext();

  return Response.json({ job: job ?? null });
}
