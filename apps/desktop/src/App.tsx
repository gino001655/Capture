import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  DEFAULT_CAPTURE_THEME,
  readCaptureTheme,
  writeCaptureTheme,
  type CaptureTheme,
} from "./capture-theme";
import { DesktopJournal } from "./DesktopJournal";
import { handleDirectionalFocus } from "./keyboard-navigation";
import "./App.css";

const CAPTURE_SHORTCUT = "Ctrl + Numpad 5";
const WORKER_SHORTCUT = "Ctrl + NumLock";

type WorkerSnapshot = {
  kind: "ready" | "checking" | "idle" | "processed" | "paused" | "error";
  message: string;
  jobId: string | null;
  lastCheckedAt: number | null;
  paused: boolean;
  checking: boolean;
};

type ConnectionSettings = {
  apiBaseUrl: string;
  tokenConfigured: boolean;
  source: "environment" | "saved" | "missing";
  aiProvider: "codex-cli" | "none";
  aiModel: string | null;
  journalAiEnabled: boolean;
  ankiEnabled: boolean;
  ankiConnectUrl: string;
  ankiDeck: string;
  todoEnabled: boolean;
  todoCardId: string | null;
  desktopRemindersEnabled: boolean;
};

type TrashedJournalRecord = {
  id: string;
  journalDate: string;
  areas: Record<string, string>;
  revision: number;
  deletedAt: string;
};

type JournalDeliveryStatus = {
  pendingRecordCount: number;
  processingRecordCount: number;
  failedRecordCount: number;
  dates: Array<{
    journalDate: string;
    pending: number;
    processing: number;
    failed: number;
    lastError?: string;
    nextAttemptAt?: string;
  }>;
};

type EnglishDeliveryStatus = {
  pending: number;
  processing: number;
  failed: number;
};

function formatLastChecked(timestamp: number | null) {
  return timestamp === null
    ? "Not yet"
    : new Date(timestamp).toLocaleTimeString();
}

