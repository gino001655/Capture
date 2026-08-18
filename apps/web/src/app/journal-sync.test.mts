import assert from "node:assert/strict";
import test from "node:test";

import {
  createJournalSyncController,
  type JournalSyncControllerOptions,
} from "./journal-sync.ts";
import {
  createLocalState,
  editActiveArea,
  finishActive,
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

async function nextEventLoopTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

type ObservableSyncStatus = {
  durability: string;
  issues: ReadonlyArray<{ code: string; localId?: string }>;
};

function observableStatus(
  controller: ReturnType<typeof createJournalSyncController>,
): ObservableSyncStatus | undefined {
  return (
    controller as unknown as { getStatus?: () => ObservableSyncStatus }
  ).getStatus?.();
}

function stateWithTwoPending(): {
  state: JournalLocalState;
  nextId: () => string;
} {
  const nextId = idFactory();
  let state = createLocalState(
    new Date("2026-08-18T01:00:00.000Z"),
    nextId,
  );
  state = finishActive(
    editActiveArea(state, "event", "first queued record"),
    new Date("2026-08-18T01:01:00.000Z"),
    nextId,
  );
  state = finishActive(
    editActiveArea(state, "insight", "later valid record"),
    new Date("2026-08-18T01:02:00.000Z"),
    nextId,
  );
  return { state, nextId };
}

function errorResponse(
  status: number,
  code: string,
  record?: JournalRecord,
): Response {
  return Response.json(
    {
      error: { code, message: code },
      ...(record === undefined ? {} : { record }),
    },
    { status },
  );
}

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

test("opening an undelivered Cloud record makes its edit PATCH through the existing revision path", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      requests.push({ url, init });
      return acceptedResponse(url, init, 8);
    },
  });
  const record: JournalRecord = {
    id: "00000000-0000-4000-8000-000000000010",
    deviceId: controller.getState().deviceId,
    journalDate: "2026-08-17",
    areas: { ...emptyJournalAreas(), insight: "existing" },
    deliveryState: "undelivered",
    editingState: "idle",
    revision: 7,
    createdAt: "2026-08-17T02:00:00.000Z",
    updatedAt: "2026-08-17T02:00:00.000Z",
  };

  assert.equal(controller.openRecord(record), true);
  const conflictRecordId = controller.getState().active.conflictRecordId;
  controller.editActiveArea("insight", "edited existing");
  scheduler.advance(1_500);
  await controller.retryPending();

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0]?.url,
    "/api/journal-records/00000000-0000-4000-8000-000000000010",
  );
  assert.equal(requests[0]?.init.method, "PATCH");
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), {
    deviceId: record.deviceId,
    journalDate: "2026-08-17",
    areas: { ...emptyJournalAreas(), insight: "edited existing" },
    editingState: "active",
    expectedRevision: 7,
    conflictRecordId,
  });
  assert.equal(controller.getState().active.revision, 8);
});

test("delivered records cannot enter the editable sync controller", () => {
  const { controller } = makeController();
  const before = controller.getState();
  const delivered: JournalRecord = {
    id: "00000000-0000-4000-8000-000000000010",
    deviceId: before.deviceId,
    journalDate: "2026-08-17",
    areas: { ...emptyJournalAreas(), feeling: "locked" },
    deliveryState: "delivered",
    editingState: "idle",
    revision: 3,
    createdAt: "2026-08-17T02:00:00.000Z",
    updatedAt: "2026-08-17T02:00:00.000Z",
  };

  assert.equal(controller.openRecord(delivered), false);
  assert.deepEqual(controller.getState(), before);
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
  await nextEventLoopTurn();
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

test("a debounced edit that fires during a failing request gets one coalesced rerun with latest content", async () => {
  let resolveFirst!: (response: Response) => void;
  const firstResponse = new Promise<Response>((resolve) => {
    resolveFirst = resolve;
  });
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      requests.push({ url, init });
      if (requests.length === 1) return firstResponse;
      return acceptedResponse(url, init, 0);
    },
  });

  controller.editActiveArea("event", "first");
  scheduler.advance(1_500);
  controller.editActiveArea("event", "latest");
  scheduler.advance(1_500);
  resolveFirst(new Response("unavailable", { status: 503 }));
  await nextEventLoopTurn();

  assert.equal(requests.length, 2);
  assert.equal(
    (JSON.parse(String(requests[1]!.init.body)) as { areas: { event: string } })
      .areas.event,
    "latest",
  );
  assert.equal(controller.getState().active.revision, 0);
});

