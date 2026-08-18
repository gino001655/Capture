import assert from "node:assert/strict";
import test from "node:test";

import {
  createJournalSyncController,
  getJournalAreaFields,
  type JournalSyncControllerOptions,
} from "./journal-sync.ts";
import {
  createLocalState,
  editActiveArea,
  JOURNAL_LOCAL_STORAGE_KEY,
  type JournalLocalState,
} from "./journal-session.ts";
import {
  emptyJournalAreas,
  type EditingState,
  type JournalRecord,
} from "../lib/journal-record.ts";

type TimerCallback = () => void;

class FakeScheduler {
  now = 0;
  private nextHandle = 1;
  private readonly tasks = new Map<
    number,
    { callback: TimerCallback; dueAt: number }
  >();

  schedule = (callback: TimerCallback, delay: number): number => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.tasks.set(handle, { callback, dueAt: this.now + delay });
    return handle;
  };

  cancel = (handle: unknown): void => {
    this.tasks.delete(handle as number);
  };

  advance(milliseconds: number): void {
    this.now += milliseconds;
    const due = [...this.tasks.entries()]
      .filter(([, task]) => task.dueAt <= this.now)
      .sort((left, right) => left[1].dueAt - right[1].dueAt);

    for (const [handle, task] of due) {
      if (!this.tasks.delete(handle)) continue;
      task.callback();
    }
  }
}

class MemoryStorage {
  value: string | null;
  readonly writes: string[] = [];

  constructor(value: string | null = null) {
    this.value = value;
  }

  getItem(key: string): string | null {
    assert.equal(key, JOURNAL_LOCAL_STORAGE_KEY);
    return this.value;
  }

  setItem(key: string, value: string): void {
    assert.equal(key, JOURNAL_LOCAL_STORAGE_KEY);
    this.value = value;
    this.writes.push(value);
  }
}

function idFactory(start = 1): () => string {
  let next = start;
  return () => {
    const suffix = String(next).padStart(12, "0");
    next += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  };
}

function readStoredState(storage: MemoryStorage): JournalLocalState {
  assert.notEqual(storage.value, null);
  return JSON.parse(storage.value!) as JournalLocalState;
}

function responseRecord(
  url: string,
  init: RequestInit,
  revision: number,
  editingState?: EditingState,
): JournalRecord {
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  const id =
    init.method === "POST"
      ? String(body.id)
      : decodeURIComponent(url.split("/").at(-1)!);

  return {
    id,
    deviceId: String(body.deviceId),
    journalDate: String(body.journalDate),
    areas: body.areas as JournalRecord["areas"],
    deliveryState: "undelivered",
    editingState: editingState ?? (body.editingState as EditingState) ?? "active",
    revision,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
  };
}

function acceptedResponse(
  url: string,
  init: RequestInit,
  revision: number,
  editingState?: EditingState,
): Response {
  const record = responseRecord(url, init, revision, editingState);
  if (init.method === "POST") {
    return Response.json({ record }, { status: 201 });
  }
  return Response.json({ kind: "updated", record });
}

function makeController(
  overrides: Partial<JournalSyncControllerOptions> = {},
): {
  controller: ReturnType<typeof createJournalSyncController>;
  scheduler: FakeScheduler;
  storage: MemoryStorage;
} {
  const scheduler = new FakeScheduler();
  const storage = new MemoryStorage();
  const controller = createJournalSyncController({
    storage,
    request: async (url, init) => acceptedResponse(url, init, 0),
    now: () => new Date("2026-08-18T01:00:00.000Z"),
    idFactory: idFactory(),
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    ...overrides,
  });

  return { controller, scheduler, storage };
}

test("the editor field model exposes six controlled values in canonical symbol and aria-label order", () => {
  const fields = getJournalAreaFields({
    unclassified: "zero",
    event: "one",
    question: "two",
    insight: "three",
    next: "four",
    feeling: "five",
  });

  assert.deepEqual(fields, [
    { key: "unclassified", symbol: "○", ariaLabel: "Unclassified", value: "zero" },
    { key: "event", symbol: "*", ariaLabel: "Event", value: "one" },
    { key: "question", symbol: "?", ariaLabel: "Question", value: "two" },
    { key: "insight", symbol: "!", ariaLabel: "Insight", value: "three" },
    { key: "next", symbol: "+", ariaLabel: "Next", value: "four" },
    { key: "feeling", symbol: "~", ariaLabel: "Feeling", value: "five" },
  ]);
});

