# Capture

Capture is a quiet, local-first inbox for thoughts, English learning, workouts, and food. It is designed to open quickly on a phone or Windows, save without a submit ceremony, synchronize across devices, and hand completed material to the right destination later.

This is an early, single-user project. The interface is intentionally compact; integrations are explicit opt-ins and raw Cloud records are retained when processing fails.

## What works

| Area | Web | Windows | Cloud sync | External processing |
| --- | --- | --- | --- | --- |
| Journal / Quick Capture | Yes | Yes | MongoDB | Optional Codex → dated Heptabase Journal |
| English | Yes | Yes | MongoDB | Optional Codex → AnkiConnect |
| Workout / running | Yes | Yes | MongoDB | Not implemented |
| Food | Yes | Yes | MongoDB | Not implemented |

The Web app is mobile-first and installable from Safari as a Home Screen app. The Tauri Desktop app supplies global shortcuts, keyboard-only workflows, a tray worker, background polling, and an NSIS installer.

The established Journal path has been exercised against MongoDB and Heptabase. The current English queue is implemented and automatically tested; its production deployment and a real queued English-to-Anki run remain release checks. A direct disposable Anki test card has been verified manually.

## Core flow

```text
Phone or Windows
  → authenticated Web API
  → MongoDB queue
  → private Windows worker
  → optional local Codex CLI
  → Heptabase CLI or AnkiConnect
  → completion recorded in MongoDB
```

- Journal records are grouped by their selected Taipei date and become eligible after the 04:00 cutoff. Successful records are locked in Capture; later corrections belong in Heptabase.
- Past English documents can become Anki notes. Workout and Food currently remain synchronized Capture data.
- A processing failure never silently discards the source. Failed work remains retryable.
- The browser and Cloud never receive Heptabase or Anki credentials; those adapters run on the user's Windows computer.

See [Setup and integrations](docs/setup-and-integrations.md) for the complete local, deployment, Codex, Heptabase, and Anki setup.

## Repository

```text
apps/web                 Next.js mobile UI, authentication, API, MongoDB stores
apps/desktop             React + Tauri Windows UI and local worker
packages/recorder-kit    shared recorder catalog and navigation contract
scripts                  recorder generator
docs                     architecture, product decisions, setup, and releases
```

The clients never connect directly to MongoDB. Each recorder owns a versioned payload and narrow API/store contract because Journal, English, Workout, and Food have different lifecycles.

## Local development

Requirements:

- Node.js 24 LTS and pnpm 11.21.0 through Corepack
- Rust stable MSVC toolchain
- Visual Studio 2022 Build Tools with Desktop development with C++
- Microsoft Edge WebView2
- Optional: Codex CLI, Heptabase Desktop with CLI enabled, Anki Desktop with AnkiConnect

Install project-local dependencies:

```powershell
pnpm.cmd install --frozen-lockfile
```

Copy `apps/web/.env.example` to `apps/web/.env.local` and provide the MongoDB, Better Auth, Google OAuth, authorized-email, and Desktop-token settings. For Desktop development, copy `apps/desktop/src-tauri/.env.example` to `.env.local` in that directory and use the same Desktop token. Never commit either `.env.local` file.

Run Web and Desktop in separate PowerShell windows:

```powershell
pnpm.cmd dev
pnpm.cmd desktop:dev
```

The installed Desktop app can instead save the deployed Web URL and Device Token under Worker Status. Build its NSIS installer with:

```powershell
pnpm.cmd desktop:build
```

## Windows controls

- `Ctrl + Numpad 5`: Quick Capture
- `Ctrl + NumLock` (`Ctrl + Pause` fallback): Worker Status
- `Ctrl + Left/Right`: move between recorder pages
- Arrow keys, `Enter`, `Escape`, `Tab`, and `Shift + Tab`: complete Desktop workflows without a mouse

Closing a Desktop window hides it. Quit the background worker from the tray menu.

## Add or replace components

Create a Web/Desktop recorder starter:

```powershell
pnpm.cmd create:recorder -- reading 閱讀 R
pnpm.cmd create:recorder -- reading 閱讀 R --dry-run
```

The generator updates the shared catalog and creates both platform pages. Synchronized recorders additionally need a versioned payload, validation, a narrow API route, and a store.

AI providers and destinations are separated from recorder UI. A fork can add an AI provider, implement another Markdown destination instead of Heptabase, or replace a MongoDB store without rewriting every client. These are code extension points rather than runtime plug-ins today.

Read [Extending Capture](docs/extending-capture.md) and the [Recorder Page Guide](docs/recorder-pages.md) before adding an integration.

## Verification

```powershell
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd build
pnpm.cmd desktop:build
```

Automated checks do not prove that a user's local Codex, Heptabase, Anki, OAuth, or production deployment is configured correctly. Use the disposable smoke tests in the [release checklist](docs/release-checklist.md) before publishing a release.

## Security and scope

- Current authentication and authorization are designed for one authorized user and one private Desktop token.
- Secrets belong only in ignored `.env.local` files, deployment secrets, or per-user Desktop settings.
- AI automation is off until enabled by the user.
- AnkiConnect is restricted to the loopback interface.
- Arbitrary remote plug-ins are intentionally not loaded.

See [Security](SECURITY.md), [Architecture](docs/architecture.md), and [Roadmap](docs/roadmap.md) for boundaries and known limitations.

## Contributing

Capture is also a software-engineering learning project, so contributions should stay small, understandable, and executable. Read [Contributing](CONTRIBUTING.md) before opening a change.

Licensed under the [MIT License](LICENSE).
