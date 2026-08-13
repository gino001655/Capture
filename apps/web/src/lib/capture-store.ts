import type { Capture } from "./capture.ts";

export class CaptureStore {
  private readonly captures = new Map<string, Capture>();

  create(content: string): Capture {
    const capture: Capture = {
      id: crypto.randomUUID(),
      content,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    this.captures.set(capture.id, capture);
    return capture;
  }

  find(id: string): Capture | undefined {
    return this.captures.get(id);
  }

  claimNext(): Capture | undefined {
    const capture = [...this.captures.values()].find(
      (candidate) => candidate.status === "pending",
    );

    if (capture === undefined) {
      return undefined;
    }

    const claimedCapture: Capture = { ...capture, status: "processing" };
    this.captures.set(capture.id, claimedCapture);
    return claimedCapture;
  }

  complete(id: string, result: string): Capture | undefined {
    const capture = this.captures.get(id);

    if (capture === undefined || capture.status !== "processing") {
      return undefined;
    }

    const completedCapture: Capture = {
      ...capture,
      status: "completed",
      result,
      completedAt: new Date().toISOString(),
    };

    this.captures.set(id, completedCapture);
    return completedCapture;
  }
}

const globalCaptureStore = globalThis as typeof globalThis & {
  captureStore?: CaptureStore;
};

export const captureStore =
  globalCaptureStore.captureStore ?? new CaptureStore();

if (process.env.NODE_ENV !== "production") {
  globalCaptureStore.captureStore = captureStore;
}
