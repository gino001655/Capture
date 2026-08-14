# Roadmap

The roadmap is ordered by dependency and learning value, not by visual completeness. Each milestone should end in a runnable or otherwise verifiable state.

## 0. Repository foundation

Status: Complete.

Objective: establish collaboration rules, architecture direction, repository hygiene, and an initial roadmap without application code.

Success criteria:

- The initial architecture and boundaries are documented.
- Generated files, secrets, and line endings have explicit repository rules.
- No application dependencies or machine setup are introduced.

## 1. Development-environment audit

Status: Complete.

Objective: inspect the existing Node.js, pnpm, Rust, Cargo, and Windows prerequisites before installing anything.

Success criteria:

- Required tools and acceptable versions are understood.
- Missing machine-global prerequisites are identified.
- No tool is installed without an explanation and user approval.

## 2. Minimal local Web and API path

Status: Complete.

Objective: create a capture in a minimal Next.js page and send it to a local Route Handler.

Success criteria:

- The Web application starts locally.
- A capture request crosses the browser-to-server boundary.
- Validation and failure behavior have minimal tests.
- Temporary state is clearly identified as non-production.

## 3. First local end-to-end slice

Status: Complete.

Objective: connect a minimal Tauri Desktop worker and fake processor to the local API.

Success criteria:

- Web creates a pending job.
- Desktop obtains the job through HTTP.
- The fake processor produces a deterministic result.
- Desktop reports completion and Web displays it.

## 4. Persistent shared data

Status: Complete. Atlas persistence, restart survival, atomic job claiming, and the local Desktop round trip were manually verified.

Objective: replace temporary state with MongoDB Atlas.

Success criteria:

- Captures and jobs survive application restarts.
- Database credentials remain outside committed files.
- Required schema validation and indexes are documented and tested.

## 5. Authentication and authorization

Status: Complete. The Web requires an allowed Google account, and the Desktop authenticates with a separate bearer token. The local end-to-end flow has been manually verified.

Objective: protect the single-user Web application and Desktop worker before public deployment.

Success criteria:

- Only the approved user can use the Web application.
- The Desktop uses a separate revocable device credential.
- Unauthorized API requests are rejected by automated tests.

## 6. First Vercel cloud slice

Objective: deploy the authenticated Web/API application and run the complete pipeline against it.

Success criteria:

- Vercel connects securely to MongoDB Atlas.
- The Desktop reaches the deployed API without direct database access.
- The complete Web-to-Desktop-to-Web path is manually verified.

## Later milestones

- Replace the fake processor with a local Codex processor.
- Add minimal Heptabase integration.
- Add minimal Anki integration.
- Improve capture UX, PWA behavior, tray, and global shortcuts.
- Add retry, idempotency, crash recovery, logging, and observability as real failure modes appear.
- Improve intelligent routing and visual polish after the pipeline is reliable.