test("an online trigger during a failing request retries once after that request settles", async () => {
  let rejectFirst!: (error: Error) => void;
  const firstResponse = new Promise<Response>((_resolve, reject) => {
    rejectFirst = reject;
  });
  let requestCount = 0;
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      requestCount += 1;
      if (requestCount === 1) return firstResponse;
      return acceptedResponse(url, init, 0);
    },
  });

  controller.editActiveArea("question", "retry when online");
  scheduler.advance(1_500);
  const onlineRetry = controller.retryPending();
  rejectFirst(new TypeError("offline"));
  await onlineRetry;

  assert.equal(requestCount, 2);
  assert.equal(controller.getState().active.revision, 0);
});

test("an idempotent POST replay with older areas rebases then PATCHes the latest local content", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  let committedRecord: JournalRecord | null = null;
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      requests.push({ url, init });
      if (requests.length === 1) {
        committedRecord = responseRecord(url, init, 0, "active");
        throw new TypeError("response lost after commit");
      }
      if (requests.length === 2) {
        return Response.json({ record: committedRecord }, { status: 201 });
      }
      return acceptedResponse(url, init, 1, "active");
    },
  });

  controller.editActiveArea("insight", "server committed this older text");
  scheduler.advance(1_500);
  await nextEventLoopTurn();
  controller.editActiveArea("insight", "newer local text");
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  assert.equal(requests.length, 3);
  assert.equal(requests[0]!.init.method, "POST");
  assert.equal(requests[1]!.init.method, "POST");
  assert.equal(requests[2]!.init.method, "PATCH");
  assert.equal(
    (JSON.parse(String(requests[2]!.init.body)) as { areas: { insight: string } })
      .areas.insight,
    "newer local text",
  );
  assert.equal(controller.getState().active.revision, 1);
  assert.equal(controller.getState().active.areas.insight, "newer local text");
});

test("content above 5000 characters stays editable and durable but cannot sync or finalize until shortened", async () => {
  let requestCount = 0;
  const { controller, scheduler, storage } = makeController({
    request: async (url, init) => {
      requestCount += 1;
      return acceptedResponse(url, init, 0);
    },
  });

  controller.editActiveArea("unclassified", "x".repeat(5_001));
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  assert.equal(controller.getState().active.areas.unclassified.length, 5_001);
  assert.equal(readStoredState(storage).active.areas.unclassified.length, 5_001);
  assert.equal(requestCount, 0);
  assert.equal(controller.finishActiveAndStartNew(), false);
  assert.equal(controller.getState().pending.length, 0);
  assert.deepEqual(
    observableStatus(controller)?.issues.map(({ code }) => code),
    ["CONTENT_TOO_LONG"],
  );

  controller.editActiveArea("unclassified", "now valid");
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  assert.equal(requestCount, 1);
  assert.equal(controller.getState().active.revision, 0);
  assert.deepEqual(observableStatus(controller)?.issues, []);
});

test("a 400-blocked queued record stays durable without starving the later valid record", async () => {
  const { state, nextId } = stateWithTwoPending();
  const blockedId = state.pending[0]!.id;
  const laterId = state.pending[1]!.id;
  const storage = new MemoryStorage(JSON.stringify(state));
  const requestedIds: string[] = [];
  const controller = createJournalSyncController({
    storage,
    idFactory: nextId,
    now: () => new Date("2026-08-18T01:03:00.000Z"),
    request: async (url, init) => {
      const id = init.method === "POST"
        ? (JSON.parse(String(init.body)) as { id: string }).id
        : decodeURIComponent(url.split("/").at(-1)!);
      requestedIds.push(id);
      if (id === blockedId) {
        return errorResponse(400, "INVALID_JOURNAL_RECORD");
      }
      return acceptedResponse(url, init, init.method === "POST" ? 0 : 1);
    },
  });

  await controller.start();

  assert.deepEqual(requestedIds, [blockedId, laterId, laterId]);
  assert.deepEqual(controller.getState().pending.map(({ id }) => id), [blockedId]);
  assert.equal(readStoredState(storage).pending[0]!.areas.event, "first queued record");
  assert.deepEqual(
    observableStatus(controller)?.issues.map(({ code, localId }) => ({ code, localId })),
    [{ code: "INVALID_JOURNAL_RECORD", localId: blockedId }],
  );
});