function WorkerView() {
  const rootRef = useRef<HTMLElement | null>(null);
  const [snapshot, setSnapshot] = useState<WorkerSnapshot>({
    kind: "ready",
    message: "Reading worker status...",
    jobId: null,
    lastCheckedAt: null,
    paused: false,
    checking: false,
  });
  const [startWithWindows, setStartWithWindows] = useState(false);
  const [connection, setConnection] = useState<ConnectionSettings>({
    apiBaseUrl: "http://localhost:3000",
    tokenConfigured: false,
    source: "missing",
    aiProvider: "codex-cli",
    aiModel: null,
    journalAiEnabled: false,
    ankiEnabled: false,
    ankiConnectUrl: "http://127.0.0.1:8765",
    ankiDeck: "English",
    todoEnabled: false,
    todoCardId: null,
    desktopRemindersEnabled: false,
  });
  const [apiBaseUrl, setApiBaseUrl] = useState("http://localhost:3000");
  const [deviceToken, setDeviceToken] = useState("");
  const [aiProvider, setAiProvider] = useState<ConnectionSettings["aiProvider"]>("codex-cli");
  const [aiModel, setAiModel] = useState("");
  const [journalAiEnabled, setJournalAiEnabled] = useState(false);
  const [ankiEnabled, setAnkiEnabled] = useState(false);
  const [ankiConnectUrl, setAnkiConnectUrl] = useState("http://127.0.0.1:8765");
  const [ankiDeck, setAnkiDeck] = useState("English");
  const [todoEnabled, setTodoEnabled] = useState(false);
  const [todoCardId, setTodoCardId] = useState("");
  const [desktopRemindersEnabled, setDesktopRemindersEnabled] = useState(false);
  const [testingTodo, setTestingTodo] = useState(false);
  const [todoResult, setTodoResult] = useState<string | null>(null);
  const [savingProcessing, setSavingProcessing] = useState(false);
  const [testingAnki, setTestingAnki] = useState(false);
  const [ankiTestResult, setAnkiTestResult] = useState<string | null>(null);
  const [savingConnection, setSavingConnection] = useState(false);
  const [settingError, setSettingError] = useState<string | null>(null);
  const [captureTheme, setCaptureTheme] = useState<CaptureTheme>(readCaptureTheme);
  const [trashRecords, setTrashRecords] = useState<TrashedJournalRecord[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [deliveryStatus, setDeliveryStatus] = useState<JournalDeliveryStatus | null>(null);
  const [englishDeliveryStatus, setEnglishDeliveryStatus] = useState<EnglishDeliveryStatus | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setSnapshot(await invoke<WorkerSnapshot>("get_worker_status"));
    } catch (error) {
      setSettingError(typeof error === "string" ? error : "Could not read worker status.");
    }
  }, []);

  const refreshDeliveryStatus = useCallback(async () => {
    try {
      const [journal, english] = await Promise.all([
        invoke<JournalDeliveryStatus>("get_journal_delivery_status"),
        invoke<EnglishDeliveryStatus>("get_english_delivery_status"),
      ]);
      setDeliveryStatus(journal);
      setEnglishDeliveryStatus(english);
    } catch {
      setDeliveryStatus(null);
      setEnglishDeliveryStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void refreshDeliveryStatus();
    void invoke<boolean>("get_start_with_windows")
      .then(setStartWithWindows)
      .catch((error) => {
        setSettingError(
          typeof error === "string" ? error : "Could not read startup settings.",
        );
      });
    void invoke<ConnectionSettings>("get_connection_settings").then((settings) => {
      setConnection(settings);
      setApiBaseUrl(settings.apiBaseUrl);
      setAiProvider(settings.aiProvider);
      setAiModel(settings.aiModel ?? "");
      setJournalAiEnabled(settings.journalAiEnabled);
      setAnkiEnabled(settings.ankiEnabled);
      setAnkiConnectUrl(settings.ankiConnectUrl);
      setAnkiDeck(settings.ankiDeck);
      setTodoEnabled(settings.todoEnabled);
      setTodoCardId(settings.todoCardId ?? "");
      setDesktopRemindersEnabled(settings.desktopRemindersEnabled);
    });

    const intervalId = window.setInterval(() => {
      void refreshStatus();
    }, 1_000);
    const deliveryIntervalId = window.setInterval(() => {
      void refreshDeliveryStatus();
    }, 15_000);

    const checkAfterReconnect = () => {
      void invoke<WorkerSnapshot>("check_for_work").then(setSnapshot);
    };

    window.addEventListener("online", checkAfterReconnect);

    return () => {
      window.clearInterval(intervalId);
      window.clearInterval(deliveryIntervalId);
      window.removeEventListener("online", checkAfterReconnect);
    };
  }, [refreshDeliveryStatus, refreshStatus]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        void invoke("hide_current_window");
        return;
      }
      if (rootRef.current) handleDirectionalFocus(event, rootRef.current);
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, []);

  async function checkNow() {
    setSettingError(null);
    try {
      await invoke("retry_failed_journal_deliveries");
      setSnapshot(await invoke<WorkerSnapshot>("check_for_work"));
      await refreshDeliveryStatus();
    } catch (error) {
      setSettingError(typeof error === "string" ? error : "Could not check pending work.");
    }
  }

  async function togglePause() {
    setSettingError(null);
    setSnapshot(
      await invoke<WorkerSnapshot>("set_pause", {
        paused: !snapshot.paused,
      }),
    );
  }

  async function toggleStartWithWindows() {
    setSettingError(null);
    try {
      setStartWithWindows(
        await invoke<boolean>("set_start_with_windows", {
          enabled: !startWithWindows,
        }),
      );
    } catch (error) {
      setSettingError(
        typeof error === "string" ? error : "Could not update startup settings.",
      );
    }
  }

  async function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettingError(null);
    setSavingConnection(true);

    try {
      const settings = await invoke<ConnectionSettings>("save_connection_settings", {
        apiBaseUrl,
        deviceToken,
      });
      setConnection(settings);
      setApiBaseUrl(settings.apiBaseUrl);
      setDeviceToken("");
      setSnapshot(await invoke<WorkerSnapshot>("check_for_work"));
      await refreshDeliveryStatus();
    } catch (error) {
      setSettingError(
        typeof error === "string" ? error : "Could not save connection settings.",
      );
    } finally {
      setSavingConnection(false);
    }
  }

  async function saveProcessing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettingError(null);
    setSavingProcessing(true);
    try {
      const settings = await invoke<ConnectionSettings>("save_processing_settings", {
        aiProvider,
        aiModel: aiModel.trim() || null,
        journalAiEnabled,
        ankiEnabled,
        ankiConnectUrl,
        ankiDeck,
        todoEnabled,
        todoCardId: todoCardId.trim() || null,
        desktopRemindersEnabled,
      });
      setConnection(settings);
      setAiProvider(settings.aiProvider);
      setAiModel(settings.aiModel ?? "");
      setJournalAiEnabled(settings.journalAiEnabled);
      setAnkiEnabled(settings.ankiEnabled);
      setAnkiConnectUrl(settings.ankiConnectUrl);
      setAnkiDeck(settings.ankiDeck);
      setTodoEnabled(settings.todoEnabled);
      setTodoCardId(settings.todoCardId ?? "");
      setDesktopRemindersEnabled(settings.desktopRemindersEnabled);
      await refreshDeliveryStatus();
    } catch (error) {
      setSettingError(
        typeof error === "string" ? error : "Could not save processing settings.",
      );
    } finally {
      setSavingProcessing(false);
    }
  }

  async function sendAnkiTestCard() {
    setSettingError(null);
    setAnkiTestResult(null);
    setTestingAnki(true);
    try {
      setAnkiTestResult(await invoke<string>("send_anki_test_card"));
    } catch (error) {
      setSettingError(typeof error === "string" ? error : "Could not send the Anki test card.");
    } finally {
      setTestingAnki(false);
    }
  }

  async function createTodoCard() {
    setSettingError(null);
    setTodoResult(null);
    setTestingTodo(true);
    try {
      const cardId = await invoke<string>("create_heptabase_todo_card");
      setTodoCardId(cardId);
      setTodoEnabled(true);
      setTodoResult("Created Capture Todo. Save Processing to enable delivery.");
    } catch (error) {
      setSettingError(typeof error === "string" ? error : "Could not create the Todo card.");
    } finally {
      setTestingTodo(false);
    }
  }

  async function sendReminderTest() {
    setSettingError(null);
    try {
      await invoke("send_desktop_reminder_test");
      setTodoResult("Windows test notification sent.");
    } catch (error) {
      setSettingError(typeof error === "string" ? error : "Could not send a test notification.");
    }
  }

  function updateCaptureTheme(theme: CaptureTheme) {
    setCaptureTheme(theme);
    try {
      writeCaptureTheme(theme);
      void emitTo("capture", "capture-theme-changed", theme);
    } catch {
      setSettingError("Could not save Quick Capture colors.");
    }
  }

  async function loadTrash() {
    setSettingError(null);
    setTrashLoading(true);
    try {
      setTrashRecords(await invoke<TrashedJournalRecord[]>("list_trashed_journal_records"));
    } catch (error) {
      setSettingError(typeof error === "string" ? error : "Could not load trash.");
    } finally {
      setTrashLoading(false);
    }
  }

  async function restoreTrashRecord(record: TrashedJournalRecord) {
    setSettingError(null);
    try {
      await invoke("restore_journal_record", {
        id: record.id,
        input: { expectedRevision: record.revision },
      });
      setTrashRecords((current) => current.filter((item) => item.id !== record.id));
    } catch (error) {
      setSettingError(typeof error === "string" ? error : "Could not restore the record.");
    }
  }

  return (
    <main className="workerShell" ref={rootRef} tabIndex={-1}>
      <header>
        <p className="eyebrow">Background worker</p>
        <h1>Personal Capture</h1>
        <p className="intro">
          The worker keeps running when this window is hidden.
        </p>
      </header>

      <section className={`statusCard ${snapshot.kind}`} aria-live="polite">
        <span className="statusLabel">{snapshot.kind}</span>
        <p>{snapshot.message}</p>
        <small>Last checked: {formatLastChecked(snapshot.lastCheckedAt)}</small>
      </section>

      <div className="workerActions">
        <button type="button" disabled={snapshot.checking} onClick={checkNow}>
          {snapshot.checking ? "Checking..." : "Check now"}
        </button>
        <button type="button" className="secondaryButton" onClick={togglePause}>
          {snapshot.paused ? "Resume worker" : "Pause worker"}
        </button>
      </div>

      {deliveryStatus ? (
        <section className="deliveryQueue" aria-label="Journal delivery queue">
          <div>
            <strong>{deliveryStatus.pendingRecordCount}</strong>
            <span>Pending</span>
          </div>
          <div>
            <strong>{deliveryStatus.processingRecordCount}</strong>
            <span>Processing</span>
          </div>
          <div className={deliveryStatus.failedRecordCount > 0 ? "hasFailure" : undefined}>
            <strong>{deliveryStatus.failedRecordCount}</strong>
            <span>Failed</span>
          </div>
          {deliveryStatus.dates.length > 0 ? (
            <ul>
              {deliveryStatus.dates.map((date) => (
                <li key={date.journalDate} title={date.lastError}>
                  <time>{date.journalDate}</time>
                  <span>{date.processing > 0 ? `${date.processing} processing` : `${date.pending} pending`}</span>
                  {date.failed > 0 ? <em>{date.failed} failed</em> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {englishDeliveryStatus && connection.ankiEnabled ? (
        <section className="deliveryQueue englishDeliveryQueue" aria-label="English to Anki queue">
          <div><strong>{englishDeliveryStatus.pending}</strong><span>English pending</span></div>
          <div><strong>{englishDeliveryStatus.processing}</strong><span>Processing</span></div>
          <div className={englishDeliveryStatus.failed > 0 ? "hasFailure" : undefined}>
            <strong>{englishDeliveryStatus.failed}</strong><span>Failed</span>
          </div>
        </section>
      ) : null}

      <label className="settingToggle">
        <input
          type="checkbox"
          checked={startWithWindows}
          onChange={toggleStartWithWindows}
        />
        Start hidden with Windows
      </label>

      <details className="connectionSettings" open={!connection.tokenConfigured}>
        <summary>
          Connection {connection.tokenConfigured ? "configured" : "required"}
        </summary>
        <form onSubmit={saveConnection}>
          <label>
            Web API URL
            <input
              type="url"
              value={apiBaseUrl}
              onChange={(event) => setApiBaseUrl(event.target.value)}
              placeholder="https://capture.example.com"
              required
            />
          </label>
          <label>
            Device Token
            <input
              type="password"
              value={deviceToken}
              onChange={(event) => setDeviceToken(event.target.value)}
              placeholder={connection.tokenConfigured ? "Enter a replacement token" : "Paste token"}
              minLength={32}
              required
            />
          </label>
          <div className="connectionFooter">
            <small>
              Source: {connection.source}. Saved only for this Windows user.
            </small>
            <button type="submit" disabled={savingConnection}>
              {savingConnection ? "Saving..." : "Save and test"}
            </button>
          </div>
        </form>
      </details>

      <details className="connectionSettings processingSettings">
        <summary>Processing</summary>
        <form onSubmit={saveProcessing}>
          <label>
            AI provider
            <select
              value={aiProvider}
              onChange={(event) => setAiProvider(event.target.value as ConnectionSettings["aiProvider"])}
              disabled={connection.source === "environment"}
            >
              <option value="codex-cli">Codex CLI</option>
              <option value="none">No AI</option>
            </select>
          </label>
          <label>
            Codex model (optional)
            <input
              value={aiModel}
              onChange={(event) => setAiModel(event.target.value)}
              placeholder="Use Codex CLI default"
              disabled={aiProvider !== "codex-cli" || connection.source === "environment"}
            />
          </label>
          <label className="settingToggle compactSettingToggle">
            <input
              type="checkbox"
              checked={journalAiEnabled}
              onChange={(event) => setJournalAiEnabled(event.target.checked)}
              disabled={connection.source === "environment"}
            />
            Organize Journal with AI
          </label>
          <label className="settingToggle compactSettingToggle">
            <input
              type="checkbox"
              checked={ankiEnabled}
              onChange={(event) => setAnkiEnabled(event.target.checked)}
              disabled={connection.source === "environment"}
            />
            Send past English notes to Anki
          </label>
          <label>
            AnkiConnect URL
            <input
              type="url"
              value={ankiConnectUrl}
              onChange={(event) => setAnkiConnectUrl(event.target.value)}
              disabled={!ankiEnabled || connection.source === "environment"}
            />
          </label>
          <label>
            Anki deck
            <input
              value={ankiDeck}
              onChange={(event) => setAnkiDeck(event.target.value)}
              disabled={!ankiEnabled || connection.source === "environment"}
            />
          </label>
          <label className="settingToggle compactSettingToggle">
            <input
              type="checkbox"
              checked={todoEnabled}
              onChange={(event) => setTodoEnabled(event.target.checked)}
              disabled={connection.source === "environment" || !todoCardId.trim()}
            />
            Append explicit + continuations to Heptabase Todo
          </label>
          <label>
            Heptabase Todo card UUID
            <input
              value={todoCardId}
              onChange={(event) => setTodoCardId(event.target.value)}
              placeholder="Create a card or paste its UUID"
              disabled={connection.source === "environment"}
            />
          </label>
          <label className="settingToggle compactSettingToggle">
            <input
              type="checkbox"
              checked={desktopRemindersEnabled}
              onChange={(event) => setDesktopRemindersEnabled(event.target.checked)}
              disabled={connection.source === "environment"}
            />
            Windows reminders at 20:00; weekly review on Sunday
          </label>
          <div className="connectionFooter">
            <small>
              {connection.source === "environment"
                ? "Controlled by CAPTURE_AI_* and CAPTURE_ANKI_* environment variables."
                : "Automation stays off until enabled here; raw Cloud records are retained."}
            </small>
            <button
              type="button"
              className="secondaryButton"
              disabled={testingAnki || !connection.ankiEnabled}
              onClick={sendAnkiTestCard}
            >
              {testingAnki ? "Sending test..." : "Send Anki test card"}
            </button>
            <button type="button" className="secondaryButton" disabled={testingTodo} onClick={createTodoCard}>
              {testingTodo ? "Creating..." : "Create Todo card"}
            </button>
            <button type="button" className="secondaryButton" onClick={sendReminderTest}>
              Test notification
            </button>
            <button
              type="submit"
              disabled={savingProcessing || !connection.tokenConfigured || connection.source === "environment"}
            >
              {savingProcessing ? "Saving..." : "Save"}
            </button>
          </div>
          {ankiTestResult ? <small role="status">{ankiTestResult}</small> : null}
          {todoResult ? <small role="status">{todoResult}</small> : null}
        </form>
      </details>

      <details className="connectionSettings appearanceSettings">
        <summary>Quick Capture colors</summary>
        <div className="colorSettings">
          <label>
            Background
            <input
              type="color"
              value={captureTheme.paper}
              onChange={(event) => updateCaptureTheme({
                ...captureTheme,
                paper: event.target.value,
              })}
            />
          </label>
          <label>
            Text
            <input
              type="color"
              value={captureTheme.ink}
              onChange={(event) => updateCaptureTheme({
                ...captureTheme,
                ink: event.target.value,
              })}
            />
          </label>
          <button
            type="button"
            className="secondaryButton"
            onClick={() => updateCaptureTheme(DEFAULT_CAPTURE_THEME)}
          >
            Reset
          </button>
        </div>
      </details>

      <details className="connectionSettings trashSettings" onToggle={(event) => {
        if (event.currentTarget.open) void loadTrash();
      }}>
        <summary>Trash</summary>
        <div className="desktopTrashList">
          {trashLoading ? <small>Loading...</small> : null}
          {!trashLoading && trashRecords.length === 0 ? <small>No deleted records.</small> : null}
          {trashRecords.map((record) => (
            <div className="desktopTrashRow" key={record.id}>
              <span>
                <small>{record.journalDate}</small>
                {Object.values(record.areas).find((value) => value.trim())?.trim() ?? "Empty record"}
              </span>
              <button type="button" className="secondaryButton" onClick={() => void restoreTrashRecord(record)}>
                Restore
              </button>
            </div>
          ))}
        </div>
      </details>

      {settingError ? <p className="desktopError">{settingError}</p> : null}

      <dl className="shortcutList">
        <div>
          <dt>{CAPTURE_SHORTCUT}</dt>
          <dd>Open Quick Capture</dd>
        </div>
        <div>
          <dt>{WORKER_SHORTCUT}</dt>
          <dd>Show or hide this window</dd>
        </div>
      </dl>

      <p className="temporaryNote">
        Closing this window hides it. Use the tray menu to quit the worker.
      </p>
    </main>
  );
}

export default function App() {
  return getCurrentWindow().label === "capture" ? <DesktopJournal /> : <WorkerView />;
}
