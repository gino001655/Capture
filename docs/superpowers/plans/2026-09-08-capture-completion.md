# Capture Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Eliminate remaining repository-side data-safety and reliability gaps and make third-party recorder creation easy without making Capture visually or architecturally heavy.

**Architecture:** Keep recorder domain payloads independent while sharing small pure synchronization policies. Strengthen the existing Next.js API/MongoDB and Tauri worker state machines instead of adding infrastructure. Recorder extension remains compile-time local source discovery, with explicit optional adapters for Cloud, AI, and destinations.

**Tech Stack:** TypeScript, React 19, Next.js 16 Route Handlers, MongoDB 7, Rust/Tauri 2, Node test runner, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-08-capture-completion-design.md`

## Global Constraints

- Preserve the monochrome, low-text Capture UI and the existing Journal behavior.
- Never remove durable local content before a valid Cloud acknowledgement.
- Do not add a marketplace, dynamic remote-code loader, or heavy offline dependency.
- Keep AI organization and Anki delivery disabled until explicitly configured.
- Do not modify or stage the untracked `.superpowers/` directory.
- Push and deployment require immediate user approval after local verification.

---

### Task 1: Date-bound autosave and pending retry

**Files:**
- Create: `apps/web/src/app/special-sync.ts`
- Create: `apps/web/src/app/special-sync.test.mts`
- Modify: `apps/web/src/app/workout-app.tsx`
- Modify: `apps/web/src/app/food-app.tsx`
- Modify: `apps/web/package.json`
- Test: `apps/web/src/app/special-sync.test.mts`

**Interfaces:**
- Produces: `createDateBoundDebounce(schedule, cancel)` whose `queue(date, candidate, save)` invokes `save(date, candidate)` with the exact scheduled values; `clampPastDate(candidate, today)` returns no date newer than today.
- Consumes: existing local cache candidates and `shiftJournalDate`.

- [x] Write failing tests proving a queued save keeps its original date/candidate after visible date changes, a replacement cancels only the same recorder timer, and future swipe dates clamp to today.
- [x] Run `pnpm.cmd --filter @capture/web test` and confirm the new tests fail because the helper is absent.
- [x] Implement the pure helper and bind Workout/Food timers to captured values.
- [x] Make Food load immediately retry a cached pending candidate; add online/visibility retry and timer cleanup for Workout/Food.
- [x] Run the focused Web suite and then the full Web tests.
- [x] Commit `fix: bind special recorder saves to their dates`.

### Task 2: Explicit no-loss conflict resolution

**Files:**
- Create: `apps/web/src/app/special-conflict.ts`
- Create: `apps/web/src/app/special-conflict.test.mts`
- Modify: `apps/web/src/app/english-app.tsx`
- Modify: `apps/web/src/app/workout-app.tsx`
- Modify: `apps/web/src/app/food-app.tsx`
- Modify: `apps/desktop/src/capture-pages/english.page.tsx`
- Modify: `apps/desktop/src/capture-pages/workout.page.tsx`
- Modify: `apps/desktop/src/capture-pages/food.page.tsx`
- Test: `apps/web/src/app/special-conflict.test.mts`

**Interfaces:**
- Produces: `SpecialConflict<T>` containing `date`, durable `local`, and authoritative `cloud`; `keepLocal(conflict)` returns a pending candidate rebased to the Cloud revision; `useCloud(conflict)` returns a non-pending Cloud candidate.
- Consumes: current API `409` bodies containing `record`.

- [x] Write failing tests that Cloud choice preserves the authoritative revision, local choice preserves the exact local payload while rebasing revision, and a missing Cloud record rebases to `null`.
- [x] Verify the tests fail for the missing conflict policy.
- [x] Implement the policy and persist conflict state with each local recorder cache.
- [x] Show one compact conflict strip on Web and Desktop with `雲端` and `本機`; no modal and no automatic winner.
- [x] Ensure successful resolution clears only the resolved conflict backup.
- [x] Run Web and Desktop tests/typechecks.
- [x] Commit `feat: resolve special recorder conflicts without data loss`.

### Task 3: Food draft validation and target persistence

**Files:**
- Modify: `apps/web/src/lib/food-record.ts`
- Modify: `apps/web/src/lib/food-store.ts`
- Modify: `apps/web/src/lib/food-record.test.mts`
- Modify: `apps/web/src/lib/food-store.test.mts`
- Modify: `apps/web/src/app/food-app.tsx`
- Modify: `apps/desktop/src/capture-pages/food.page.tsx`

**Interfaces:**
- Produces: `isFoodPayloadReady(payload)` that refuses Cloud sync while any local row has a blank name; empty rows remain device-local drafts. A payload with custom targets but no rows remains a stored daily record.
- Consumes: existing `FoodPayload` and store save contract.

- [x] Write failing parser/store tests for blank local draft readiness and target-only persistence.
- [x] Verify failures reflect current validation/deletion behavior.
- [x] Implement readiness gating in both clients and preserve target-only documents in the store.
- [x] Run food tests and both typechecks.
- [x] Commit `fix: preserve food drafts and nutrition targets`.

### Task 4: Retryable legacy job lifecycle

**Files:**
- Modify: `apps/web/src/lib/capture.ts`
- Modify: `apps/web/src/lib/capture-store.ts`
- Modify: `apps/web/src/lib/capture-store.test.mts`
- Modify: `apps/web/src/app/api/jobs/[id]/route.ts`
- Modify: `apps/web/src/app/api/jobs/claim/route.ts`
- Modify: `apps/web/src/app/api/captures/[id]/route.ts`
- Modify: `apps/desktop/src-tauri/src/worker.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Produces: legacy states `pending | processing | failed | completed`, processing lease timestamps, `fail(id,error)`, and `retryFailed()`; PATCH accepts `{ outcome: "completed", result }` or `{ outcome: "failed", error }`.
- Consumes: existing Desktop bearer authentication and claim endpoint.