test("401 and AUTH_NOT_CONFIGURED 503 pause the whole queue until an explicit later trigger", async () => {
  for (const authFailure of [
    { status: 401, code: "UNAUTHORIZED" },
    { status: 503, code: "AUTH_NOT_CONFIGURED" },
  ]) {
    const { state, nextId } = stateWithTwoPending();
    const firstId = state.pending[0]!.id;
    const storage = new MemoryStorage(JSON.stringify(state));
    const requestedIds: string[] = [];
    const controller = createJournalSyncController({
      storage,
      idFactory: nextId,
      now: () => new Date("2026-08-18T01:03:00.000Z"),
      request: async (_url, init) => {
        requestedIds.push(
          (JSON.parse(String(init.body)) as { id?: string }).id ?? "patch",
        );
        return errorResponse(authFailure.status, authFailure.code);
      },
    });

    await controller.start();
    assert.deepEqual(requestedIds, [firstId]);
    assert.equal(observableStatus(controller)?.issues[0]?.code, authFailure.code);

    await controller.retryPending();
    assert.deepEqual(requestedIds, [firstId, firstId]);
    controller.dispose();
  }
});

test("PATCH 404 rebases the same local draft to POST without losing content", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      requests.push({ url, init });
      if (requests.length === 1) return acceptedResponse(url, init, 0);
      if (requests.length === 2) return errorResponse(404, "NOT_FOUND");
      return acceptedResponse(url, init, 0);
    },
  });

  const originalId = controller.getState().active.id;
  controller.editActiveArea("question", "created once");
  scheduler.advance(1_500);
  await nextEventLoopTurn();
  controller.editActiveArea("question", "recreate this latest text");
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  assert.deepEqual(requests.map(({ init }) => init.method), ["POST", "PATCH", "POST"]);
  assert.equal(
    (JSON.parse(String(requests[2]!.init.body)) as { id: string }).id,
    originalId,
  );
  assert.equal(
    (JSON.parse(String(requests[2]!.init.body)) as { areas: { question: string } })
      .areas.question,
    "recreate this latest text",
  );
  assert.equal(controller.getState().active.revision, 0);
});

test("CONFLICT_ID_COLLISION rotates only the reservation then retries PATCH once on the same trigger", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      requests.push({ url, init });
      if (requests.length === 1) return acceptedResponse(url, init, 0);
      if (requests.length === 2) {
        return errorResponse(409, "CONFLICT_ID_COLLISION");
      }
      return acceptedResponse(url, init, 1);
    },
  });

  const originalId = controller.getState().active.id;
  const originalReservation = controller.getState().active.conflictRecordId;
  controller.editActiveArea("event", "initial");
  scheduler.advance(1_500);
  await nextEventLoopTurn();
  controller.editActiveArea("event", "collision recovery");
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  const firstPatch = JSON.parse(String(requests[1]!.init.body)) as {
    conflictRecordId: string;
  };
  const retryPatch = JSON.parse(String(requests[2]!.init.body)) as {
    conflictRecordId: string;
  };
  assert.deepEqual(requests.map(({ init }) => init.method), ["POST", "PATCH", "PATCH"]);
  assert.equal(controller.getState().active.id, originalId);
  assert.equal(firstPatch.conflictRecordId, originalReservation);
  assert.notEqual(retryPatch.conflictRecordId, originalReservation);
  assert.equal(controller.getState().active.revision, 1);
});

test("RECORD_LOCKED clears after the forked replacement is acknowledged and exposes later active validation", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      requests.push({ url, init });
      if (requests.length === 1) return acceptedResponse(url, init, 0);
      if (requests.length === 2) {
        return errorResponse(409, "RECORD_LOCKED", {
          ...responseRecord(url, init, 1, "idle"),
          deliveryState: "delivered",
        });
      }
      return acceptedResponse(url, init, 0);
    },
  });

  const deliveredId = controller.getState().active.id;
  controller.editActiveArea("insight", "original");
  scheduler.advance(1_500);
  await nextEventLoopTurn();
  controller.editActiveArea("insight", "preserve as new record");
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  const replacementBody = JSON.parse(String(requests[2]!.init.body)) as {
    id: string;
    areas: { insight: string };
  };
  assert.deepEqual(requests.map(({ init }) => init.method), ["POST", "PATCH", "POST"]);
  assert.notEqual(replacementBody.id, deliveredId);
  assert.equal(replacementBody.areas.insight, "preserve as new record");
  assert.equal(controller.getState().active.id, replacementBody.id);
  assert.equal(controller.getState().active.revision, 0);
  assert.equal(
    observableStatus(controller)?.issues.some(
      (issue) => issue.code === "RECORD_LOCKED",
    ),
    false,
  );

  controller.editActiveArea("insight", "x".repeat(5_001));
  assert.deepEqual(
    observableStatus(controller)?.issues.map((issue) => issue.code),
    ["CONTENT_TOO_LONG"],
  );
});

