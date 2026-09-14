import { invoke } from "@tauri-apps/api/core";
import { clampRecorderDate, createDateBoundDebounce, nextRecorderToday, rebaseConflictCandidate, resolveVersionedPayloadConflict } from "@capture/recorder-kit";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type {
  StrengthExercise,
  RunningSegment,
  WorkoutExercise,
  WorkoutPayload,
  WorkoutRecord,
  WorkoutSession,
  WorkoutSet,
} from "../../../web/src/lib/workout-record";
import { elapsedWorkoutTimer, emptyWorkoutPayload, nextWorkoutSetIndex } from "../../../web/src/lib/workout-record";
import type { WorkoutLibraryEntry, WorkoutLibraryPayload, WorkoutLibraryRecord } from "../../../web/src/lib/workout-library";
import { emptyWorkoutLibrary } from "../../../web/src/lib/workout-library";
import type { CapturePageDefinition, CapturePageProps } from "./types";

const CACHE_KEY = "capture.desktop.workout.v1";
type LocalWorkout = { payload: WorkoutPayload; revision: number | null; pending: boolean; clientUpdatedAt: string; conflict?: { cloud: WorkoutRecord | null } };
type Cache = Record<string, LocalWorkout>;
type SaveResult<T> = { record: T | null; conflict: boolean };

function taipeiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function readCache(): Cache {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}"); } catch { return {}; }
}
function writeCache(cache: Cache) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* memory remains */ } }
function blankSet(source?: WorkoutSet): WorkoutSet {
  return { id: crypto.randomUUID(), weightKg: source?.weightKg ?? null, reps: source?.reps ?? null, rpe: source?.rpe ?? null, rir: source?.rir ?? null, type: source?.type ?? "working", note: "", confirmed: false };
}
function newSession(): WorkoutSession {
  return { id: crypto.randomUUID(), name: "", note: "", startedAt: new Date().toISOString(), completedAt: null, restTimer: { startedAt: null, elapsedSeconds: 0, running: false }, exercises: [] };
}
function numeric(value: string) { return value === "" ? null : Number(value); }

