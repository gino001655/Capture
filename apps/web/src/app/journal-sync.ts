import {
  hasJournalContent,
  isValidUuid,
  JOURNAL_AREA_KEYS,
  validateJournalCreateRequest,
  type JournalAreaKey,
  type JournalRecord,
} from "../lib/journal-record.ts";
import { MAX_CAPTURE_LENGTH } from "../lib/capture.ts";
import {
  applyServerRecord,
  AUTOSAVE_DELAY_MS,
  decideForegroundAction,
  editActiveArea,
  finishActive,
  JOURNAL_LOCAL_STORAGE_KEY,
  markBackgrounded,
  readLocalState,
  rebaseDraftForCreate,
  rotateConflictReservation,
  forkLockedDraft,
  type JournalLocalState,
  type LocalJournalDraft,
} from "./journal-session.ts";

export type JournalAreaField = {
  key: JournalAreaKey;
  symbol: string;
  ariaLabel: string;
  value: string;
};

const AREA_SYMBOLS: Record<JournalAreaKey, string> = {
  unclassified: "○",
  event: "*",
  question: "?",
  insight: "!",
  next: "+",
  feeling: "~",
};

const AREA_ARIA_LABELS: Record<JournalAreaKey, string> = {
  unclassified: "Unclassified",
  event: "Event",
  question: "Question",
  insight: "Insight",
  next: "Next",
  feeling: "Feeling",
};

export function getJournalAreaFields(
  areas: LocalJournalDraft["areas"],
): JournalAreaField[] {
  return JOURNAL_AREA_KEYS.map((key) => ({
    key,
    symbol: AREA_SYMBOLS[key],
    ariaLabel: AREA_ARIA_LABELS[key],
    value: areas[key],
  }));
}

export type JournalSyncControllerOptions = {
  storage: Pick<Storage, "getItem" | "setItem">;
  request: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => Date;
  idFactory?: () => string;
  schedule?: (callback: () => void, delay: number) => unknown;
  cancel?: (handle: unknown) => void;
};

export type JournalSyncController = {
  getState(): JournalLocalState;
  getStatus(): JournalSyncStatus;
  subscribe(listener: () => void): () => void;
  editActiveArea(key: JournalAreaKey, value: string): void;
  finishActiveAndStartNew(): boolean;
  markHidden(): void;
  resumeVisible(): boolean;
  start(): Promise<void>;
  retryPending(): Promise<void>;
  dispose(): void;
};

export type JournalSyncIssueCode =
  | "CONTENT_TOO_LONG"
  | "INVALID_JOURNAL_RECORD"
  | "UNAUTHORIZED"
  | "AUTH_NOT_CONFIGURED"
  | "RECORD_LOCKED";

export type JournalSyncIssue = {
  code: JournalSyncIssueCode;
  message: string;
  localId?: string;
};

export type JournalSyncStatus = {
  durability: "durable";
  issues: readonly JournalSyncIssue[];
};

type MutationTarget = {
  draft: LocalJournalDraft;
  activeVersion: number | null;
};