test("a replacement acknowledgement clears its lock notice without masking a storage failure", async () => {
  let failWrites = false;
  let requestCount = 0;
  const scheduler = new FakeScheduler();
  const storage = new MemoryStorage();
  const controller = createJournalSyncController({
    storage: {
      getItem: storage.getItem.bind(storage),
      setItem(key, value) {
        if (failWrites) throw new DOMException("quota", "QuotaExceededError");
        storage.setItem(key, value);
      },
    },
    request: async (url, init) => {
      requestCount += 1;
      if (requestCount === 1) return acceptedResponse(url, init, 0);
      if (requestCount === 2) {
        failWrites = true;
        return errorResponse(409, "RECORD_LOCKED", {
          ...responseRecord(url, init, 1),
          deliveryState: "delivered",
        });
      }
      return acceptedResponse(url, init, 0);
    },
    now: () => new Date("2026-08-18T01:00:00.000Z"),
    idFactory: idFactory(),
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  controller.editActiveArea("question", "initial");
  scheduler.advance(1_500);
  await nextEventLoopTurn();
  controller.editActiveArea("question", "fork after delivery");
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  assert.equal(controller.getState().active.revision, 0);
  assert.equal(observableStatus(controller)?.durability, "memory-only");
  assert.deepEqual(
    observableStatus(controller)?.issues.map((issue) => issue.code),
    ["STORAGE_WRITE_FAILED"],
  );
});

test("an accepted conflict applies the conflict id and rotates its next reservation", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      requests.push({ url, init });
      if (requests.length === 1) return acceptedResponse(url, init, 0);

      const body = JSON.parse(String(init.body)) as { conflictRecordId: string };
      const sourceId = decodeURIComponent(url.split("/").at(-1)!);
      const conflictRecord = {
        ...responseRecord(url, init, 0, "active"),
        id: body.conflictRecordId,
        conflictOf: sourceId,
      };
      const current = {
        ...responseRecord(url, init, 1, "active"),
        areas: { ...emptyJournalAreas(), insight: "other device won" },
      };
      return Response.json({ kind: "conflict", record: conflictRecord, current });
    },
  });

  const sourceId = controller.getState().active.id;
  const conflictId = controller.getState().active.conflictRecordId;
  controller.editActiveArea("insight", "source");
  scheduler.advance(1_500);
  await nextEventLoopTurn();
  controller.editActiveArea("insight", "stale local edit");
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  assert.notEqual(conflictId, sourceId);
  assert.equal(controller.getState().active.id, conflictId);
  assert.equal(controller.getState().active.revision, 0);
  assert.equal(controller.getState().active.areas.insight, "stale local edit");
  assert.notEqual(controller.getState().active.conflictRecordId, conflictId);
  assert.notEqual(controller.getState().active.conflictRecordId, sourceId);
});

test("a delivered updated acknowledgement cannot remove pending local work", async () => {
  let patchAttempt = 0;
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      if (init.method === "POST") return acceptedResponse(url, init, 0);
      patchAttempt += 1;
      const updated = responseRecord(url, init, 1, "idle");
      return Response.json({
        kind: "updated",
        record:
          patchAttempt === 1
            ? { ...updated, deliveryState: "delivered" }
            : updated,
      });
    },
  });

  controller.editActiveArea("event", "keep queued until valid acknowledgement");
  scheduler.advance(1_500);
  await nextEventLoopTurn();
  const pendingId = controller.getState().active.id;
  assert.equal(controller.finishActiveAndStartNew(), true);
  await nextEventLoopTurn();

  assert.equal(patchAttempt, 1);
  assert.equal(controller.getState().pending.length, 1);
  assert.equal(controller.getState().pending[0]!.id, pendingId);
  assert.equal(controller.getState().pending[0]!.revision, 0);

  await controller.retryPending();
  assert.equal(patchAttempt, 2);
  assert.equal(controller.getState().pending.length, 0);
});

