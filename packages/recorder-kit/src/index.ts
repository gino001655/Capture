export const RECORDER_CATALOG = [
  { id: "journal", order: 0, label: "Journal", symbol: "○", kind: "core" },
  { id: "english", order: 10, label: "英文", symbol: "Aa", kind: "special" },
  { id: "workout", order: 20, label: "重訓", symbol: "↟", kind: "special" },
  { id: "food", order: 30, label: "飲食", symbol: "◫", kind: "special" },
  // recorder-catalog-entry
] as const;

export type RecorderManifest = {
  id: string;
  order: number;
  label: string;
  symbol: string;
  kind: "core" | "special";
};

export function validateRecorderCatalog(catalog: readonly RecorderManifest[]): void {
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const recorder of catalog) {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(recorder.id)) {
      throw new Error(`Recorder id must be lowercase kebab-case: ${recorder.id}`);
    }
    if (ids.has(recorder.id)) throw new Error(`Duplicate id in recorder catalog: ${recorder.id}`);
    if (!Number.isSafeInteger(recorder.order) || recorder.order < 0) {
      throw new Error(`Recorder order must be a non-negative integer: ${recorder.order}`);
    }
    if (orders.has(recorder.order)) throw new Error(`Duplicate order in recorder catalog: ${recorder.order}`);
    if (!recorder.label.trim()) throw new Error(`Recorder label is required: ${recorder.id}`);
    if (Array.from(recorder.symbol).length < 1 || Array.from(recorder.symbol).length > 4) {
      throw new Error(`Recorder symbol must contain 1 to 4 characters: ${recorder.id}`);
    }
    ids.add(recorder.id);
    orders.add(recorder.order);
  }
}

validateRecorderCatalog(RECORDER_CATALOG);

export type RecorderDefinition = (typeof RECORDER_CATALOG)[number];
export type RecorderId = RecorderDefinition["id"];
export type SpecialRecorderId = Exclude<RecorderId, "journal">;

export function recorderDefinition(id: RecorderId): RecorderDefinition {
  const definition = RECORDER_CATALOG.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    throw new RangeError(`Unknown recorder: ${id}`);
  }
  return definition;
}

type TimerHandle = unknown;

type DateBoundDebounceOptions = {
  delayMs: number;
  schedule(callback: () => void, delayMs: number): TimerHandle;
  cancel(handle: TimerHandle): void;
};

export function createDateBoundDebounce<T>(options: DateBoundDebounceOptions) {
  let handle: TimerHandle | null = null;

  return {
    queue(
      date: string,
      candidate: T,
      save: (date: string, candidate: T) => Promise<void> | void,
    ) {
      if (handle !== null) options.cancel(handle);
      const snapshot = structuredClone(candidate);
      handle = options.schedule(() => {
        handle = null;
        void save(date, snapshot);
      }, options.delayMs);
    },
    cancel() {
      if (handle === null) return;
      options.cancel(handle);
      handle = null;
    },
  };
}

export function clampRecorderDate(candidate: string, today: string): string {
  return candidate > today ? today : candidate;
}

export function nextRecorderToday(currentToday: string, observedToday: string): string | null {
  return observedToday > currentToday ? observedToday : null;
}

export function rebaseConflictCandidate<
  T extends { revision: number | null; pending: boolean },
>(candidate: T, cloudRevision: number | null): T {
  return {
    ...structuredClone(candidate),
    revision: cloudRevision,
    pending: true,
  };
}

export function resolveVersionedPayloadConflict<P>(
  localPayload: P,
  cloudRecord: { payload: P; revision: number } | null,
  choice: "cloud" | "local",
  emptyPayload: P,
): { payload: P; revision: number | null; retry: boolean } {
  if (choice === "local") {
    return {
      payload: structuredClone(localPayload),
      revision: cloudRecord?.revision ?? null,
      retry: true,
    };
  }
  return {
    payload: structuredClone(cloudRecord?.payload ?? emptyPayload),
    revision: cloudRecord?.revision ?? null,
    retry: false,
  };
}
