# Capture Completion and Extension Design

## Goal

Finish every repository-side task that can be completed without the user's accounts, physical devices, or permission to publish, while preserving Capture's quiet, minimal interaction model.

## Product boundary

Capture stays a small personal capture tool, not a general no-code platform. New capability is accepted only when it either prevents data loss, removes a repeated interaction, or makes a third-party recorder substantially easier to add. The normal capture surfaces remain nearly text-free; diagnostics and configuration belong in Worker Status or developer documentation.

## Delivery slices

### 1. Special-recorder data safety

English, Workout, and Food keep local-first editing and delayed Cloud synchronization. Every delayed save is bound to the date and immutable candidate that scheduled it, so changing the visible date cannot redirect data. Pending documents retry when the browser or Desktop regains connectivity or the module becomes active.

Revision conflicts never silently choose a winner. The local candidate remains in durable storage while the UI exposes two compact actions: use the newer Cloud version, or intentionally save the local version on top of the newer revision. Choosing Cloud first leaves a recoverable local conflict backup until the user has made the choice; choosing local rebases the candidate to the Cloud revision and retries. Future dates are never reachable through swipe navigation.

Incomplete Food rows are local drafts and do not produce repeated validation errors while the name is blank. Nutrition targets are retained even when the day has no food rows.

### 2. Worker reliability

Legacy captures gain explicit failed state, retry metadata, and an expiring processing lease, matching the safety properties already used by Journal delivery. A processor failure is reported to Cloud instead of leaving a capture permanently processing. Manual Check Now makes failed legacy captures immediately retryable.

One worker wake drains a bounded number of available Journal dates and legacy captures rather than exactly one item. The bound prevents a corrupt or constantly replenished queue from monopolizing the process. Existing non-overlap protection remains authoritative. Windows power-resume and network-return events both request a new check; periodic polling remains the fallback.

### 3. Offline launch

The Web app registers a small first-party service worker that caches only the application shell and same-origin static assets. Mutations remain in each recorder's existing local queue; the service worker never invents server acknowledgements or stores credentials. An offline launch can open the installed UI, edit local content, and retry after connectivity returns. Authentication still requires a valid previously established browser session and production verification remains manual.

### 4. Open-source recorder experience

`@capture/recorder-kit` exposes a small recorder manifest contract and shared lifecycle helpers, not UI policy. A recorder example lives beside the extension guide and demonstrates the smallest useful module: metadata, Web page, Desktop page, optional versioned payload parser, and optional server adapter. Core navigation derives from the catalog; a missing surface fails a type or build check with a direct message.

The guide distinguishes three extension levels:

1. local-only page: one page per client and browser/device storage;
2. synchronized recorder: add a versioned payload and narrow API/store adapter;
3. processed recorder: add a processor and destination adapter without coupling UI to Heptabase, Anki, Codex, or MongoDB.

A contributor checklist, permissive MIT license, environment examples, architecture map, and copyable starter recorder make a fork usable without reading the whole codebase. No marketplace, dynamic remote code loading, plugin daemon, or database abstraction framework is introduced.

### 5. Optional future processors

Journal AI classification and English-to-Anki remain disabled by default. This completion pass may expose stable provider configuration and documented processor inputs/outputs, but it must not guess the user's private prompt, Anki deck/model mapping, or enable destructive automation. Exact production activation therefore remains user-owned.

## Error handling

- Local pending content is removed only after a valid Cloud acknowledgement.
- Malformed or unauthorized responses pause automatic retry and keep a visible compact issue state.
- Network and retryable server failures retain the candidate and retry on the next connectivity, visibility, or worker trigger.
- Conflict actions are explicit and idempotent.
- Worker leases expire so a crashed worker cannot hold a job forever.
- Heptabase's append/acknowledgement crash window is documented because its API currently provides no idempotency key; Capture does not claim exactly-once delivery.

## Verification

Each behavior change follows red-green TDD with pure unit tests where possible and route/store integration tests at persistence boundaries. Completion requires fresh root test, typecheck, lint, Web production build, Desktop frontend build, Rust tests, and Tauri installer build. Authenticated production, phone gestures, installed-window behavior, Google login, Heptabase append, Anki connection, and deployment remain manual/external verification.

## Completion boundary

Repository work is complete only after a requirement-by-requirement audit finds no remaining automatable gap. Publishing is a separate action because the project policy requires immediate user approval before push or deployment.