test("an edit is locally durable at the event boundary and waits exactly 1500 ms before POST", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const { controller, scheduler, storage } = makeController({
    request: async (url, init) => {
      requests.push({ url, init });
      return acceptedResponse(url, init, 0);
    },
  });

  controller.editActiveArea("question", "What changed?");

  assert.equal(readStoredState(storage).active.areas.question, "What changed?");
  assert.equal(requests.length, 0);
  scheduler.advance(1_499);
  assert.equal(requests.length, 0);

  scheduler.advance(1);
  await controller.retryPending();

  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, "/api/journal-records");
  assert.equal(requests[0]!.init.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0]!.init.body)), {
    id: "00000000-0000-4000-8000-000000000002",
    deviceId: "00000000-0000-4000-8000-000000000001",
    journalDate: "2026-08-18",
    areas: { ...emptyJournalAreas(), question: "What changed?" },
  });
});

test("a later edit resets the 1500 ms debounce and only the latest content is sent", async () => {
  const sentBodies: unknown[] = [];
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      sentBodies.push(JSON.parse(String(init.body)));
      return acceptedResponse(url, init, 0);
    },
  });

  controller.editActiveArea("event", "first");
  scheduler.advance(1_000);
  controller.editActiveArea("event", "second");
  scheduler.advance(1_499);
  assert.equal(sentBodies.length, 0);

  scheduler.advance(1);
  await controller.retryPending();

  assert.equal(sentBodies.length, 1);
  assert.equal(
    (sentBodies[0] as { areas: { event: string } }).areas.event,
    "second",
  );
});

test("an acknowledged create makes later edits PATCH the current revision with a stable conflict id", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      requests.push({ url, init });
      return acceptedResponse(url, init, init.method === "POST" ? 0 : 1);
    },
  });

  const conflictRecordId = controller.getState().active.conflictRecordId;
  controller.editActiveArea("insight", "first version");
  scheduler.advance(1_500);
  await controller.retryPending();
  controller.editActiveArea("insight", "revised version");
  scheduler.advance(1_500);
  await controller.retryPending();

  assert.equal(requests.length, 2);
  assert.equal(
    requests[1]!.url,
    "/api/journal-records/00000000-0000-4000-8000-000000000002",
  );
  assert.equal(requests[1]!.init.method, "PATCH");
  assert.deepEqual(JSON.parse(String(requests[1]!.init.body)), {
    deviceId: "00000000-0000-4000-8000-000000000001",
    journalDate: "2026-08-18",
    areas: { ...emptyJournalAreas(), insight: "revised version" },
    editingState: "active",
    expectedRevision: 0,
    conflictRecordId,
  });
  assert.equal(controller.getState().active.revision, 1);
  assert.equal(controller.getState().active.conflictRecordId, conflictRecordId);
});

test("an edit that becomes ready during a request waits for its acknowledgement before starting PATCH", async () => {
  let resolveFirst!: (response: Response) => void;
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const firstResponse = new Promise<Response>((resolve) => {
    resolveFirst = resolve;
  });
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      requests.push({ url, init });
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      try {
        if (requests.length === 1) return await firstResponse;
        return acceptedResponse(url, init, 1);
      } finally {
        activeRequests -= 1;
      }
    },
  });

  controller.editActiveArea("event", "first");
  scheduler.advance(1_500);
  const firstDrain = controller.retryPending();
  controller.editActiveArea("event", "second");
  scheduler.advance(1_500);

  assert.equal(requests.length, 1);
  assert.equal(maximumActiveRequests, 1);
  resolveFirst(acceptedResponse(requests[0]!.url, requests[0]!.init, 0));
  await firstDrain;

  assert.equal(requests.length, 2);
  assert.equal(requests[1]!.init.method, "PATCH");
  assert.equal(maximumActiveRequests, 1);
  assert.equal(
    (JSON.parse(String(requests[1]!.init.body)) as { areas: { event: string } })
      .areas.event,
    "second",
  );
});

test("5xx, malformed acknowledgements, and network errors retain content until online retry succeeds", async () => {
  let attempt = 0;
  const { controller, scheduler, storage } = makeController({
    request: async (url, init) => {
      attempt += 1;
      if (attempt === 1) return new Response("unavailable", { status: 503 });
      if (attempt === 2) return Response.json({ nope: true }, { status: 201 });
      if (attempt === 3) throw new TypeError("offline");
      return acceptedResponse(url, init, 0);
    },
  });

  controller.editActiveArea("feeling", "still here");
  scheduler.advance(1_500);
  await controller.retryPending();
  assert.equal(controller.getState().active.revision, null);
  assert.equal(readStoredState(storage).active.areas.feeling, "still here");

  await controller.retryPending();
  assert.equal(controller.getState().active.revision, null);
  assert.equal(readStoredState(storage).active.areas.feeling, "still here");

  await controller.retryPending();
  assert.equal(controller.getState().active.revision, null);
  assert.equal(readStoredState(storage).active.areas.feeling, "still here");

  await controller.retryPending();
  assert.equal(attempt, 4);
  assert.equal(controller.getState().active.revision, 0);
  assert.equal(readStoredState(storage).active.areas.feeling, "still here");
});