test("a delivered conflict copy cannot replace the active local draft", async () => {
  let patchAttempt = 0;
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      if (init.method === "POST") return acceptedResponse(url, init, 0);
      patchAttempt += 1;
      const body = JSON.parse(String(init.body)) as { conflictRecordId: string };
      const sourceId = decodeURIComponent(url.split("/").at(-1)!);
      const conflict = {
        ...responseRecord(url, init, 0),
        id: body.conflictRecordId,
        conflictOf: sourceId,
        deliveryState: patchAttempt === 1 ? "delivered" as const : "undelivered" as const,
      };
      const current = {
        ...responseRecord(url, init, 1),
        areas: { ...emptyJournalAreas(), insight: "newer server text" },
      };
      return Response.json({ kind: "conflict", record: conflict, current });
    },
  });

  controller.editActiveArea("insight", "initial");
  scheduler.advance(1_500);
  await nextEventLoopTurn();
  const sourceId = controller.getState().active.id;
  controller.editActiveArea("insight", "stale local edit");
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  assert.equal(patchAttempt, 1);
  assert.equal(controller.getState().active.id, sourceId);
  assert.equal(controller.getState().active.revision, 0);
  assert.equal(controller.getState().active.areas.insight, "stale local edit");

  await controller.retryPending();
  assert.equal(patchAttempt, 2);
  assert.notEqual(controller.getState().active.id, sourceId);
  assert.equal(controller.getState().active.areas.insight, "stale local edit");
});

test("conflict current must be the newer undelivered source while allowing concurrent device and area changes", async () => {
  let patchAttempt = 0;
  const unrelatedId = idFactory(80)();
  const concurrentDeviceId = idFactory(81)();
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      if (init.method === "POST") return acceptedResponse(url, init, 0);
      const attempt = patchAttempt;
      patchAttempt += 1;
      const body = JSON.parse(String(init.body)) as { conflictRecordId: string };
      const sourceId = decodeURIComponent(url.split("/").at(-1)!);
      const conflict = {
        ...responseRecord(url, init, 0),
        id: body.conflictRecordId,
        conflictOf: sourceId,
      };
      const validCurrent = {
        ...responseRecord(url, init, 1),
        deviceId: concurrentDeviceId,
        areas: { ...emptyJournalAreas(), question: "concurrent server text" },
      };
      const currentVariants: unknown[] = [
        {},
        { ...validCurrent, id: unrelatedId },
        { ...validCurrent, journalDate: "2026-08-17" },
        { ...validCurrent, deliveryState: "delivered" },
        { ...validCurrent, revision: 0 },
        validCurrent,
      ];
      return Response.json({
        kind: "conflict",
        record: conflict,
        current: currentVariants[attempt],
      });
    },
  });

  controller.editActiveArea("question", "initial");
  scheduler.advance(1_500);
  await nextEventLoopTurn();
  const sourceId = controller.getState().active.id;
  controller.editActiveArea("question", "preserve stale local text");
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  for (let expectedAttempt = 1; expectedAttempt <= 5; expectedAttempt += 1) {
    assert.equal(patchAttempt, expectedAttempt);
    assert.equal(controller.getState().active.id, sourceId);
    assert.equal(controller.getState().active.revision, 0);
    assert.equal(
      controller.getState().active.areas.question,
      "preserve stale local text",
    );
    await controller.retryPending();
  }

  assert.equal(patchAttempt, 6);
  assert.notEqual(controller.getState().active.id, sourceId);
  assert.equal(
    controller.getState().active.areas.question,
    "preserve stale local text",
  );
});

