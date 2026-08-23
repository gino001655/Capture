import {
  createElement,
  type ChangeEvent,
  type ReactElement,
  type Ref,
} from "react";

import {
  hasJournalContent,
  JOURNAL_AREA_KEYS,
  type JournalAreaKey,
  type JournalAreas,
  type JournalRecord,
} from "../lib/journal-record.ts";
import {
  formatJournalDateLabel,
  textEditDiff,
  type JournalListEntry,
} from "./journal-ui.ts";

const AREA_SYMBOLS: Record<JournalAreaKey, string> = {
  unclassified: "○",
  event: "+",
  question: "?",
  insight: "~",
  next: "!",
  feeling: "*",
};

const AREA_ARIA_LABELS: Record<JournalAreaKey, string> = {
  unclassified: "Unclassified",
  event: "Event",
  question: "Question",
  insight: "Insight",
  next: "Next",
  feeling: "Feeling",
};

function autosizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (textarea === null || textarea.style === undefined) return;
  textarea.style.height = "0px";
  textarea.style.height = `${Math.max(96, textarea.scrollHeight)}px`;
}

function settingsIcon() {
  return createElement(
    "svg",
    { viewBox: "0 0 24 24", width: 19, height: 19, "aria-hidden": true },
    createElement("path", {
      d: "M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M7 14v6",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
    }),
  );
}

export type JournalEditorViewProps = {
  areas: JournalAreas;
  canFinalize: boolean;
  issueMessages: readonly string[];
  onEdit(key: JournalAreaKey, value: string): void;
  onNewRecord(): void;
  unclassifiedRef?: Ref<HTMLTextAreaElement>;
};

export type JournalToolbarProps = {
  date: string;
  mode: "capture" | "list" | "record";
  onOpenSettings(): void;
  onPrevious(): void;
  onDateChange(value: string): void;
  onNext(): void;
  onPrimaryAction(): void;
};

export function JournalToolbar({
  date,
  mode,
  onOpenSettings,
  onPrevious,
  onDateChange,
  onNext,
  onPrimaryAction,
}: JournalToolbarProps): ReactElement {
  const primary = mode === "list"
    ? { label: "新增紀錄", symbol: "+" }
    : mode === "record"
      ? { label: "放棄編輯", symbol: "↶" }
      : { label: "紀錄列表", symbol: "☷" };
  return createElement(
    "nav",
    { className: "journalToolbar", "aria-label": "日誌工具列" },
    createElement(
      "button",
      { type: "button", "aria-label": "設定", onClick: onOpenSettings },
      settingsIcon(),
    ),
    createElement(
      "button",
      { type: "button", "aria-label": "前一天", onClick: onPrevious },
      createElement("span", { "aria-hidden": true }, "‹"),
    ),
    createElement(
      "label",
      { className: "journalDatePicker" },
      createElement("span", { "aria-hidden": true }, formatJournalDateLabel(date)),
      createElement("input", {
        type: "date",
        value: date,
        "aria-label": "選擇日期",
        onChange: (event: ChangeEvent<HTMLInputElement>) =>
          onDateChange(event.currentTarget.value),
      }),
    ),
    createElement(
      "button",
      { type: "button", "aria-label": "後一天", onClick: onNext },
      createElement("span", { "aria-hidden": true }, "›"),
    ),
    createElement(
      "button",
      { type: "button", "aria-label": primary.label, onClick: onPrimaryAction },
      createElement("span", { "aria-hidden": true }, primary.symbol),
    ),
  );
}

export function JournalEditorView({
  areas,
  canFinalize,
  issueMessages,
  onEdit,
  onNewRecord,
  unclassifiedRef,
}: JournalEditorViewProps): ReactElement {
  const fields = JOURNAL_AREA_KEYS.map((key) =>
    createElement(
      "div",
      { className: "journalArea", key },
      createElement("span", { "aria-hidden": true }, AREA_SYMBOLS[key]),
      createElement("textarea", {
        ref: (node: HTMLTextAreaElement | null) => {
          autosizeTextarea(node);
          if (key === "unclassified" && typeof unclassifiedRef === "function") {
            unclassifiedRef(node);
          } else if (key === "unclassified" && unclassifiedRef && "current" in unclassifiedRef) {
            unclassifiedRef.current = node;
          }
        },
        "aria-label": AREA_ARIA_LABELS[key],
        value: areas[key],
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
          onEdit(key, event.currentTarget.value);
          autosizeTextarea(event.currentTarget);
        },
      }),
    ),
  );
  const issues = issueMessages.map((message) =>
    createElement(
      "div",
      { key: message, role: "alert", "aria-label": message },
      createElement("span", { "aria-hidden": true }, "⚠"),
    ),
  );
  const newRecord = hasJournalContent(areas)
    ? createElement(
        "button",
        {
          type: "button",
          "aria-label": "New record",
          disabled: !canFinalize,
          onClick: onNewRecord,
        },
        createElement("span", { "aria-hidden": true }, "＋"),
      )
    : null;
  return createElement(
    "section",
    { className: "journalEditor viewEnter", "aria-label": "Journal editor" },
    ...fields,
    ...issues,
    newRecord,
  );
}

