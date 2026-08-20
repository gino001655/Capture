import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AREA_SYMBOLS,
  AUTOSAVE_DELAY_MS,
  JOURNAL_AREA_KEYS,
  JOURNAL_LOCAL_STORAGE_KEY,
  editActiveArea,
  emptyJournalAreas,
  finishActive,
  hasJournalContent,
  quickCaptureKeyAction,
  readLocalState,
  shiftJournalDate,
  type JournalAreaKey,
  type JournalAreas,
  type JournalLocalState,
  type JournalRecord,
  type LocalJournalDraft,
  type QuickCaptureConfirmation,
} from "./journal";

type View = "quick" | "list" | "record";
type ConfirmationChoice = "cancel" | "confirm";

function idFactory() {
  return crypto.randomUUID();
}

function initialState(): JournalLocalState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(JOURNAL_LOCAL_STORAGE_KEY);
  } catch {
    // The in-memory draft still works if WebView storage is unavailable.
  }
  return readLocalState(raw, new Date(), idFactory);
}

function persistState(state: JournalLocalState) {
  try {
    localStorage.setItem(JOURNAL_LOCAL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Cloud sync remains available; the compact alert is set by the caller only for API errors.
  }
}

function errorMessage(error: unknown) {
  return typeof error === "string" ? error : "Journal sync failed.";
}

function dateLabel(date: string) {
  const [, month, day] = date.split("-").map(Number);
  return `${month}.${day}`;
}

function previewLines(areas: JournalAreas) {
  return JOURNAL_AREA_KEYS.filter((key) => areas[key].trim()).map((key) => ({
    key,
    symbol: AREA_SYMBOLS[key],
    text: areas[key],
  }));
}

export function DesktopJournal() {
  const [journalState, setJournalState] = useState<JournalLocalState>(initialState);
  const stateRef = useRef(journalState);
  const [view, setView] = useState<View>("quick");
  const [confirmation, setConfirmation] = useState<QuickCaptureConfirmation>("none");
  const [confirmationChoice, setConfirmationChoice] = useState<ConfirmationChoice>("confirm");
  const [selectedDate, setSelectedDate] = useState(journalState.active.journalDate);
  const [records, setRecords] = useState<JournalRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingRecord, setEditingRecord] = useState<JournalRecord | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const fieldRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const listRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const syncingRef = useRef(false);
  const rerunRef = useRef(false);

  const commitState = useCallback((next: JournalLocalState) => {
    stateRef.current = next;
    setJournalState(next);
    persistState(next);
  }, []);

  const sendDraft = useCallback(async (draft: LocalJournalDraft, idle: boolean) => {
    let record: JournalRecord;
    if (draft.revision === null) {
      record = await invoke<JournalRecord>("create_journal_record", {
        input: {
          id: draft.id,
          deviceId: draft.deviceId,
          journalDate: draft.journalDate,
          areas: draft.areas,
        },
      });
    } else {
      record = await invoke<JournalRecord>("update_journal_record", {
        id: draft.id,
        input: {
          deviceId: draft.deviceId,
          journalDate: draft.journalDate,
          areas: draft.areas,
          editingState: idle ? "idle" : "active",
          expectedRevision: draft.revision,
          conflictRecordId: draft.conflictRecordId,
        },
      });
    }

    if (idle && record.editingState !== "idle") {
      record = await invoke<JournalRecord>("update_journal_record", {
        id: record.id,
        input: {
          deviceId: record.deviceId,
          journalDate: record.journalDate,
          areas: record.areas,
          editingState: "idle",
          expectedRevision: record.revision,
          conflictRecordId: crypto.randomUUID(),
        },
      });
    }
    return record;
  }, []);

  const syncNow = useCallback(async () => {
    if (syncingRef.current) {
      rerunRef.current = true;
      return;
    }
    syncingRef.current = true;
    try {
      do {
        rerunRef.current = false;
        for (const pending of [...stateRef.current.pending]) {
          const record = await sendDraft(pending, true);
          const current = stateRef.current;
          commitState({
            ...current,
            pending: current.pending.filter((draft) => draft.id !== pending.id),
          });
          if (record.id !== pending.id) rerunRef.current = true;
        }

        const active = stateRef.current.active;
        if (hasJournalContent(active.areas)) {
          const record = await sendDraft(active, false);
          const current = stateRef.current;
          if (current.active.id === active.id) {
            commitState({
              ...current,
              active: {
                ...current.active,
                id: record.id,
                revision: record.revision,
                conflictRecordId:
                  record.id === active.id
                    ? current.active.conflictRecordId
                    : crypto.randomUUID(),
              },
            });
          }
        }
        setSyncError(null);
      } while (rerunRef.current);
    } catch (error) {
      setSyncError(errorMessage(error));
    } finally {
      syncingRef.current = false;
    }
  }, [commitState, sendDraft]);

  const scheduleSync = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void syncNow(), AUTOSAVE_DELAY_MS);
  }, [syncNow]);

  const loadRecords = useCallback(async (date: string) => {
    try {
      const next = await invoke<JournalRecord[]>("list_journal_records", {
        journalDate: date,
      });
      setRecords(next);
      setSelectedIndex(0);
      setSyncError(null);
    } catch (error) {
      setSyncError(errorMessage(error));
    }
  }, []);

  const openFullJournal = useCallback(() => {
    const date = stateRef.current.active.journalDate;
    setConfirmation("none");
    setSelectedDate(date);
    setView("list");
    void loadRecords(date);
    window.setTimeout(() => listRef.current?.focus(), 0);
  }, [loadRecords]);

  useEffect(() => {
    const focusQuick = () => {
      if (view === "quick") window.setTimeout(() => fieldRefs.current[0]?.focus(), 0);
    };
    window.addEventListener("focus", focusQuick);
    const unlistenPromise = listen("open-quick-capture", () => {
      setView("quick");
      setConfirmation("none");
      window.setTimeout(() => fieldRefs.current[0]?.focus(), 0);
    });
    const online = () => void syncNow();
    window.addEventListener("online", online);
    focusQuick();
    void syncNow();
    return () => {
      window.removeEventListener("focus", focusQuick);
      window.removeEventListener("online", online);
      void unlistenPromise.then((unlisten) => unlisten());
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [syncNow, view]);

  const listEntries = useMemo(() => {
    const active = journalState.active;
    const cloud = records.filter((record) => record.id !== active.id);
    if (active.journalDate !== selectedDate || !hasJournalContent(active.areas)) return records;
    const matching = records.find((record) => record.id === active.id);
    if (
      matching &&
      (matching.deliveryState === "delivered" ||
        (active.revision !== null && matching.revision > active.revision))
    ) {
      return [matching, ...cloud];
    }
    const local: JournalRecord = {
      id: active.id,
      deviceId: active.deviceId,
      journalDate: active.journalDate,
      areas: active.areas,
      deliveryState: "undelivered",
      editingState: active.editingState,
      revision: active.revision ?? 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return [local, ...cloud];
  }, [journalState.active, records, selectedDate]);

  function editArea(key: JournalAreaKey, value: string) {
    const next = editActiveArea(stateRef.current, key, value);
    commitState(next);
    setConfirmation("none");
    scheduleSync();
  }

  function finishCurrent() {
    const next = finishActive(stateRef.current, new Date(), idFactory);
    commitState(next);
    setConfirmation("none");
    setConfirmationChoice("confirm");
    void syncNow();
    window.setTimeout(() => fieldRefs.current[0]?.focus(), 0);
  }

  async function discardCurrent(destination: "hide" | "full") {
    await syncNow();
    const current = stateRef.current;
    const active = current.active;
    try {
      if (active.revision !== null && hasJournalContent(active.areas)) {
        await invoke("delete_journal_record", {
          id: active.id,
          input: { expectedRevision: active.revision },
        });
      }
      const blanked: JournalLocalState = {
        ...current,
        active: { ...active, areas: emptyJournalAreas(), revision: null },
      };
      commitState(finishActive(blanked, new Date(), idFactory));
      setConfirmation("none");
      if (destination === "hide") await invoke("hide_current_window");
      else openFullJournal();
    } catch (error) {
      setSyncError(errorMessage(error));
      setConfirmation("none");
    }
  }

  function handleQuickKey(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
    index: number,
  ) {
    if (
      confirmation !== "none" &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      setConfirmation("none");
      return;
    }

    if (confirmation !== "none" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      setConfirmationChoice((choice) => (choice === "confirm" ? "cancel" : "confirm"));
      return;
    }

    if (confirmation === "none" && event.key === "ArrowUp" && event.currentTarget.selectionStart === 0) {
      if (index > 0) {
        event.preventDefault();
        fieldRefs.current[index - 1]?.focus();
      }
      return;
    }
    if (
      confirmation === "none" &&
      event.key === "ArrowDown" &&
      event.currentTarget.selectionStart === event.currentTarget.value.length
    ) {
      if (index < JOURNAL_AREA_KEYS.length - 1) {
        event.preventDefault();
        fieldRefs.current[index + 1]?.focus();
      }
      return;
    }

    const action = quickCaptureKeyAction(
      hasJournalContent(journalState.active.areas),
      confirmation,
      event.key,
      event.shiftKey,
      event.ctrlKey,
    );
    if (action === "none") return;
    event.preventDefault();

    if (action === "hide") void invoke("hide_current_window");
    else if (action === "open-full") openFullJournal();
    else if (action === "confirm-complete") {
      setConfirmation("complete");
      setConfirmationChoice("confirm");
    } else if (action === "confirm-hide") {
      setConfirmation("hide");
      setConfirmationChoice("confirm");
    } else if (action === "confirm-full") {
      setConfirmation("full");
      setConfirmationChoice("confirm");
    } else if (action === "cancel" || confirmationChoice === "cancel") {
      setConfirmation("none");
    } else if (action === "finish") finishCurrent();
    else if (action === "discard-hide") void discardCurrent("hide");
    else if (action === "discard-full") void discardCurrent("full");
  }

  function shiftDate(delta: number) {
    const next = shiftJournalDate(selectedDate, delta);
    setSelectedDate(next);
    void loadRecords(next);
  }

  function handleListKey(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      void invoke("hide_current_window");
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      shiftDate(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      shiftDate(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(listEntries.length - 1, index + 1));
    } else if (event.key === "Enter" && listEntries[selectedIndex]) {
      event.preventDefault();
      setEditingRecord({ ...listEntries[selectedIndex]!, areas: { ...listEntries[selectedIndex]!.areas } });
      setView("record");
    }
  }

  async function closeRecordEditor() {
    const record = editingRecord;
    if (!record) return;
    try {
      if (record.deliveryState === "undelivered") {
        if (record.id === stateRef.current.active.id) {
          const current = stateRef.current;
          const updated = {
            ...current,
            active: { ...current.active, areas: record.areas, editingState: "idle" as const },
          };
          commitState(finishActive(updated, new Date(), idFactory));
          void syncNow();
        } else {
          await invoke<JournalRecord>("update_journal_record", {
            id: record.id,
            input: {
              deviceId: record.deviceId,
              journalDate: record.journalDate,
              areas: record.areas,
              editingState: "idle",
              expectedRevision: record.revision,
              conflictRecordId: crypto.randomUUID(),
            },
          });
        }
      }
      setEditingRecord(null);
      setView("list");
      await loadRecords(selectedDate);
      window.setTimeout(() => listRef.current?.focus(), 0);
    } catch (error) {
      setSyncError(errorMessage(error));
    }
  }

  if (view === "quick") {
    const prompt = confirmation === "complete" ? "完成？" : "不保存？";
    return (
      <main className="desktopJournal quickJournal">
        <div className="dragStrip" data-tauri-drag-region />
        <section className={confirmation === "none" ? "areaEditor" : "areaEditor quieted"}>
          {JOURNAL_AREA_KEYS.map((key, index) => (
            <label className="journalArea" key={key}>
              <span aria-hidden="true">{AREA_SYMBOLS[key]}</span>
              <span className="srOnly">{key}</span>
              <textarea
                ref={(node) => { fieldRefs.current[index] = node; }}
                value={journalState.active.areas[key]}
                onChange={(event) => editArea(key, event.target.value)}
                onKeyDown={(event) => handleQuickKey(event, index)}
                rows={2}
                maxLength={5000}
                aria-label={key}
              />
            </label>
          ))}
        </section>
        {confirmation !== "none" ? (
          <div className="microPrompt" role="dialog" aria-label={prompt}>
            <p>{prompt}</p>
            <div>
              <button className={confirmationChoice === "cancel" ? "selected" : ""} onClick={() => setConfirmation("none")}>取消</button>
              <button
                className={confirmationChoice === "confirm" ? "selected" : ""}
                onClick={() => confirmation === "complete" ? finishCurrent() : void discardCurrent(confirmation === "hide" ? "hide" : "full")}
              >
                {confirmation === "complete" ? "完成" : "離開"}
              </button>
            </div>
          </div>
        ) : null}
        {syncError ? <p className="journalError" role="alert">{syncError}</p> : null}
      </main>
    );
  }

  if (view === "record" && editingRecord) {
    const delivered = editingRecord.deliveryState === "delivered";
    return (
      <main
        className="desktopJournal recordEditor"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            void closeRecordEditor();
          }
        }}
      >
        <div className="dragStrip" data-tauri-drag-region />
        {JOURNAL_AREA_KEYS.filter((key) => !delivered || editingRecord.areas[key].trim()).map((key) => (
          <label className="journalArea" key={key}>
            <span aria-hidden="true">{AREA_SYMBOLS[key]}</span>
            <span className="srOnly">{key}</span>
            <textarea
              value={editingRecord.areas[key]}
              onChange={(event) => setEditingRecord({
                ...editingRecord,
                areas: { ...editingRecord.areas, [key]: event.target.value },
              })}
              rows={2}
              disabled={delivered}
              aria-label={key}
            />
          </label>
        ))}
        {delivered ? <span className="lockMark" aria-label="已送出">◇</span> : null}
        {syncError ? <p className="journalError" role="alert">{syncError}</p> : null}
      </main>
    );
  }

  return (
    <main className="desktopJournal fullJournal" ref={listRef} tabIndex={0} onKeyDown={handleListKey}>
      <div className="dragStrip" data-tauri-drag-region />
      <nav className="journalToolbar" aria-label="Journal controls">
        <button aria-label="設定" onClick={() => void invoke("show_worker_window")}>⚙</button>
        <button aria-label="前一天" onClick={() => shiftDate(-1)}>‹</button>
        <label>
          <span>{dateLabel(selectedDate)}</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => {
              setSelectedDate(event.target.value);
              void loadRecords(event.target.value);
            }}
            aria-label="選擇日期"
          />
        </label>
        <button aria-label="後一天" onClick={() => shiftDate(1)}>›</button>
      </nav>
      <section className="recordStream">
        {listEntries.map((record, index) => (
          <button
            type="button"
            key={record.id}
            className={index === selectedIndex ? "recordRow selected" : "recordRow"}
            onClick={() => setSelectedIndex(index)}
            onDoubleClick={() => {
              setEditingRecord({ ...record, areas: { ...record.areas } });
              setView("record");
            }}
          >
            {previewLines(record.areas).map((line) => (
              <span className="previewLine" key={line.key}>
                <i>{line.symbol}</i><b>{line.text}</b>
              </span>
            ))}
            {record.deliveryState === "delivered" ? <em aria-label="已送出">◇</em> : null}
          </button>
        ))}
      </section>
      {syncError ? <p className="journalError" role="alert">{syncError}</p> : null}
    </main>
  );
}
