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
