# Personal Capture System

A personal system for quickly capturing information, processing it on a Windows computer, and routing the results to useful destinations.

This repository is also a software-engineering learning project. Development proceeds in small, testable vertical slices so that each architectural boundary is understood before the system is expanded.

## Current status

The project is in the repository-foundation stage. No Web or Desktop application has been scaffolded yet.

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

Setup and development commands will be added when the first application is scaffolded.
