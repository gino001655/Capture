"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ChangeEvent,
} from "react";

import {
  emptyJournalAreas,
  hasJournalContent,
  type JournalAreaKey,
} from "../lib/journal-record";
import { AccountControls } from "./account-controls";
import { InstallPrompt } from "./install-prompt";
import {
  createJournalSyncController,
  getJournalAreaFields,
  type JournalSyncController,
} from "./journal-sync";

const EMPTY_AREAS = emptyJournalAreas();

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

    const handleOnline = () => {
      void controller.retryPending();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        controller.markHidden();
        return;
      }

      focusNewSheetRef.current = controller.resumeVisible();
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void controller.start();
    onStoreChange();

    return () => {
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unsubscribe();
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, []);

  const getSnapshot = useCallback(
    () => controllerRef.current?.getState() ?? null,
    [],
  );
  const state = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const activeId = state?.active.id;

  useEffect(() => {
    if (activeId === undefined || !focusNewSheetRef.current) return;
    focusNewSheetRef.current = false;
    unclassifiedRef.current?.focus();
  }, [activeId]);

  function editArea(key: JournalAreaKey, event: ChangeEvent<HTMLTextAreaElement>) {
    controllerRef.current?.editActiveArea(key, event.currentTarget.value);
  }

  function startNewRecord() {
    focusNewSheetRef.current = true;
    if (!controllerRef.current?.finishActiveAndStartNew()) {
      focusNewSheetRef.current = false;
    }
  }

  const areas = state?.active.areas ?? EMPTY_AREAS;
  const showNewRecord = hasJournalContent(areas);

  return (
    <main>
      <header>
        <AccountControls email={accountEmail} />
        <InstallPrompt />
      </header>
      <section aria-label="Journal editor">
        {getJournalAreaFields(areas).map((field) => (
          <div key={field.key}>
            <span aria-hidden="true">{field.symbol}</span>
            <textarea
              ref={field.key === "unclassified" ? unclassifiedRef : undefined}
              aria-label={field.ariaLabel}
              value={field.value}
              onChange={(event) => editArea(field.key, event)}
            />
          </div>
        ))}
        {showNewRecord ? (
          <button type="button" aria-label="New record" onClick={startNewRecord}>
            <span aria-hidden="true">＋</span>
          </button>
        ) : null}
      </section>
    </main>
  );
}
