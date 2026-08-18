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
import { formatJournalDateLabel } from "./journal-ui.ts";

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
  listMode: boolean;
  onOpenSettings(): void;
  onPrevious(): void;
  onDateChange(value: string): void;
  onNext(): void;
  onToggleList(): void;
};

export function JournalToolbar({
  date,
  listMode,
  onOpenSettings,
  onPrevious,
  onDateChange,
  onNext,
  onToggleList,
}: JournalToolbarProps): ReactElement {
  return createElement(
    "nav",
    { className: "journalToolbar", "aria-label": "日誌工具列" },
    createElement(
      "button",
      { type: "button", "aria-label": "設定", onClick: onOpenSettings },
      createElement("span", { "aria-hidden": true }, "⚙"),
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
      {
        type: "button",
        "aria-label": listMode ? "返回編輯" : "紀錄列表",
        onClick: onToggleList,
      },
      createElement("span", { "aria-hidden": true }, listMode ? "✎" : "☷"),
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
        ref: key === "unclassified" ? unclassifiedRef : undefined,
        "aria-label": AREA_ARIA_LABELS[key],
        value: areas[key],
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) =>
          onEdit(key, event.currentTarget.value),
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
    { className: "journalEditor", "aria-label": "Journal editor" },
    ...fields,
    ...issues,
    newRecord,
  );
}

export type JournalRecordListViewProps = {
  records: readonly JournalRecord[];
  selectedId: string | null;
  onSelect(record: JournalRecord): void;
};

export function JournalRecordListView({
  records,
  selectedId,
  onSelect,
}: JournalRecordListViewProps): ReactElement {
  return createElement(
    "section",
    { className: "journalRecordStream", "aria-label": "紀錄列表" },
    ...records.map((record) => {
      const previews = JOURNAL_AREA_KEYS.filter(
        (key) => record.areas[key].trim().length > 0,
      ).map((key) =>
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
          "aria-label":
            record.deliveryState === "delivered" ? "檢視已送出紀錄" : "編輯紀錄",
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
  record: JournalRecord;
  areas: JournalAreas;
  issueMessages: readonly string[];
  onEdit(key: JournalAreaKey, value: string): void;
  onBack(): void;
};

export function JournalRecordEditorView({
  record,
  areas,
  issueMessages,
  onEdit,
  onBack,
}: JournalRecordEditorViewProps): ReactElement {
  const locked = record.deliveryState === "delivered";
  const visibleKeys = locked
    ? JOURNAL_AREA_KEYS.filter((key) => areas[key].trim().length > 0)
    : JOURNAL_AREA_KEYS;
  const fields = visibleKeys.map((key) =>
    createElement(
      "div",
      { className: "journalArea", key },
      createElement("span", { "aria-hidden": true }, AREA_SYMBOLS[key]),
      createElement("textarea", {
        "aria-label": AREA_ARIA_LABELS[key],
        value: areas[key],
        disabled: locked,
        onChange: locked
          ? undefined
          : (event: ChangeEvent<HTMLTextAreaElement>) =>
              onEdit(key, event.currentTarget.value),
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

  return createElement(
    "section",
    { className: "journalEditor journalRecordEditor", "aria-label": "紀錄編輯器" },
    createElement(
      "header",
      null,
      createElement(
        "button",
        { type: "button", "aria-label": "返回紀錄列表", onClick: onBack },
        createElement("span", { "aria-hidden": true }, "‹"),
      ),
      locked
        ? createElement(
            "span",
            { className: "journalLock", "aria-label": "已送出，唯讀" },
            createElement("span", { "aria-hidden": true }, "⌑"),
          )
        : null,
    ),
    ...fields,
    ...issues,
  );
}
