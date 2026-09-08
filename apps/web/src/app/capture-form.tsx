"use client";

import { type FormEvent, useEffect, useState } from "react";

import { MAX_CAPTURE_LENGTH, type Capture } from "@/lib/capture";

type SubmissionState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; capture: Capture }
  | { kind: "error"; message: string };

function readErrorMessage(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return "The server returned an unexpected response.";
  }

  const error = (payload as Record<string, unknown>).error;

  if (typeof error !== "object" || error === null) {
    return "The server returned an unexpected response.";
  }

  const message = (error as Record<string, unknown>).message;

  return typeof message === "string"
    ? message
    : "The server returned an unexpected response.";
}

function readCapture(payload: unknown): Capture | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const capture = (payload as Record<string, unknown>).capture;

  if (typeof capture !== "object" || capture === null) {
    return null;
  }

  const candidate = capture as Record<string, unknown>;
  const status = candidate.status;

  if (
    typeof candidate.id !== "string" ||
    typeof candidate.content !== "string" ||
    (status !== "pending" &&
      status !== "processing" &&
      status !== "failed" &&
      status !== "completed") ||
    typeof candidate.createdAt !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    content: candidate.content,
    status,
    createdAt: candidate.createdAt,
    ...(typeof candidate.result === "string"
      ? { result: candidate.result }
      : {}),
    ...(typeof candidate.completedAt === "string"
      ? { completedAt: candidate.completedAt }
      : {}),
    ...(typeof candidate.lastError === "string"
      ? { lastError: candidate.lastError }
      : {}),
  };
}

export function CaptureForm() {
  const [content, setContent] = useState("");
  const [submission, setSubmission] = useState<SubmissionState>({
    kind: "idle",
  });
  const [pollingMessage, setPollingMessage] = useState<string | null>(null);

  const isSubmitting = submission.kind === "submitting";

  useEffect(() => {
    if (
      submission.kind !== "success" ||
      submission.capture.status === "completed"
    ) {
      return;
    }

    const captureId = submission.capture.id;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    async function refreshCapture() {
      try {
        const response = await fetch(`/api/captures/${captureId}`, {
          cache: "no-store",
        });
        const payload: unknown = await response.json();
        const capture = response.ok ? readCapture(payload) : null;

        if (!cancelled && capture !== null) {
          setSubmission({ kind: "success", capture });
          setPollingMessage(null);

          if (capture.status !== "completed") {
            timeoutId = setTimeout(refreshCapture, 2_000);
          }
          return;
        }

        if (!cancelled) {
          setPollingMessage("Could not read the latest status. Retrying...");
          timeoutId = setTimeout(refreshCapture, 2_000);
        }
      } catch {
        if (!cancelled) {
          setPollingMessage("Could not reach the server. Retrying...");
          timeoutId = setTimeout(refreshCapture, 2_000);
        }
      }
    }

    timeoutId = setTimeout(refreshCapture, 2_000);

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };
  }, [submission]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPollingMessage(null);
    setSubmission({ kind: "submitting" });

    try {
      const response = await fetch("/api/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        setSubmission({ kind: "error", message: readErrorMessage(payload) });
        return;
      }

      const capture = readCapture(payload);

      if (capture === null) {
        setSubmission({
          kind: "error",
          message: "The server returned an unexpected response.",
        });
        return;
      }

      setContent("");
      setSubmission({ kind: "success", capture });
    } catch {
      setSubmission({
        kind: "error",
        message: "The request could not reach the server. Try again.",
      });
    }
  }

  return (
    <section className="capturePanel" aria-labelledby="capture-heading">
      <div className="panelHeading">
        <div>
          <p className="eyebrow">Local vertical slice</p>
          <h2 id="capture-heading">Capture something</h2>
        </div>
        <span className="temporaryBadge">Temporary</span>
      </div>

      <form onSubmit={handleSubmit}>
        <label htmlFor="capture-content">Content</label>
        <textarea
          id="capture-content"
          name="content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Paste a thought, link, task, or note..."
          maxLength={MAX_CAPTURE_LENGTH}
          rows={8}
          required
        />
        <div className="formFooter">
          <span className="characterCount">
            {content.length.toLocaleString()} / {MAX_CAPTURE_LENGTH.toLocaleString()}
          </span>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Capturing..." : "Capture"}
          </button>
        </div>
      </form>

      {submission.kind === "success" ? (
        <div className="result successResult" role="status">
          <strong>Capture accepted</strong>
          <span>Status: {submission.capture.status}</span>
          <p>{submission.capture.content}</p>
          {submission.capture.result ? (
            <p>Result: {submission.capture.result}</p>
          ) : null}
          {submission.capture.lastError ? (
            <p>{submission.capture.lastError}</p>
          ) : null}
          {pollingMessage ? <span>{pollingMessage}</span> : null}
        </div>
      ) : null}

      {submission.kind === "error" ? (
        <div className="result errorResult" role="alert">
          <strong>Capture failed</strong>
          <p>{submission.message}</p>
        </div>
      ) : null}

      <p className="temporaryNote">
        Captures persist in MongoDB Atlas when the server environment is
        configured. The local processor remains temporary.
      </p>
    </section>
  );
}
