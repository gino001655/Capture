import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
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
  hasJournalInput,
  journalEditCounts,
  journalAreasEqual,
  quickCaptureKeyAction,
  readLocalState,
  refreshBlankDraftDate,
  shiftJournalDate,
  textEditDiff,
  type JournalAreaKey,
  type JournalAreas,
  type JournalLocalState,
  type JournalRecord,
  type LocalJournalDraft,
  type QuickCaptureConfirmation,
} from "./journal";
import { readCaptureTheme, type CaptureTheme } from "./capture-theme";
import { SPECIAL_CAPTURE_PAGES } from "./capture-pages/registry";

type View = "quick" | "list" | "record" | "special";
type ConfirmationChoice = "cancel" | "confirm";
type RecordConfirmation = "none" | "save" | "discard";

const RECORD_CACHE_STORAGE_KEY = "capture.desktop.record-cache.v1";

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
  return refreshBlankDraftDate(readLocalState(raw, new Date(), idFactory), new Date());
}

function readRecordCache(): Record<string, JournalRecord[]> {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(RECORD_CACHE_STORAGE_KEY) ?? "{}",
    );
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, JournalRecord[]>;
    }
  } catch {
    // Empty cache still gives correct Cloud-backed behavior.
  }
  return {};
}

function persistRecordCache(cache: Record<string, JournalRecord[]>) {
  try {
    localStorage.setItem(RECORD_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Cache is an acceleration layer, not authoritative storage.
  }
}

function autosizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "0px";
  textarea.style.height = `${Math.max(54, textarea.scrollHeight)}px`;
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

function isMissingConnectionError(error: string | null) {
  return error?.startsWith("Desktop connection is not configured") ?? false;
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

function recordTimeLabel(createdAt: string) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function SyncStatus({ error }: { error: string | null }) {
  if (!error) return null;
  if (isMissingConnectionError(error)) {
    return (
      <button
        type="button"
        className="connectionWarning"
        aria-label="連線設定尚未完成，開啟設定"
        title="連線設定尚未完成"
        onClick={() => void invoke("show_worker_window")}
      >
        ⚠
      </button>
    );
  }
  return <p className="journalError" role="alert">{error}</p>;
}

export function DesktopJournal() {
  const [journalState, setJournalState] = useState<JournalLocalState>(initialState);
  const stateRef = useRef(journalState);
  const [view, setView] = useState<View>("quick");
  const [confirmation, setConfirmation] = useState<QuickCaptureConfirmation>("none");
  const [confirmationChoice, setConfirmationChoice] = useState<ConfirmationChoice>("confirm");
  const [selectedDate, setSelectedDate] = useState(journalState.active.journalDate);
  const [recordsByDate, setRecordsByDate] = useState<Record<string, JournalRecord[]>>(readRecordCache);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingRecord, setEditingRecord] = useState<JournalRecord | null>(null);
  const [editingOriginalAreas, setEditingOriginalAreas] = useState<JournalAreas | null>(null);
  const [showDeletions, setShowDeletions] = useState(false);
  const [recordConfirmation, setRecordConfirmation] = useState<RecordConfirmation>("none");
  const [recordConfirmationChoice, setRecordConfirmationChoice] = useState<ConfirmationChoice>("confirm");
  const [specialIndex, setSpecialIndex] = useState(0);
  const [captureTheme, setCaptureTheme] = useState<CaptureTheme>(readCaptureTheme);
  const [syncError, setSyncError] = useState<string | null>(null);
  const fieldRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const recordFieldRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const recordRowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const verticalBoundaryRef = useRef<{
    field: HTMLTextAreaElement;
    direction: "up" | "down";
    position: number;
  } | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const syncingRef = useRef(false);
  const rerunRef = useRef(false);
  const records = recordsByDate[selectedDate] ?? [];

  function focusArea(index: number) {
    const field = fieldRefs.current[index];
    field?.focus();
    field?.scrollIntoView({ block: "center", behavior: "auto" });
  }

  function focusRecordArea(index: number) {
    const field = recordFieldRefs.current[index];
    field?.focus();
    field?.scrollIntoView({ block: "center", behavior: "auto" });
  }

  function handleVerticalAreaNavigation(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
    index: number,
    fields: MutableRefObject<Array<HTMLTextAreaElement | null>>,
    count: number,
  ) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      verticalBoundaryRef.current = null;
      return false;
    }

    const direction = event.key === "ArrowUp" ? "up" : "down";
    const field = event.currentTarget;
    const atTextEdge = direction === "up"
      ? field.selectionStart === 0 && field.selectionEnd === 0
      : field.selectionStart === field.value.length && field.selectionEnd === field.value.length;
    const destination = direction === "up" ? index - 1 : index + 1;

    if (atTextEdge && destination >= 0 && destination < count) {
      event.preventDefault();
      verticalBoundaryRef.current = null;
      const next = fields.current[destination];
      next?.focus();
      const caret = direction === "up" ? next?.value.length ?? 0 : 0;
      next?.setSelectionRange(caret, caret);
      next?.scrollIntoView({ block: "center", behavior: "auto" });
      return true;
    }

    const before = field.selectionStart;
    window.requestAnimationFrame(() => {
      if (document.activeElement !== field) return;
      const after = field.selectionStart;
      const previous = verticalBoundaryRef.current;
      if (
        after === before &&
        previous?.field === field &&
        previous.direction === direction &&
        previous.position === after &&
        destination >= 0 &&
        destination < count
      ) {
        verticalBoundaryRef.current = null;
        const next = fields.current[destination];
        next?.focus();
        const caret = direction === "up" ? next?.value.length ?? 0 : 0;
        next?.setSelectionRange(caret, caret);
        next?.scrollIntoView({ block: "center", behavior: "auto" });
      } else {
        verticalBoundaryRef.current = after === before
          ? { field, direction, position: after }
          : null;
      }
    });
    return false;
  }

  function resizeAllFields() {
    window.requestAnimationFrame(() => {
      fieldRefs.current.forEach(autosizeTextarea);
    });
  }

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

  const loadRecords = useCallback(async (date: string, resetSelection = false) => {
    try {
      const next = await invoke<JournalRecord[]>("list_journal_records", {
        journalDate: date,
      });
      setRecordsByDate((current) => {
        const updated = { ...current, [date]: next };
        persistRecordCache(updated);
        return updated;
      });
      if (resetSelection) setSelectedIndex(0);
      setSyncError(null);
    } catch (error) {
      setSyncError(errorMessage(error));
    }
  }, []);

  const prefetchDateNeighborhood = useCallback((date: string) => {
    void loadRecords(date);
    void loadRecords(shiftJournalDate(date, -1));
    void loadRecords(shiftJournalDate(date, 1));
  }, [loadRecords]);

  const openFullJournal = useCallback(() => {
    const date = stateRef.current.active.journalDate;
    setConfirmation("none");
    setSelectedDate(date);
    setView("list");
    prefetchDateNeighborhood(date);
    window.setTimeout(() => listRef.current?.focus(), 0);
  }, [prefetchDateNeighborhood]);

  const showQuickCapture = useCallback(() => {
    const refreshed = refreshBlankDraftDate(stateRef.current, new Date());
    if (refreshed !== stateRef.current) commitState(refreshed);
    setConfirmation("none");
    setView("quick");
    window.setTimeout(() => focusArea(0), 0);
  }, [commitState]);

  function showSpecialPage(index: number) {
    if (SPECIAL_CAPTURE_PAGES.length === 0) return;
    setSpecialIndex(Math.max(0, Math.min(SPECIAL_CAPTURE_PAGES.length - 1, index)));
    setConfirmation("none");
    setView("special");
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(".captureExtensionPage, .desktopFood, .desktopEnglish")?.focus();
    }, 0);
  }

  function requestModeChange(delta: -1 | 1) {
    if (view === "list") {
      if (delta === 1) showQuickCapture();
      return;
    }
    if (view === "quick") {
      if (delta === -1) openFullJournal();
      else showSpecialPage(0);
      return;
    }
    if (view === "special") {
      if (delta === -1 && specialIndex === 0) showQuickCapture();
      else showSpecialPage(specialIndex + delta);
    }
  }

  useEffect(() => {
    const focusQuick = () => {
      if (view === "quick") window.setTimeout(() => focusArea(0), 0);
    };
    window.addEventListener("focus", focusQuick);
    const unlistenPromise = listen("open-quick-capture", () => {
      showQuickCapture();
    });
    const themeListener = listen<CaptureTheme>("capture-theme-changed", (event) => {
      setCaptureTheme(event.payload);
    });
    const online = () => void syncNow();
    window.addEventListener("online", online);
    focusQuick();
    void syncNow();
    resizeAllFields();
    return () => {
      window.removeEventListener("focus", focusQuick);
      window.removeEventListener("online", online);
      void unlistenPromise.then((unlisten) => unlisten());
      void themeListener.then((unlisten) => unlisten());
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [showQuickCapture, syncNow, view]);

  const listEntries = useMemo(() => {
    const active = journalState.active;
    const cloud = records.filter((record) => record.id !== active.id);
    if (active.journalDate !== selectedDate || !hasJournalContent(active.areas)) return records;
    const matching = records.find((record) => record.id === active.id);
    if (
      matching &&
      (matching.deliveryState !== "undelivered" ||
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

  useEffect(() => {
    recordRowRefs.current[selectedIndex]?.scrollIntoView({
      block: "nearest",
      behavior: "auto",
    });
  }, [selectedDate, selectedIndex, listEntries.length]);

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
    window.setTimeout(() => focusArea(0), 0);
  }

  async function discardCurrent(destination: "hide" | "full" | "special") {
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
      else if (destination === "full") openFullJournal();
      else showSpecialPage(0);
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

    if (
      confirmation === "none" &&
      handleVerticalAreaNavigation(
        event,
        index,
        fieldRefs,
        JOURNAL_AREA_KEYS.length,
      )
    ) {
      return;
    }

    const action = quickCaptureKeyAction(
      hasJournalInput(journalState.active.areas),
      confirmation,
      event.key,
      event.shiftKey,
      event.ctrlKey,
    );
    if (action === "none") return;
    event.preventDefault();

    if (action === "hide") void invoke("hide_current_window");
    else if (action === "open-full") openFullJournal();
    else if (action === "open-special") showSpecialPage(0);
    else if (action === "confirm-complete") {
      setConfirmation("complete");
      setConfirmationChoice("confirm");
    } else if (action === "confirm-hide") {
      setConfirmation("hide");
      setConfirmationChoice("confirm");
    } else if (action === "confirm-full") {
      setConfirmation("full");
      setConfirmationChoice("confirm");
    } else if (action === "confirm-special") {
      setConfirmation("special");
      setConfirmationChoice("confirm");
    } else if (action === "cancel" || confirmationChoice === "cancel") {
      setConfirmation("none");
    } else if (action === "finish") finishCurrent();
    else if (action === "discard-hide") void discardCurrent("hide");
    else if (action === "discard-full") void discardCurrent("full");
    else if (action === "discard-special") void discardCurrent("special");
  }

  function shiftDate(delta: number) {
    const next = shiftJournalDate(selectedDate, delta);
    setSelectedDate(next);
    setSelectedIndex(0);
    prefetchDateNeighborhood(next);
  }

  function handleListKey(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      void invoke("hide_current_window");
    } else if (event.ctrlKey && event.key === "ArrowRight") {
      event.preventDefault();
      showQuickCapture();
    } else if (event.ctrlKey && event.key === "ArrowLeft") {
      event.preventDefault();
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
      openRecord(listEntries[selectedIndex]!);
    }
  }

  function openRecord(record: JournalRecord) {
    const areas = { ...record.areas };
    setEditingRecord({ ...record, areas });
    setEditingOriginalAreas({ ...areas });
    setShowDeletions(false);
    setRecordConfirmation("none");
    setRecordConfirmationChoice("confirm");
    setView("record");
    window.setTimeout(() => focusRecordArea(0), 0);
  }

  function returnToList() {
    setEditingRecord(null);
    setEditingOriginalAreas(null);
    setShowDeletions(false);
    setRecordConfirmation("none");
    setView("list");
    window.setTimeout(() => listRef.current?.focus(), 0);
  }

  function replaceCachedRecord(record: JournalRecord) {
    setRecordsByDate((current) => {
      const recordsForDate = current[record.journalDate] ?? [];
      const updated = {
        ...current,
        [record.journalDate]: recordsForDate.map((item) =>
          item.id === record.id ? record : item,
        ),
      };
      persistRecordCache(updated);
      return updated;
    });
  }

  function saveRecordEditor() {
    const record = editingRecord;
    if (!record) return;
    if (
      editingOriginalAreas &&
      journalAreasEqual(editingOriginalAreas, record.areas)
    ) {
      returnToList();
      return;
    }
    returnToList();
    if (record.deliveryState !== "undelivered") return;

    replaceCachedRecord(record);
    if (record.id === stateRef.current.active.id) {
      const current = stateRef.current;
      const updated = {
        ...current,
        active: { ...current.active, areas: record.areas, editingState: "idle" as const },
      };
      commitState(finishActive(updated, new Date(), idFactory));
      void syncNow();
      return;
    }

    void invoke<JournalRecord>("update_journal_record", {
      id: record.id,
      input: {
        deviceId: record.deviceId,
        journalDate: record.journalDate,
        areas: record.areas,
        editingState: "idle",
        expectedRevision: record.revision,
        conflictRecordId: crypto.randomUUID(),
      },
    })
      .then((saved) => {
        replaceCachedRecord(saved);
        void loadRecords(selectedDate);
      })
      .catch((error) => setSyncError(errorMessage(error)));
  }

  function handleRecordKey(event: ReactKeyboardEvent<HTMLElement>) {
    const record = editingRecord;
    if (!record) return;
    if (record.deliveryState !== "undelivered") {
      if (event.key === "Escape") {
        event.preventDefault();
        returnToList();
      }
      return;
    }

    if (
      event.ctrlKey &&
      (event.key === "-" || event.code === "Minus" || event.code === "NumpadSubtract")
    ) {
      event.preventDefault();
      setRecordConfirmation("none");
      setShowDeletions((visible) => !visible);
      return;
    }

    if (
      recordConfirmation !== "none" &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      setRecordConfirmation("none");
      return;
    }
    if (
      recordConfirmation !== "none" &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      setRecordConfirmationChoice((choice) =>
        choice === "confirm" ? "cancel" : "confirm",
      );
      return;
    }
    if (recordConfirmation !== "none") {
      if (event.key === "Escape") {
        event.preventDefault();
        setRecordConfirmation("none");
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (recordConfirmationChoice === "cancel") setRecordConfirmation("none");
        else if (recordConfirmation === "save") saveRecordEditor();
        else returnToList();
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      setRecordConfirmation("save");
      setRecordConfirmationChoice("confirm");
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (
        editingOriginalAreas &&
        journalAreasEqual(editingOriginalAreas, record.areas)
      ) {
        returnToList();
      } else {
        setRecordConfirmation("discard");
        setRecordConfirmationChoice("confirm");
      }
    }
  }

  // Window-level handling also works when a newly mounted page has no focused input.
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key !== "Escape" || view === "special") return;
      // These handlers use only keyboard fields and preventDefault for Escape.
      if (view === "quick") handleQuickKey(event as unknown as ReactKeyboardEvent<HTMLTextAreaElement>, 0);
      else if (view === "record") handleRecordKey(event as unknown as ReactKeyboardEvent<HTMLElement>);
      else if (view === "list") handleListKey(event as unknown as ReactKeyboardEvent<HTMLElement>);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  });

  useEffect(() => {
    if (view !== "special") return;
    const handle = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.ctrlKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        event.stopPropagation();
        requestModeChange(event.key === "ArrowLeft" ? -1 : 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        showQuickCapture();
      }
    };
    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  });

  const themeStyle = {
    "--paper": captureTheme.paper,
    "--ink": captureTheme.ink,
  } as CSSProperties;

  if (view === "special") {
    const definition = SPECIAL_CAPTURE_PAGES[specialIndex];
    if (definition) {
      const Page = definition.Component;
      return (
        <div className="desktopJournal viewEnter" style={themeStyle} key={`special-${definition.id}`}>
          <div className="dragStrip" data-tauri-drag-region />
          <Page requestModeChange={requestModeChange} />
        </div>
      );
    }
  }

  if (view === "quick") {
    const prompt = confirmation === "complete" ? "完成？" : "不保存？";
    return (
      <main className="desktopJournal quickJournal viewEnter" style={themeStyle} key="quick">
        <div className="dragStrip" data-tauri-drag-region />
        <section
          className={confirmation === "none" ? "areaEditor" : "areaEditor quieted"}
          key={journalState.active.id}
        >
          {JOURNAL_AREA_KEYS.map((key, index) => (
            <label className="journalArea" key={key}>
              <span aria-hidden="true">{AREA_SYMBOLS[key]}</span>
              <span className="srOnly">{key}</span>
              <textarea
                ref={(node) => {
                  fieldRefs.current[index] = node;
                  autosizeTextarea(node);
                }}
                value={journalState.active.areas[key]}
                onChange={(event) => {
                  verticalBoundaryRef.current = null;
                  editArea(key, event.target.value);
                  autosizeTextarea(event.currentTarget);
                }}
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
                onClick={() => confirmation === "complete"
                  ? finishCurrent()
                  : void discardCurrent(
                      confirmation === "hide"
                        ? "hide"
                        : confirmation === "full"
                          ? "full"
                          : "special",
                    )}
              >
                {confirmation === "complete" ? "完成" : "離開"}
              </button>
            </div>
          </div>
        ) : null}
        <SyncStatus error={syncError} />
      </main>
    );
  }

  if (view === "record" && editingRecord) {
    const delivered = editingRecord.deliveryState !== "undelivered";
    const editCounts = editingOriginalAreas
      ? journalEditCounts(editingOriginalAreas, editingRecord.areas)
      : { added: 0, removed: 0 };
    const saveSummary = editCounts.added === 0 && editCounts.removed === 0
      ? "沒有變更"
      : `新增 ${editCounts.added}・刪除 ${editCounts.removed} 字元`;
    const recordAreaKeys = JOURNAL_AREA_KEYS.filter(
      (key) => !delivered || editingRecord.areas[key].trim(),
    );
    return (
      <main
        className="desktopJournal recordEditor viewEnter"
        key="record"
        style={themeStyle}
        onKeyDown={handleRecordKey}
      >
        <div className="dragStrip" data-tauri-drag-region />
        {!delivered ? (
          <button
            type="button"
            className={showDeletions ? "deletionToggle active" : "deletionToggle"}
            onClick={() => setShowDeletions((visible) => !visible)}
            aria-label={showDeletions ? "隱藏刪除內容" : "顯示刪除內容"}
            title={`${showDeletions ? "隱藏" : "顯示"}刪除內容（Ctrl+-）`}
          >
            −
          </button>
        ) : null}
        <section className={recordConfirmation === "none" ? "areaEditor" : "areaEditor quieted"}>
          {recordAreaKeys.map((key, index) => {
            const diff = textEditDiff(
              editingOriginalAreas?.[key] ?? editingRecord.areas[key],
              editingRecord.areas[key],
            );
            const changed = Boolean(diff.added || diff.removed);
            return (
              <label className="journalArea" key={key}>
                <span aria-hidden="true">{AREA_SYMBOLS[key]}</span>
                <span className="srOnly">{key}</span>
                <div className="diffField">
                  {changed ? (
                    <pre className="diffOverlay" aria-hidden="true">
                      <span>{diff.before}</span>
                      {diff.added ? <ins>{diff.added}</ins> : null}
                      <span>{diff.after}</span>
                    </pre>
                  ) : null}
                  <textarea
                    className={changed ? "diffInput" : ""}
                    ref={(node) => {
                      recordFieldRefs.current[index] = node;
                      autosizeTextarea(node);
                    }}
                    value={editingRecord.areas[key]}
                    onChange={(event) => {
                      verticalBoundaryRef.current = null;
                      setEditingRecord({
                        ...editingRecord,
                        areas: { ...editingRecord.areas, [key]: event.target.value },
                      });
                      autosizeTextarea(event.currentTarget);
                    }}
                    onKeyDown={(event) => {
                      handleVerticalAreaNavigation(
                        event,
                        index,
                        recordFieldRefs,
                        recordAreaKeys.length,
                      );
                    }}
                    rows={2}
                    disabled={delivered}
                    aria-label={key}
                  />
                  {showDeletions && diff.removed ? (
                    <del className="deletedText">{diff.removed}</del>
                  ) : null}
                </div>
              </label>
            );
          })}
        </section>
        {recordConfirmation !== "none" ? (
          <div className="microPrompt" role="dialog" aria-label={recordConfirmation === "save" ? "保存？" : "不保存？"}>
            <p>{recordConfirmation === "save" ? saveSummary : "不保存？"}</p>
            <div>
              <button className={recordConfirmationChoice === "cancel" ? "selected" : ""} onClick={() => setRecordConfirmation("none")}>取消</button>
              <button
                className={recordConfirmationChoice === "confirm" ? "selected" : ""}
                onClick={recordConfirmation === "save" ? saveRecordEditor : returnToList}
              >
                {recordConfirmation === "save" ? "保存" : "離開"}
              </button>
            </div>
          </div>
        ) : null}
        {delivered ? <span className="lockMark" aria-label="已送出">◇</span> : null}
        <SyncStatus error={syncError} />
      </main>
    );
  }

  return (
    <main className="desktopJournal fullJournal viewEnter" key="list" style={themeStyle} ref={listRef} tabIndex={0} onKeyDown={handleListKey}>
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
              setSelectedIndex(0);
              prefetchDateNeighborhood(event.target.value);
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
            ref={(node) => {
              recordRowRefs.current[index] = node;
            }}
            className={index === selectedIndex ? "recordRow selected" : "recordRow"}
            onClick={() => setSelectedIndex(index)}
            onDoubleClick={() => openRecord(record)}
          >
            {previewLines(record.areas).map((line) => (
              <span className="previewLine" key={line.key}>
                <i>{line.symbol}</i><b>{line.text}</b>
              </span>
            ))}
            <time dateTime={record.createdAt}>{recordTimeLabel(record.createdAt)}</time>
            {record.deliveryState !== "undelivered" ? <em aria-label="已鎖定">◇</em> : null}
          </button>
        ))}
      </section>
      <SyncStatus error={syncError} />
    </main>
  );
}