type MutationOutcome =
  | { kind: "acknowledged"; record: JournalRecord }
  | { kind: "invalid"; code: "INVALID_JOURNAL_RECORD" }
  | { kind: "auth"; code: "UNAUTHORIZED" | "AUTH_NOT_CONFIGURED" }
  | { kind: "not-found" }
  | { kind: "conflict-id-collision" }
  | { kind: "record-locked" }
  | { kind: "transient" }
  | { kind: "malformed" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJournalRecord(value: unknown): value is JournalRecord {
  const creation = validateJournalCreateRequest(value);
  if (!creation.success || !isPlainObject(value)) return false;

  return (
    (value.deliveryState === "undelivered" || value.deliveryState === "delivered") &&
    (value.editingState === "active" || value.editingState === "idle") &&
    typeof value.revision === "number" &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    (value.conflictOf === undefined || isValidUuid(value.conflictOf))
  );
}

function hasSameAreas(
  left: LocalJournalDraft["areas"],
  right: JournalRecord["areas"],
): boolean {
  return JOURNAL_AREA_KEYS.every((key) => left[key] === right[key]);
}

function hasExcessContent(areas: LocalJournalDraft["areas"]): boolean {
  return (
    JOURNAL_AREA_KEYS.reduce((total, key) => total + areas[key].length, 0) >
    MAX_CAPTURE_LENGTH
  );
}

function hasSameMutableFields(
  draft: LocalJournalDraft,
  record: JournalRecord,
): boolean {
  return (
    draft.deviceId === record.deviceId &&
    draft.journalDate === record.journalDate &&
    draft.editingState === record.editingState &&
    hasSameAreas(draft.areas, record.areas)
  );
}

function isAcceptedRecordForTarget(
  record: JournalRecord,
  target: LocalJournalDraft,
  kind: "created" | "updated" | "conflict",
): boolean {
  if (
    record.deviceId !== target.deviceId ||
    record.journalDate !== target.journalDate
  ) {
    return false;
  }

  if (kind === "created") {
    return (
      record.id === target.id &&
      record.deliveryState === "undelivered" &&
      record.editingState === "active"
    );
  }

  if (kind === "updated") {
    return (
      target.revision !== null &&
      record.id === target.id &&
      record.editingState === target.editingState &&
      record.revision === target.revision + 1 &&
      hasSameAreas(record.areas, target.areas)
    );
  }

  return (
    record.id === target.conflictRecordId &&
    record.conflictOf === target.id &&
    record.editingState === target.editingState &&
    record.revision === 0 &&
    hasSameAreas(record.areas, target.areas)
  );
}

function readErrorCode(payload: unknown): string | undefined {
  if (!isPlainObject(payload) || !isPlainObject(payload.error)) return undefined;
  return typeof payload.error.code === "string" ? payload.error.code : undefined;
}

async function readMutationOutcome(
  response: Response,
  target: LocalJournalDraft,
): Promise<MutationOutcome> {
  const method = target.revision === null ? "POST" : "PATCH";

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return response.status >= 500
      ? { kind: "transient" }
      : { kind: "malformed" };
  }

  const expectedStatus =
    (method === "POST" && response.status === 201) ||
    (method === "PATCH" && response.status === 200);
  if (!expectedStatus) {
    const code = readErrorCode(payload);
    if (response.status === 400) {
      return { kind: "invalid", code: "INVALID_JOURNAL_RECORD" };
    }
    if (response.status === 401) {
      return { kind: "auth", code: "UNAUTHORIZED" };
    }
    if (response.status === 503 && code === "AUTH_NOT_CONFIGURED") {
      return { kind: "auth", code: "AUTH_NOT_CONFIGURED" };
    }
    if (response.status === 404 && method === "PATCH") {
      return { kind: "not-found" };
    }
    if (response.status === 409 && code === "CONFLICT_ID_COLLISION") {
      return { kind: "conflict-id-collision" };
    }
    if (response.status === 409 && code === "RECORD_LOCKED") {
      return { kind: "record-locked" };
    }
    return response.status >= 500
      ? { kind: "transient" }
      : { kind: "malformed" };
  }

  if (!isPlainObject(payload) || !isJournalRecord(payload.record)) {
    return { kind: "malformed" };
  }

  if (method === "POST") {
    return isAcceptedRecordForTarget(payload.record, target, "created")
      ? { kind: "acknowledged", record: payload.record }
      : { kind: "malformed" };
  }

  if (payload.kind === "updated") {
    return isAcceptedRecordForTarget(payload.record, target, "updated")
      ? { kind: "acknowledged", record: payload.record }
      : { kind: "malformed" };
  }

  if (
    payload.kind === "conflict" &&
    isJournalRecord(payload.current) &&
    isAcceptedRecordForTarget(payload.record, target, "conflict")
  ) {
    return { kind: "acknowledged", record: payload.record };
  }

  return { kind: "malformed" };
}

