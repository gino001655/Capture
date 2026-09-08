"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  RunningExercise,
  StrengthExercise,
  WorkoutExercise,
  WorkoutPayload,
  WorkoutRecord,
  WorkoutSession,
  WorkoutSet,
} from "../lib/workout-record";
import { emptyWorkoutPayload } from "../lib/workout-record";
import { shiftJournalDate } from "./journal-session";
import { ModuleRail, type CaptureModule } from "./module-rail";
import { toTaipeiDate } from "../lib/special-record";

const CACHE_KEY = "capture.workout.v1";
const AUTOSAVE_MS = 800;

type LocalWorkout = {
  payload: WorkoutPayload;
  revision: number | null;
  pending: boolean;
  clientUpdatedAt: string;
};
type Cache = Record<string, LocalWorkout>;

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

export function WorkoutApp({
  active,
  onSelectModule,
}: {
  active: boolean;
  onSelectModule(module: CaptureModule): void;
}) {
  const today = toTaipeiDate(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [local, setLocal] = useState<LocalWorkout>(() => readCache()[today] ?? {
    payload: emptyWorkoutPayload(), revision: null, pending: false, clientUpdatedAt: new Date().toISOString(),
  });
  const [history, setHistory] = useState<WorkoutRecord[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [newExerciseName, setNewExerciseName] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const timerRef = useRef<number | null>(null);
  const touchStartRef = useRef<number | null>(null);
  const localRef = useRef(local);
  const dateRef = useRef(selectedDate);

  const publish = useCallback((date: string, next: LocalWorkout) => {
    localRef.current = next;
    if (date === dateRef.current) setLocal(next);
    const cache = readCache();
    if (next.payload.sessions.length === 0 && !next.pending && next.revision === null) delete cache[date];
    else cache[date] = next;
    writeCache(cache);
  }, []);

  const sync = useCallback(async (date: string, candidate = localRef.current) => {
    if (!candidate.pending) return;
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
        setIssue(result?.error?.code === "REVISION_CONFLICT" ? "另一台裝置已有較新的訓練紀錄" : "尚未同步");
        return;
      }
      const current = readCache()[date] ?? candidate;
      const revision = result.record?.revision ?? null;
      if (current.clientUpdatedAt === candidate.clientUpdatedAt) {
        publish(date, { ...current, revision, pending: false });
      }
      setIssue(null);
    } catch { setIssue("尚未同步"); }
  }, [publish]);

  const scheduleSync = useCallback((date: string) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void sync(date), AUTOSAVE_MS);
  }, [sync]);

  const mutate = useCallback((change: (payload: WorkoutPayload) => WorkoutPayload) => {
    const next: LocalWorkout = {
      ...localRef.current,
      payload: change(structuredClone(localRef.current.payload)),
      pending: true,
      clientUpdatedAt: new Date().toISOString(),
    };
    publish(dateRef.current, next);
    scheduleSync(dateRef.current);
  }, [publish, scheduleSync]);

  const load = useCallback(async (date: string) => {
    dateRef.current = date;
    setSelectedDate(date);
    setIssue(null);
    const cached = readCache()[date];
    if (cached?.pending) {
      publish(date, cached);
      void sync(date, cached);
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
        setSessionIndex(openIndex >= 0 ? openIndex : Math.max(0, next.payload.sessions.length - 1));
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
  }, [active, load]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const editable = selectedDate === today || selectedDate === shiftJournalDate(today, -1);
  const session = local.payload.sessions[sessionIndex] ?? null;
  const recentExercises = useMemo(() => {
    const names: string[] = [];
    for (const record of history) for (const item of record.payload.sessions) for (const exercise of item.exercises) {
      if (!names.includes(exercise.name)) names.push(exercise.name);
    }
    return names.slice(0, 6);
  }, [history]);

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

  function previousStrength(name: string): StrengthExercise | undefined {
    for (const record of history) for (const item of record.payload.sessions) {
      const found = item.exercises.find((exercise): exercise is StrengthExercise =>
        exercise.kind === "strength" && exercise.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      );
      if (found) return found;
    }
    return undefined;
  }

  function addStrength(name: string) {
    const trimmed = name.trim();
    if (!trimmed || !session) return;
    const previous = previousStrength(trimmed);
    const exercise: StrengthExercise = {
      id: crypto.randomUUID(), kind: "strength", name: trimmed, note: "",
      sets: previous?.sets.length ? previous.sets.map(blankSet) : [blankSet()],
    };
    updateSession((target) => target.exercises.push(exercise));
    setNewExerciseName("");
  }

  function addRun() {
    if (!session) return;
    const exercise: RunningExercise = {
      id: crypto.randomUUID(), kind: "running", name: "跑步", note: "",
      distanceKm: null, durationSeconds: null, averageHeartRate: null, maximumHeartRate: null,
      temperatureC: null, elevationGainM: null, rpe: null, segments: [],
    };
    updateSession((target) => target.exercises.push(exercise));
  }

  function updateExercise(id: string, change: (exercise: WorkoutExercise) => void) {
    updateSession((target) => {
      const exercise = target.exercises.find((item) => item.id === id);
      if (exercise) change(exercise);
    });
  }

  function elapsed(session: WorkoutSession) {
    const base = session.restTimer.elapsedSeconds;
    return clock > 0 && session.restTimer.running && session.restTimer.startedAt
      ? base + Math.floor((clock - Date.parse(session.restTimer.startedAt)) / 1_000)
      : base;
  }

  if (!active) return null;
  return (
    <main
      className="workoutShell"
      onPointerDown={(event) => { if (event.pointerType === "touch") touchStartRef.current = event.clientX; }}
      onPointerUp={(event) => {
        if (event.pointerType !== "touch" || touchStartRef.current === null) return;
        const delta = event.clientX - touchStartRef.current;
        touchStartRef.current = null;
        if (Math.abs(delta) > 70) void load(shiftJournalDate(selectedDate, delta > 0 ? -1 : 1));
      }}
    >
      <header className="workoutToolbar">
        <button type="button" onClick={() => setHistoryOpen((open) => !open)} aria-label="訓練歷史">≡</button>
        <label>{selectedDate.slice(5).replace("-", ".")}<input type="date" max={today} value={selectedDate} onChange={(event) => void load(event.target.value)} /></label>
        <span className={local.pending ? "workoutSync pending" : "workoutSync"}>{issue ? "!" : local.pending ? "·" : ""}</span>
      </header>

      {historyOpen ? (
        <section className="workoutHistory">
          {history.map((record) => (
            <button key={record.id} onClick={() => { setHistoryOpen(false); void load(record.journalDate); }}>
              <time>{record.journalDate.slice(5).replace("-", ".")}</time>
              <span>{record.payload.sessions.map((item) => item.name || item.exercises.map((exercise) => exercise.name).join(" · ")).join(" / ")}</span>
            </button>
          ))}
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
              <button type="button" disabled={!editable} onClick={addSession}>＋</button>
              <div>{recentExercises.map((name) => <span key={name}>{name}</span>)}</div>
            </div>
          ) : (
            <div className={editable ? "workoutSession" : "workoutSession locked"}>
              <div className="sessionHeader">
                <input aria-label="訓練名稱" placeholder="訓練" value={session.name} disabled={!editable} onChange={(event) => updateSession((target) => { target.name = event.target.value; })} />
                <button type="button" disabled={!editable} onClick={() => updateSession((target) => { target.completedAt = target.completedAt ? null : new Date().toISOString(); })}>{session.completedAt ? "↶" : "✓"}</button>
              </div>

              {session.exercises.map((exercise) => exercise.kind === "strength" ? (
                <StrengthEditor key={exercise.id} exercise={exercise} editable={editable}
                  update={(change) => updateExercise(exercise.id, change)}
                  confirmSet={(setId) => updateSession((target) => {
                    const item = target.exercises.find((candidate) => candidate.id === exercise.id);
                    if (item?.kind !== "strength") return;
                    const set = item.sets.find((candidate) => candidate.id === setId);
                    if (set) set.confirmed = true;
                    target.restTimer = { startedAt: new Date().toISOString(), elapsedSeconds: 0, running: true };
                  })}
                />
              ) : (
                <RunningEditor key={exercise.id} exercise={exercise} editable={editable} update={(change) => updateExercise(exercise.id, change)} />
              ))}

              {editable ? (
                <div className="addExercise">
                  <input value={newExerciseName} placeholder="動作" onChange={(event) => setNewExerciseName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addStrength(newExerciseName); }} />
                  <button onClick={() => addStrength(newExerciseName)}>＋</button>
                  <button onClick={addRun}>跑</button>
                  <div>{recentExercises.map((name) => <button key={name} onClick={() => addStrength(name)}>{name}</button>)}</div>
                </div>
              ) : null}

              <textarea className="sessionNote" aria-label="訓練註記" placeholder="註記" value={session.note} disabled={!editable} onChange={(event) => updateSession((target) => { target.note = event.target.value; })} />

              <div className="restTimer">
                <strong>{Math.floor(elapsed(session) / 60)}:{String(elapsed(session) % 60).padStart(2, "0")}</strong>
                {editable ? <>
                  <button onClick={() => updateSession((target) => {
                    const seconds = elapsed(target);
                    target.restTimer = target.restTimer.running
                      ? { startedAt: null, elapsedSeconds: seconds, running: false }
                      : { startedAt: new Date().toISOString(), elapsedSeconds: seconds, running: true };
                  })}>{session.restTimer.running ? "Ⅱ" : "▶"}</button>
                  <button onClick={() => updateSession((target) => { target.restTimer = { startedAt: null, elapsedSeconds: 0, running: false }; })}>↺</button>
                </> : null}
              </div>
              {editable ? <button className="newSession" onClick={addSession}>＋ session</button> : <span className="workoutLock">◇</span>}
            </div>
          )}
        </section>
      )}
      <ModuleRail active="workout" onSelect={onSelectModule} />
    </main>
  );
}

