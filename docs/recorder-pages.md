# Recorder Page Guide

A recorder page is one focused capture workflow, not a general-purpose dashboard. It should make one repeated action faster while preserving Capture's quiet, compact interface.

## Start a recorder

From the repository root:

```powershell
pnpm.cmd create:recorder -- reading 閱讀 R
```

Preview the affected files without writing anything:

```powershell
pnpm.cmd create:recorder -- reading 閱讀 R --dry-run
```

The command validates the id, refuses to overwrite existing work, registers the recorder in the shared catalog, and creates:

- `apps/web/src/app/reading-app.tsx`
- `apps/desktop/src/capture-pages/reading.page.tsx`

Replace the starter textareas with the smallest useful workflow. Run `pnpm.cmd typecheck` immediately; the shared `RecorderId` union makes missing or misspelled registrations fail at compile time.

## Page contract

Every recorder has one id, label, symbol, and order in `packages/recorder-kit/src/index.ts`.

- `id`: stable lowercase kebab-case storage and routing identity. Never rename it after data exists without a migration.
- `label`: accessible name. The visible interface may be symbol-only, but controls still need labels.
- `symbol`: one to four compact characters for the module rail.
- `order`: shared Web/Desktop navigation order.

The Web component receives `active` and `onSelectModule`. Return `null` while inactive so hidden recorders do not intercept focus or gestures. The Desktop definition receives `requestModeChange`; preserve `Ctrl + Left/Right` so keyboard navigation remains consistent.

Mobile and Desktop should share the same concepts, ordering, data, and save rules. They do not need identical pixels: mobile may use swipe and touch-sized targets, while Desktop may use keyboard focus and a denser fixed window.

## Minimal interaction standard

Before adding controls, ask whether the repeated task can be completed with fewer decisions. A good recorder normally has:

- the primary input focused or immediately reachable;
- local-first edits, so typing never waits for the network;
- automatic save for special recorders;
- today's record editable and older records visibly read-only;
- compact sync/conflict state only when action is required;
- no permanent tutorial text in the capture surface;
- motion that explains a state change, while respecting reduced-motion preferences.

Do not add settings, analytics, tags, search, AI, or a new database collection merely because they may be useful later. Add them when the recorder's real workflow requires them.

## Synced data

A static/local experiment needs no Cloud code. When synchronization becomes necessary, add one narrow vertical slice:

1. Define a domain payload with `schemaVersion: 1` under `apps/web/src/lib`.
2. Validate unknown input at the API boundary; do not trust TypeScript types over HTTP.
3. Store stable item ids and explicit timestamps when ordering or history matters.
4. Save with `expectedRevision`; a conflict must preserve both the Cloud record and the local candidate.
5. Cache pending local edits by recorder id and journal date, then retry on reconnect.
6. Expose only the smallest authenticated route and store interface the page needs.
7. Mirror the contract in Desktop commands; clients never connect directly to MongoDB.

Use a new collection only when the data has a genuinely different lifecycle or query pattern. A small recorder with one document per user/date should reuse the special-record pattern. Do not put unrelated recorder fields into Journal records.

## Completion checklist

- The primary flow works using touch and keyboard.
- Web and Desktop agree on dates, ordering, validation, and read-only rules.
- Empty content does not create junk Cloud records.
- Refresh, offline editing, reconnect, and revision conflict preserve user text.
- Controls have accessible names and focus is visible.
- Focused tests protect parsing, save rules, and the failure most likely to lose data.
- `pnpm.cmd test`, `pnpm.cmd typecheck`, and `pnpm.cmd lint` pass.
- The README or this guide changes if the real extension contract changed.

That is the full baseline. A recorder should earn additional machinery through demonstrated need.
