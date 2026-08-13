"use client";

import { type FormEvent, useState } from "react";

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

  if (
    typeof candidate.id !== "string" ||
    typeof candidate.content !== "string" ||
    candidate.status !== "pending" ||
    typeof candidate.createdAt !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    content: candidate.content,
    status: candidate.status,
    createdAt: candidate.createdAt,
  };
}

export function CaptureForm() {
  const [content, setContent] = useState("");
  const [submission, setSubmission] = useState<SubmissionState>({
    kind: "idle",
  });

  const isSubmitting = submission.kind === "submitting";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        </div>
      ) : null}

      {submission.kind === "error" ? (
        <div className="result errorResult" role="alert">
          <strong>Capture failed</strong>
          <p>{submission.message}</p>
        </div>
      ) : null}

      <p className="temporaryNote">
        This milestone returns a pending capture to this page only. Refreshing
        the page removes it because persistent storage is not connected yet.
      </p>
    </section>
  );
}
