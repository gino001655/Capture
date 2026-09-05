# Architecture

## Status

The Web/API is deployed to Vercel and verified with Google authentication, MongoDB Atlas persistence, and the local Desktop worker. The worker-to-Codex-to-Heptabase path is connected and verified against production. Its first version has no durable retry or failed-job state. The English special-recorder slice now exists in source but has not yet been deployed or manually verified across devices.

## System context

```mermaid
flowchart LR
    U["User on Web / iPhone PWA"] --> W["Next.js Web UI"]
    W --> A["Cloud API in Next.js"]
    D["Tauri Desktop Worker"] --> A
    A --> M["MongoDB Atlas"]
    D --> C["Local Codex CLI"]
    C --> D
    D --> H["Heptabase CLI / Desktop"]
    H --> D
    D -. "later" .-> K["Anki"]
```

## Component responsibilities

### Web UI

- Provide a mobile-oriented capture form.
- Display captures and processing status.
- Provide a Web App Manifest and Apple metadata so the deployed site can be installed from Safari onto the iPhone Home Screen.
- Continue to require a network connection; offline capture and a service worker are not implemented yet.

### Cloud API

- Run inside the Next.js application initially.
- Validate requests and enforce authentication and authorization.
- Own capture persistence and job lifecycle state.
- Provide HTTP endpoints used by both Web and Desktop clients.

For local development, the API runs at `http://localhost:3000` and uses a server-only MongoDB connection configured through environment variables. It exposes:

- `POST /api/captures` to create a pending capture;
- `GET /api/captures/{id}` to read its current state;
- `POST /api/jobs/claim` to atomically move one pending job to processing;
- `PATCH /api/jobs/{id}` to record a completed result.
- `GET /api/special-records/english?date=YYYY-MM-DD` to read one daily English document;
- `PUT /api/special-records/english` to create, revise, or remove an empty daily English document with optimistic revision checking.

### MongoDB Atlas

- Persist each capture, its job lifecycle, and its processing result in one `captures` collection.
- Use an index on `status` and `createdAt` to find the oldest pending capture efficiently.
- Atomically claim work by filtering for `pending` and changing it to `processing` in one database operation.
- Enforce the current document contract at the API boundary and in TypeScript. A database-level JSON Schema validator is deferred while the Cloud API remains the only database writer.
- Remain accessible only from trusted server-side code.
- Never expose its connection credentials to the browser or Desktop application.
- Persist versioned special-recorder payloads in `specialRecords`. The first payload is `english`, uniquely addressed by module and Taipei Journal date; future modules reuse lifecycle fields without sharing their domain payloads.

### Desktop application

- Use Tauri, React, Vite, TypeScript, and Rust.
- Poll the Cloud API rather than accepting inbound connections from the server.
- Run processors that require local machine access.
- Report results and job state changes through the Cloud API.
- Keep the worker alive when its windows are hidden, expose controls through the Windows tray, and prevent duplicate worker instances.
- Open Quick Capture with `Ctrl + Alt + C` and toggle Worker Status with `Ctrl + Alt + W`.
- Optionally register the installed app to start hidden with Windows.
- Discover special Capture pages from `capture-pages/*.page.tsx`. The English page keeps an immediate local pending cache and reaches the Cloud through narrow Tauri commands that reuse the saved Desktop bearer-token configuration.

## English synchronization boundary

- Web and Desktop both persist each keystroke locally, then debounce Cloud writes.
- Cloud writes carry an expected revision so a stale device cannot silently overwrite newer text. The first UI preserves a conflicting local pending copy and reports an unsynchronized state; an explicit conflict-resolution interface is still required.
- The UI permits editing only the current Taipei date. A delayed offline write for an earlier date is accepted only when its recorded client edit timestamp belongs to that same date; this preserves pre-midnight offline text without opening normal past-date editing.
- Past documents are read-only in both clients. Empty text deletes the current empty daily document, so blank days do not remain in `specialRecords`.
- The current slice does not yet include the content-date history list, service-worker background synchronization, Worker downstream processing, AI/Anki transformation, or production deployment verification.

### Processor

- Invoke `codex exec` in ephemeral, read-only mode and provide capture text through standard input rather than a shell argument.
- Write the final Markdown response to a temporary file, then ask the official Heptabase CLI to create a note from that file.
- Require the user-installed Codex CLI to be signed in and Heptabase CLI access to be enabled.
- Run the official Heptabase `start` command before writing, launching Heptabase Desktop when necessary and waiting up to 60 seconds for its local CLI server.
- Return the created Heptabase card ID and title as the Cloud processing result.
- Not own persistence, retry policy, or authoritative job state.
- Currently leave a claimed job in `processing` if Codex or Heptabase fails; retry and explicit failure states are later reliability work.

## Desktop polling behavior

The worker checks for work:

1. when it starts while online;
2. when network connectivity returns;
3. every five minutes while running and online;
4. when the user selects a manual check action.

All triggers share one check operation and avoid overlapping polls. The application runs the five-minute schedule in Rust so hiding the WebView window does not stop the worker. Queue draining, durable retries, and explicit sleep-resume handling remain future reliability work.

## Trust boundaries

- Browser and Desktop inputs are untrusted and require server-side validation.
- Capture text is passed to Codex through standard input and is never interpolated into a shell command.
- Only the Cloud API may connect to MongoDB Atlas.
- The public deployment must be authenticated before it is treated as usable production.
- The Web uses a stateless Better Auth session created through Google OAuth and authorizes only the configured email address.
- The Desktop uses a separate bearer token. Development reads it from the Rust `.env.local`; an installed build stores a user-entered token in its per-user AppData configuration. Rotating the server token revokes the previous device credential.
- Secrets belong in local or deployment environment configuration, never committed source files.

## Repository direction

The planned monorepo shape is:

```text
apps/
├─ web/       # Next.js Web UI and initial Cloud API
└─ desktop/   # Tauri application and Desktop worker

packages/     # Created only when stable code or contracts are genuinely shared
docs/
```

pnpm will manage JavaScript and TypeScript workspace dependencies. Cargo will manage Rust dependencies inside the Tauri application. Additional build orchestration will not be introduced until the repository demonstrates a need for it.
