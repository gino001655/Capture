export const RECORDER_CATALOG = [
  { id: "journal", order: 0, label: "Journal", symbol: "○", kind: "core" },
  { id: "english", order: 10, label: "英文", symbol: "Aa", kind: "special" },
  { id: "workout", order: 20, label: "重訓", symbol: "↟", kind: "special" },
  { id: "food", order: 30, label: "飲食", symbol: "◫", kind: "special" },
] as const;

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
