import { captureStore } from "../../../../lib/capture-store.ts";

export function POST() {
  const job = captureStore.claimNext();

  return Response.json({ job: job ?? null });
}
