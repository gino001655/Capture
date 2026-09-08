# Extending Capture

Capture keeps recorder metadata, platform UI, Cloud persistence, processors, and destinations separate. A personal fork can replace one part without rewriting the others.

## Add a recorder

1. Add its id, order, accessible label, and compact symbol to `packages/recorder-kit/src/index.ts`. This catalog is the single source of truth for both clients.
2. Add the mobile page component to `apps/web/src/app/recorder-registry.tsx`. The `satisfies Record<RecorderId, ...>` check deliberately makes the build fail until every catalog entry has a Web page.
3. Add `apps/desktop/src/capture-pages/<id>.page.tsx`. Vite discovers every `*.page.tsx` file automatically. Export `{ id, Component } satisfies CapturePageDefinition`; ordering comes from the shared catalog.
4. If the recorder synchronizes data, define a versioned payload in `apps/web/src/lib/special-record.ts` and expose it through a narrow authenticated API. Do not let a browser or Desktop client connect directly to MongoDB.

Journal is the core recorder and has a delivery lifecycle. Special recorders use independent payloads and processors because English, workouts, and food do not share a useful domain schema.

## Select or add an AI provider

Worker Status → Processing selects the provider used by the legacy text-to-note processor:

- `codex-cli` uses the locally signed-in Codex CLI. An optional model name is passed with `--model`.
- `none` preserves the raw text in deterministic Markdown and requires no AI CLI.

Development and unattended installs may instead set:

```dotenv
CAPTURE_AI_PROVIDER=codex-cli
CAPTURE_AI_MODEL=
```

The implementation contract is `AiProvider::write_markdown` in `apps/desktop/src-tauri/src/ai_provider.rs`: untrusted captured text enters as a string and a Markdown file is produced. Add a provider variant there, keep credentials in environment or per-user configuration, and never interpolate capture text into a shell command.

The daily Journal delivery intentionally does not use AI yet. Its deterministic formatter is the verified fallback; the later classification stage should call the same provider boundary and retain the raw Journal records as source data.

## Add a destination

Heptabase is currently the only destination. The stable contract is `CaptureDestination` in `apps/desktop/src-tauri/src/destination.rs`; its local CLI implementation currently lives beside the deterministic formatters in `processor.rs`. Cloud never receives destination credentials. A new adapter consumes prepared Markdown and returns a stable receipt without changing the worker, recorder UI, or Cloud API.

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
- A public license still needs to be selected before accepting outside contributions.
- Adding a Web recorder requires one explicit registry entry because Next.js does not provide Vite's build-time glob import.
