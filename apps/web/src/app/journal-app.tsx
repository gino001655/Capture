"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { emptyJournalAreas, validateJournalDate, type JournalRecord } from "../lib/journal-record";
import { AccountControls } from "./account-controls";
import { InstallPrompt } from "./install-prompt";
import { attachJournalBrowserEvents } from "./journal-browser-events";
import { shiftJournalDate } from "./journal-session";
import {
  createJournalSyncController,
  type JournalSyncController,
} from "./journal-sync";
import {
  parseJournalRecordList,
  persistJournalTheme,
  readJournalTheme,
  type JournalTheme,
} from "./journal-ui";
import {
  JournalEditorView,
  JournalRecordEditorView,
  JournalRecordListView,
  JournalToolbar,
} from "./journal-view";

export function JournalApp({ accountEmail }: { accountEmail: string }) {
  const controllerRef = useRef<JournalSyncController | null>(null);
  const unclassifiedRef = useRef<HTMLTextAreaElement | null>(null);
  const focusNewSheetRef = useRef(false);
  const [selectedDateOverride, setSelectedDateOverride] = useState<string | null>(null);
  const [listMode, setListMode] = useState(false);
  const [records, setRecords] = useState<JournalRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<JournalRecord | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [listIssue, setListIssue] = useState<string | null>(null);
  const [listRequestVersion, setListRequestVersion] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
      onOnline: () => {
        void controller.retryPending();
      },
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

  const getSnapshot = useCallback(
    () => controllerRef.current?.getSnapshot() ?? null,
    [],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const state = snapshot?.state;
  const activeId = state?.active.id;
  const selectedDate = selectedDateOverride ?? state?.active.journalDate ?? "";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!listMode || selectedRecord !== null || selectedDate === "") return;
    const abortController = new AbortController();

    void (async () => {
      try {
        const response = await fetch(
          `/api/journal-records?date=${encodeURIComponent(selectedDate)}`,
          { signal: abortController.signal },
        );
        if (!response.ok) throw new Error("Journal list request failed.");
        const payload: unknown = await response.json();
        const nextRecords = parseJournalRecordList(payload, selectedDate);
        if (abortController.signal.aborted) return;
        setRecords(nextRecords);
        setListIssue(null);
      } catch (error) {
        if (abortController.signal.aborted) return;
        setListIssue(
          error instanceof Error
            ? "紀錄目前無法載入"
            : "紀錄回應無法讀取",
        );
      }
    })();

    return () => abortController.abort();
  }, [listMode, listRequestVersion, selectedDate, selectedRecord]);

  useEffect(() => {
    if (activeId === undefined || !focusNewSheetRef.current) return;
    focusNewSheetRef.current = false;
    unclassifiedRef.current?.focus();
  }, [activeId]);

  if (snapshot === null || state === undefined || selectedDate === "") {
    return <main className="journalShell" />;
  }

  function startNewRecord() {
    focusNewSheetRef.current = true;
    if (!controllerRef.current?.finishActiveAndStartNew()) {
      focusNewSheetRef.current = false;
    }
  }

  function showDate(value: string) {
    if (!validateJournalDate(value)) return;
    setSelectedDateOverride(value);
    setSelectedRecord(null);
    setSelectedRowId(null);
    setRecords([]);
    setListIssue(null);
    setListMode(true);
  }

  function toggleList() {
    setSelectedRecord(null);
    setListIssue(null);
    if (listMode) {
      setListMode(false);
      return;
    }
    setListMode(true);
    setListRequestVersion((version) => version + 1);
  }

  function selectRecord(record: JournalRecord) {
    setSelectedRowId(record.id);
    if (
      record.deliveryState === "undelivered" &&
      !controllerRef.current?.openRecord(record)
    ) {
      setListIssue("目前的清除動作同步後才能開啟另一筆紀錄");
      return;
    }
    setSelectedRecord(record);
  }

  function returnToList() {
    setSelectedRecord(null);
    setListIssue(null);
    setListRequestVersion((version) => version + 1);
  }

  function chooseTheme(nextTheme: JournalTheme) {
    setTheme(nextTheme);
    persistJournalTheme(window.localStorage, nextTheme);
  }

  const visibleIssueMessages = [
    ...new Set(snapshot.status.issues.map((issue) => issue.message)),
  ];
  const canFinalize = !snapshot.status.issues.some(
    (issue) =>
      issue.localId === activeId &&
      (issue.code === "CONTENT_TOO_LONG" ||
        issue.code === "INVALID_JOURNAL_RECORD"),
  );

  return (
    <main className="journalShell">
      <JournalToolbar
        date={selectedDate}
        listMode={listMode}
        onOpenSettings={() => setSettingsOpen(true)}
        onPrevious={() => showDate(shiftJournalDate(selectedDate, -1))}
        onDateChange={showDate}
        onNext={() => showDate(shiftJournalDate(selectedDate, 1))}
        onToggleList={toggleList}
      />

      <div className="journalContent">
        {listMode ? (
          selectedRecord === null ? (
            <>
              {listIssue === null ? null : (
                <div className="journalIssue" role="alert" aria-label={listIssue}>
                  <span aria-hidden="true">⚠</span>
                </div>
              )}
              <JournalRecordListView
                records={records}
                selectedId={selectedRowId}
                onSelect={selectRecord}
              />
            </>
          ) : (
            <JournalRecordEditorView
              record={selectedRecord}
              areas={
                selectedRecord.deliveryState === "delivered"
                  ? selectedRecord.areas
                  : state.active.areas
              }
              issueMessages={visibleIssueMessages}
              onEdit={(key, value) =>
                controllerRef.current?.editActiveArea(key, value)
              }
              onBack={returnToList}
            />
          )
        ) : (
          <JournalEditorView
            areas={state.active.areas ?? emptyJournalAreas()}
            canFinalize={canFinalize}
            issueMessages={visibleIssueMessages}
            onEdit={(key, value) =>
              controllerRef.current?.editActiveArea(key, value)
            }
            onNewRecord={startNewRecord}
            unclassifiedRef={unclassifiedRef}
          />
        )}
      </div>

      {settingsOpen ? (
        <div className="journalSettingsBackdrop">
          <section
            className="journalSettings"
            role="dialog"
            aria-modal="true"
            aria-label="設定"
          >
            <header>
              <span>設定</span>
              <button
                type="button"
                aria-label="關閉設定"
                onClick={() => setSettingsOpen(false)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </header>
            <fieldset>
              <legend>主題</legend>
              <label>
                <input
                  type="radio"
                  name="theme"
                  checked={theme === "light"}
                  onChange={() => chooseTheme("light")}
                />
                淺色
              </label>
              <label>
                <input
                  type="radio"
                  name="theme"
                  checked={theme === "dark"}
                  onChange={() => chooseTheme("dark")}
                />
                深色
              </label>
            </fieldset>
            <AccountControls email={accountEmail} />
            <InstallPrompt />
          </section>
        </div>
      ) : null}
    </main>
  );
}
