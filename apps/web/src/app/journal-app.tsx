"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";

import { AccountControls } from "./account-controls";
import { InstallPrompt } from "./install-prompt";
import { attachJournalBrowserEvents } from "./journal-browser-events";
import {
  createJournalSyncController,
  type JournalSyncController,
} from "./journal-sync";
import { JournalEditorView } from "./journal-view";

export function JournalApp({ accountEmail }: { accountEmail: string }) {
  const controllerRef = useRef<JournalSyncController | null>(null);
  const unclassifiedRef = useRef<HTMLTextAreaElement | null>(null);
  const focusNewSheetRef = useRef(false);

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

  useEffect(() => {
    if (activeId === undefined || !focusNewSheetRef.current) return;
    focusNewSheetRef.current = false;
    unclassifiedRef.current?.focus();
  }, [activeId]);

  function startNewRecord() {
    focusNewSheetRef.current = true;
    if (!controllerRef.current?.finishActiveAndStartNew()) {
      focusNewSheetRef.current = false;
    }
  }

  const visibleIssueMessages = [
    ...new Set(snapshot?.status.issues.map((issue) => issue.message) ?? []),
  ];
  const canFinalize = !snapshot?.status.issues.some(
    (issue) =>
      issue.localId === activeId &&
      (issue.code === "CONTENT_TOO_LONG" ||
        issue.code === "INVALID_JOURNAL_RECORD"),
  );

  return (
    <main>
      <header>
        <AccountControls email={accountEmail} />
        <InstallPrompt />
      </header>
      <JournalEditorView
        areas={state?.active.areas ?? {
          unclassified: "",
          event: "",
          question: "",
          insight: "",
          next: "",
          feeling: "",
        }}
        canFinalize={canFinalize}
        issueMessages={visibleIssueMessages}
        onEdit={(key, value) =>
          controllerRef.current?.editActiveArea(key, value)
        }
        onNewRecord={startNewRecord}
        unclassifiedRef={unclassifiedRef}
      />
    </main>
  );
}
