import { type FormEvent, useCallback, useEffect, useState } from "react";
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

function formatLastChecked(timestamp: number | null) {
  return timestamp === null
    ? "Not yet"
    : new Date(timestamp).toLocaleTimeString();
}

function WorkerView() {
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
  });
  const [apiBaseUrl, setApiBaseUrl] = useState("http://localhost:3000");
  const [deviceToken, setDeviceToken] = useState("");
  const [savingConnection, setSavingConnection] = useState(false);
  const [settingError, setSettingError] = useState<string | null>(null);
  const [captureTheme, setCaptureTheme] = useState<CaptureTheme>(readCaptureTheme);
  const [trashRecords, setTrashRecords] = useState<TrashedJournalRecord[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [deliveryStatus, setDeliveryStatus] = useState<JournalDeliveryStatus | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setSnapshot(await invoke<WorkerSnapshot>("get_worker_status"));
    } catch (error) {
      setSettingError(typeof error === "string" ? error : "Could not read worker status.");
    }
  }, []);

  const refreshDeliveryStatus = useCallback(async () => {
    try {
      setDeliveryStatus(await invoke<JournalDeliveryStatus>("get_journal_delivery_status"));
    } catch {
      setDeliveryStatus(null);
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
    <main className="workerShell">
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
