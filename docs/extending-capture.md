# Extending Capture

Capture keeps recorder metadata, platform UI, Cloud persistence, processors, and destinations separate. A personal fork can replace one part without rewriting the others.

## Add a recorder

For the page contract, UX rules, generator, and verification checklist, see [Recorder Page Guide](recorder-pages.md).

The quickest path is:

```powershell
pnpm.cmd create:recorder -- reading 閱讀 R
```

The generator performs the catalog and registry edits described below and creates both platform starters.

1. Add its id, order, accessible label, and compact symbol to `packages/recorder-kit/src/index.ts`. This catalog is the single source of truth for both clients.
2. Add the mobile page component to `apps/web/src/app/recorder-registry.tsx`. The `satisfies Record<RecorderId, ...>` check deliberately makes the build fail until every catalog entry has a Web page.
3. Add `apps/desktop/src/capture-pages/<id>.page.tsx`. Vite discovers every `*.page.tsx` file automatically. Export `{ id, Component } satisfies CapturePageDefinition`; ordering comes from the shared catalog.
4. If the recorder synchronizes data, define a versioned payload in `apps/web/src/lib/special-record.ts` and expose it through a narrow authenticated API. Do not let a browser or Desktop client connect directly to MongoDB.

Journal is the core recorder and has a delivery lifecycle. Special recorders use independent payloads and processors because English, workouts, and food do not share a useful domain schema.

## Select or add an AI provider

Worker Status → Processing selects the provider used by legacy notes and any explicitly enabled Journal/English automation:

- `codex-cli` uses the locally signed-in Codex CLI. An optional model name is passed with `--model`.
- `none` preserves the raw text in deterministic Markdown and requires no AI CLI.

Development and unattended installs may instead set:

```dotenv
CAPTURE_AI_PROVIDER=codex-cli
CAPTURE_AI_MODEL=
```

The implementation contract is `AiProvider` in `apps/desktop/src-tauri/src/ai_provider.rs`: untrusted content enters as data and the provider returns validated Markdown or card data. Add a provider variant there, keep credentials in environment or per-user configuration, and never interpolate capture text into a shell command.

Journal AI is opt-in and starts from the deterministic formatter; English automation returns validated `front/back/tags` cards. Both retain raw Cloud records and report failures to their queue instead of silently substituting output.

## Add a destination

Heptabase implements the Markdown destination contract in `destination.rs`; AnkiConnect is isolated in `anki.rs` because cards use a different data shape. Cloud never receives destination credentials. Add a narrow typed adapter for a new destination rather than adding destination-specific logic to recorder UI or MongoDB stores.

## Data and secrets

### Replace the database

Route-handler factories such as `createWorkoutHandler` and `createFoodHandler` accept narrow domain-store ports (`get`, `list`, and `save`). The exported Next.js routes inject the MongoDB stores only at the bottom of each route file. A fork can implement the same typed port with another database and change that composition line; UI and domain validation remain unchanged.

Capture intentionally does not expose one untyped JSON repository for every recorder. Each recorder keeps its versioned schema and conflict rules, while the adapter boundary stays small and test fakes use the same port.

- Web secrets belong in `apps/web/.env.local` or the deployment platform.
- Desktop development secrets belong in `apps/desktop/src-tauri/.env.local`.
- Installed Desktop settings are stored for the current Windows user.
- Commit only `.env.example` placeholders.
- Evolve special-recorder payloads with `schemaVersion`; do not reinterpret old records in place.

## Current open-source limitations

- Authentication is intentionally single-user through one allowed email and one Desktop token.
- The Desktop integration targets Windows, Codex CLI, and Heptabase Desktop.
- Adding a Web recorder requires one explicit registry entry because Next.js does not provide Vite's build-time glob import.