test("mismatched PATCH ids revisions and areas retain local state until a later valid acknowledgement", async () => {
  let patchAttempt = 0;
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      if (init.method === "POST") return acceptedResponse(url, init, 0);
      patchAttempt += 1;
      const valid = responseRecord(url, init, 1, "active");
      if (patchAttempt === 1) {
        return Response.json({ kind: "updated", record: { ...valid, id: idFactory(90)() } });
      }
      if (patchAttempt === 2) {
        return Response.json({ kind: "updated", record: { ...valid, revision: 9 } });
      }
      if (patchAttempt === 3) {
        return Response.json({
          kind: "updated",
          record: { ...valid, areas: { ...valid.areas, feeling: "wrong" } },
        });
      }
      return Response.json({ kind: "updated", record: valid });
    },
  });

  controller.editActiveArea("feeling", "initial");
  scheduler.advance(1_500);
  await nextEventLoopTurn();
  controller.editActiveArea("feeling", "must remain local");
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  for (let expectedAttempt = 1; expectedAttempt <= 3; expectedAttempt += 1) {
    assert.equal(patchAttempt, expectedAttempt);
    assert.equal(controller.getState().active.revision, 0);
    assert.equal(controller.getState().active.areas.feeling, "must remain local");
    await controller.retryPending();
  }

  assert.equal(patchAttempt, 4);
  assert.equal(controller.getState().active.revision, 1);
  assert.equal(controller.getState().active.areas.feeling, "must remain local");
});

test("clearing an acknowledged active draft DELETEs Cloud then opens a fresh blank identity", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      requests.push({ url, init });
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      return acceptedResponse(url, init, 0);
    },
  });

  controller.editActiveArea("event", "save then clear");
  scheduler.advance(1_500);
  await nextEventLoopTurn();
  const deletedId = controller.getState().active.id;
  controller.editActiveArea("event", "");
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  assert.deepEqual(requests.map(({ init }) => init.method), ["POST", "DELETE"]);
  assert.equal(requests[1]!.url, `/api/journal-records/${deletedId}`);
  assert.deepEqual(JSON.parse(String(requests[1]!.init.body)), {
    expectedRevision: 0,
  });
  assert.notEqual(controller.getState().active.id, deletedId);
  assert.equal(controller.getState().active.revision, null);
  assert.deepEqual(controller.getState().active.areas, emptyJournalAreas());
});

test("typing while DELETE is in flight preserves the new text under fresh identity then POSTs it", async () => {
  let resolveDelete!: (response: Response) => void;
  const deleteResponse = new Promise<Response>((resolve) => {
    resolveDelete = resolve;
  });
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      requests.push({ url, init });
      if (init.method === "DELETE") return deleteResponse;
      return acceptedResponse(url, init, init.method === "POST" ? 0 : 1);
    },
  });

  controller.editActiveArea("insight", "old Cloud text");
  scheduler.advance(1_500);
  await nextEventLoopTurn();
  const deletedId = controller.getState().active.id;
  controller.editActiveArea("insight", "");
  scheduler.advance(1_500);
  controller.editActiveArea("insight", "typed during delete");
  scheduler.advance(1_500);
  resolveDelete(new Response(null, { status: 204 }));
  await nextEventLoopTurn();

  assert.deepEqual(requests.map(({ init }) => init.method), ["POST", "DELETE", "POST"]);
  const recreated = JSON.parse(String(requests[2]!.init.body)) as {
    id: string;
    areas: { insight: string };
  };
  assert.notEqual(recreated.id, deletedId);
  assert.equal(recreated.areas.insight, "typed during delete");
  assert.equal(controller.getState().active.id, recreated.id);
  assert.equal(controller.getState().active.revision, 0);
  assert.equal(controller.getState().active.areas.insight, "typed during delete");
});

test("a locked DELETE preserves delivered Cloud state and opens a fresh local blank with an issue", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      requests.push({ url, init });
      if (init.method === "DELETE") {
        return errorResponse(409, "RECORD_LOCKED");
      }
      return acceptedResponse(url, init, 0);
    },
  });

  controller.editActiveArea("feeling", "delivered elsewhere");
  scheduler.advance(1_500);
  await nextEventLoopTurn();
  const deliveredId = controller.getState().active.id;
  controller.editActiveArea("feeling", "");
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  assert.deepEqual(requests.map(({ init }) => init.method), ["POST", "DELETE"]);
  assert.equal(requests[1]!.url, `/api/journal-records/${deliveredId}`);
  assert.notEqual(controller.getState().active.id, deliveredId);
  assert.equal(controller.getState().active.revision, null);
  assert.deepEqual(controller.getState().active.areas, emptyJournalAreas());
  assert.equal(observableStatus(controller)?.issues[0]?.code, "RECORD_LOCKED");
});

