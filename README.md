# Personal Capture System

A personal system for quickly capturing information, processing it on a Windows computer, and routing the results to useful destinations.

This repository is also a software-engineering learning project. Development proceeds in small, testable vertical slices so that each architectural boundary is understood before the system is expanded.

Licensed under the [MIT License](LICENSE). See [Contributing](CONTRIBUTING.md) before proposing a new recorder or integration.

## Current status

The authenticated Web/API is deployed to Vercel and verified with MongoDB Atlas and the Desktop worker. The Web is installable as an iPhone Home Screen app, and the Windows worker has a tray menu, background polling, quick-capture and status-window shortcuts, optional autostart, and a release installer.

The legacy text-to-note pipeline is connected and production-verified. The newer Journal pipeline batches idle records by Taipei date after the 04:00 boundary, appends deterministic Markdown to the corresponding Heptabase Journal, locks successful records, and keeps failed work in a visible retry queue. That newer path is implemented and automatically verified but still needs one production smoke test.

English, Workout/Running, and Food are synchronized special recorders shared by Web and Desktop. Workout includes copied prior sets, a rest timer, history metrics, running segments, and a synced exercise library. Food includes daily calorie/protein totals and a synced reusable-food library. Cross-device manual verification and the English-to-Anki processor remain pending.

## Local development

Requirements:

- Node.js 24 LTS
- Corepack with pnpm 11.21.0 enabled
- Rust stable MSVC toolchain
- Visual Studio 2022 Build Tools with Desktop development with C++
- Microsoft Edge WebView2
- OpenAI Codex CLI installed globally and signed in when the `codex-cli` processor is selected (optional with `none`)
- Heptabase Desktop with its CLI enabled; the worker starts the Desktop application when processing needs it

Install the workspace dependencies:

```powershell
pnpm.cmd install --frozen-lockfile
```

Copy `apps/web/.env.example` to `apps/web/.env.local`, then provide the Atlas, Better Auth, Google OAuth, allowed-email, and Desktop-token values. Copy `apps/desktop/src-tauri/.env.example` to `apps/desktop/src-tauri/.env.local` and use the same Desktop token. Both `.env.local` files contain secrets and must not be committed.

Start the Web application:

```powershell
pnpm.cmd dev
```

Then open `http://localhost:3000`.

In a second PowerShell window, start the Desktop worker:

```powershell
pnpm.cmd desktop:dev
```

Development uses `apps/desktop/src-tauri/.env.local`. The installed Desktop app instead lets the user save the Web API URL and Device Token from Worker Status. Those release settings are stored for the current Windows user in the application's AppData configuration directory and must still be treated as a secret.

Desktop shortcuts:

- `Ctrl + Numpad 5`: open Quick Capture;
- `Ctrl + NumLock` (with `Ctrl + Pause` fallback): show or hide Worker Status.

Closing either Desktop window hides it; use the tray menu's Quit action to stop the worker. Build the Windows NSIS installer with:

```powershell
pnpm.cmd desktop:build
```

Run the current automated checks:

```powershell
pnpm.cmd lint       # Web ESLint
pnpm.cmd test       # Web tests + Desktop Rust tests
pnpm.cmd typecheck  # Web + Desktop TypeScript
pnpm.cmd build      # Web production build (stop next dev first)
```

This Windows setup uses the `.cmd` entry because the current PowerShell execution policy blocks the generated `pnpm.ps1` shim. On shells without that restriction, the equivalent command is simply `pnpm`.

## Current system

- A mobile-oriented Next.js Web application for Journal, English, Workout/Running, and Food capture.
- A Cloud API hosted with the Web application on Vercel.
- MongoDB Atlas for persistent cloud data and revision-safe cross-device synchronization.
- A Tauri Windows application containing Quick Capture, special recorders, and the Desktop worker.
- A configurable local Codex/none processor invoked by the Windows Desktop worker.
- Heptabase as the first destination adapter; Anki remains later work.

The first end-to-end target is:

```text
Web capture
→ Cloud API
→ Desktop worker
→ Local Codex CLI
→ Heptabase CLI
→ Cloud API completion
→ Web status
```

## Development principles

- Build vertical slices instead of completing isolated subsystems.
- Keep Web, Desktop, and future shared contracts in one monorepo.
- Keep the Cloud API inside the Next.js application initially.
- Let the Desktop access cloud data only through the API, never directly through MongoDB.
- Introduce infrastructure and abstractions only when a milestone needs them.
- Treat executable verification and manual verification as different evidence.

Create a minimal Web/Desktop recorder starter with:

```powershell
pnpm.cmd create:recorder -- reading 閱讀 R
```

The generated UI is intentionally plain. The [Recorder Page Guide](docs/recorder-pages.md) explains the interaction, synchronization, and verification contract without requiring a plugin framework.

## Documentation

- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Extending recorders, AI, and destinations](docs/extending-capture.md)
- [Recorder page creation guide](docs/recorder-pages.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Collaboration rules](AGENTS.md)
