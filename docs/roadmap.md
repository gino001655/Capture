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

Status: Complete. The authenticated production Web/API, Atlas persistence, and Desktop round trip were manually verified against the Vercel deployment.

Objective: deploy the authenticated Web/API application and run the complete pipeline against it.

Success criteria:

- Vercel connects securely to MongoDB Atlas.
- The Desktop reaches the deployed API without direct database access.
- The complete Web-to-Desktop-to-Web path is manually verified.

## 7. Installable capture clients

Status: Complete. iPhone installation, Windows installation, tray behavior, shortcuts, and autostart were manually verified.

Objective: make capture fast enough for daily use without opening a full browser or a heavy foreground Desktop window.

Success criteria:

- The deployed Web app can be added to the iPhone Home Screen and opens in standalone mode.
- `Ctrl + Alt + C` opens a focused Desktop capture input.
- `Ctrl + Alt + W` shows or hides Worker Status.
- Closing Desktop windows leaves one worker in the tray; Quit stops it.
- The worker can start hidden with Windows and can be installed from a Windows `.exe` installer.

## 8. Local Codex and Heptabase slice

Status: Complete for the minimum happy path. The production Capture-to-Cloud-to-Desktop-to-Codex-to-Heptabase flow was manually verified, including MongoDB completion state and direct Heptabase card read-back.

Objective: replace the fake processor and connect the first real destination without prematurely designing the final content format.

Success criteria:

- The Desktop invokes the signed-in local Codex CLI without placing capture text in a shell argument.
- Codex returns a minimal Markdown note.
- The worker uses the official Heptabase CLI to ensure Heptabase Desktop is ready, then creates a note.
- The worker reports the Heptabase card ID through the Cloud API and MongoDB records the job as completed.

## Later milestones

## 9. Journal product slice

Status: Implemented in source; production smoke test pending.

- Cloud claims undelivered idle records by Taipei Journal date after the 04:00 boundary.
- Desktop appends deterministic Markdown to that date's Heptabase Journal with MD5 conflict protection.
- Success locks delivered records; failure persists an error and retries after 15 minutes.
- Worker Status exposes pending, processing, and failed dates with an immediate manual retry.

Remaining limitation: Heptabase does not expose an idempotency key. A crash in the narrow interval after a successful append but before the Cloud acknowledgement can still require manual duplicate inspection.

## 10. Open-source extension boundary

Status: Foundation implemented; public-license selection and broader provider coverage remain.

- Web and Desktop now share one typed recorder catalog; Desktop page files remain auto-discovered and Web completeness is build-checked.
- The extension guide documents the minimum files needed to add a recorder.
- The legacy AI stage now has a configurable `codex-cli` / deterministic `none` provider boundary and optional model selection, without committing credentials.
- Destination and database adapters remain the next interface extraction; only Heptabase and MongoDB are currently implemented.
- Supply examples and development setup suitable for a GitHub user modifying a personal fork.

## 11. English to Anki

Status: Planned. The daily English source document and history are implemented.

## 12. Workout and running recorder

Status: Designed; not implemented.

## 13. Food recorder

Status: Designed; not implemented.

## Later reliability and product work

- Add offline capture only if real mobile usage demonstrates that it is needed.
- Add explicit English conflict resolution and improve legacy capture retry/idempotency.
- Resolve the Heptabase append acknowledgement crash window if its API gains a stable idempotency mechanism.
- Add AI organization only after the deterministic delivery path is production-verified.