test("a stale DELETE preserves the empty clear intent and newer Cloud revision until a later edit conflicts safely", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  let created!: JournalRecord;
  let newerCloud!: JournalRecord;
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      requests.push({ url, init });
      if (init.method === "POST") {
        created = responseRecord(url, init, 0);
        return Response.json({ record: created }, { status: 201 });
      }
      if (init.method === "DELETE") {
        newerCloud = {
          ...created,
          revision: 1,
          areas: { ...emptyJournalAreas(), event: "newer server text" },
          updatedAt: "2026-08-18T00:01:00.000Z",
        };
        return errorResponse(409, "REVISION_CONFLICT", newerCloud);
      }

      const body = JSON.parse(String(init.body)) as {
        conflictRecordId: string;
      };
      return Response.json({
        kind: "conflict",
        record: {
          ...responseRecord(url, init, 0),
          id: body.conflictRecordId,
          conflictOf: created.id,
        },
        current: newerCloud,
      });
    },
  });

  controller.editActiveArea("event", "original local text");
  scheduler.advance(1_500);
  await nextEventLoopTurn();
  const sourceId = controller.getState().active.id;
  controller.editActiveArea("event", "");
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  assert.deepEqual(requests.map(({ init }) => init.method), ["POST", "DELETE"]);
  assert.deepEqual(JSON.parse(String(requests[1]!.init.body)), {
    expectedRevision: 0,
  });
  assert.equal(controller.getState().active.id, sourceId);
  assert.equal(controller.getState().active.revision, 0);
  assert.deepEqual(controller.getState().active.areas, emptyJournalAreas());
  assert.equal(observableStatus(controller)?.issues[0]?.code, "DELETE_CONFLICT");
  await nextEventLoopTurn();
  assert.equal(requests.length, 2);
  assert.equal(newerCloud.areas.event, "newer server text");

  controller.editActiveArea("event", "preserve this after conflict");
  assert.equal(
    observableStatus(controller)?.issues.some(
      (issue) => issue.code === "DELETE_CONFLICT",
    ),
    false,
  );
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  assert.deepEqual(requests.map(({ init }) => init.method), ["POST", "DELETE", "PATCH"]);
  const patchBody = JSON.parse(String(requests[2]!.init.body)) as {
    expectedRevision: number;
    areas: { event: string };
  };
  assert.equal(patchBody.expectedRevision, 0);
  assert.equal(patchBody.areas.event, "preserve this after conflict");
  assert.equal(controller.getState().active.areas.event, "preserve this after conflict");
  assert.notEqual(controller.getState().active.id, sourceId);
  assert.equal(newerCloud.areas.event, "newer server text");
});

test("a lost DELETE response retries the same revision and accepts idempotent missing success", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const { controller, scheduler } = makeController({
    request: async (url, init) => {
      requests.push({ url, init });
      if (init.method === "POST") return acceptedResponse(url, init, 0);
      if (requests.length === 2) throw new TypeError("response lost after delete");
      return new Response(null, { status: 204 });
    },
  });

  controller.editActiveArea("feeling", "delete then lose response");
  scheduler.advance(1_500);
  await nextEventLoopTurn();
  const deletedId = controller.getState().active.id;
  controller.editActiveArea("feeling", "");
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  assert.equal(requests.length, 2);
  assert.equal(controller.getState().active.id, deletedId);
  assert.equal(controller.getState().active.revision, 0);

  await controller.retryPending();

  assert.deepEqual(requests.map(({ init }) => init.method), ["POST", "DELETE", "DELETE"]);
  assert.deepEqual(JSON.parse(String(requests[1]!.init.body)), {
    expectedRevision: 0,
  });
  assert.deepEqual(JSON.parse(String(requests[2]!.init.body)), {
    expectedRevision: 0,
  });
  assert.notEqual(controller.getState().active.id, deletedId);
  assert.equal(controller.getState().active.revision, null);
});

test("storage read denial never crashes or writes unknown storage and still syncs in-memory edits", async () => {
  let writeAttempts = 0;
  let requestCount = 0;
  let notifications = 0;
  const scheduler = new FakeScheduler();
  let controller!: ReturnType<typeof createJournalSyncController>;

  assert.doesNotThrow(() => {
    controller = createJournalSyncController({
      storage: {
        getItem() {
          throw new DOMException("denied", "SecurityError");
        },
        setItem() {
          writeAttempts += 1;
        },
      },
      request: async (url, init) => {
        requestCount += 1;
        return acceptedResponse(url, init, 0);
      },
      now: () => new Date("2026-08-18T01:00:00.000Z"),
      idFactory: idFactory(),
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });
  });
  controller.subscribe(() => {
    notifications += 1;
  });

  controller.editActiveArea("event", "memory and Cloud remain available");
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  assert.equal(writeAttempts, 0);
  assert.equal(requestCount, 1);
  assert.equal(controller.getState().active.revision, 0);
  assert.equal(controller.getState().active.areas.event, "memory and Cloud remain available");
  assert.ok(notifications >= 2);
  assert.equal(observableStatus(controller)?.durability, "read-denied");
  assert.equal(observableStatus(controller)?.issues[0]?.code, "STORAGE_READ_FAILED");
});

