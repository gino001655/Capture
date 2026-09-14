"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  RunningExercise,
  StrengthExercise,
  PreviousStrengthExercise,
  WorkoutExercise,
  WorkoutPayload,
  WorkoutRecord,
  WorkoutSession,
  WorkoutSet,
} from "../lib/workout-record";
import { elapsedWorkoutTimer, emptyWorkoutPayload, findPreviousStrengthExercise, nextWorkoutSetIndex, summarizeWorkoutRecord } from "../lib/workout-record";
import { shiftJournalDate } from "./journal-session";
import { ModuleRail, type CaptureModule } from "./module-rail";
import { toTaipeiDate } from "../lib/special-record";
import type { WorkoutLibraryEntry, WorkoutLibraryPayload, WorkoutLibraryRecord } from "../lib/workout-library";
import { emptyWorkoutLibrary } from "../lib/workout-library";
import { clampRecorderDate, createDateBoundDebounce, nextRecorderToday, rebaseConflictCandidate, resolveVersionedPayloadConflict } from "@capture/recorder-kit";

const CACHE_KEY = "capture.workout.v1";
const AUTOSAVE_MS = 800;

type LocalWorkout = {
  payload: WorkoutPayload;
  revision: number | null;
  pending: boolean;
  clientUpdatedAt: string;
  conflict?: { cloud: WorkoutRecord | null };
};
type Cache = Record<string, LocalWorkout>;
type StrengthStats = { sessions: number; maximumWeight: number | null; estimatedOneRepMax: number | null; recentNote: string };

function readCache(): Cache {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Cache
      : {};
  } catch { return {}; }
}

function writeCache(cache: Cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* in-memory state remains */ }
}

function blankSet(source?: WorkoutSet): WorkoutSet {
  return {
    id: crypto.randomUUID(),
    weightKg: source?.weightKg ?? null,
    reps: source?.reps ?? null,
    rpe: source?.rpe ?? null,
    rir: source?.rir ?? null,
    type: source?.type ?? "working",
    note: "",
    confirmed: false,
  };
}

function newSession(): WorkoutSession {
  return {
    id: crypto.randomUUID(),
    name: "",
    note: "",
    startedAt: new Date().toISOString(),
    completedAt: null,
    restTimer: { startedAt: null, elapsedSeconds: 0, running: false },
    exercises: [],
  };
}

