import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

const CHECK_INTERVAL_MS = 5 * 60 * 1_000;

type WorkerReport = {
  outcome: "idle" | "processed";
  message: string;
  jobId: string | null;
};

function App() {
  const [state, setState] = useState<
    | { kind: "ready"; message: string }
    | { kind: "checking"; message: string }
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
  >({
    kind: "ready",
    message: "Waiting for the first check.",
  });
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const checkInProgress = useRef(false);

  const checkForWork = useCallback(async (reason: string) => {
    if (checkInProgress.current) {
      return;
    }

    checkInProgress.current = true;
    setState({ kind: "checking", message: `${reason}: checking the API...` });

    try {
      const report = await invoke<WorkerReport>("check_for_work");
      setState({ kind: "success", message: report.message });
    } catch (error) {
      setState({
        kind: "error",
        message: typeof error === "string" ? error : "The worker failed.",
      });
    } finally {
      setLastCheckedAt(new Date());
      checkInProgress.current = false;
    }
  }, []);

  useEffect(() => {
    const checkAfterReconnect = () => {
      void checkForWork("Connection restored");
    };

    if (navigator.onLine) {
      void checkForWork("App opened while online");
    }

    window.addEventListener("online", checkAfterReconnect);
    const intervalId = window.setInterval(() => {
      if (navigator.onLine) {
        void checkForWork("Five-minute interval");
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", checkAfterReconnect);
      window.clearInterval(intervalId);
    };
  }, [checkForWork]);

  return (
    <main className="workerShell">
      <header>
        <p className="eyebrow">Local vertical slice</p>
        <h1>Personal Capture Worker</h1>
        <p className="intro">
          Claims one pending capture, runs the temporary processor, and reports
          the result to the API.
        </p>
      </header>

      <section className={`statusCard ${state.kind}`} aria-live="polite">
        <span className="statusLabel">{state.kind}</span>
        <p>{state.message}</p>
        <small>
          Last checked: {lastCheckedAt?.toLocaleTimeString() ?? "Not yet"}
        </small>
      </section>

      <button
        type="button"
        disabled={state.kind === "checking"}
        onClick={() => void checkForWork("Manual check")}
      >
        {state.kind === "checking" ? "Checking..." : "Check now"}
      </button>

      <ul className="schedule">
        <li>Checks once when opened with a network connection</li>
        <li>Checks when the computer reconnects</li>
        <li>Checks every five minutes while online</li>
      </ul>

      <p className="temporaryNote">
        The API address and device credential come from the Rust environment.
        The processor still only prefixes the content with “Processed:”.
      </p>
    </main>
  );
}

export default App;