test("an initial write denial reports memory-only then a later successful edit write restores durable status", () => {
  let writeAttempt = 0;
  let stored: string | null = null;
  let controller!: ReturnType<typeof createJournalSyncController>;

  assert.doesNotThrow(() => {
    controller = createJournalSyncController({
      storage: {
        getItem() {
          return null;
        },
        setItem(_key, value) {
          writeAttempt += 1;
          if (writeAttempt === 1) {
            throw new DOMException("quota", "QuotaExceededError");
          }
          stored = value;
        },
      },
      request: async (url, init) => acceptedResponse(url, init, 0),
      now: () => new Date("2026-08-18T01:00:00.000Z"),
      idFactory: idFactory(),
    });
  });

  assert.equal(observableStatus(controller)?.durability, "memory-only");
  assert.equal(observableStatus(controller)?.issues[0]?.code, "STORAGE_WRITE_FAILED");

  controller.editActiveArea("question", "second write succeeds");

  assert.equal(observableStatus(controller)?.durability, "durable");
  assert.deepEqual(observableStatus(controller)?.issues, []);
  assert.equal((JSON.parse(stored!) as JournalLocalState).active.areas.question, "second write succeeds");
});

test("an edit quota failure retains memory state notifies React and continues Cloud sync without false durability", async () => {
  let failWrites = false;
  let notifications = 0;
  let requestCount = 0;
  const scheduler = new FakeScheduler();
  const storage = new MemoryStorage();
  const controller = createJournalSyncController({
    storage: {
      getItem: storage.getItem.bind(storage),
      setItem(key, value) {
        if (failWrites) {
          throw new DOMException("quota", "QuotaExceededError");
        }
        storage.setItem(key, value);
      },
    },
    request: async (url, init) => {
      requestCount += 1;
      return acceptedResponse(url, init, 0);
    },
    now: () => new Date("2026-08-18T01:00:00.000Z"),
    idFactory: idFactory(),
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });
  controller.subscribe(() => {
    notifications += 1;
  });
  failWrites = true;

  assert.doesNotThrow(() => {
    controller.editActiveArea("feeling", "retain me in memory");
  });
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  assert.equal(controller.getState().active.areas.feeling, "retain me in memory");
  assert.equal(controller.getState().active.revision, 0);
  assert.equal(requestCount, 1);
  assert.ok(notifications >= 2);
  assert.equal(observableStatus(controller)?.durability, "memory-only");
  assert.equal(observableStatus(controller)?.issues[0]?.code, "STORAGE_WRITE_FAILED");
});

test("an acknowledgement storage failure keeps the acknowledged revision in memory and reports write failure", async () => {
  let writeAttempt = 0;
  let notifications = 0;
  const scheduler = new FakeScheduler();
  const controller = createJournalSyncController({
    storage: {
      getItem() {
        return null;
      },
      setItem() {
        writeAttempt += 1;
        if (writeAttempt === 3) {
          throw new DOMException("quota", "QuotaExceededError");
        }
      },
    },
    request: async (url, init) => acceptedResponse(url, init, 0),
    now: () => new Date("2026-08-18T01:00:00.000Z"),
    idFactory: idFactory(),
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });
  controller.subscribe(() => {
    notifications += 1;
  });

  controller.editActiveArea("next", "acknowledge this");
  assert.equal(observableStatus(controller)?.durability, "durable");
  scheduler.advance(1_500);
  await nextEventLoopTurn();

  assert.equal(controller.getState().active.revision, 0);
  assert.equal(controller.getState().active.areas.next, "acknowledge this");
  assert.ok(notifications >= 2);
  assert.equal(observableStatus(controller)?.durability, "memory-only");
  assert.equal(observableStatus(controller)?.issues[0]?.code, "STORAGE_WRITE_FAILED");
});