- [x] Write failing store tests for failed reporting, retry delay, manual retry, and expired processing lease reclamation.
- [x] Write failing route tests for validated failure reports and retry authorization.
- [x] Implement the smallest compatible schema/store/route changes, preserving old completed documents.
- [x] Report processor failures from Desktop before returning the operator error.
- [x] Include failed legacy work in Check Now retry behavior.
- [x] Run Web route/store tests and Rust tests.
- [x] Commit `fix: make legacy capture failures retryable`.

### Task 5: Bounded queue draining and resume triggers

**Files:**
- Modify: `apps/desktop/src-tauri/src/worker.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Test: `apps/desktop/src-tauri/src/worker.rs`

**Interfaces:**
- Produces: `check_for_work` drains at most 20 items per wake and summarizes processed/failed/idle counts; a power/network resume requests the existing serialized check channel.
- Consumes: the current non-overlapping worker trigger and journal/legacy claim APIs.

- [x] Extract a pure drain-decision function and write failing Rust tests for idle stop, 20-item bound, and failure stop after reporting.
- [x] Verify focused Rust failure.
- [x] Refactor one-item work into one iteration and implement the bounded loop.
- [x] Wire supported Tauri/Windows resume events to the existing trigger without starting a second loop.
- [x] Run Rust tests and Desktop typecheck.
- [x] Commit `feat: drain worker queues after wake`.

### Task 6: Lightweight offline Web shell

**Files:**
- Create: `apps/web/public/sw.js`
- Create: `apps/web/src/app/service-worker-registration.tsx`
- Create: `apps/web/src/app/offline-policy.test.mts`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/manifest.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces: a same-origin service worker with versioned shell cache, network-first navigation fallback, cache-first immutable static assets, and no API mutation caching.
- Consumes: existing recorder local caches.

- [x] Write a failing policy test that exercises exported request classification and proves `/api/**`, auth, and non-GET requests are never cached.
- [x] Verify failure before implementation.
- [x] Implement registration and service worker caching with an explicit cache version.
- [x] Run Web tests, lint, typecheck, and production build.
- [x] Commit `feat: open the capture shell offline`.

### Task 7: Recorder starter contract and generator

**Files:**
- Modify: `packages/recorder-kit/src/index.ts`
- Modify: `packages/recorder-kit/src/index.test.mts`
- Create: `scripts/create-recorder.mjs`
- Create: `scripts/create-recorder.test.mts`
- Create: `docs/recorder-page-spec.md`
- Create: `examples/recorder-starter/README.md`
- Create: `examples/recorder-starter/web.page.tsx`
- Create: `examples/recorder-starter/desktop.page.tsx`
- Modify: `package.json`
- Modify: `docs/extending-capture.md`

**Interfaces:**
- Produces: `RecorderManifest` metadata contract and `pnpm create:recorder -- <id> <label> <symbol>` dry-run-capable generator that creates a minimal Web/Desktop source pair and prints the single catalog edit still required by Next.js.
- Consumes: existing `CapturePageDefinition`, `WebRecorderProps`, and typed catalog.

- [x] Write failing recorder-kit validation tests for lowercase stable IDs, unique ordering, compact symbols, and required labels.
- [x] Write a failing generator integration test in a temporary directory, asserting exact generated files and refusal to overwrite.
- [x] Verify both failures.
- [x] Implement the manifest validator and dependency-free generator.
- [x] Add the copyable starter and concise page creation standard covering lifecycle, accessibility, local cache, Cloud schema, and test expectations.
- [x] Run package/script tests and typechecks.
- [x] Commit `feat: add recorder starter workflow`.

### Task 8: Open-source project readiness

**Files:**
- Create: `LICENSE`
- Create: `CONTRIBUTING.md`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/roadmap.md`
- Modify: `apps/web/.env.example`
- Modify: `apps/desktop/src-tauri/.env.example`
- Modify: root/package metadata where applicable.

**Interfaces:**
- Produces: MIT licensing, a verified local setup path, extension entry links, secret-handling guidance, and a truthful feature/manual-verification matrix.
- Consumes: commands already defined in the workspace.

- [x] Audit tracked files for committed credentials, machine-specific absolute paths, and stale shortcut/status claims.
- [x] Add MIT license and a concise contribution workflow using fork/branch/test/PR steps.
- [x] Rewrite the README entry path around install, configure, run, extend, and verify; keep advanced architecture in docs.
- [x] Update roadmap/status using only verified implementation evidence.
- [x] Run link/path and secret-pattern inspection plus lint.
- [x] Commit `docs: make Capture approachable to contributors`.

### Task 9: Final audit and distributable

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: documentation only if audit finds stale claims.

**Interfaces:**
- Produces: one consistent Desktop patch version and a fresh NSIS installer.
- Consumes: all earlier tasks.

- [x] Re-read the approved product design, architecture, roadmap, and this spec; map every requirement to code/test/manual/external status.
- [x] Fix only remaining automatable contradictions through additional red-green cycles.
- [x] Bump the Desktop patch version consistently.
- [x] Run `pnpm.cmd test`, `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd build`, `pnpm.cmd --filter @capture/desktop build`, and `pnpm.cmd desktop:build` fresh and inspect exit codes.
- [x] Inspect Git diff/status, installer path/size/hash, and tracked-secret scan.
- [x] Commit `chore: prepare verified Capture release`.
- [ ] Report only true user/external blockers and ask for immediate push/deploy authorization.
