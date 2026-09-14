"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FoodEntry, FoodPayload, FoodRecord } from "../lib/food-record";
import { emptyFoodPayload, isFoodPayloadReady } from "../lib/food-record";
import { toTaipeiDate } from "../lib/special-record";
import { shiftJournalDate } from "./journal-session";
import { ModuleRail, type CaptureModule } from "./module-rail";
import type { FoodLibraryEntry, FoodLibraryPayload, FoodLibraryRecord } from "../lib/food-library";
import { emptyFoodLibrary } from "../lib/food-library";
import { clampRecorderDate, createDateBoundDebounce, nextRecorderToday, rebaseConflictCandidate, resolveVersionedPayloadConflict } from "@capture/recorder-kit";

const CACHE_KEY = "capture.food.v1";
type LocalFood = { payload: FoodPayload; revision: number | null; pending: boolean; clientUpdatedAt: string; conflict?: { cloud: FoodRecord | null } };
type Cache = Record<string, LocalFood>;
function cache(): Cache { try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}"); } catch { return {}; } }
function persist(values: Cache) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(values)); } catch { /* memory remains */ } }
function number(value: string) { return value === "" ? null : Number(value); }

export function FoodApp({ active, onSelectModule }: { active: boolean; onSelectModule(module: CaptureModule): void }) {
  const [today, setToday] = useState(() => toTaipeiDate(new Date()));
  const [date, setDate] = useState(today);
  const [local, setLocal] = useState<LocalFood>(() => cache()[today] ?? { payload: emptyFoodPayload(), revision: null, pending: false, clientUpdatedAt: new Date().toISOString() });
  const [history, setHistory] = useState<FoodRecord[]>([]);
  const [library, setLibrary] = useState<FoodLibraryPayload>(emptyFoodLibrary);
  const [libraryRevision, setLibraryRevision] = useState<number | null>(null);
  const [libraryConflict, setLibraryConflict] = useState<{ local: FoodLibraryPayload; cloud: FoodLibraryRecord | null } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [issue, setIssue] = useState(false);
  const [dateSlideDirection, setDateSlideDirection] = useState<"next" | "previous" | null>(null);
  const dateRef = useRef(date); const localRef = useRef(local); const todayRef = useRef(today); const touch = useRef<{ x: number; y: number } | null>(null);
  const syncDebounceRef = useRef<ReturnType<typeof createDateBoundDebounce<LocalFood>> | null>(null);
  const syncRef = useRef<(targetDate: string, candidate?: LocalFood) => Promise<void>>(async () => undefined);
  syncDebounceRef.current ??= createDateBoundDebounce<LocalFood>({ delayMs: 800, schedule: (callback, delayMs) => window.setTimeout(callback, delayMs), cancel: (handle) => window.clearTimeout(handle as number) });
  const editable = date === today;
  const publish = useCallback((targetDate: string, next: LocalFood) => { if (targetDate === dateRef.current) { localRef.current = next; setLocal(next); } const values = cache(); values[targetDate] = next; persist(values); }, []);
  const syncingDates = useRef(new Set<string>());
  const sync = useCallback(async (targetDate: string, candidate = localRef.current) => {
    if (!candidate.pending || candidate.conflict || !isFoodPayloadReady(candidate.payload)) return;
    if (syncingDates.current.has(targetDate)) return;
    syncingDates.current.add(targetDate);
    try {
      const response = await fetch("/api/special-records/food", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ journalDate: targetDate, payload: candidate.payload, expectedRevision: candidate.revision, clientUpdatedAt: candidate.clientUpdatedAt }) });
      const result = await response.json(); if (!response.ok) { if (result?.error?.code === "REVISION_CONFLICT") { const current = cache()[targetDate] ?? candidate; publish(targetDate, { ...current, conflict: { cloud: result.record ?? null } }); } setIssue(true); return; }
      const current = cache()[targetDate] ?? candidate; if (current.clientUpdatedAt === candidate.clientUpdatedAt) publish(targetDate, { ...current, revision: result.record?.revision ?? null, pending: false, conflict: undefined }); else { const next = { ...current, revision: result.record?.revision ?? null }; publish(targetDate, next); syncDebounceRef.current?.queue(targetDate, next, (queuedDate, queuedCandidate) => void syncRef.current(queuedDate, queuedCandidate)); } setIssue(false);
    } catch { setIssue(true); } finally { syncingDates.current.delete(targetDate); }
  }, [publish]);
  useEffect(() => { syncRef.current = sync; }, [sync]);
  const mutate = useCallback((change: (payload: FoodPayload) => void) => { const payload = structuredClone(localRef.current.payload); change(payload); const next = { ...localRef.current, payload, pending: true, clientUpdatedAt: new Date().toISOString() }; const targetDate = dateRef.current; publish(targetDate, next); syncDebounceRef.current?.queue(targetDate, next, sync); }, [publish, sync]);
  const load = useCallback(async (targetDate: string) => { targetDate = clampRecorderDate(targetDate, todayRef.current); dateRef.current = targetDate; setDate(targetDate); const cached = cache()[targetDate]; publish(targetDate, cached ?? { payload: emptyFoodPayload(), revision: null, pending: false, clientUpdatedAt: new Date().toISOString() }); if (cached?.pending) void sync(targetDate, cached); try { const response = await fetch(`/api/special-records/food?date=${encodeURIComponent(targetDate)}`, { cache: "no-store" }); const { record } = await response.json() as { record: FoodRecord | null }; if (!cache()[targetDate]?.pending) publish(targetDate, record ? { payload: record.payload, revision: record.revision, pending: false, clientUpdatedAt: record.updatedAt } : { payload: emptyFoodPayload(), revision: null, pending: false, clientUpdatedAt: new Date().toISOString() }); setIssue(false); } catch { if (!cached) setIssue(true); } }, [publish, sync]);
  useEffect(() => { if (!active) return; queueMicrotask(() => void load(dateRef.current)); void fetch("/api/special-records/food", { cache: "no-store" }).then((response) => response.json()).then(({ records }) => setHistory(records ?? [])).catch(() => undefined); void fetch("/api/special-records/food/library", { cache: "no-store" }).then((response) => response.json()).then(({ record }: { record: FoodLibraryRecord | null }) => { setLibrary(record?.payload ?? emptyFoodLibrary()); setLibraryRevision(record?.revision ?? null); }).catch(() => setIssue(true)); }, [active, load]);
  useEffect(() => { const retryPending = () => { for (const [targetDate, candidate] of Object.entries(cache())) if (candidate.pending) void sync(targetDate, candidate); }; const retryVisible = () => { if (document.visibilityState === "visible") retryPending(); }; window.addEventListener("online", retryPending); document.addEventListener("visibilitychange", retryVisible); return () => { window.removeEventListener("online", retryPending); document.removeEventListener("visibilitychange", retryVisible); syncDebounceRef.current?.cancel(); }; }, [sync]);
  useEffect(() => { const id = window.setInterval(() => { const nextToday = nextRecorderToday(todayRef.current, toTaipeiDate(new Date())); if (!nextToday) return; const previousDate = dateRef.current; const previous = cache()[previousDate] ?? localRef.current; if (previous.pending) void sync(previousDate, previous); todayRef.current = nextToday; setToday(nextToday); void load(nextToday); }, 30_000); return () => window.clearInterval(id); }, [load, sync]);
  const recent = useMemo(() => { const values: FoodLibraryEntry[] = library.entries.filter((entry) => !entry.archived).sort((left, right) => left.order - right.order); for (const record of history) for (const entry of [...record.payload.entries].reverse()) if (!values.some((item) => item.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase())) values.push({ id: entry.libraryEntryId ?? entry.id, name: entry.name, quantity: entry.quantity, unit: entry.unit, calories: entry.calories, proteinGrams: entry.proteinGrams, order: values.length, archived: false }); return values.slice(0, 8); }, [history, library]);
  const totals = local.payload.entries.reduce((value, entry) => ({ calories: value.calories + (entry.calories ?? 0), protein: value.protein + (entry.proteinGrams ?? 0) }), { calories: 0, protein: 0 });
  function add(source?: FoodLibraryEntry) { if (!editable) return; const id = crypto.randomUUID(); setExpandedId(id); mutate((payload) => payload.entries.push({ id, libraryEntryId: source?.id, name: source?.name ?? "", quantity: source?.quantity ?? null, unit: source?.unit ?? "份", calories: source?.calories ?? null, proteinGrams: source?.proteinGrams ?? null, note: "", occurredAt: new Date().toISOString() })); }
  function update(id: string, change: (entry: FoodEntry) => void) { mutate((payload) => { const target = payload.entries.find((entry) => entry.id === id); if (target) change(target); }); }
  async function saveLibrary(next: FoodLibraryPayload, expectedRevision = libraryRevision) { setLibrary(next); try { const response = await fetch("/api/special-records/food/library", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: next, expectedRevision }) }); const result = await response.json(); if (!response.ok) { if (result?.error?.code === "REVISION_CONFLICT") { setLibraryConflict({ local: structuredClone(next), cloud: result.record ?? null }); setIssue(true); return; } if (result.record) { setLibrary(result.record.payload); setLibraryRevision(result.record.revision); } setIssue(true); return; } setLibrary(result.record.payload); setLibraryRevision(result.record.revision); setLibraryConflict(null); setIssue(false); } catch { setIssue(true); } }
  function resolveLibraryConflict(choice: "cloud" | "local") { if (!libraryConflict) return; const resolution = resolveVersionedPayloadConflict(libraryConflict.local, libraryConflict.cloud, choice, emptyFoodLibrary()); setLibrary(resolution.payload); setLibraryRevision(resolution.revision); setLibraryConflict(null); setIssue(resolution.retry); if (resolution.retry) void saveLibrary(resolution.payload, resolution.revision); }
  function ensureLibrary(entry: FoodEntry) { const name = entry.name.trim(); if (!name || entry.libraryEntryId) return; const existing = library.entries.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase()); const item = existing ?? { id: crypto.randomUUID(), name, quantity: entry.quantity, unit: entry.unit, calories: entry.calories, proteinGrams: entry.proteinGrams, order: library.entries.length, archived: false }; if (!existing) void saveLibrary({ ...library, entries: [...library.entries, item] }); update(entry.id, (target) => { target.libraryEntryId = item.id; }); }
  function used(entry: FoodLibraryEntry) { return history.some((record) => record.payload.entries.some((food) => food.libraryEntryId === entry.id || (!food.libraryEntryId && food.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase()))); }
  function useCloudVersion() { const cloud = localRef.current.conflict?.cloud; const next: LocalFood = cloud ? { payload: cloud.payload, revision: cloud.revision, pending: false, clientUpdatedAt: cloud.updatedAt } : { payload: emptyFoodPayload(), revision: null, pending: false, clientUpdatedAt: new Date().toISOString() }; publish(date, next); setIssue(false); }
  function keepLocalVersion() { const current = localRef.current; if (!current.conflict) return; const { conflict, ...withoutConflict } = current; const next = rebaseConflictCandidate(withoutConflict, conflict.cloud?.revision ?? null); publish(date, next); setIssue(false); void sync(date, next); }
  if (!active) return null;
  return <main className={dateSlideDirection === null ? "foodShell" : `foodShell dateSlide-${dateSlideDirection}`} onAnimationEnd={() => setDateSlideDirection(null)} onPointerDown={(event) => { if (event.pointerType === "touch") touch.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={(event) => { const start = touch.current; touch.current = null; if (event.pointerType !== "touch" || !start || libraryOpen) return; const dx = event.clientX - start.x; const dy = event.clientY - start.y; if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.25) return; const direction = dx < 0 ? 1 : -1; const nextDate = clampRecorderDate(shiftJournalDate(date, direction), today); if (nextDate === date) return; setDateSlideDirection(direction > 0 ? "next" : "previous"); void load(nextDate); }}>
    <header className="foodToolbar">
      <label>{date.slice(5).replace("-", ".")}<input aria-label="選擇飲食日期" type="date" max={today} value={date} onChange={(event) => void load(event.target.value)} /></label>
      <span>飲食紀錄</span><small role="status">{issue ? "尚未同步" : local.pending ? "儲存中" : "已儲存"}</small>
    </header>
    <section className="foodBody">
      {local.conflict ? <div className="specialConflict" role="alert"><span>雲端已有較新的飲食內容，請選擇要保留的版本。</span><button type="button" onClick={useCloudVersion}>保留雲端內容</button><button type="button" onClick={keepLocalVersion}>保留這台內容</button></div> : null}
      {libraryConflict ? <div className="specialConflict" role="alert"><span>雲端已有較新的常用食物，請選擇要保留的版本。</span><button type="button" onClick={() => resolveLibraryConflict("cloud")}>保留雲端內容</button><button type="button" onClick={() => resolveLibraryConflict("local")}>保留這台內容</button></div> : null}
      <section className="recorderSection foodSummarySection"><h2>今日總計</h2><div className="foodTotals"><span><strong>{totals.calories}</strong> kcal</span><span>蛋白質 <strong>{totals.protein}</strong> g</span></div></section>
      <section className="recorderSection foodAddSection"><h2>新增飲食</h2><div className="recorderActions"><button className="primaryRecorderAction" disabled={!editable} onClick={() => add()}>＋ 新增食物</button></div>
        <details className="recorderOptions"><summary>從常用食物快速新增</summary><p className="recorderHint">點選後帶入一筆紀錄，可再調整份量與營養。</p><div className="recentFoods">{recent.map((entry) => <button key={entry.id} disabled={!editable} onClick={() => add(entry)}>＋ {entry.name}</button>)}{recent.length === 0 ? <span>完成第一筆紀錄後，會出現在這裡。</span> : null}</div></details>
      </section>
      <section className="recorderSection foodRecordsSection"><h2>今日紀錄 <small>{local.payload.entries.length} 筆{!editable ? " · 僅供查看" : ""}</small></h2>
      {local.payload.entries.length === 0 ? <p className="recorderHint">還沒有紀錄。按「新增食物」開始。</p> : null}
      {local.payload.entries.map((entry) => {
        const expanded = expandedId === entry.id || !entry.name.trim();
        return <article key={entry.id} className="foodEntry">
          <button className="recorderSummary" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : entry.id)}>
            <span><strong>{entry.name || "新增食物"}</strong><small>{entry.quantity ?? "—"} {entry.unit} · {entry.calories ?? "—"} kcal · 蛋白質 {entry.proteinGrams ?? "—"} g</small></span>
            <span><time>{new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(entry.occurredAt))}</time> {expanded ? "收起" : "展開"}</span>
          </button>
          {expanded ? <div className="foodEntryForm">
            <label className="foodNameLabel">食物名稱<input className="foodName" placeholder="例如：雞胸肉便當" value={entry.name} disabled={!editable} onChange={(event) => update(entry.id, (item) => { item.name = event.target.value; })} /></label>
            <div className="foodFields">
              <label>份量<input type="number" inputMode="decimal" value={entry.quantity ?? ""} disabled={!editable} onChange={(event) => update(entry.id, (item) => { item.quantity = number(event.target.value); })} /></label>
              <label>單位<input value={entry.unit} disabled={!editable} onChange={(event) => update(entry.id, (item) => { item.unit = event.target.value; })} /></label>
              <label>熱量 kcal<input type="number" inputMode="decimal" value={entry.calories ?? ""} disabled={!editable} onChange={(event) => update(entry.id, (item) => { item.calories = number(event.target.value); })} /></label>
              <label>蛋白質 g<input type="number" inputMode="decimal" value={entry.proteinGrams ?? ""} disabled={!editable} onChange={(event) => update(entry.id, (item) => { item.proteinGrams = number(event.target.value); })} /></label>
            </div>
            <label className="foodNameLabel">備註<textarea placeholder="選填" value={entry.note} disabled={!editable} onChange={(event) => update(entry.id, (item) => { item.note = event.target.value; })} /></label>
            <div className="recorderActions"><button disabled={!entry.name.trim()} onClick={() => { if (editable) ensureLibrary(entry); setExpandedId(null); }}>完成並收起</button>{editable ? <button onClick={() => mutate((payload) => { payload.entries = payload.entries.filter((item) => item.id !== entry.id); })}>移除這筆</button> : null}</div>
          </div> : null}
        </article>;
      })}
      </section>
      <details className="recorderSection foodSettingsSection"><summary><strong>目標與常用食物管理</strong><small>平常不需要調整</small></summary>
        <h3>每日目標</h3><div className="foodFields">
          <label>熱量 kcal<input type="number" inputMode="decimal" value={local.payload.calorieTarget ?? ""} disabled={!editable} onChange={(event) => mutate((payload) => { payload.calorieTarget = number(event.target.value); })} /></label>
          <label>蛋白質 g<input type="number" inputMode="decimal" value={local.payload.proteinTargetGrams ?? ""} disabled={!editable} onChange={(event) => mutate((payload) => { payload.proteinTargetGrams = number(event.target.value); })} /></label>
        </div>
        <button className="manageLibraryButton" onClick={() => setLibraryOpen((open) => !open)}>{libraryOpen ? "收起常用食物" : "管理常用食物"}</button>
        {libraryOpen ? <div className="foodLibrary">{library.entries.slice().sort((left, right) => left.order - right.order).map((entry, index, entries) => <div key={entry.id} className={entry.archived ? "archived" : ""}><input value={entry.name} onChange={(event) => setLibrary((current) => ({ ...current, entries: current.entries.map((item) => item.id === entry.id ? { ...item, name: event.target.value } : item) }))} onBlur={(event) => { const name = event.target.value.trim(); if (name) void saveLibrary({ ...library, entries: library.entries.map((item) => item.id === entry.id ? { ...item, name } : item) }); }} /><button disabled={index === 0} onClick={() => { const next = entries.slice(); [next[index - 1], next[index]] = [next[index], next[index - 1]]; void saveLibrary({ ...library, entries: next.map((item, order) => ({ ...item, order })) }); }}>上移</button><button disabled={index === entries.length - 1} onClick={() => { const next = entries.slice(); [next[index], next[index + 1]] = [next[index + 1], next[index]]; void saveLibrary({ ...library, entries: next.map((item, order) => ({ ...item, order })) }); }}>下移</button><button onClick={() => void saveLibrary({ ...library, entries: library.entries.map((item) => item.id === entry.id ? { ...item, archived: !item.archived } : item) })}>{entry.archived ? "取消封存" : "封存"}</button>{!used(entry) ? <button onClick={() => void saveLibrary({ ...library, entries: library.entries.filter((item) => item.id !== entry.id).map((item, order) => ({ ...item, order })) })}>刪除</button> : <span />}</div>)}</div> : null}
      </details>
      <p className="recorderHint recorderAutosaveHint">內容會自動儲存。營養數值為這筆食物的總量。</p>
    </section>
    <ModuleRail active="food" onSelect={onSelectModule} />
  </main>;
}
