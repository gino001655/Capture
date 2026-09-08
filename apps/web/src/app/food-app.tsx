"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FoodEntry, FoodPayload, FoodRecord } from "../lib/food-record";
import { emptyFoodPayload } from "../lib/food-record";
import { toTaipeiDate } from "../lib/special-record";
import { shiftJournalDate } from "./journal-session";
import { ModuleRail, type CaptureModule } from "./module-rail";

const CACHE_KEY = "capture.food.v1";
type LocalFood = { payload: FoodPayload; revision: number | null; pending: boolean; clientUpdatedAt: string };
type Cache = Record<string, LocalFood>;
function cache(): Cache { try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}"); } catch { return {}; } }
function persist(values: Cache) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(values)); } catch { /* memory remains */ } }
function number(value: string) { return value === "" ? null : Number(value); }

export function FoodApp({ active, onSelectModule }: { active: boolean; onSelectModule(module: CaptureModule): void }) {
  const today = toTaipeiDate(new Date());
  const [date, setDate] = useState(today);
  const [local, setLocal] = useState<LocalFood>(() => cache()[today] ?? { payload: emptyFoodPayload(), revision: null, pending: false, clientUpdatedAt: new Date().toISOString() });
  const [history, setHistory] = useState<FoodRecord[]>([]);
  const [issue, setIssue] = useState(false);
  const dateRef = useRef(date); const localRef = useRef(local); const timer = useRef<number | null>(null); const touch = useRef<number | null>(null);
  const editable = date === today || date === shiftJournalDate(today, -1);
  const publish = useCallback((targetDate: string, next: LocalFood) => { localRef.current = next; if (targetDate === dateRef.current) setLocal(next); const values = cache(); values[targetDate] = next; persist(values); }, []);
  const sync = useCallback(async (targetDate: string, candidate = localRef.current) => {
    if (!candidate.pending) return;
    try {
      const response = await fetch("/api/special-records/food", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ journalDate: targetDate, payload: candidate.payload, expectedRevision: candidate.revision, clientUpdatedAt: candidate.clientUpdatedAt }) });
      const result = await response.json(); if (!response.ok) { setIssue(true); return; }
      const current = cache()[targetDate] ?? candidate; if (current.clientUpdatedAt === candidate.clientUpdatedAt) publish(targetDate, { ...current, revision: result.record?.revision ?? null, pending: false }); setIssue(false);
    } catch { setIssue(true); }
  }, [publish]);
  const mutate = useCallback((change: (payload: FoodPayload) => void) => { const payload = structuredClone(localRef.current.payload); change(payload); const next = { ...localRef.current, payload, pending: true, clientUpdatedAt: new Date().toISOString() }; publish(dateRef.current, next); if (timer.current !== null) window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void sync(dateRef.current), 800); }, [publish, sync]);
  const load = useCallback(async (targetDate: string) => { dateRef.current = targetDate; setDate(targetDate); const cached = cache()[targetDate]; if (cached) publish(targetDate, cached); try { const response = await fetch(`/api/special-records/food?date=${targetDate}`, { cache: "no-store" }); const { record } = await response.json() as { record: FoodRecord | null }; if (!cache()[targetDate]?.pending) publish(targetDate, record ? { payload: record.payload, revision: record.revision, pending: false, clientUpdatedAt: record.updatedAt } : { payload: emptyFoodPayload(), revision: null, pending: false, clientUpdatedAt: new Date().toISOString() }); setIssue(false); } catch { if (!cached) setIssue(true); } }, [publish]);
  useEffect(() => { if (!active) return; queueMicrotask(() => void load(dateRef.current)); void fetch("/api/special-records/food", { cache: "no-store" }).then((response) => response.json()).then(({ records }) => setHistory(records ?? [])).catch(() => undefined); }, [active, load]);
  const recent = useMemo(() => { const values: FoodEntry[] = []; for (const record of history) for (const entry of [...record.payload.entries].reverse()) if (!values.some((item) => item.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase())) values.push(entry); return values.slice(0, 8); }, [history]);
  const totals = local.payload.entries.reduce((value, entry) => ({ calories: value.calories + (entry.calories ?? 0), protein: value.protein + (entry.proteinGrams ?? 0) }), { calories: 0, protein: 0 });
  function add(source?: FoodEntry) { if (!editable) return; mutate((payload) => payload.entries.push({ id: crypto.randomUUID(), name: source?.name ?? "", quantity: source?.quantity ?? null, unit: source?.unit ?? "份", calories: source?.calories ?? null, proteinGrams: source?.proteinGrams ?? null, note: "", occurredAt: new Date().toISOString() })); }
  function update(id: string, change: (entry: FoodEntry) => void) { mutate((payload) => { const target = payload.entries.find((entry) => entry.id === id); if (target) change(target); }); }
  if (!active) return null;
  return <main className="foodShell" onPointerDown={(event) => { if (event.pointerType === "touch") touch.current = event.clientX; }} onPointerUp={(event) => { if (event.pointerType !== "touch" || touch.current === null) return; const delta = event.clientX - touch.current; touch.current = null; if (Math.abs(delta) > 70) void load(shiftJournalDate(date, delta > 0 ? -1 : 1)); }}>
    <header className="foodToolbar"><label>{date.slice(5).replace("-", ".")}<input type="date" max={today} value={date} onChange={(event) => void load(event.target.value)} /></label><div><strong>{totals.calories}</strong><input aria-label="熱量目標" type="number" value={local.payload.calorieTarget ?? ""} disabled={!editable} onChange={(event) => mutate((payload) => { payload.calorieTarget = number(event.target.value); })} /></div><div><strong>{totals.protein}g</strong><input aria-label="蛋白質目標" type="number" value={local.payload.proteinTargetGrams ?? ""} disabled={!editable} onChange={(event) => mutate((payload) => { payload.proteinTargetGrams = number(event.target.value); })} /></div><span>{issue ? "!" : local.pending ? "·" : ""}</span></header>
    <section className="foodBody">
      <div className="recentFoods">{recent.map((entry) => <button key={entry.id} disabled={!editable} onClick={() => add(entry)}>{entry.name}</button>)}<button disabled={!editable} onClick={() => add()}>＋</button></div>
      {local.payload.entries.map((entry) => <article key={entry.id} className="foodEntry"><div><input className="foodName" placeholder="食物" value={entry.name} disabled={!editable} onChange={(event) => update(entry.id, (item) => { item.name = event.target.value; })} /><time>{new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(entry.occurredAt))}</time>{editable ? <button aria-label="移除" onClick={() => mutate((payload) => { payload.entries = payload.entries.filter((item) => item.id !== entry.id); })}>×</button> : null}</div><div className="foodFields"><label>量<input type="number" inputMode="decimal" value={entry.quantity ?? ""} disabled={!editable} onChange={(event) => update(entry.id, (item) => { item.quantity = number(event.target.value); })} /></label><label>單位<input value={entry.unit} disabled={!editable} onChange={(event) => update(entry.id, (item) => { item.unit = event.target.value; })} /></label><label>kcal<input type="number" inputMode="decimal" value={entry.calories ?? ""} disabled={!editable} onChange={(event) => update(entry.id, (item) => { item.calories = number(event.target.value); })} /></label><label>蛋白質 g<input type="number" inputMode="decimal" value={entry.proteinGrams ?? ""} disabled={!editable} onChange={(event) => update(entry.id, (item) => { item.proteinGrams = number(event.target.value); })} /></label></div><textarea placeholder="註記" value={entry.note} disabled={!editable} onChange={(event) => update(entry.id, (item) => { item.note = event.target.value; })} /></article>)}
    </section><ModuleRail active="food" onSelect={onSelectModule} />
  </main>;
}