function numberValue(value: string) { return value === "" ? null : Number(value); }

function StrengthEditor({ exercise, editable, update, confirmSet }: {
  exercise: StrengthExercise;
  editable: boolean;
  update(change: (exercise: WorkoutExercise) => void): void;
  confirmSet(id: string): void;
}) {
  return <article className="strengthExercise">
    <input className="exerciseName" value={exercise.name} disabled={!editable} onChange={(event) => update((item) => { item.name = event.target.value; })} />
    <div className="setLabels"><span>#</span><span>kg</span><span>次</span><span>RPE</span><span>RIR</span><span /></div>
    {exercise.sets.map((set, index) => <div className="workoutSetBlock" key={set.id}><div className={set.confirmed ? "workoutSet confirmed" : "workoutSet ghost"}>
      <span>{index + 1}</span>
      <input type="number" inputMode="decimal" value={set.weightKg ?? ""} disabled={!editable} onChange={(event) => update((item) => { if (item.kind === "strength") item.sets[index].weightKg = numberValue(event.target.value); })} />
      <input type="number" inputMode="numeric" value={set.reps ?? ""} disabled={!editable} onChange={(event) => update((item) => { if (item.kind === "strength") item.sets[index].reps = numberValue(event.target.value); })} />
      <input type="number" inputMode="decimal" value={set.rpe ?? ""} disabled={!editable} onChange={(event) => update((item) => { if (item.kind === "strength") item.sets[index].rpe = numberValue(event.target.value); })} />
      <input type="number" inputMode="decimal" value={set.rir ?? ""} disabled={!editable} onChange={(event) => update((item) => { if (item.kind === "strength") item.sets[index].rir = numberValue(event.target.value); })} />
      <button disabled={!editable} onClick={() => confirmSet(set.id)}>{set.confirmed ? "✓" : "○"}</button>
    </div><div className="workoutSetMeta"><select value={set.type} disabled={!editable} onChange={(event) => update((item) => { if (item.kind === "strength") item.sets[index].type = event.target.value as WorkoutSet["type"]; })}><option value="working">正式</option><option value="warmup">熱身</option><option value="drop">遞減</option><option value="failure">力竭</option></select><input placeholder="這組註記" value={set.note} disabled={!editable} onChange={(event) => update((item) => { if (item.kind === "strength") item.sets[index].note = event.target.value; })} /></div></div>)}
    {editable ? <button className="cloneSet" onClick={() => update((item) => { if (item.kind === "strength") item.sets.push(blankSet(item.sets[item.sets.length - 1])); })}>＋ set</button> : null}
    <textarea placeholder="動作註記" value={exercise.note} disabled={!editable} onChange={(event) => update((item) => { item.note = event.target.value; })} />
  </article>;
}

function RunningEditor({ exercise, editable, update }: {
  exercise: RunningExercise;
  editable: boolean;
  update(change: (exercise: WorkoutExercise) => void): void;
}) {
  const field = (key: keyof RunningExercise, value: string) => update((item) => {
    if (item.kind === "running") (item as unknown as Record<string, unknown>)[key] = numberValue(value);
  });
  return <article className="runningExercise">
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
  </article>;
}