export type JournalRecordListViewProps = {
  records: readonly JournalListEntry[];
  selectedId: string | null;
  onSelect(record: JournalListEntry): void;
};

export function JournalRecordListView({ records, selectedId, onSelect }: JournalRecordListViewProps): ReactElement {
  return createElement(
    "section",
    { className: "journalRecordStream viewEnter", "aria-label": "紀錄列表" },
    ...records.map((record) => {
      const previews = JOURNAL_AREA_KEYS.filter((key) => record.areas[key].trim().length > 0).map((key) =>
        createElement(
          "div",
          { className: "journalPreviewArea", key },
          createElement("span", { "aria-hidden": true }, AREA_SYMBOLS[key]),
          createElement("p", null, record.areas[key]),
        ),
      );
      return createElement(
        "button",
        {
          className: "journalRecordRow",
          type: "button",
          key: record.id,
          "aria-label": record.deliveryState === "delivered" ? "檢視已送出紀錄" : "編輯紀錄",
          "aria-current": record.id === selectedId ? "true" : undefined,
          autoFocus: record.id === selectedId,
          onClick: () => onSelect(record),
        },
        ...previews,
      );
    }),
  );
}

export type JournalRecordEditorViewProps = {
  record: Pick<JournalRecord, "deliveryState">;
  originalAreas?: JournalAreas;
  areas: JournalAreas;
  issueMessages: readonly string[];
  showDeletions?: boolean;
  editCounts?: { added: number; removed: number };
  onEdit(key: JournalAreaKey, value: string): void;
  onBack(): void;
  onToggleDeletions?(): void;
  onTrash?(): void;
};

export function JournalRecordEditorView({
  record,
  areas,
  originalAreas = areas,
  issueMessages,
  showDeletions = false,
  editCounts = { added: 0, removed: 0 },
  onEdit,
  onBack,
  onToggleDeletions = () => undefined,
  onTrash = () => undefined,
}: JournalRecordEditorViewProps): ReactElement {
  const locked = record.deliveryState === "delivered";
  const visibleKeys = locked ? JOURNAL_AREA_KEYS.filter((key) => areas[key].trim().length > 0) : JOURNAL_AREA_KEYS;
  const fields = visibleKeys.map((key) => {
    const diff = textEditDiff(originalAreas[key], areas[key]);
    const changed = Boolean(diff.added || diff.removed);
    return createElement(
      "div",
      { className: "journalArea", key },
      createElement("span", { "aria-hidden": true }, AREA_SYMBOLS[key]),
      createElement(
        "div",
        { className: "diffField" },
        changed
          ? createElement(
              "pre",
              { className: "diffOverlay", "aria-hidden": true },
              createElement("span", null, diff.before),
              diff.added ? createElement("ins", null, diff.added) : null,
              createElement("span", null, diff.after),
            )
          : null,
        createElement("textarea", {
          className: changed ? "diffInput" : undefined,
          ref: autosizeTextarea,
          "aria-label": AREA_ARIA_LABELS[key],
          value: areas[key],
          disabled: locked,
          onChange: locked ? undefined : (event: ChangeEvent<HTMLTextAreaElement>) => {
            onEdit(key, event.currentTarget.value);
            autosizeTextarea(event.currentTarget);
          },
        }),
        showDeletions && diff.removed ? createElement("del", { className: "deletedText" }, diff.removed) : null,
      ),
    );
  });
  const issues = issueMessages.map((message) =>
    createElement("div", { key: message, role: "alert", "aria-label": message }, createElement("span", { "aria-hidden": true }, "⚠")),
  );
  return createElement(
    "section",
    { className: "journalEditor journalRecordEditor viewEnter", "aria-label": "紀錄編輯器" },
    createElement(
      "header",
      null,
      createElement("button", { type: "button", "aria-label": "保存並返回紀錄列表", onClick: onBack }, createElement("span", { "aria-hidden": true }, "‹")),
      locked
        ? createElement("span", { className: "journalLock", "aria-label": "已送出，唯讀" }, createElement("span", { "aria-hidden": true }, "◇"))
        : createElement(
            "div",
            { className: "recordActions" },
            createElement("span", { className: "editCount", "aria-label": `新增 ${editCounts.added} 字元，刪除 ${editCounts.removed} 字元` }, `+${editCounts.added} −${editCounts.removed}`),
            createElement("button", { type: "button", className: showDeletions ? "active" : undefined, "aria-label": showDeletions ? "隱藏刪除內容" : "顯示刪除內容", onClick: onToggleDeletions }, "−"),
            createElement("button", { type: "button", "aria-label": "移到垃圾桶", onClick: onTrash }, "⌫"),
          ),
    ),
    ...fields,
    ...issues,
  );
}
