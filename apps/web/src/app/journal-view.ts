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
} from "../lib/journal-record.ts";

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
      { key },
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
    { "aria-label": "Journal editor" },
    ...fields,
    ...issues,
    newRecord,
  );
}
