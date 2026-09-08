"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { rebaseConflictCandidate } from "@capture/recorder-kit";

import type { EnglishRecord } from "../lib/special-record";
import { toTaipeiDate } from "../lib/special-record";
import { ModuleRail, type CaptureModule } from "./module-rail";
import { shiftJournalDate } from "./journal-session";

const STORAGE_KEY = "capture.english.v1";
const AUTOSAVE_DELAY_MS = 800;

type LocalEnglishDocument = {
  text: string;
  revision: number | null;
  pending: boolean;
  clientUpdatedAt: string;
  conflict?: { cloud: EnglishRecord | null };
};

type EnglishCache = Record<string, LocalEnglishDocument>;
type EnglishHistoryEntry = { journalDate: string; text: string };

function readCache(): EnglishCache {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as EnglishCache
      : {};
  } catch {
    return {};
  }
}

function writeCache(cache: EnglishCache) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
}

function recordToLocal(record: EnglishRecord | null): LocalEnglishDocument {
  return {
    text: record?.payload.text ?? "",
    revision: record?.revision ?? null,
    pending: false,
    clientUpdatedAt: record?.updatedAt ?? new Date().toISOString(),
  };
}

export function EnglishApp({
  active,
  onSelectModule,
}: {
  active: boolean;
  onSelectModule(module: CaptureModule): void;
}) {
  const initialToday = toTaipeiDate(new Date());
  const [today, setToday] = useState(initialToday);
  const [selectedDate, setSelectedDate] = useState(initialToday);
  const [document, setDocument] = useState<LocalEnglishDocument>(() =>
    readCache()[initialToday] ?? { text: "", revision: null, pending: false, clientUpdatedAt: new Date().toISOString() },
  );
  const [issue, setIssue] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<EnglishHistoryEntry[]>([]);
  const documentRef = useRef(document);
  const activeDateRef = useRef(selectedDate);
  const syncingDatesRef = useRef(new Set<string>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [dateSlideDirection, setDateSlideDirection] = useState<"next" | "previous" | null>(null);

  const publish = useCallback((date: string, next: LocalEnglishDocument) => {
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
        const response = await fetch("/api/special-records/english", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            journalDate: date,
            text: attempt.text,
            expectedRevision: attempt.revision,
            clientUpdatedAt: attempt.clientUpdatedAt,
          }),
        });
        const payload = await response.json() as { error?: { code?: string }; record: EnglishRecord | null };
        if (!response.ok) {
          if (payload.error?.code === "REVISION_CONFLICT") {
            const current = readCache()[date] ?? attempt;
            publish(date, { ...current, conflict: { cloud: payload.record } });
            setIssue("選擇版本");
            return;
          }
          throw new Error("sync failed");
        }
        const current = readCache()[date] ?? attempt;
        const revision = payload.record?.revision ?? null;
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
      setIssue(null);
    } catch {
      setIssue("尚未同步");
    } finally {
      syncingDatesRef.current.delete(date);
    }
  }, [publish]);

  const load = useCallback(async (date: string) => {
    await Promise.resolve();
    const cached = readCache()[date];
    publish(date, cached ?? { text: "", revision: null, pending: false, clientUpdatedAt: new Date().toISOString() });
    try {
      const response = await fetch(`/api/special-records/english?date=${encodeURIComponent(date)}`);
      if (!response.ok) throw new Error("load failed");
      const payload = await response.json() as { record: EnglishRecord | null };
      const current = readCache()[date];
      if (current?.pending) {
        publish(date, current);
        void sync(date, current);
      } else {
        publish(date, recordToLocal(payload.record));
      }
      setIssue(null);
    } catch {
      setIssue("離線");
    }
  }, [publish, sync]);

  useEffect(() => {
    activeDateRef.current = selectedDate;
    const timer = window.setTimeout(() => void load(selectedDate), 0);
    return () => window.clearTimeout(timer);
  }, [load, selectedDate]);
  useEffect(() => {
    if (active && selectedDate === today) editorRef.current?.focus();
  }, [active, selectedDate, today]);
  useEffect(() => {
    const online = () => void sync(selectedDate, readCache()[selectedDate] ?? documentRef.current);
    window.addEventListener("online", online);
    const interval = window.setInterval(() => {
      const nextToday = toTaipeiDate(new Date());
      if (nextToday !== today) {
        void sync(selectedDate, documentRef.current);
        activeDateRef.current = nextToday;
        setToday(nextToday);
        setSelectedDate(nextToday);
      }
    }, 30_000);
    return () => {
      window.removeEventListener("online", online);
      window.clearInterval(interval);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [selectedDate, sync, today]);

  const editable = selectedDate === today;
  const [, month, day] = selectedDate.split("-");

  async function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    const merged = new Map<string, string>();
    try {
      const response = await fetch("/api/special-records/english");
      if (!response.ok) throw new Error("history failed");
      const payload = await response.json() as { records: EnglishRecord[] };
      for (const record of payload.records) merged.set(record.journalDate, record.payload.text);
      setIssue(null);
    } catch {
      setIssue("離線");
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
    publish(selectedDate, recordToLocal(cloud ?? null));
    setIssue(null);
  }

  function keepLocalVersion() {
    const current = documentRef.current;
    if (!current.conflict) return;
    const { conflict, ...withoutConflict } = current;
    const next = rebaseConflictCandidate(withoutConflict, conflict.cloud?.revision ?? null);
    publish(selectedDate, next);
    setIssue(null);
    void sync(selectedDate, next);
  }

  return (
    <main
      className={dateSlideDirection === null ? "englishShell" : `englishShell dateSlide-${dateSlideDirection}`}
      hidden={!active}
      onAnimationEnd={() => setDateSlideDirection(null)}
      onPointerDown={(event) => { if (event.pointerType === "touch") swipeStartRef.current = { x: event.clientX, y: event.clientY }; }}
      onPointerUp={(event) => {
        const start = swipeStartRef.current;
        swipeStartRef.current = null;
        if (event.pointerType !== "touch" || !start || historyOpen) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
        const direction = dx < 0 ? 1 : -1;
        const nextDate = shiftJournalDate(selectedDate, direction);
        if (nextDate > today) return;
        activeDateRef.current = nextDate;
        setDateSlideDirection(direction > 0 ? "next" : "previous");
        setSelectedDate(nextDate);
      }}
    >
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
        {issue ? <span className="englishIssue" aria-label={issue}>·</span> : null}
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
          className="englishEditor"
          aria-label={`${selectedDate} 英文紀錄`}
          value={document.text}
          readOnly={!editable}
          spellCheck
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            const next = {
              ...documentRef.current,
              text: event.currentTarget.value,
              pending: true,
              clientUpdatedAt: new Date().toISOString(),
            };
            publish(selectedDate, next);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => void sync(selectedDate, next), AUTOSAVE_DELAY_MS);
          }}
        />
      )}
      {!focused ? <ModuleRail active="english" onSelect={onSelectModule} /> : null}
    </main>
  );
}
