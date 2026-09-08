"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  emptyJournalAreas,
  hasJournalContent,
  validateJournalDate,
  type JournalRecord,
  type TrashedJournalRecord,
} from "../lib/journal-record";
import { AccountControls } from "./account-controls";
import { InstallPrompt } from "./install-prompt";
import { attachJournalBrowserEvents } from "./journal-browser-events";
import { shiftJournalDate } from "./journal-session";
import {
  createJournalSyncController,
  type JournalSyncController,
} from "./journal-sync";
import {
  journalEditCounts,
  parseJournalRecordList,
  parseJournalTrashList,
  persistJournalTheme,
  reconcileJournalRecordList,
  readJournalTheme,
  type JournalListEntry,
  type JournalTheme,
} from "./journal-ui";
import {
  JournalEditorView,
  JournalRecordEditorView,
  JournalRecordListView,
  JournalToolbar,
} from "./journal-view";
import { ModuleRail, type CaptureModule } from "./module-rail";

type ConfirmAction = "abandon" | null;
type DateSlideDirection = "previous" | "next" | null;

function trashPreview(record: TrashedJournalRecord) {
  return Object.values(record.areas).find((value) => value.trim())?.trim() ?? "空白紀錄";
}

export function JournalApp({
  accountEmail,
  active = true,
  onSelectModule = () => undefined,
}: {
  accountEmail: string;
  active?: boolean;
  onSelectModule?: (module: CaptureModule) => void;
}) {
  const controllerRef = useRef<JournalSyncController | null>(null);
  const unclassifiedRef = useRef<HTMLTextAreaElement | null>(null);
  const focusNewSheetRef = useRef(false);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeConsumedRef = useRef(false);
  const [selectedDateOverride, setSelectedDateOverride] = useState<string | null>(null);
  const [listMode, setListMode] = useState(false);
  const [recordsByDate, setRecordsByDate] = useState<Record<string, JournalRecord[]>>({});
  const [selectedRecord, setSelectedRecord] = useState<JournalListEntry | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [listIssue, setListIssue] = useState<string | null>(null);
  const [listRequestVersion, setListRequestVersion] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashRecords, setTrashRecords] = useState<TrashedJournalRecord[]>([]);
  const [trashIssue, setTrashIssue] = useState<string | null>(null);
  const [showDeletions, setShowDeletions] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const [dateSlideDirection, setDateSlideDirection] = useState<DateSlideDirection>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [pendingModule, setPendingModule] = useState<CaptureModule | null>(null);
  const [theme, setTheme] = useState<JournalTheme>(() =>
    typeof window === "undefined" ? "light" : readJournalTheme(window.localStorage),
  );

  const subscribe = useCallback((onStoreChange: () => void) => {
    const controller = createJournalSyncController({
      storage: window.localStorage,
      request: (url, init) => fetch(url, init),
    });
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(onStoreChange);
    const detachBrowserEvents = attachJournalBrowserEvents({
      onlineTarget: window,
      visibilityTarget: document,
      onOnline: () => void controller.retryPending(),
      onHidden: () => controller.markHidden(),
      onVisible: () => {
        focusNewSheetRef.current = controller.resumeVisible();
      },
    });
    void controller.start();
    onStoreChange();
    return () => {
      detachBrowserEvents();
      unsubscribe();
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, []);

  const getSnapshot = useCallback(() => controllerRef.current?.getSnapshot() ?? null, []);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const state = snapshot?.state;
  const activeId = state?.active.id;
  const selectedDate = selectedDateOverride ?? state?.active.journalDate ?? "";
  const records = selectedDate === "" ? [] : (recordsByDate[selectedDate] ?? []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!listMode || selectedRecord !== null || selectedDate === "") return;
    const abortController = new AbortController();
    const dates = [selectedDate, shiftJournalDate(selectedDate, -1), shiftJournalDate(selectedDate, 1)];
    void Promise.all(dates.map(async (date) => {
      try {
        const response = await fetch(`/api/journal-records?date=${encodeURIComponent(date)}`, {
          signal: abortController.signal,
        });
        if (!response.ok) throw new Error("Journal list request failed.");
        const nextRecords = parseJournalRecordList(await response.json() as unknown, date);
        if (!abortController.signal.aborted) {
          setRecordsByDate((current) => ({ ...current, [date]: nextRecords }));
          if (date === selectedDate) setListIssue(null);
        }
      } catch {
        if (!abortController.signal.aborted && date === selectedDate) setListIssue("紀錄目前無法載入");
      }
    }));
    return () => abortController.abort();
  }, [listMode, listRequestVersion, selectedDate, selectedRecord]);

  useEffect(() => {
    if (!trashOpen) return;
    const abortController = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/journal-records/trash", { signal: abortController.signal });
        if (!response.ok) throw new Error("Trash request failed.");
        const next = parseJournalTrashList(await response.json() as unknown);
        if (!abortController.signal.aborted) {
          setTrashRecords(next);
          setTrashIssue(null);
        }
      } catch {
        if (!abortController.signal.aborted) setTrashIssue("垃圾桶目前無法載入");
      }
    })();
    return () => abortController.abort();
  }, [trashOpen]);

  useEffect(() => {
    if (activeId === undefined || !focusNewSheetRef.current) return;
    focusNewSheetRef.current = false;
    unclassifiedRef.current?.focus();
  }, [activeId]);

  if (snapshot === null || state === undefined || selectedDate === "") {
    return <main className="journalShell" hidden={!active} />;
  }

  const reconciledList = reconcileJournalRecordList(records, state.active, selectedDate, selectedRowId);
  const mode = selectedRecord !== null ? "record" : listMode ? "list" : "capture";
  const editableAreas = selectedRecord?.deliveryState === "undelivered" ? state.active.areas : selectedRecord?.areas;
  const editCounts = selectedRecord && editableAreas
    ? journalEditCounts(selectedRecord.areas, editableAreas)
    : { added: 0, removed: 0 };
  const hasEditChanges = editCounts.added > 0 || editCounts.removed > 0;

  function startNewRecord() {
    focusNewSheetRef.current = true;
    if (!controllerRef.current?.finishActiveAndStartNew()) focusNewSheetRef.current = false;
  }

  function showDate(value: string, direction: DateSlideDirection = null) {
    if (!validateJournalDate(value)) return;
    setDateSlideDirection(direction);
    setSelectedDateOverride(value);
    setSelectedRecord(null);
    setSelectedRowId(null);
    setListIssue(null);
    setDeleteMode(false);
    setListMode(true);
  }

  function openList() {
    setSelectedRecord(null);
    setListIssue(null);
    setListMode(true);
    setDeleteMode(false);
    setListRequestVersion((version) => version + 1);
  }

  function addRecordForSelectedDate() {
    focusNewSheetRef.current = true;
    if (controllerRef.current?.startNewForDate(selectedDate)) {
      setListMode(false);
      setDeleteMode(false);
      setSelectedRecord(null);
    } else {
      focusNewSheetRef.current = false;
    }
  }

  function selectRecord(record: JournalListEntry) {
    if (deleteMode) {
      trashRecordFromList(record);
      return;
    }
    setSelectedRowId(record.id);
    if (
      record.deliveryState === "undelivered" &&
      record.serverRecord !== null &&
      !controllerRef.current?.openRecord(record.serverRecord)
    ) {
      setListIssue("目前的清除動作同步後才能開啟另一筆紀錄");
      return;
    }
    setShowDeletions(false);
    setSelectedRecord(record);
  }

  function returnToList() {
    if (selectedRecord?.deliveryState === "undelivered") {
      if (!hasJournalContent(state!.active.areas) && hasJournalContent(selectedRecord.areas)) {
        setConfirmAction("abandon");
        return;
      }
      if (hasJournalContent(state!.active.areas)) controllerRef.current?.finishActiveAndStartNew();
    }
    setSelectedRecord(null);
    setListIssue(null);
    setListRequestVersion((version) => version + 1);
  }

  function requestAbandon() {
    if (!selectedRecord || selectedRecord.deliveryState !== "undelivered") returnToList();
    else if (!hasEditChanges) returnToList();
    else setConfirmAction("abandon");
  }

  function confirmAbandon() {
    if (selectedRecord && controllerRef.current?.discardActiveEdits(selectedRecord.areas)) {
      setSelectedRecord(null);
      setConfirmAction(null);
      setListRequestVersion((version) => version + 1);
    }
  }

  function trashRecordFromList(record: JournalListEntry) {
    if (record.deliveryState !== "undelivered") return;
    if (
      record.serverRecord !== null &&
      !controllerRef.current?.openRecord(record.serverRecord)
    ) {
      setListIssue("目前的同步完成後才能刪除這筆紀錄");
      return;
    }
    if (!controllerRef.current?.trashActiveRecord()) {
      setListIssue("目前無法刪除這筆紀錄");
      return;
    }
    setRecordsByDate((current) => ({
      ...current,
      [record.journalDate]: (current[record.journalDate] ?? []).filter((item) => item.id !== record.id),
    }));
    setSelectedRowId(null);
    setListRequestVersion((version) => version + 1);
  }

  async function restoreRecord(record: TrashedJournalRecord) {
    setTrashIssue(null);
    try {
      const response = await fetch(`/api/journal-records/${record.id}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: record.revision }),
      });
      if (!response.ok) throw new Error("Restore failed.");
      setTrashRecords((current) => current.filter((item) => item.id !== record.id));
      setRecordsByDate((current) => {
        const next = { ...current };
        delete next[record.journalDate];
        return next;
      });
      setListRequestVersion((version) => version + 1);
    } catch {
      setTrashIssue("無法還原，請重新整理後再試");
    }
  }

  function chooseTheme(nextTheme: JournalTheme) {
    setTheme(nextTheme);
    persistJournalTheme(window.localStorage, nextTheme);
  }

  function requestModule(module: CaptureModule) {
    if (module === "journal") return;
    if (mode === "capture" && hasJournalContent(state!.active.areas)) {
      setPendingModule(module);
      return;
    }
    onSelectModule(module);
  }

  function discardAndSwitchModule() {
    if (pendingModule === null) return;
    if (!controllerRef.current?.trashActiveRecord()) return;
    const destination = pendingModule;
    setPendingModule(null);
    onSelectModule(destination);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
    swipeStartRef.current = { x: event.clientX, y: event.clientY };
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || selectedRecord !== null) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    swipeConsumedRef.current = true;
    showDate(
      shiftJournalDate(selectedDate, dx < 0 ? 1 : -1),
      dx < 0 ? "next" : "previous",
    );
  }

  const visibleIssueMessages = [...new Set(snapshot.status.issues.map((issue) => issue.message))];
  const canFinalize = !snapshot.status.issues.some(
    (issue) => issue.localId === activeId && (issue.code === "CONTENT_TOO_LONG" || issue.code === "INVALID_JOURNAL_RECORD"),
  );

  return (
    <main className="journalShell" hidden={!active}>
      <JournalToolbar
        date={selectedDate}
        mode={mode}
        onOpenSettings={() => setSettingsOpen(true)}
        onDateChange={showDate}
        onPrimaryAction={mode === "capture" ? openList : mode === "list" ? addRecordForSelectedDate : requestAbandon}
      />

      <div
        className="journalContentFrame"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onClickCapture={(event) => {
          if (swipeConsumedRef.current) {
            event.stopPropagation();
            swipeConsumedRef.current = false;
          }
        }}
      >
        <div
          className={dateSlideDirection === null ? "journalContent" : `journalContent dateSlide-${dateSlideDirection}`}
          onAnimationEnd={() => setDateSlideDirection(null)}
        >
          {listMode ? (
            selectedRecord === null ? (
              <>
                {listIssue ? <div className="journalIssue" role="alert" aria-label={listIssue}><span aria-hidden="true">⚠</span></div> : null}
                <JournalRecordListView
                  records={reconciledList.entries}
                  selectedId={reconciledList.selectedId}
                  deleteMode={deleteMode}
                  onToggleDeleteMode={() => setDeleteMode((enabled) => !enabled)}
                  onSelect={selectRecord}
                />
              </>
            ) : (
              <JournalRecordEditorView
                record={selectedRecord}
                originalAreas={selectedRecord.areas}
                areas={editableAreas ?? selectedRecord.areas}
                issueMessages={visibleIssueMessages}
                showDeletions={showDeletions}
                editCounts={editCounts}
                onEdit={(key, value) => controllerRef.current?.editActiveArea(key, value)}
                onBack={returnToList}
                onToggleDeletions={() => setShowDeletions((visible) => !visible)}
              />
            )
          ) : (
            <JournalEditorView
              areas={state.active.areas ?? emptyJournalAreas()}
              canFinalize={canFinalize}
              issueMessages={visibleIssueMessages}
              onEdit={(key, value) => controllerRef.current?.editActiveArea(key, value)}
              onNewRecord={startNewRecord}
              unclassifiedRef={unclassifiedRef}
            />
          )}
        </div>
      </div>

      {settingsOpen ? (
        <div className="journalSettingsBackdrop">
          <section className="journalSettings" role="dialog" aria-modal="true" aria-label="設定">
            <header><span>設定</span><button type="button" aria-label="關閉設定" onClick={() => setSettingsOpen(false)}>×</button></header>
            <fieldset>
              <legend>主題</legend>
              <label><input type="radio" name="theme" checked={theme === "light"} onChange={() => chooseTheme("light")} />淺色</label>
              <label><input type="radio" name="theme" checked={theme === "dark"} onChange={() => chooseTheme("dark")} />深色</label>
            </fieldset>
            <section className="trashSettings">
              <button type="button" className="trashHeading" onClick={() => setTrashOpen((open) => !open)}>
                <span>垃圾桶</span><span aria-hidden="true">{trashOpen ? "−" : "+"}</span>
              </button>
              {trashOpen ? (
                <div className="trashList">
                  {trashIssue ? <p role="alert">{trashIssue}</p> : null}
                  {trashRecords.map((record) => (
                    <div className="trashRow" key={record.id}>
                      <span><small>{record.journalDate}</small>{trashPreview(record)}</span>
                      <button type="button" onClick={() => void restoreRecord(record)}>還原</button>
                    </div>
                  ))}
                  {!trashIssue && trashRecords.length === 0 ? <p>沒有已刪除的紀錄</p> : null}
                </div>
              ) : null}
            </section>
            <AccountControls email={accountEmail} />
            <InstallPrompt />
          </section>
        </div>
      ) : null}

      {confirmAction ? (
        <div className="journalSettingsBackdrop">
          <section className="microDialog" role="dialog" aria-modal="true" aria-label="復原本次修改？">
            <p>復原到編輯前的內容？</p>
            <div>
              <button type="button" onClick={() => setConfirmAction(null)}>取消</button>
              <button type="button" onClick={confirmAbandon}>復原</button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingModule ? (
        <div className="journalSettingsBackdrop">
          <section className="microDialog" role="dialog" aria-modal="true" aria-label="不保存就離開？">
            <p>不保存就離開？</p>
            <div>
              <button type="button" onClick={() => setPendingModule(null)}>取消</button>
              <button type="button" onClick={discardAndSwitchModule}>離開</button>
            </div>
          </section>
        </div>
      ) : null}

      <ModuleRail active="journal" onSelect={requestModule} />
    </main>
  );
}
