import { invoke } from "@tauri-apps/api/core";
import { rebaseConflictCandidate } from "@capture/recorder-kit";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { CapturePageDefinition, CapturePageProps } from "./types";

const STORAGE_KEY = "capture.desktop.english.v1";
const AUTOSAVE_DELAY_MS = 800;

type EnglishRecord = {
  journalDate: string;
  payload: { schemaVersion: 1; text: string };
  revision: number;
  updatedAt: string;
};

type LocalDocument = {
  text: string;
  revision: number | null;
  pending: boolean;
  clientUpdatedAt: string;
  conflict?: { cloud: EnglishRecord | null };
};
type SaveResult<T> = { record: T | null; conflict: boolean };
type Cache = Record<string, LocalDocument>;
type HistoryEntry = { journalDate: string; text: string };

function taipeiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function readCache(): Cache {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Cache
      : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Cache) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); } catch { /* memory copy remains */ }
}

function EnglishPage({ requestModeChange }: CapturePageProps) {
  const initialToday = taipeiDate();
  const [today, setToday] = useState(initialToday);
  const [selectedDate, setSelectedDate] = useState(initialToday);
  const [document, setDocument] = useState<LocalDocument>(() =>
    readCache()[initialToday] ?? { text: "", revision: null, pending: false, clientUpdatedAt: new Date().toISOString() },
  );
  const [issue, setIssue] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const documentRef = useRef(document);
  const activeDateRef = useRef(selectedDate);
  const syncingDatesRef = useRef(new Set<string>());
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<number | null>(null);

  const publish = useCallback((date: string, next: LocalDocument) => {
    if (date === activeDateRef.current) {
      documentRef.current = next;
      setDocument(next);
    }
    const cache = readCache();
    if (!next.text && !next.pending && next.revision === null) delete cache[date];
    else cache[date] = next;
    writeCache(cache);
  }, []);

  const sync = useCallback(async (date: string, candidate = documentRef.current) => {
    if (!candidate.pending || candidate.conflict || syncingDatesRef.current.has(date)) return;
    syncingDatesRef.current.add(date);
    try {
      let attempt = candidate;
      while (attempt.pending) {
        const result = await invoke<SaveResult<EnglishRecord>>("save_english_record", {
          input: {
            journalDate: date,
            text: attempt.text,
            expectedRevision: attempt.revision,
            clientUpdatedAt: attempt.clientUpdatedAt,
          },
        });
        if (result.conflict) {
          const current = readCache()[date] ?? attempt;
          publish(date, { ...current, conflict: { cloud: result.record } });
          setIssue(true);
          return;
        }
        const current = readCache()[date] ?? attempt;
        const revision = result.record?.revision ?? null;
        if (
          current.text === attempt.text &&
          current.clientUpdatedAt === attempt.clientUpdatedAt
        ) {
          publish(date, { ...current, revision, pending: false, conflict: undefined });
          break;
        }
        attempt = { ...current, revision, pending: true };
        publish(date, attempt);
      }
      setIssue(false);
    } catch {
      setIssue(true);
    } finally {
      syncingDatesRef.current.delete(date);
    }
  }, [publish]);

  const load = useCallback(async (date: string) => {
    await Promise.resolve();
    const cached = readCache()[date];
    publish(date, cached ?? { text: "", revision: null, pending: false, clientUpdatedAt: new Date().toISOString() });
    try {
      const record = await invoke<EnglishRecord | null>("get_english_record", { journalDate: date });
      const pending = readCache()[date];
      if (pending?.pending) {
        publish(date, pending);
        void sync(date, pending);
      } else {
        publish(date, {
          text: record?.payload.text ?? "",
          revision: record?.revision ?? null,
          pending: false,
          clientUpdatedAt: record?.updatedAt ?? new Date().toISOString(),
        });
      }
      setIssue(false);
    } catch {
      setIssue(true);
    }
  }, [publish, sync]);

  useEffect(() => {
    activeDateRef.current = selectedDate;
    const timer = window.setTimeout(() => void load(selectedDate), 0);
    return () => window.clearTimeout(timer);
  }, [load, selectedDate]);
  useEffect(() => {
    if (selectedDate === today) editorRef.current?.focus();
  }, [selectedDate, today]);
  useEffect(() => {
    const online = () => void sync(selectedDate, readCache()[selectedDate] ?? documentRef.current);
    window.addEventListener("online", online);
    const interval = window.setInterval(() => {
      const next = taipeiDate();
      if (next !== today) {
        void sync(selectedDate, documentRef.current);
        activeDateRef.current = next;
        setToday(next);
        setSelectedDate(next);
      }
    }, 30_000);
    return () => {
      window.removeEventListener("online", online);
      window.clearInterval(interval);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [selectedDate, sync, today]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!event.ctrlKey) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      requestModeChange(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      requestModeChange(1);
    }
  }

  const editable = selectedDate === today;
  const [, month, day] = selectedDate.split("-");

  async function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false);
      editorRef.current?.focus();
      return;
    }
    const merged = new Map<string, string>();
    try {
      const records = await invoke<EnglishRecord[]>("list_english_records");
      for (const record of records) merged.set(record.journalDate, record.payload.text);
      setIssue(false);
    } catch {
      setIssue(true);
    }
    for (const [date, local] of Object.entries(readCache())) {
      if (local.text.trim()) merged.set(date, local.text);
      else merged.delete(date);
    }
    setHistory(
      [...merged].map(([journalDate, text]) => ({ journalDate, text }))
        .sort((left, right) => right.journalDate.localeCompare(left.journalDate)),
    );
    setHistoryOpen(true);
  }

  function useCloudVersion() {
    const cloud = documentRef.current.conflict?.cloud;
    publish(selectedDate, {
      text: cloud?.payload.text ?? "",
      revision: cloud?.revision ?? null,
      pending: false,
      clientUpdatedAt: cloud?.updatedAt ?? new Date().toISOString(),
    });
    setIssue(false);
  }

  function keepLocalVersion() {
    const current = documentRef.current;
    if (!current.conflict) return;
    const { conflict, ...withoutConflict } = current;
    const next = rebaseConflictCandidate(withoutConflict, conflict.cloud?.revision ?? null);
    publish(selectedDate, next);
    setIssue(false);
    void sync(selectedDate, next);
  }

  return (
    <main className="captureExtensionPage englishPage viewEnter" aria-label="英文紀錄" onKeyDown={handleKeyDown}>
      <header className="englishToolbar">
        <label>
          <span>{Number(month)}.{Number(day)}</span>
          <input
            type="date"
            max={today}
            value={selectedDate}
            aria-label="選擇英文紀錄日期"
            onChange={(event) => {
              if (!event.currentTarget.value) return;
              activeDateRef.current = event.currentTarget.value;
              setSelectedDate(event.currentTarget.value);
            }}
          />
        </label>
        {!editable ? <span aria-label="過往紀錄唯讀">◇</span> : null}
        {issue ? <span className="englishSyncIssue" aria-label="尚未同步">·</span> : null}
        <button type="button" aria-label="英文紀錄列表" onClick={() => void toggleHistory()}>☷</button>
      </header>
      {document.conflict ? <div className="specialConflict" role="alert"><span>版本</span><button type="button" onClick={useCloudVersion}>雲端</button><button type="button" onClick={keepLocalVersion}>本機</button></div> : null}
      {historyOpen ? (
        <section className="englishHistory" aria-label="英文紀錄列表">
          {history.map((entry) => (
            <button
              type="button"
              key={entry.journalDate}
              onClick={() => {
                activeDateRef.current = entry.journalDate;
                setSelectedDate(entry.journalDate);
                setHistoryOpen(false);
              }}
            >
              <time>{entry.journalDate.slice(5).replace("-", ".")}</time>
              <span>{entry.text.replace(/\s+/g, " ").trim()}</span>
            </button>
          ))}
        </section>
      ) : (
        <textarea
          ref={editorRef}
          aria-label={`${selectedDate} 英文紀錄`}
          value={document.text}
          readOnly={!editable}
          spellCheck
          onChange={(event) => {
            const next = {
              ...documentRef.current,
              text: event.currentTarget.value,
              pending: true,
              clientUpdatedAt: new Date().toISOString(),
            };
            publish(selectedDate, next);
            if (timerRef.current !== null) window.clearTimeout(timerRef.current);
            timerRef.current = window.setTimeout(() => void sync(selectedDate, next), AUTOSAVE_DELAY_MS);
          }}
        />
      )}
    </main>
  );
}

export default {
  id: "english",
  Component: EnglishPage,
} satisfies CapturePageDefinition;
