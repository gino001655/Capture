# Personal Capture System

A personal system for quickly capturing information, processing it on a Windows computer, and routing the results to useful destinations.

This repository is also a software-engineering learning project. Development proceeds in small, testable vertical slices so that each architectural boundary is understood before the system is expanded.

## Current status

The repository foundation and minimal local Web foundation are complete. The Next.js application can run locally, but capture and API behavior have not been implemented yet.

## Local development

Requirements:

- Node.js 24 LTS
- Corepack with pnpm 11.21.0 enabled

Install the workspace dependencies:

```powershell
pnpm.cmd install --frozen-lockfile
```

Start the Web application:

```powershell
pnpm.cmd dev
```

Then open `http://localhost:3000`.

Run the current automated checks:

```powershell
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd build
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
