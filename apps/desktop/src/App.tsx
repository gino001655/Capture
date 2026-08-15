import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

const CAPTURE_SHORTCUT = "Ctrl + Alt + C";
const WORKER_SHORTCUT = "Ctrl + Alt + W";

type WorkerSnapshot = {
  kind: "ready" | "checking" | "idle" | "processed" | "paused" | "error";
  message: string;
  jobId: string | null;
  lastCheckedAt: number | null;
  paused: boolean;
  checking: boolean;
};

type CreatedCapture = {
  id: string;
  content: string;
  status: string;
};

type ConnectionSettings = {
  apiBaseUrl: string;
  tokenConfigured: boolean;
  source: "environment" | "saved" | "missing";
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

  const refreshStatus = useCallback(async () => {
    try {
      setSnapshot(await invoke<WorkerSnapshot>("get_worker_status"));
    } catch (error) {
      setSettingError(typeof error === "string" ? error : "Could not read worker status.");
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
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

    const checkAfterReconnect = () => {
      void invoke<WorkerSnapshot>("check_for_work").then(setSnapshot);
    };

    window.addEventListener("online", checkAfterReconnect);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("online", checkAfterReconnect);
    };
  }, [refreshStatus]);

  async function checkNow() {
    setSettingError(null);
    setSnapshot(await invoke<WorkerSnapshot>("check_for_work"));
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
    } catch (error) {
      setSettingError(
        typeof error === "string" ? error : "Could not save connection settings.",
      );
    } finally {
      setSavingConnection(false);
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

function CaptureView() {
  const [content, setContent] = useState("");
  const [state, setState] = useState<
    | { kind: "ready" }
    | { kind: "submitting" }
    | { kind: "success"; capture: CreatedCapture }
    | { kind: "error"; message: string }
  >({ kind: "ready" });
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const focusInput = () => inputRef.current?.focus();
    window.addEventListener("focus", focusInput);
    window.setTimeout(focusInput, 0);

    return () => window.removeEventListener("focus", focusInput);
  }, []);

  useEffect(() => {
    const hideOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void invoke("hide_current_window");
      }
    };

    window.addEventListener("keydown", hideOnEscape);
    return () => window.removeEventListener("keydown", hideOnEscape);
  }, []);

  async function submitCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedContent = content.trim();

    if (!trimmedContent) {
      return;
    }

    setState({ kind: "submitting" });

    try {
      const capture = await invoke<CreatedCapture>("create_capture", {
        content: trimmedContent,
      });
      setState({ kind: "success", capture });
      setContent("");
      window.setTimeout(() => {
        setState({ kind: "ready" });
        void invoke("hide_current_window");
      }, 650);
    } catch (error) {
      setState({
        kind: "error",
        message: typeof error === "string" ? error : "Capture failed.",
      });
    }
  }

  return (
    <main className="quickCaptureShell">
      <header className="captureHeader">
        <div>
          <p className="eyebrow">{CAPTURE_SHORTCUT}</p>
          <h1>Quick Capture</h1>
        </div>
        <button
          type="button"
          className="closeButton"
          aria-label="Hide Quick Capture"
          onClick={() => void invoke("hide_current_window")}
        >
          ×
        </button>
      </header>

      <form onSubmit={submitCapture}>
        <textarea
          ref={inputRef}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Type a thought, task, link, or note..."
          rows={5}
          maxLength={10_000}
          disabled={state.kind === "submitting"}
        />
        <div className="captureFooter">
          <span>Enter to capture · Shift+Enter for a new line · Esc to hide</span>
          <button type="submit" disabled={state.kind === "submitting" || !content.trim()}>
            {state.kind === "submitting" ? "Sending..." : "Capture"}
          </button>
        </div>
      </form>

      {state.kind === "success" ? (
        <p className="captureMessage successMessage">
          Captured. The worker will process it in the background.
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p className="captureMessage desktopError">{state.message}</p>
      ) : null}
    </main>
  );
}

export default function App() {
  return getCurrentWindow().label === "capture" ? <CaptureView /> : <WorkerView />;
}