export function createJournalSyncController(
  options: JournalSyncControllerOptions,
): JournalSyncController {
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const schedule =
    options.schedule ??
    ((callback: () => void, delay: number) => setTimeout(callback, delay));
  const cancel =
    options.cancel ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const abortController = new AbortController();
  const listeners = new Set<() => void>();

  let state = readLocalState(
    options.storage.getItem(JOURNAL_LOCAL_STORAGE_KEY),
    now(),
    idFactory,
  );
  if (hasJournalContent(state.active.areas)) {
    state = finishActive(state, now(), idFactory);
  }
  options.storage.setItem(JOURNAL_LOCAL_STORAGE_KEY, JSON.stringify(state));

  let disposed = false;
  let debounceHandle: unknown = null;
  let activeReady = false;
  let activeVersion = 0;
  let draining: Promise<void> | null = null;
  let rerunRequested = false;
  let status: JournalSyncStatus = { durability: "durable", issues: [] };
  const blockedIds = new Set<string>();

  function notifyListeners(): void {
    for (const listener of listeners) listener();
  }

  function publish(nextState: JournalLocalState): void {
    if (disposed) return;
    state = nextState;
    options.storage.setItem(JOURNAL_LOCAL_STORAGE_KEY, JSON.stringify(state));
    notifyListeners();
  }

  function setIssue(issue: JournalSyncIssue): void {
    const withoutPrevious = status.issues.filter(
      (candidate) =>
        candidate.code !== issue.code || candidate.localId !== issue.localId,
    );
    status = { ...status, issues: [...withoutPrevious, issue] };
    notifyListeners();
  }

  function clearRecordIssues(localId: string): void {
    const nextIssues = status.issues.filter(
      (issue) => issue.localId !== localId || issue.code === "RECORD_LOCKED",
    );
    if (nextIssues.length === status.issues.length) return;
    status = { ...status, issues: nextIssues };
    notifyListeners();
  }

  function clearAuthIssues(): void {
    const nextIssues = status.issues.filter(
      (issue) =>
        issue.code !== "UNAUTHORIZED" && issue.code !== "AUTH_NOT_CONFIGURED",
    );
    if (nextIssues.length === status.issues.length) return;
    status = { ...status, issues: nextIssues };
    notifyListeners();
  }

  function clearDebounce(): void {
    if (debounceHandle === null) return;
    cancel(debounceHandle);
    debounceHandle = null;
  }

  function selectTarget(): MutationTarget | null {
    const pending = state.pending.find((draft) => !blockedIds.has(draft.id));
    if (pending !== undefined) {
      return { draft: pending, activeVersion: null };
    }

    if (
      activeReady &&
      hasJournalContent(state.active.areas) &&
      !blockedIds.has(state.active.id)
    ) {
      return { draft: state.active, activeVersion };
    }

    return null;
  }

  async function sendMutation(target: LocalJournalDraft): Promise<MutationOutcome> {
    const isCreate = target.revision === null;
    const url = isCreate
      ? "/api/journal-records"
      : `/api/journal-records/${encodeURIComponent(target.id)}`;
    const body = isCreate
      ? {
          id: target.id,
          deviceId: target.deviceId,
          journalDate: target.journalDate,
          areas: target.areas,
        }
      : {
          deviceId: target.deviceId,
          journalDate: target.journalDate,
          areas: target.areas,
          editingState: target.editingState,
          expectedRevision: target.revision,
          conflictRecordId: target.conflictRecordId,
        };

    try {
      const response = await options.request(url, {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      if (disposed) return { kind: "transient" };
      return await readMutationOutcome(response, target);
    } catch {
      return { kind: "transient" };
    }
  }

  function findCurrentDraft(localId: string): LocalJournalDraft | undefined {
    if (state.active.id === localId) return state.active;
    return state.pending.find((draft) => draft.id === localId);
  }

  function rebasePendingDraft(
    current: LocalJournalDraft,
    record: JournalRecord,
  ): LocalJournalDraft {
    const projectedState: JournalLocalState = {
      ...state,
      active: current,
      pending: [
        state.active,
        ...state.pending.filter((draft) => draft.id !== current.id),
      ],
    };
    return applyServerRecord(projectedState, current.id, record, idFactory).active;
  }

  function applyAcknowledgement(
    target: MutationTarget,
    record: JournalRecord,
  ): void {
    const current = findCurrentDraft(target.draft.id);
    if (current === undefined) return;

    blockedIds.delete(target.draft.id);
    clearRecordIssues(target.draft.id);

    const pendingIndex = state.pending.findIndex(
      (draft) => draft.id === target.draft.id,
    );
    const shouldRemainPending =
      pendingIndex !== -1 && !hasSameMutableFields(current, record);
    const rebased = shouldRemainPending
      ? rebasePendingDraft(current, record)
      : null;
    let nextState = applyServerRecord(
      state,
      target.draft.id,
      record,
      idFactory,
    );

    if (rebased !== null) {
      const insertionIndex = Math.min(pendingIndex, nextState.pending.length);
      nextState = {
        ...nextState,
        pending: [
          ...nextState.pending.slice(0, insertionIndex),
          rebased,
          ...nextState.pending.slice(insertionIndex),
        ],
      };
    }

    if (target.activeVersion !== null) {
      const isStillActive = current.id === state.active.id;
      if (
        isStillActive &&
        target.activeVersion === activeVersion &&
        hasSameMutableFields(current, record)
      ) {
        activeReady = false;
      }
    }

    publish(nextState);
  }

  async function drainLoop(): Promise<void> {
    clearAuthIssues();
    const collisionRetries = new Set<string>();

    while (!disposed) {
      const target = selectTarget();
      if (target === null) return;

      if (hasExcessContent(target.draft.areas)) {
        blockedIds.add(target.draft.id);
        setIssue({
          code: "CONTENT_TOO_LONG",
          localId: target.draft.id,
          message: `Journal content must be ${MAX_CAPTURE_LENGTH.toLocaleString()} characters or fewer.`,
        });
        continue;
      }

      const outcome = await sendMutation(target.draft);
      if (disposed) return;

      if (outcome.kind === "acknowledged") {
        applyAcknowledgement(target, outcome.record);
        continue;
      }

      if (outcome.kind === "invalid") {
        blockedIds.add(target.draft.id);
        setIssue({
          code: outcome.code,
          localId: target.draft.id,
          message: "This Journal record needs correction before it can sync.",
        });
        continue;
      }

      if (outcome.kind === "auth") {
        setIssue({
          code: outcome.code,
          message: "Journal sync is paused until authentication is available.",
        });
        return;
      }

      if (outcome.kind === "not-found") {
        publish(rebaseDraftForCreate(state, target.draft.id));
        continue;
      }

      if (outcome.kind === "conflict-id-collision") {
        publish(rotateConflictReservation(state, target.draft.id, idFactory));
        if (collisionRetries.has(target.draft.id)) return;
        collisionRetries.add(target.draft.id);
        continue;
      }

      if (outcome.kind === "record-locked") {
        const recoveredState = forkLockedDraft(
          state,
          target.draft.id,
          idFactory,
        );
        blockedIds.delete(target.draft.id);
        publish(recoveredState);
        setIssue({
          code: "RECORD_LOCKED",
          localId: target.draft.id,
          message: "The delivered Cloud record is locked; the local edit was preserved as a new record.",
        });
        continue;
      }

      return;
    }
  }

  function drainQueue(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (draining !== null) {
      rerunRequested = true;
      return draining;
    }

    draining = (async () => {
      do {
        rerunRequested = false;
        await drainLoop();
      } while (!disposed && rerunRequested);
    })().finally(() => {
        draining = null;
      });
    return draining;
  }

  function finishActiveAndStartNew(): boolean {
    if (disposed || !hasJournalContent(state.active.areas)) return false;
    if (hasExcessContent(state.active.areas)) {
      blockedIds.add(state.active.id);
      setIssue({
        code: "CONTENT_TOO_LONG",
        localId: state.active.id,
        message: `Journal content must be ${MAX_CAPTURE_LENGTH.toLocaleString()} characters or fewer.`,
      });
      return false;
    }
    clearDebounce();
    activeReady = false;
    publish(finishActive(state, now(), idFactory));
    void drainQueue();
    return true;
  }

  return {
    getState() {
      return state;
    },
    getStatus() {
      return status;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    editActiveArea(key, value) {
      if (disposed) return;
      activeVersion += 1;
      activeReady = false;
      const localId = state.active.id;
      const nextState = editActiveArea(state, key, value);
      publish(nextState);
      if (hasExcessContent(nextState.active.areas)) {
        blockedIds.add(localId);
        setIssue({
          code: "CONTENT_TOO_LONG",
          localId,
          message: `Journal content must be ${MAX_CAPTURE_LENGTH.toLocaleString()} characters or fewer.`,
        });
      } else {
        blockedIds.delete(localId);
        clearRecordIssues(localId);
      }
      clearDebounce();
      debounceHandle = schedule(() => {
        debounceHandle = null;
        activeReady = true;
        void drainQueue();
      }, AUTOSAVE_DELAY_MS);
    },
    finishActiveAndStartNew,
    markHidden() {
      if (disposed) return;
      publish(markBackgrounded(state, now()));
    },
    resumeVisible() {
      if (
        disposed ||
        decideForegroundAction(state.active, now().getTime()) === "resume"
      ) {
        return false;
      }
      return finishActiveAndStartNew();
    },
    start: drainQueue,
    retryPending: drainQueue,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearDebounce();
      abortController.abort();
      listeners.clear();
    },
  };
}