function WorkoutPage({ requestModeChange }: CapturePageProps) {
  const [today, setToday] = useState(taipeiDate);
  const [date, setDate] = useState(today);
  const [local, setLocal] = useState<LocalWorkout>(() => readCache()[today] ?? { payload: emptyWorkoutPayload(), revision: null, pending: false, clientUpdatedAt: new Date().toISOString() });
  const [history, setHistory] = useState<WorkoutRecord[]>([]);
  const [library, setLibrary] = useState<WorkoutLibraryPayload>(emptyWorkoutLibrary);
  const [libraryRevision, setLibraryRevision] = useState<number | null>(null);
  const [libraryConflict, setLibraryConflict] = useState<{ local: WorkoutLibraryPayload; cloud: WorkoutLibraryRecord | null } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [name, setName] = useState("");
  const [issue, setIssue] = useState(false);
  const [now, setNow] = useState(Date.now());
  const localRef = useRef(local);
  const dateRef = useRef(date);
  const todayRef = useRef(today);
  const syncDebounceRef = useRef<ReturnType<typeof createDateBoundDebounce<LocalWorkout>> | null>(null);
  syncDebounceRef.current ??= createDateBoundDebounce<LocalWorkout>({ delayMs: 800, schedule: (callback, delayMs) => window.setTimeout(callback, delayMs), cancel: (handle) => window.clearTimeout(handle as number) });
  const editable = date === today;
  const activeSession = local.payload.sessions.find((item) => item.completedAt === null) ?? local.payload.sessions[local.payload.sessions.length - 1] ?? null;

  const publish = useCallback((targetDate: string, next: LocalWorkout) => {
    if (targetDate === dateRef.current) {
      localRef.current = next;
      setLocal(next);
    }
    const cache = readCache(); cache[targetDate] = next; writeCache(cache);
  }, []);

  const syncingDates = useRef(new Set<string>());
  const sync = useCallback(async (targetDate: string, candidate = localRef.current) => {
    if (!candidate.pending || candidate.conflict) return;
    if (syncingDates.current.has(targetDate)) return;
    syncingDates.current.add(targetDate);
    try {
      const result = await invoke<SaveResult<WorkoutRecord>>("save_workout_record", { input: {
        journalDate: targetDate, payload: candidate.payload, expectedRevision: candidate.revision, clientUpdatedAt: candidate.clientUpdatedAt,
      } });
      if (result.conflict) { const current = readCache()[targetDate] ?? candidate; publish(targetDate, { ...current, conflict: { cloud: result.record } }); setIssue(true); return; }
      const current = readCache()[targetDate] ?? candidate;
      if (current.clientUpdatedAt === candidate.clientUpdatedAt) publish(targetDate, { ...current, revision: result.record?.revision ?? null, pending: false, conflict: undefined }); else { const next = { ...current, revision: result.record?.revision ?? null }; publish(targetDate, next); syncDebounceRef.current?.queue(targetDate, next, sync); }
      setIssue(false);
    } catch { setIssue(true); } finally { syncingDates.current.delete(targetDate); }
  }, [publish]);

  const mutate = useCallback((change: (payload: WorkoutPayload) => void) => {
    const payload = structuredClone(localRef.current.payload); change(payload);
    const next = { ...localRef.current, payload, pending: true, clientUpdatedAt: new Date().toISOString() };
    const targetDate = dateRef.current;
    publish(targetDate, next);
    syncDebounceRef.current?.queue(targetDate, next, sync);
  }, [publish, sync]);

  const load = useCallback(async (targetDate: string) => {
    targetDate = clampRecorderDate(targetDate, todayRef.current);
    dateRef.current = targetDate; setDate(targetDate);
    const cached = readCache()[targetDate];
    if (cached?.pending) { publish(targetDate, cached); void sync(targetDate, cached); return; }
    try {
      const record = await invoke<WorkoutRecord | null>("get_workout_record", { journalDate: targetDate });
      publish(targetDate, record
        ? { payload: record.payload, revision: record.revision, pending: false, clientUpdatedAt: record.updatedAt }
        : { payload: emptyWorkoutPayload(), revision: null, pending: false, clientUpdatedAt: new Date().toISOString() });
      setIssue(false);
    } catch { setIssue(true); }
  }, [publish, sync]);

  useEffect(() => { void load(todayRef.current); void invoke<WorkoutRecord[]>("list_workout_records").then(setHistory).catch(() => setIssue(true)); void invoke<WorkoutLibraryRecord | null>("get_workout_library").then((record) => { setLibrary(record?.payload ?? emptyWorkoutLibrary()); setLibraryRevision(record?.revision ?? null); }).catch(() => setIssue(true)); }, [load]);
  useEffect(() => { const retryPending = () => { for (const [targetDate, candidate] of Object.entries(readCache())) if (candidate.pending) void sync(targetDate, candidate); }; window.addEventListener("online", retryPending); return () => { window.removeEventListener("online", retryPending); syncDebounceRef.current?.cancel(); }; }, [sync]);
  useEffect(() => { const id = window.setInterval(() => { const current = new Date(); setNow(current.getTime()); const nextToday = nextRecorderToday(todayRef.current, taipeiDate()); if (!nextToday) return; const previousDate = dateRef.current; const previous = readCache()[previousDate] ?? localRef.current; if (previous.pending) void sync(previousDate, previous); todayRef.current = nextToday; setToday(nextToday); void load(nextToday); }, 1_000); return () => window.clearInterval(id); }, [load, sync]);

  const recent = useMemo(() => {
    const names = library.entries.filter((entry) => !entry.archived).sort((left, right) => left.order - right.order).map((entry) => entry.name);
    for (const record of history) for (const item of record.payload.sessions) for (const exercise of item.exercises) if (!names.includes(exercise.name)) names.push(exercise.name);
    return names.slice(0, 5);
  }, [history, library]);

  function keyNavigation(event: KeyboardEvent<HTMLElement>) {
    if (!event.ctrlKey && event.key === "Enter" && event.target instanceof HTMLInputElement) {
      const row = event.target.closest<HTMLElement>(".desktopSet");
      if (!row) return;
      event.preventDefault();
      const exercise = row.closest("article");
      const rows = [...(exercise ?? event.currentTarget).querySelectorAll<HTMLElement>(".desktopSet")];
      const index = rows.indexOf(row);
      row.querySelector<HTMLButtonElement>("button")?.click();
      const nextIndex = nextWorkoutSetIndex(index, rows.length);
      if (nextIndex !== null) queueMicrotask(() => rows[nextIndex]?.querySelector<HTMLInputElement>("input")?.focus());
      return;
    }
    if (!event.ctrlKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault(); requestModeChange(event.key === "ArrowLeft" ? -1 : 1);
    }
  }
  function useCloudVersion() { const cloud = localRef.current.conflict?.cloud; const next: LocalWorkout = cloud ? { payload: cloud.payload, revision: cloud.revision, pending: false, clientUpdatedAt: cloud.updatedAt } : { payload: emptyWorkoutPayload(), revision: null, pending: false, clientUpdatedAt: new Date().toISOString() }; publish(date, next); setIssue(false); }
  function keepLocalVersion() { const current = localRef.current; if (!current.conflict) return; const { conflict, ...withoutConflict } = current; const next = rebaseConflictCandidate(withoutConflict, conflict.cloud?.revision ?? null); publish(date, next); setIssue(false); void sync(date, next); }
  function updateSession(change: (value: WorkoutSession) => void) {
    if (!activeSession) return;
    mutate((payload) => { const target = payload.sessions.find((item) => item.id === activeSession.id); if (target) change(target); });
  }
  function previous(exerciseName: string, libraryEntryId?: string) {
    for (const record of history) for (const item of record.payload.sessions) {
      const found = item.exercises.find((exercise): exercise is StrengthExercise => exercise.kind === "strength" && (
        (libraryEntryId !== undefined && exercise.libraryEntryId === libraryEntryId) ||
        (!exercise.libraryEntryId && exercise.name.toLowerCase() === exerciseName.toLowerCase())
      ));
      if (found) return found;
    }
  }
  function stats(exerciseName: string, libraryEntryId?: string) {
    let sessions = 0; let maximumWeight: number | null = null; let estimatedOneRepMax: number | null = null; let recentNote = "";
    for (const record of history) for (const session of record.payload.sessions) for (const exercise of session.exercises) {
      if (exercise.kind !== "strength" || !(
        (libraryEntryId !== undefined && exercise.libraryEntryId === libraryEntryId) ||
        (!exercise.libraryEntryId && exercise.name.toLocaleLowerCase() === exerciseName.toLocaleLowerCase())
      )) continue;
      sessions += 1;
      if (!recentNote && exercise.note.trim()) recentNote = exercise.note.trim();
      for (const set of exercise.sets) {
        if (set.weightKg !== null) maximumWeight = Math.max(maximumWeight ?? set.weightKg, set.weightKg);
        if (set.weightKg !== null && set.reps !== null) estimatedOneRepMax = Math.max(estimatedOneRepMax ?? 0, Math.round(set.weightKg * (1 + set.reps / 30) * 10) / 10);
      }
    }
    return { sessions, maximumWeight, estimatedOneRepMax, recentNote };
  }
  function addExercise(raw: string) {
    const exerciseName = raw.trim(); if (!exerciseName || !activeSession) return;
    let entry = library.entries.find((item) => item.name.toLocaleLowerCase() === exerciseName.toLocaleLowerCase());
    if (!entry) {
      entry = { id: crypto.randomUUID(), name: exerciseName, order: library.entries.length, archived: false };
      void saveLibrary({ ...library, entries: [...library.entries, entry] });
    }
    const old = previous(exerciseName, entry.id);
    updateSession((target) => target.exercises.push({ id: crypto.randomUUID(), kind: "strength", libraryEntryId: entry.id, name: exerciseName, note: "", sets: old?.sets.length ? old.sets.map(blankSet) : [blankSet()] }));
    setName("");
  }
  async function saveLibrary(next: WorkoutLibraryPayload, expectedRevision = libraryRevision) {
    setLibrary(next);
    try {
      const result = await invoke<SaveResult<WorkoutLibraryRecord>>("save_workout_library", { input: { payload: next, expectedRevision } });
      if (result.conflict) { setLibraryConflict({ local: structuredClone(next), cloud: result.record }); setIssue(true); return; }
      setLibrary(result.record?.payload ?? next); setLibraryRevision(result.record?.revision ?? expectedRevision); setLibraryConflict(null); setIssue(false);
    } catch { setIssue(true); }
  }
  function resolveLibraryConflict(choice: "cloud" | "local") { if (!libraryConflict) return; const resolution = resolveVersionedPayloadConflict(libraryConflict.local, libraryConflict.cloud, choice, emptyWorkoutLibrary()); setLibrary(resolution.payload); setLibraryRevision(resolution.revision); setLibraryConflict(null); setIssue(resolution.retry); if (resolution.retry) void saveLibrary(resolution.payload, resolution.revision); }
  function libraryEntryUsed(entry: WorkoutLibraryEntry) {
    return history.some((record) => record.payload.sessions.some((session) =>
      session.exercises.some((exercise) => exercise.kind === "strength" && (
        exercise.libraryEntryId === entry.id ||
        (!exercise.libraryEntryId && exercise.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase())
      )),
    ));
  }
  function addRun() {
    if (!activeSession) return;
    updateSession((target) => target.exercises.push({
      id: crypto.randomUUID(), kind: "running", name: "跑步", note: "",
      distanceKm: null, durationSeconds: null, averageHeartRate: null, maximumHeartRate: null,
      temperatureC: null, elevationGainM: null, rpe: null, segments: [],
    }));
  }
  function updateExercise(id: string, change: (exercise: WorkoutExercise) => void) {
    updateSession((target) => { const exercise = target.exercises.find((item) => item.id === id); if (exercise) change(exercise); });
  }
  function elapsed(target: WorkoutSession) {
    return elapsedWorkoutTimer(target.restTimer, now);
  }

  return <main className="captureExtensionPage desktopWorkout viewEnter" aria-label="重訓紀錄" tabIndex={0} onKeyDown={keyNavigation}>
    <header><button onClick={() => setLibraryOpen((open) => !open)}>≡</button><label>{date.slice(5).replace("-", ".")}<input type="date" max={today} value={date} onChange={(event) => void load(event.target.value)} /></label><span>{issue ? "!" : local.pending ? "·" : ""}</span></header>
    {local.conflict ? <div className="specialConflict" role="alert"><span>版本</span><button type="button" onClick={useCloudVersion}>雲端</button><button type="button" onClick={keepLocalVersion}>本機</button></div> : null}
    {libraryConflict ? <div className="specialConflict" role="alert"><span>動作庫</span><button type="button" onClick={() => resolveLibraryConflict("cloud")}>雲端</button><button type="button" onClick={() => resolveLibraryConflict("local")}>本機</button></div> : null}
    <section>
      {libraryOpen ? <div className="desktopLibrary">{library.entries.slice().sort((left, right) => left.order - right.order).map((entry, index, entries) => <div key={entry.id} className={entry.archived ? "archived" : ""}><input value={entry.name} onChange={(event) => setLibrary((current) => ({ ...current, entries: current.entries.map((item) => item.id === entry.id ? { ...item, name: event.target.value } : item) }))} onBlur={(event) => { const nextName = event.target.value.trim(); if (nextName) void saveLibrary({ ...library, entries: library.entries.map((item) => item.id === entry.id ? { ...item, name: nextName } : item) }); }} /><button disabled={index === 0} onClick={() => { const next = entries.slice(); [next[index - 1], next[index]] = [next[index], next[index - 1]]; void saveLibrary({ ...library, entries: next.map((item, order) => ({ ...item, order })) }); }}>↑</button><button disabled={index === entries.length - 1} onClick={() => { const next = entries.slice(); [next[index], next[index + 1]] = [next[index + 1], next[index]]; void saveLibrary({ ...library, entries: next.map((item, order) => ({ ...item, order })) }); }}>↓</button><button onClick={() => void saveLibrary({ ...library, entries: library.entries.map((item) => item.id === entry.id ? { ...item, archived: !item.archived } : item) })}>{entry.archived ? "◇" : "—"}</button>{!libraryEntryUsed(entry) ? <button onClick={() => void saveLibrary({ ...library, entries: library.entries.filter((item) => item.id !== entry.id).map((item, order) => ({ ...item, order })) })}>×</button> : <span />}</div>)}</div> : !activeSession ? <div className="desktopWorkoutEmpty"><button disabled={!editable} onClick={() => mutate((payload) => payload.sessions.push(newSession()))}>＋</button>{recent.map((item) => <small key={item}>{item}</small>)}</div> : <>
        <div className="desktopWorkoutSession"><input placeholder="訓練" value={activeSession.name} disabled={!editable} onChange={(event) => updateSession((target) => { target.name = event.target.value; })} /><button disabled={!editable} onClick={() => updateSession((target) => { target.completedAt = target.completedAt ? null : new Date().toISOString(); })}>{activeSession.completedAt ? "↶" : "✓"}</button></div>
        {activeSession.exercises.map((exercise: WorkoutExercise) => exercise.kind === "strength" ? <article key={exercise.id}>
          <input className="desktopExerciseName" value={exercise.name} disabled={!editable} onChange={(event) => updateExercise(exercise.id, (target) => { target.name = event.target.value; })} />
          {(() => { const summary = stats(exercise.name, exercise.libraryEntryId); return summary.sessions ? <div className="desktopStrengthStats"><span>{summary.sessions} 次</span>{summary.maximumWeight !== null ? <span>max {summary.maximumWeight} kg</span> : null}{summary.estimatedOneRepMax !== null ? <span>e1RM {summary.estimatedOneRepMax}</span> : null}{summary.recentNote ? <small>{summary.recentNote}</small> : null}</div> : null; })()}
          <div className="desktopSet labels"><span>#</span><span>kg</span><span>次</span><span>RPE</span><span>RIR</span><span /></div>
          {exercise.sets.map((set: WorkoutSet, index: number) => <div key={set.id} className="desktopSetBlock"><div className={set.confirmed ? "desktopSet" : "desktopSet ghost"}><span>{index + 1}</span>{(["weightKg", "reps", "rpe", "rir"] as const).map((key) => <input key={key} type="number" value={set[key] ?? ""} disabled={!editable} onChange={(event) => updateExercise(exercise.id, (target) => { if (target.kind === "strength") target.sets[index][key] = numeric(event.target.value); })} />)}<button disabled={!editable} onClick={() => updateSession((target) => { const item = target.exercises.find((candidate) => candidate.id === exercise.id); if (item?.kind === "strength") item.sets[index].confirmed = true; target.restTimer = { startedAt: new Date().toISOString(), elapsedSeconds: 0, running: true }; })}>{set.confirmed ? "✓" : "○"}</button></div><div className="desktopSetMeta"><select value={set.type} disabled={!editable} onChange={(event) => updateExercise(exercise.id, (target) => { if (target.kind === "strength") target.sets[index].type = event.target.value as WorkoutSet["type"]; })}><option value="working">正式</option><option value="warmup">熱身</option><option value="drop">遞減</option><option value="failure">力竭</option></select><input placeholder="這組註記" value={set.note} disabled={!editable} onChange={(event) => updateExercise(exercise.id, (target) => { if (target.kind === "strength") target.sets[index].note = event.target.value; })} /></div></div>)}
          {editable ? <button className="desktopAddSet" onClick={() => updateExercise(exercise.id, (target) => { if (target.kind === "strength") target.sets.push(blankSet(target.sets[target.sets.length - 1])); })}>＋ set</button> : null}
          <textarea placeholder="動作註記" value={exercise.note} disabled={!editable} onChange={(event) => updateExercise(exercise.id, (target) => { target.note = event.target.value; })} />
        </article> : <article className="desktopRun" key={exercise.id}>
          <div><input className="desktopExerciseName" value={exercise.name} disabled={!editable} onChange={(event) => updateExercise(exercise.id, (target) => { target.name = event.target.value; })} /><strong>{exercise.distanceKm && exercise.durationSeconds ? `${Math.floor(exercise.durationSeconds / exercise.distanceKm / 60)}:${String(Math.round(exercise.durationSeconds / exercise.distanceKm) % 60).padStart(2, "0")}/km` : "—"}</strong></div>
          <div className="desktopRunGrid">{([
            ["distanceKm", "km", 1], ["durationSeconds", "分鐘", 60], ["averageHeartRate", "平均心率", 1], ["maximumHeartRate", "最高心率", 1], ["temperatureC", "°C", 1], ["elevationGainM", "爬升 m", 1], ["rpe", "RPE", 1],
          ] as const).map(([key, label, multiplier]) => <label key={key}>{label}<input type="number" value={exercise[key] === null ? "" : Number(exercise[key]) / multiplier} disabled={!editable} onChange={(event) => updateExercise(exercise.id, (target) => { if (target.kind === "running") target[key] = event.target.value === "" ? null : Number(event.target.value) * multiplier; })} /></label>)}</div>
          <div className="desktopSegments">{exercise.segments.map((segment: RunningSegment, index: number) => <div key={segment.id}><span>{index + 1}</span><input aria-label="分段公里" type="number" placeholder="km" value={segment.distanceKm ?? ""} disabled={!editable} onChange={(event) => updateExercise(exercise.id, (target) => { if (target.kind === "running") target.segments[index].distanceKm = numeric(event.target.value); })} /><input aria-label="分段分鐘" type="number" placeholder="分鐘" value={segment.durationSeconds === null ? "" : segment.durationSeconds / 60} disabled={!editable} onChange={(event) => updateExercise(exercise.id, (target) => { if (target.kind === "running") target.segments[index].durationSeconds = event.target.value === "" ? null : Number(event.target.value) * 60; })} /></div>)}{editable ? <button onClick={() => updateExercise(exercise.id, (target) => { if (target.kind === "running") target.segments.push({ id: crypto.randomUUID(), distanceKm: null, durationSeconds: null }); })}>＋ 分段</button> : null}</div>
          <textarea placeholder="跑步註記" value={exercise.note} disabled={!editable} onChange={(event) => updateExercise(exercise.id, (target) => { target.note = event.target.value; })} />
        </article>)}
        {editable ? <div className="desktopAddExercise"><input placeholder="動作" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addExercise(name); }} /><button onClick={() => addExercise(name)}>＋</button><button onClick={addRun}>跑</button><div>{recent.map((item) => <button key={item} onClick={() => addExercise(item)}>{item}</button>)}</div></div> : null}
        <textarea className="desktopSessionNote" placeholder="訓練註記" value={activeSession.note} disabled={!editable} onChange={(event) => updateSession((target) => { target.note = event.target.value; })} />
        <div className="desktopRest"><strong>{Math.floor(elapsed(activeSession) / 60)}:{String(elapsed(activeSession) % 60).padStart(2, "0")}</strong>{editable ? <><button onClick={() => updateSession((target) => { const seconds = elapsed(target); target.restTimer = target.restTimer.running ? { startedAt: null, elapsedSeconds: seconds, running: false } : { startedAt: new Date().toISOString(), elapsedSeconds: seconds, running: true }; })}>{activeSession.restTimer.running ? "Ⅱ" : "▶"}</button><button onClick={() => updateSession((target) => { target.restTimer = { startedAt: null, elapsedSeconds: 0, running: false }; })}>↺</button></> : null}</div>
      </>}
    </section>
  </main>;
}

export default { id: "workout", Component: WorkoutPage } satisfies CapturePageDefinition;