test("disposing aborts the instance and prevents a stale acknowledgement from changing persisted state", async () => {
  let resolveRequest!: (response: Response) => void;
  let requestSignal: AbortSignal | null = null;
  let requestUrl = "";
  let requestInit: RequestInit = {};
  const response = new Promise<Response>((resolve) => {
    resolveRequest = resolve;
  });
  const { controller, scheduler, storage } = makeController({
    request: async (url, init) => {
      requestUrl = url;
      requestInit = init;
      requestSignal = init.signal as AbortSignal;
      return response;
    },
  });

  controller.editActiveArea("next", "do not lose me");
  scheduler.advance(1_500);
  const drain = controller.retryPending();
  controller.dispose();

  assert.equal(requestSignal?.aborted, true);
  resolveRequest(acceptedResponse(requestUrl, requestInit, 0));
  await drain;

  assert.equal(controller.getState().active.revision, null);
  assert.equal(readStoredState(storage).active.areas.next, "do not lose me");
});

test("cold launch queues a non-empty active draft and POSTs then PATCHes it idle before removal", async () => {
  const source = editActiveArea(
    createLocalState(new Date("2026-08-18T01:00:00.000Z"), idFactory()),
    "unclassified",
    "from the previous launch",
  );
  const storage = new MemoryStorage(JSON.stringify(source));
  let resolvePatch!: (response: Response) => void;
  const patchResponse = new Promise<Response>((resolve) => {
    resolvePatch = resolve;
  });
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const controller = createJournalSyncController({
    storage,
    request: async (url, init) => {
      requests.push({ url, init });
      if (init.method === "POST") {
        return acceptedResponse(url, init, 0, "active");
      }
      return patchResponse;
    },
    now: () => new Date("2026-08-18T01:02:00.000Z"),
    idFactory: idFactory(4),
  });

  assert.equal(controller.getState().pending.length, 1);
  assert.equal(controller.getState().pending[0]!.editingState, "idle");
  assert.equal(controller.getState().pending[0]!.areas.unclassified, "from the previous launch");
  assert.deepEqual(controller.getState().active.areas, emptyJournalAreas());

  const drain = controller.start();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.init.method, "POST");
  assert.equal(requests[1]!.init.method, "PATCH");
  assert.equal(controller.getState().pending.length, 1);
  assert.equal(controller.getState().pending[0]!.revision, 0);
  assert.equal(controller.getState().pending[0]!.editingState, "idle");

  resolvePatch(acceptedResponse(requests[1]!.url, requests[1]!.init, 1, "idle"));
  await drain;

  assert.equal(controller.getState().pending.length, 0);
  assert.deepEqual(controller.getState().active.areas, emptyJournalAreas());
});

test("cold launch does not turn an empty stored active sheet into a record", () => {
  const source = createLocalState(
    new Date("2026-08-18T01:00:00.000Z"),
    idFactory(),
  );
  const storage = new MemoryStorage(JSON.stringify(source));
  const controller = createJournalSyncController({
    storage,
    request: async (url, init) => acceptedResponse(url, init, 0),
    now: () => new Date("2026-08-18T01:02:00.000Z"),
    idFactory: idFactory(4),
  });

  assert.equal(controller.getState().pending.length, 0);
  assert.equal(controller.getState().active.id, source.active.id);
});

test("foreground resumes at 9:59.999 but finishes a non-empty draft at exactly 10:00", () => {
  let now = new Date("2026-08-18T01:00:00.000Z");
  const { controller, storage } = makeController({ now: () => now });
  controller.editActiveArea("event", "ten-minute boundary");
  controller.markHidden();

  assert.equal(
    readStoredState(storage).active.backgroundedAt,
    Date.parse("2026-08-18T01:00:00.000Z"),
  );
  now = new Date("2026-08-18T01:09:59.999Z");
  assert.equal(controller.resumeVisible(), false);
  assert.equal(controller.getState().pending.length, 0);

  now = new Date("2026-08-18T01:10:00.000Z");
  assert.equal(controller.resumeVisible(), true);
  assert.equal(controller.getState().pending.length, 1);
  assert.equal(controller.getState().pending[0]!.editingState, "idle");
  assert.deepEqual(controller.getState().active.areas, emptyJournalAreas());
  assert.deepEqual(readStoredState(storage), controller.getState());
});