function pace(distanceKm: number | null, durationSeconds: number | null) {
  if (!distanceKm || !durationSeconds) return "—";
  const seconds = Math.round(durationSeconds / distanceKm);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}/km`;
}

function buildStrengthStats(records: WorkoutRecord[]) {
  const stats = new Map<string, StrengthStats>();
  for (const record of records) for (const session of record.payload.sessions) for (const exercise of session.exercises) {
    if (exercise.kind !== "strength") continue;
    const key = exercise.libraryEntryId ?? exercise.name.toLocaleLowerCase();
    const current = stats.get(key) ?? { sessions: 0, maximumWeight: null, estimatedOneRepMax: null, recentNote: "" };
    current.sessions += 1;
    if (!current.recentNote && exercise.note.trim()) current.recentNote = exercise.note.trim();
    for (const set of exercise.sets) {
      if (set.weightKg !== null) current.maximumWeight = Math.max(current.maximumWeight ?? set.weightKg, set.weightKg);
      if (set.weightKg !== null && set.reps !== null) {
        const estimate = Math.round(set.weightKg * (1 + set.reps / 30) * 10) / 10;
        current.estimatedOneRepMax = Math.max(current.estimatedOneRepMax ?? estimate, estimate);
      }
    }
    stats.set(key, current);
  }
  return stats;
}

export function WorkoutApp({
  active,
  onSelectModule,
}: {
  active: boolean;
  onSelectModule(module: CaptureModule): void;
}) {
  const [today, setToday] = useState(() => toTaipeiDate(new Date()));
  const [selectedDate, setSelectedDate] = useState(today);
  const [local, setLocal] = useState<LocalWorkout>(() => readCache()[today] ?? {
    payload: emptyWorkoutPayload(), revision: null, pending: false, clientUpdatedAt: new Date().toISOString(),
  });
  const [history, setHistory] = useState<WorkoutRecord[]>([]);
  const [library, setLibrary] = useState<WorkoutLibraryPayload>(emptyWorkoutLibrary);
  const [libraryRevision, setLibraryRevision] = useState<number | null>(null);
  const [libraryConflict, setLibraryConflict] = useState<{ local: WorkoutLibraryPayload; cloud: WorkoutLibraryRecord | null } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [expandedExerciseId, setExpandedExerciseId] = useState<string | null>(null);
  const [newExerciseName, setNewExerciseName] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [dateSlideDirection, setDateSlideDirection] = useState<"next" | "previous" | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const localRef = useRef(local);
  const dateRef = useRef(selectedDate);
  const todayRef = useRef(today);
  const syncDebounceRef = useRef<ReturnType<typeof createDateBoundDebounce<LocalWorkout>> | null>(null);
  const syncRef = useRef<(date: string, candidate?: LocalWorkout) => Promise<void>>(async () => undefined);
  syncDebounceRef.current ??= createDateBoundDebounce<LocalWorkout>({
    delayMs: AUTOSAVE_MS,
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancel: (handle) => window.clearTimeout(handle as number),
  });

  const publish = useCallback((date: string, next: LocalWorkout) => {
    if (date === dateRef.current) {
      localRef.current = next;
      setLocal(next);
    }
    const cache = readCache();
    if (next.payload.sessions.length === 0 && !next.pending && next.revision === null) delete cache[date];
    else cache[date] = next;
    writeCache(cache);
  }, []);

  const syncingDates = useRef(new Set<string>());
  const sync = useCallback(async (date: string, candidate = localRef.current) => {
    if (!candidate.pending || candidate.conflict) return;
    if (syncingDates.current.has(date)) return;
    syncingDates.current.add(date);
    try {
      const response = await fetch("/api/special-records/workout", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          journalDate: date,
          payload: candidate.payload,
          expectedRevision: candidate.revision,
          clientUpdatedAt: candidate.clientUpdatedAt,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result?.error?.code === "REVISION_CONFLICT") {
          const current = readCache()[date] ?? candidate;
          publish(date, { ...current, conflict: { cloud: result.record ?? null } });
          setIssue("選擇版本");
          return;
        }
        setIssue("尚未同步");
        return;
      }
      const current = readCache()[date] ?? candidate;
      const revision = result.record?.revision ?? null;
      if (current.clientUpdatedAt === candidate.clientUpdatedAt) {
        publish(date, { ...current, revision, pending: false, conflict: undefined });
      } else { const next = { ...current, revision }; publish(date, next); syncDebounceRef.current?.queue(date, next, (queuedDate, queuedCandidate) => void syncRef.current(queuedDate, queuedCandidate)); }
      setIssue(null);
    } catch { setIssue("尚未同步"); } finally { syncingDates.current.delete(date); }
  }, [publish]);
  useEffect(() => { syncRef.current = sync; }, [sync]);

  const mutate = useCallback((change: (payload: WorkoutPayload) => WorkoutPayload) => {
    const next: LocalWorkout = {
      ...localRef.current,
      payload: change(structuredClone(localRef.current.payload)),
      pending: true,
      clientUpdatedAt: new Date().toISOString(),
    };
    const targetDate = dateRef.current;
    publish(targetDate, next);
    syncDebounceRef.current?.queue(targetDate, next, sync);
  }, [publish, sync]);

  const load = useCallback(async (date: string) => {
    date = clampRecorderDate(date, todayRef.current);
    dateRef.current = date;
    setSelectedDate(date);
    setIssue(null);
    const cached = readCache()[date];
    const visible = cached ?? {
      payload: emptyWorkoutPayload(), revision: null, pending: false, clientUpdatedAt: new Date().toISOString(),
    };
    publish(date, visible);
    const visibleOpenIndex = visible.payload.sessions.findIndex((session) => session.completedAt === null);
    setSessionIndex(visibleOpenIndex >= 0 ? visibleOpenIndex : Math.max(0, visible.payload.sessions.length - 1));
    if (cached) {
      if (cached.pending) void sync(date, cached);
    }
    try {
      const response = await fetch(`/api/special-records/workout?date=${date}`, { cache: "no-store" });
      const { record } = await response.json() as { record: WorkoutRecord | null };
      if (!readCache()[date]?.pending) {
        const next = record
          ? { payload: record.payload, revision: record.revision, pending: false, clientUpdatedAt: record.updatedAt }
          : { payload: emptyWorkoutPayload(), revision: null, pending: false, clientUpdatedAt: new Date().toISOString() };
        publish(date, next);
        const openIndex = next.payload.sessions.findIndex((session) => session.completedAt === null);
        if (date === dateRef.current) setSessionIndex(openIndex >= 0 ? openIndex : Math.max(0, next.payload.sessions.length - 1));
      }
    } catch { if (!cached) setIssue("無法載入"); }
  }, [publish, sync]);

  useEffect(() => {
    if (!active) return;
    queueMicrotask(() => void load(dateRef.current));
    void fetch("/api/special-records/workout", { cache: "no-store" })
      .then((response) => response.json())
      .then(({ records }) => setHistory(records ?? []))
      .catch(() => undefined);
    void fetch("/api/special-records/workout/library", { cache: "no-store" })
      .then((response) => response.json())
      .then(({ record }: { record: WorkoutLibraryRecord | null }) => {
        setLibrary(record?.payload ?? emptyWorkoutLibrary());
        setLibraryRevision(record?.revision ?? null);
      })
      .catch(() => setIssue("動作庫尚未同步"));
  }, [active, load]);

  useEffect(() => {
    const retryPending = () => {
      for (const [date, candidate] of Object.entries(readCache())) {
        if (candidate.pending) void sync(date, candidate);
      }
    };
    const retryVisible = () => {
      if (document.visibilityState === "visible") retryPending();
    };
    window.addEventListener("online", retryPending);
    document.addEventListener("visibilitychange", retryVisible);
    return () => {
      window.removeEventListener("online", retryPending);
      document.removeEventListener("visibilitychange", retryVisible);
      syncDebounceRef.current?.cancel();
    };
  }, [sync]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = new Date();
      setClock(now.getTime());
      const nextToday = nextRecorderToday(todayRef.current, toTaipeiDate(now));
      if (!nextToday) return;
      const previousDate = dateRef.current;
      const previous = readCache()[previousDate] ?? localRef.current;
      if (previous.pending) void sync(previousDate, previous);
      todayRef.current = nextToday;
      setToday(nextToday);
      void load(nextToday);
    }, 1_000);
    return () => window.clearInterval(id);
  }, [load, sync]);

  const editable = selectedDate === today;
  const session = local.payload.sessions[sessionIndex] ?? null;
  const recentExercises = useMemo(() => {
    const names = library.entries.filter((entry) => !entry.archived).sort((left, right) => left.order - right.order).map((entry) => entry.name);
    for (const record of history) for (const item of record.payload.sessions) for (const exercise of item.exercises) {
      if (!names.includes(exercise.name)) names.push(exercise.name);
    }
    return names.slice(0, 6);
  }, [history, library]);
  const strengthStats = useMemo(() => buildStrengthStats(history), [history]);

  function updateSession(change: (session: WorkoutSession) => void) {
    mutate((payload) => {
      const target = payload.sessions[sessionIndex];
      if (target) change(target);
      return payload;
    });
  }

  function addSession() {
    mutate((payload) => { payload.sessions.push(newSession()); return payload; });
    setSessionIndex(localRef.current.payload.sessions.length - 1);
  }

  function addStrength(name: string) {
    const trimmed = name.trim();
    if (!trimmed || !session) return;
    let entry = library.entries.find((item) => item.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
    if (!entry) {
      entry = { id: crypto.randomUUID(), name: trimmed, order: library.entries.length, archived: false };
      void saveLibrary({ ...library, entries: [...library.entries, entry] });
    }
    const previous = findPreviousStrengthExercise(history, trimmed, entry.id, selectedDate);
    const exercise: StrengthExercise = {
      id: crypto.randomUUID(), kind: "strength", name: trimmed, note: "",
      libraryEntryId: entry.id,
      sets: previous?.sets.length ? previous.sets.map(blankSet) : [blankSet()],
    };
    updateSession((target) => target.exercises.push(exercise));
    setExpandedExerciseId(exercise.id);
    setNewExerciseName("");
  }

  async function saveLibrary(next: WorkoutLibraryPayload, expectedRevision = libraryRevision) {
    setLibrary(next);
    try {
      const response = await fetch("/api/special-records/workout/library", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: next, expectedRevision }) });
      const result = await response.json();
      if (!response.ok) {
        if (result?.error?.code === "REVISION_CONFLICT") {
          setLibraryConflict({ local: structuredClone(next), cloud: result.record ?? null });
          setIssue("選擇動作庫版本");
          return;
        }
        if (result.record) { setLibrary(result.record.payload); setLibraryRevision(result.record.revision); }
        setIssue(result?.error?.code === "LIBRARY_ENTRY_IN_USE" ? "有歷史的動作只能封存" : "動作庫尚未同步");
        return;
      }
      setLibrary(result.record.payload);
      setLibraryRevision(result.record.revision);
      setLibraryConflict(null);
      setIssue(null);
    } catch { setIssue("動作庫尚未同步"); }
  }

  function resolveLibraryConflict(choice: "cloud" | "local") {
    if (!libraryConflict) return;
    const resolution = resolveVersionedPayloadConflict(
      libraryConflict.local,
      libraryConflict.cloud,
      choice,
      emptyWorkoutLibrary(),
    );
    setLibrary(resolution.payload);
    setLibraryRevision(resolution.revision);
    setLibraryConflict(null);
    setIssue(resolution.retry ? "動作庫同步中" : null);
    if (resolution.retry) void saveLibrary(resolution.payload, resolution.revision);
  }

  function libraryEntryUsed(entry: WorkoutLibraryEntry) {
    return history.some((record) => record.payload.sessions.some((item) => item.exercises.some((exercise) =>
      exercise.kind === "strength" && (exercise.libraryEntryId === entry.id || (!exercise.libraryEntryId && exercise.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase())),
    )));
  }

  function addRun() {
    if (!session) return;
    const exercise: RunningExercise = {
      id: crypto.randomUUID(), kind: "running", name: "跑步", note: "",
      distanceKm: null, durationSeconds: null, averageHeartRate: null, maximumHeartRate: null,
      temperatureC: null, elevationGainM: null, rpe: null, segments: [],
    };
    updateSession((target) => target.exercises.push(exercise));
    setExpandedExerciseId(exercise.id);
  }

  function useCloudVersion() {
    const cloud = localRef.current.conflict?.cloud;
    const next: LocalWorkout = cloud
      ? { payload: cloud.payload, revision: cloud.revision, pending: false, clientUpdatedAt: cloud.updatedAt }
      : { payload: emptyWorkoutPayload(), revision: null, pending: false, clientUpdatedAt: new Date().toISOString() };
    publish(selectedDate, next);
    setIssue(null);
  }

  function keepLocalVersion() {
    const current = localRef.current;
    if (!current.conflict) return;
    const { conflict, ...withoutConflict } = current;
    const next = rebaseConflictCandidate(withoutConflict, conflict.cloud?.revision ?? null);
    publish(selectedDate, next);
    setIssue(null);
    void sync(selectedDate, next);
  }

  function updateExercise(id: string, change: (exercise: WorkoutExercise) => void) {
    updateSession((target) => {
      const exercise = target.exercises.find((item) => item.id === id);
      if (exercise) change(exercise);
    });
  }

  function elapsed(session: WorkoutSession) {
    return elapsedWorkoutTimer(session.restTimer, clock || Date.now());
  }

  if (!active) return null;
  return (
    <main
      className={dateSlideDirection === null ? "workoutShell" : `workoutShell dateSlide-${dateSlideDirection}`}
      onAnimationEnd={() => setDateSlideDirection(null)}
      onPointerDown={(event) => { if (event.pointerType === "touch") touchStartRef.current = { x: event.clientX, y: event.clientY }; }}
      onPointerUp={(event) => {
        const start = touchStartRef.current;
        touchStartRef.current = null;
        if (event.pointerType !== "touch" || !start || historyOpen) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
        const direction = dx < 0 ? 1 : -1;
        const nextDate = clampRecorderDate(shiftJournalDate(selectedDate, direction), today);
        if (nextDate === selectedDate) return;
        setDateSlideDirection(direction > 0 ? "next" : "previous");
        void load(nextDate);
      }}
    >
      <header className="workoutToolbar">
        <button type="button" onClick={() => setHistoryOpen((open) => !open)} aria-label="訓練歷史">{historyOpen ? "返回" : "歷史"}</button>
        <label>{selectedDate.slice(5).replace("-", ".")}<input type="date" max={today} value={selectedDate} onChange={(event) => void load(event.target.value)} /></label>
        <span className={local.pending ? "workoutSync pending" : "workoutSync"}>{issue ? "!" : local.pending ? "·" : ""}</span>
      </header>
      <div className="recorderNotices">
      {local.conflict ? <div className="specialConflict" role="alert"><span>雲端已有較新的訓練內容，請選擇要保留的版本。</span><button type="button" onClick={useCloudVersion}>保留雲端內容</button><button type="button" onClick={keepLocalVersion}>保留這台內容</button></div> : null}
      {libraryConflict ? <div className="specialConflict" role="alert"><span>雲端已有較新的常用動作，請選擇要保留的版本。</span><button type="button" onClick={() => resolveLibraryConflict("cloud")}>保留雲端內容</button><button type="button" onClick={() => resolveLibraryConflict("local")}>保留這台內容</button></div> : null}
      </div>

      {historyOpen ? (
        <section className="workoutHistory">
          <details className="workoutLibrary recorderSection">
            <summary><strong>管理常用動作</strong><small>重新排序、封存或刪除</small></summary>
            {library.entries.slice().sort((left, right) => left.order - right.order).map((entry, index, entries) => <div key={entry.id} className={entry.archived ? "archived" : ""}>
              <input value={entry.name} onChange={(event) => setLibrary((current) => ({ ...current, entries: current.entries.map((item) => item.id === entry.id ? { ...item, name: event.target.value } : item) }))} onBlur={(event) => { const name = event.target.value.trim(); if (name) void saveLibrary({ ...library, entries: library.entries.map((item) => item.id === entry.id ? { ...item, name } : item) }); }} />
              <button disabled={index === 0} onClick={() => { const next = entries.slice(); [next[index - 1], next[index]] = [next[index], next[index - 1]]; void saveLibrary({ ...library, entries: next.map((item, order) => ({ ...item, order })) }); }}>上移</button>
              <button disabled={index === entries.length - 1} onClick={() => { const next = entries.slice(); [next[index], next[index + 1]] = [next[index + 1], next[index]]; void saveLibrary({ ...library, entries: next.map((item, order) => ({ ...item, order })) }); }}>下移</button>
              <button onClick={() => void saveLibrary({ ...library, entries: library.entries.map((item) => item.id === entry.id ? { ...item, archived: !item.archived } : item) })}>{entry.archived ? "取消封存" : "封存"}</button>
              {!libraryEntryUsed(entry) ? <button onClick={() => void saveLibrary({ ...library, entries: library.entries.filter((item) => item.id !== entry.id).map((item, order) => ({ ...item, order })) })}>刪除</button> : <span />}
            </div>)}
          </details>
          <h2 className="recorderSectionTitle">訓練歷史</h2>
          {history.map((record) => { const summary = summarizeWorkoutRecord(record); return (
            <button className="workoutHistoryRow" key={record.id} onClick={() => { setHistoryOpen(false); void load(record.journalDate); }}>
              <time>{record.journalDate.slice(5).replace("-", ".")}</time>
              <span><strong>{summary.sessionNames.join(" / ")}</strong><small>{summary.exerciseNames.length ? summary.exerciseNames.join(" · ") : "尚無動作"}</small></span>
            </button>
          ); })}
        </section>
      ) : (
        <section className="workoutBody">
          {local.payload.sessions.length > 1 ? (
            <nav className="sessionTabs">{local.payload.sessions.map((item, index) => (
              <button key={item.id} className={index === sessionIndex ? "active" : ""} onClick={() => setSessionIndex(index)}>{item.name || index + 1}</button>
            ))}</nav>
          ) : null}

          {!session ? (
            <div className="emptyWorkout">
              <button type="button" disabled={!editable} onClick={addSession}>＋ 開始訓練</button>
              <div>{recentExercises.map((name) => <span key={name}>{name}</span>)}</div>
            </div>
          ) : (
            <div className={editable ? "workoutSession" : "workoutSession locked"}>
              <section className="recorderSection currentWorkoutSection"><h2>本次訓練</h2><div className="sessionHeader">
                <input aria-label="訓練名稱" placeholder="訓練" value={session.name} disabled={!editable} onChange={(event) => updateSession((target) => { target.name = event.target.value; })} />
                <button type="button" disabled={!editable} onClick={() => updateSession((target) => { target.completedAt = target.completedAt ? null : new Date().toISOString(); })}>{session.completedAt ? "繼續訓練" : "完成訓練"}</button>
              </div></section>

              <section className="recorderSection exerciseListSection"><h2>已加入的動作 <small>{session.exercises.length}</small></h2>
              {session.exercises.map((exercise) => exercise.kind === "strength" ? (
                <StrengthEditor key={exercise.id} exercise={exercise} editable={editable}
                  expanded={expandedExerciseId === exercise.id}
                  toggle={() => setExpandedExerciseId(expandedExerciseId === exercise.id ? null : exercise.id)}
                  stats={strengthStats.get(exercise.libraryEntryId ?? exercise.name.toLocaleLowerCase())}
                  previous={findPreviousStrengthExercise(history, exercise.name, exercise.libraryEntryId, selectedDate)}
                  update={(change) => updateExercise(exercise.id, change)}
                  confirmSet={(setId, nextSetId) => {
                    updateSession((target) => {
                    const item = target.exercises.find((candidate) => candidate.id === exercise.id);
                    if (item?.kind !== "strength") return;
                    const set = item.sets.find((candidate) => candidate.id === setId);
                    if (set) set.confirmed = true;
                    target.restTimer = { startedAt: new Date().toISOString(), elapsedSeconds: 0, running: true };
                    });
                    if (nextSetId) queueMicrotask(() => document.querySelector<HTMLInputElement>(`[data-workout-set="${nextSetId}"] input`)?.focus());
                  }}
                />
              ) : (
                <RunningEditor key={exercise.id} exercise={exercise} editable={editable} expanded={expandedExerciseId === exercise.id} toggle={() => setExpandedExerciseId(expandedExerciseId === exercise.id ? null : exercise.id)} update={(change) => updateExercise(exercise.id, change)} />
              ))}
              {session.exercises.length === 0 ? <p className="recorderHint">尚未加入動作。</p> : null}</section>

              {editable ? (
                <section className="recorderSection addExerciseSection"><h2>新增動作</h2><div className="addExercise">
                  <input value={newExerciseName} placeholder="輸入動作名稱" onChange={(event) => setNewExerciseName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addStrength(newExerciseName); }} />
                  <button onClick={() => addStrength(newExerciseName)}>新增動作</button>
                  <button onClick={addRun}>新增跑步</button>
                  <div><small>點選新增常用動作</small>{recentExercises.map((name) => <button key={name} onClick={() => addStrength(name)}>{name}</button>)}</div>
                </div></section>
              ) : null}

              <section className="recorderSection sessionNoteSection"><h2>訓練備註</h2><textarea className="sessionNote" aria-label="訓練註記" placeholder="記下今天的感受或調整" value={session.note} disabled={!editable} onChange={(event) => updateSession((target) => { target.note = event.target.value; })} /></section>

              <div className="workoutFloatingActions"><div className="restTimer"><small>休息</small>
                <strong>{Math.floor(elapsed(session) / 60)}:{String(elapsed(session) % 60).padStart(2, "0")}</strong>
                {editable ? <>
                  <button onClick={() => updateSession((target) => {
                    const seconds = elapsed(target);
                    target.restTimer = target.restTimer.running
                      ? { startedAt: null, elapsedSeconds: seconds, running: false }
                      : { startedAt: new Date().toISOString(), elapsedSeconds: seconds, running: true };
                  })}>{session.restTimer.running ? "暫停" : "開始休息"}</button>
                  <button onClick={() => updateSession((target) => { target.restTimer = { startedAt: null, elapsedSeconds: 0, running: false }; })}>歸零</button>
                </> : null}
              </div>
              {editable ? <button className="newSession" onClick={addSession}>＋ 另一場訓練</button> : <span className="workoutLock">僅供查看</span>}</div>
            </div>
          )}
        </section>
      )}
      <ModuleRail active="workout" onSelect={onSelectModule} />
    </main>
  );
}

function numberValue(value: string) { return value === "" ? null : Number(value); }

function StrengthEditor({ exercise, editable, stats, previous, update, confirmSet, expanded, toggle }: {
  expanded: boolean;
  toggle(): void;
  exercise: StrengthExercise;
  editable: boolean;
  stats?: StrengthStats;
  previous?: PreviousStrengthExercise;
  update(change: (exercise: WorkoutExercise) => void): void;
  confirmSet(id: string, nextId?: string): void;
}) {
  return <details className="strengthExercise recorderExercise" open={expanded}>
    <summary onClick={(event) => { event.preventDefault(); toggle(); }}><strong>{exercise.name || "未命名動作"}</strong><small>{exercise.sets.filter((set) => set.confirmed).length}/{exercise.sets.length} 組完成 · {expanded ? "收起" : "展開"}</small></summary>
    <div className="exerciseForm">
    <input className="exerciseName" value={exercise.name} disabled={!editable} onChange={(event) => update((item) => { item.name = event.target.value; })} />
    {previous ? <div className="previousStrength"><strong>上次 {previous.journalDate.slice(5).replace("-", ".")}</strong><span>{previous.sets.map((set) => `${set.weightKg ?? "—"}×${set.reps ?? "—"}`).join(" · ")}</span></div> : <div className="previousStrength empty">尚無上次紀錄</div>}
    {stats ? <details className="strengthStats"><summary>歷史統計</summary><span>{stats.sessions} 次</span>{stats.maximumWeight !== null ? <span>最高 {stats.maximumWeight} kg</span> : null}{stats.estimatedOneRepMax !== null ? <span>e1RM {stats.estimatedOneRepMax}</span> : null}{stats.recentNote ? <small>{stats.recentNote}</small> : null}</details> : null}
    <div className="setLabels"><span>#</span><span>kg</span><span>次</span><span>RPE</span><span>RIR</span><span /></div>
    {exercise.sets.map((set, index) => { const nextIndex = nextWorkoutSetIndex(index, exercise.sets.length); const nextId = nextIndex === null ? undefined : exercise.sets[nextIndex]?.id; return <div className="workoutSetBlock" key={set.id} data-workout-set={set.id}><div className={set.confirmed ? "workoutSet confirmed" : "workoutSet ghost"}>
      <span>{index + 1}</span>
      <input type="number" inputMode="decimal" value={set.weightKg ?? ""} disabled={!editable} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); confirmSet(set.id, nextId); } }} onChange={(event) => update((item) => { if (item.kind === "strength") item.sets[index].weightKg = numberValue(event.target.value); })} />
      <input type="number" inputMode="numeric" value={set.reps ?? ""} disabled={!editable} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); confirmSet(set.id, nextId); } }} onChange={(event) => update((item) => { if (item.kind === "strength") item.sets[index].reps = numberValue(event.target.value); })} />
      <input type="number" inputMode="decimal" value={set.rpe ?? ""} disabled={!editable} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); confirmSet(set.id, nextId); } }} onChange={(event) => update((item) => { if (item.kind === "strength") item.sets[index].rpe = numberValue(event.target.value); })} />
      <input type="number" inputMode="decimal" value={set.rir ?? ""} disabled={!editable} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); confirmSet(set.id, nextId); } }} onChange={(event) => update((item) => { if (item.kind === "strength") item.sets[index].rir = numberValue(event.target.value); })} />
      <button disabled={!editable} onClick={() => confirmSet(set.id, nextId)}>{set.confirmed ? "✓" : "○"}</button>
    </div><div className="workoutSetMeta"><select value={set.type} disabled={!editable} onChange={(event) => update((item) => { if (item.kind === "strength") item.sets[index].type = event.target.value as WorkoutSet["type"]; })}><option value="working">正式</option><option value="warmup">熱身</option><option value="drop">遞減</option><option value="failure">力竭</option></select><input placeholder="這組註記" value={set.note} disabled={!editable} onChange={(event) => update((item) => { if (item.kind === "strength") item.sets[index].note = event.target.value; })} /></div></div>; })}
    {editable ? <button className="cloneSet" onClick={() => update((item) => { if (item.kind === "strength") item.sets.push(blankSet(item.sets[item.sets.length - 1])); })}>＋ 新增一組</button> : null}
    <textarea placeholder="動作註記" value={exercise.note} disabled={!editable} onChange={(event) => update((item) => { item.note = event.target.value; })} />
    </div>
  </details>;
}

function RunningEditor({ exercise, editable, update, expanded, toggle }: {
  expanded: boolean;
  toggle(): void;
  exercise: RunningExercise;
  editable: boolean;
  update(change: (exercise: WorkoutExercise) => void): void;
}) {
  const field = (key: keyof RunningExercise, value: string) => update((item) => {
    if (item.kind === "running") (item as unknown as Record<string, unknown>)[key] = numberValue(value);
  });
  return <details className="runningExercise recorderExercise" open={expanded}><summary onClick={(event) => { event.preventDefault(); toggle(); }}><strong>{exercise.name || "跑步"}</strong><small>{expanded ? "收起" : "展開跑步紀錄"}</small></summary><div className="exerciseForm">
    <div><input className="exerciseName" value={exercise.name} disabled={!editable} onChange={(event) => update((item) => { item.name = event.target.value; })} /><strong>{pace(exercise.distanceKm, exercise.durationSeconds)}</strong></div>
    <div className="runGrid">
      <label>km<input type="number" inputMode="decimal" value={exercise.distanceKm ?? ""} disabled={!editable} onChange={(event) => field("distanceKm", event.target.value)} /></label>
      <label>分鐘<input type="number" inputMode="decimal" value={exercise.durationSeconds === null ? "" : exercise.durationSeconds / 60} disabled={!editable} onChange={(event) => field("durationSeconds", event.target.value === "" ? "" : String(Number(event.target.value) * 60))} /></label>
      <label>平均心率<input type="number" value={exercise.averageHeartRate ?? ""} disabled={!editable} onChange={(event) => field("averageHeartRate", event.target.value)} /></label>
      <label>最高心率<input type="number" value={exercise.maximumHeartRate ?? ""} disabled={!editable} onChange={(event) => field("maximumHeartRate", event.target.value)} /></label>
      <label>°C<input type="number" value={exercise.temperatureC ?? ""} disabled={!editable} onChange={(event) => field("temperatureC", event.target.value)} /></label>
      <label>爬升 m<input type="number" value={exercise.elevationGainM ?? ""} disabled={!editable} onChange={(event) => field("elevationGainM", event.target.value)} /></label>
      <label>RPE<input type="number" value={exercise.rpe ?? ""} disabled={!editable} onChange={(event) => field("rpe", event.target.value)} /></label>
    </div>
    <div className="runSegments">
      {exercise.segments.map((segment, index) => <div key={segment.id}><span>{index + 1}</span><input aria-label="分段公里" type="number" inputMode="decimal" placeholder="km" value={segment.distanceKm ?? ""} disabled={!editable} onChange={(event) => update((item) => { if (item.kind === "running") item.segments[index].distanceKm = numberValue(event.target.value); })} /><input aria-label="分段分鐘" type="number" inputMode="decimal" placeholder="分鐘" value={segment.durationSeconds === null ? "" : segment.durationSeconds / 60} disabled={!editable} onChange={(event) => update((item) => { if (item.kind === "running") item.segments[index].durationSeconds = event.target.value === "" ? null : Number(event.target.value) * 60; })} /></div>)}
      {editable ? <button onClick={() => update((item) => { if (item.kind === "running") item.segments.push({ id: crypto.randomUUID(), distanceKm: null, durationSeconds: null }); })}>＋ 分段</button> : null}
    </div>
    <textarea placeholder="跑步註記" value={exercise.note} disabled={!editable} onChange={(event) => update((item) => { item.note = event.target.value; })} />
  </div></details>;
}
