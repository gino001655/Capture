# Personal Capture System

A personal system for quickly capturing information, processing it on a Windows computer, and routing the results to useful destinations.

This repository is also a software-engineering learning project. Development proceeds in small, testable vertical slices so that each architectural boundary is understood before the system is expanded.

## Current status

The authenticated Web/API is deployed to Vercel and verified with MongoDB Atlas and the Desktop worker. The Web is installable as an iPhone Home Screen app, and the Windows worker now has a tray menu, background polling, quick-capture and status-window shortcuts, optional autostart, and a release installer.

The fake processor remains in place. Replacing it with the real Codex processor is the next core pipeline milestone.

## Local development

Requirements:

- Node.js 24 LTS
- Corepack with pnpm 11.21.0 enabled
- Rust stable MSVC toolchain
- Visual Studio 2022 Build Tools with Desktop development with C++
- Microsoft Edge WebView2

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

- `Ctrl + Alt + C`: open Quick Capture;
- `Ctrl + Alt + W`: show or hide Worker Status.

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

## Planned system

- A mobile-oriented Next.js Web application for capture and status viewing.
- A Cloud API hosted with the Web application on Vercel.
- MongoDB Atlas for persistent cloud data.
- A Tauri Windows application containing the Desktop worker.
- A simple fake processor first, followed later by a local Codex processor.
- Heptabase and Anki integrations only after the core pipeline works.

The first end-to-end target is:

```text
Web capture
→ Cloud API
→ Desktop worker
→ Fake processor
→ Cloud API
→ Web status
```

## Development principles

- Build vertical slices instead of completing isolated subsystems.
- Keep Web, Desktop, and future shared contracts in one monorepo.
- Keep the Cloud API inside the Next.js application initially.
- Let the Desktop access cloud data only through the API, never directly through MongoDB.
- Introduce infrastructure and abstractions only when a milestone needs them.
- Treat executable verification and manual verification as different evidence.

## Documentation

- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Collaboration rules](AGENTS.md)
