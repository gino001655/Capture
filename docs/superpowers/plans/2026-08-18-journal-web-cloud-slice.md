# Journal Web + Cloud Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the temporary phone capture form with a six-area Journal that autosaves to a revision-safe Cloud record store and supports date navigation plus same-day record editing.

**Architecture:** Add a `journalRecords` MongoDB collection beside the legacy `captures` collection so the verified Desktop processor path remains untouched. Pure TypeScript domain and session modules own validation, date logic, local pending mutations, and conflict handling; thin Next.js Route Handlers expose authenticated create/list/update operations; one React client coordinates the mobile UI, localStorage, and 1.5-second Cloud sync.

**Tech Stack:** Next.js 16.3 App Router, React 19.2, TypeScript, MongoDB 7.5, Node test runner, ESLint, browser localStorage.

**Spec:** `docs/capture-product-design.md`

## Global Constraints

- Implement only the mobile Journal + Cloud slice. Do not modify Desktop, worker, Codex, or Heptabase files in this plan.
- Preserve the production `captures` collection and all existing `/api/captures` and `/api/jobs` behavior.
- The six ordered areas are `○ * ? ! + ~`, represented in code as `unclassified`, `event`, `question`, `insight`, `next`, and `feeling`.
- Use `Asia/Taipei` for the assigned Journal date; never derive it from UTC date slicing.
- The normal mobile Journal has no submit button or explanatory labels. Accessible names remain available to assistive technology.
- Save locally immediately and debounce Cloud sync by exactly `1_500` milliseconds.
- Returning from background in under `600_000` milliseconds resumes the active sheet. At or beyond that boundary, preserve a non-empty record as `idle` and start a blank sheet. Empty sheets never become records.
- Records list newest-first by `createdAt`; editing never changes that order.
- Delivered records are read-only. This slice creates only undelivered records but must enforce the lock in its update contract for later delivery work.
- A stale revision must never overwrite Cloud content. Preserve the stale device's content as a separate conflict copy.
- Reuse the current `MAX_CAPTURE_LENGTH` (`5_000`) as the maximum combined Journal-area length for this first slice; changing that limit requires a separate evidence-based decision.
- No AI classification, rewriting, title generation, or `解` field is introduced in this plan.

## File Responsibility Map

- `apps/web/src/lib/journal-record.ts`: domain types, ordered area metadata, request validation, content/date helpers.
- `apps/web/src/lib/journal-store.ts`: Mongo persistence, newest-first date queries, optimistic revision updates, conflict-copy creation.
- `apps/web/src/app/api/journal-records/route.ts`: authenticated `GET` by date and idempotent `POST` creation.
- `apps/web/src/app/api/journal-records/[id]/route.ts`: authenticated optimistic `PATCH` update.
- `apps/web/src/app/journal-session.ts`: pure Taipei date arithmetic, 10-minute decisions, local pending-mutation state transitions.
- `apps/web/src/app/journal-app.tsx`: browser orchestration, debounce, localStorage, focus, editor/list modes.
- `apps/web/src/app/page.tsx`: authenticated server entry that renders `JournalApp`.
- `apps/web/src/app/globals.css`: approved monochrome mobile layout.
- `apps/web/package.json`: include new Node test files in the Web test script.
- `docs/architecture.md` and `docs/roadmap.md`: update only after the slice passes automated and manual verification.

---

### Task 1: Journal domain contract and validation

**Files:**
- Create: `apps/web/src/lib/journal-record.ts`
- Create: `apps/web/src/lib/journal-record.test.mts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces: `JournalAreas`, `JournalRecord`, `JournalCreateInput`, `JournalUpdateInput`, `emptyJournalAreas()`, `hasJournalContent()`, `validateJournalDate()`, `validateJournalCreateRequest()`, and `validateJournalUpdateRequest()`.
- Consumes: `MAX_CAPTURE_LENGTH` from `apps/web/src/lib/capture.ts`.

- [ ] **Step 1: Add the test file to the Web test command**

Change the script to run existing tests plus `src/app/journal-session.test.mts` and every Journal API test explicitly, avoiding shell-dependent recursive globs:

```json
"test": "node --test src/lib/*.test.mts src/app/journal-session.test.mts src/app/api/captures/route.test.mts src/app/api/journal-records/route.test.mts src/app/api/journal-records/[id]/route.test.mts"
```

- [ ] **Step 2: Write failing domain tests**

Cover ordered keys, a valid leap-day date, an impossible date, empty content, combined-length overflow, revision validation, and preservation of multiline text:

```ts
function validCreate(overrides: Partial<JournalCreateInput> = {}): JournalCreateInput {
  return {
    id: "8b52495a-a8b7-4d99-a2c8-30be915dc95b",
    deviceId: "0cd30ab8-3000-42de-bf56-dcb4526b2461",
    journalDate: "2026-08-18",
    areas: { ...emptyJournalAreas(), insight: "A useful idea" },
    ...overrides,
  };
}

test("accepts a six-area Journal record without trimming its prose", () => {
  const areas = { ...emptyJournalAreas(), insight: " first line\n  detail" };
  const result = validateJournalCreateRequest(validCreate({ areas }));
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.value.areas.insight, areas.insight);
});

test("rejects an empty Journal record", () => {
  assert.equal(validateJournalCreateRequest(validCreate({ areas: emptyJournalAreas() })).success, false);
});

test("rejects an impossible Taipei Journal date", () => {
  assert.equal(validateJournalDate("2026-02-30"), false);
});
```

- [ ] **Step 3: Run the domain tests and verify the expected failure**

Run: `pnpm.cmd --filter @capture/web exec node --test src/lib/journal-record.test.mts`

Expected: FAIL because `journal-record.ts` does not exist.

- [ ] **Step 4: Implement the domain module**

Use these exact public shapes:

```ts
export const JOURNAL_AREA_KEYS = [
  "unclassified", "event", "question", "insight", "next", "feeling",
] as const;
export type JournalAreaKey = (typeof JOURNAL_AREA_KEYS)[number];
export type JournalAreas = Record<JournalAreaKey, string>;
export type DeliveryState = "undelivered" | "delivered";
export type EditingState = "active" | "idle";

export type JournalRecord = {
  id: string;
  deviceId: string;
  journalDate: string;
  areas: JournalAreas;
  deliveryState: DeliveryState;
  editingState: EditingState;
  revision: number;
  createdAt: string;
  updatedAt: string;
  conflictOf?: string;
};

export type JournalCreateInput = Pick<
  JournalRecord,
  "id" | "deviceId" | "journalDate" | "areas"
>;

export type JournalUpdateInput = Pick<
  JournalRecord,
  "deviceId" | "journalDate" | "areas" | "editingState"
> & { expectedRevision: number; conflictRecordId: string };
```

Require UUID-shaped `id`, `deviceId`, and `conflictRecordId`; require six string fields and at least one non-whitespace character; preserve strings verbatim; reject combined `.length` above `MAX_CAPTURE_LENGTH`; validate a `YYYY-MM-DD` round trip with `Date.UTC` rather than accepting JavaScript's overflow normalization.

- [ ] **Step 5: Run the focused test and all Web tests**

Run: `pnpm.cmd --filter @capture/web exec node --test src/lib/journal-record.test.mts`

Expected: PASS.

Run: `pnpm.cmd --filter @capture/web test`

Expected: all existing and new tests PASS.

- [ ] **Step 6: Commit the domain contract**

```powershell
git add apps/web/package.json apps/web/src/lib/journal-record.ts apps/web/src/lib/journal-record.test.mts
git commit -m "feat(web): define Journal record contract"
```

### Task 2: Revision-safe Mongo Journal store

**Files:**
- Create: `apps/web/src/lib/journal-store.ts`
- Create: `apps/web/src/lib/journal-store.test.mts`

**Interfaces:**
- Consumes: Task 1 domain types.
- Produces: `JournalStore.create()`, `JournalStore.listDate()`, `JournalStore.update()`, and `JournalUpdateOutcome`.

- [ ] **Step 1: Write an in-memory collection double and failing store tests**

The tests must demonstrate four independent guarantees:

```ts
test("lists one date newest-first without moving edited records", async () => {
  const { store, clock } = createHarness();
  const older = await store.create(createInput(IDS.older));
  clock.advance(1_000);
  const newer = await store.create(createInput(IDS.newer));
  const outcome = await store.update(older.id, updateInput({ expectedRevision: 0 }));
  assert.equal(outcome.kind, "updated");
  assert.deepEqual((await store.listDate("2026-08-18")).map(({ id }) => id), [newer.id, older.id]);
});

test("replaying create with the same id returns the original record", async () => {
  const { store, documents } = createHarness();
  const first = await store.create(createInput(IDS.older));
  const replay = await store.create(createInput(IDS.older));
  assert.deepEqual(replay, first);
  assert.equal(documents.size, 1);
});

test("preserves a stale edit as one idempotent conflict copy", async () => {
  const { store, documents } = createHarness();
  const original = await store.create(createInput(IDS.older));
  const first = await store.update(original.id, updateInput({ expectedRevision: 0 }));
  assert.equal(first.kind, "updated");
  const staleInput = updateInput({
    expectedRevision: 0,
    conflictRecordId: IDS.conflict,
    areas: areasWith("feeling", "stale device text"),
  });
  const conflict = await store.update(original.id, staleInput);
  const retry = await store.update(original.id, staleInput);
  assert.equal(conflict.kind, "conflict");
  assert.equal(retry.kind, "conflict");
  if (conflict.kind === "conflict") assert.equal(conflict.record.conflictOf, original.id);
  assert.equal(documents.size, 2);
});

test("refuses to edit a delivered record", async () => {
  const { store, setDeliveryState } = createHarness();
  const record = await store.create(createInput(IDS.older));
  setDeliveryState(record.id, "delivered");
  const outcome = await store.update(record.id, updateInput({ expectedRevision: 0 }));
  assert.equal(outcome.kind, "locked");
});
```

Define `IDS` with three fixed UUIDs. Define `createInput(id)`, `updateInput(overrides)`, and `areasWith(key, text)` using Task 1 types. `createHarness()` returns `{ store, documents, clock, setDeliveryState }`; its clock begins at `2026-08-18T00:00:00.000Z` and is injected into `JournalStore` as `now: () => clock.now()` so order tests never depend on wall time.

The fake collection must implement `updateOne`, `findOne`, `findOneAndUpdate`, and `find().sort().toArray()` so tests exercise the same operations as MongoDB.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm.cmd --filter @capture/web exec node --test src/lib/journal-store.test.mts`

Expected: FAIL because `JournalStore` is not defined.

- [ ] **Step 3: Implement `JournalStore` with a separate collection**

Use collection name `journalRecords` and create `{ journalDate: 1, createdAt: -1, _id: 1 }` as index `journal_date_newest_first`.

```ts
export type JournalUpdateOutcome =
  | { kind: "updated"; record: JournalRecord }
  | { kind: "conflict"; record: JournalRecord; current: JournalRecord }
  | { kind: "locked"; record: JournalRecord }
  | { kind: "notFound" };

export class JournalStore {
  create(input: JournalCreateInput): Promise<JournalRecord>;
  listDate(journalDate: string): Promise<JournalRecord[]>;
  update(id: string, input: JournalUpdateInput): Promise<JournalUpdateOutcome>;
}
```

`create()` uses `$setOnInsert` with `upsert: true`, then reads the document, making retries idempotent. `update()` first attempts one atomic filter on `_id`, `revision`, and `deliveryState: "undelivered"`, using `$set` plus `$inc: { revision: 1 }`. On mismatch it reads the current record: delivered becomes `locked`; a different revision creates or reuses `conflictRecordId` with `conflictOf: id` and returns `conflict`; a missing ID returns `notFound`.

- [ ] **Step 4: Run store tests and the Web suite**

Run: `pnpm.cmd --filter @capture/web exec node --test src/lib/journal-store.test.mts`

Expected: PASS, including an assertion that retrying the same stale mutation does not create a second conflict copy.

Run: `pnpm.cmd --filter @capture/web test`

Expected: PASS.

- [ ] **Step 5: Commit the store**

```powershell
git add apps/web/src/lib/journal-store.ts apps/web/src/lib/journal-store.test.mts
git commit -m "feat(web): persist revision-safe Journal records"
```

### Task 3: Authenticated Journal REST routes

**Files:**
- Create: `apps/web/src/app/api/journal-records/route.ts`
- Create: `apps/web/src/app/api/journal-records/route.test.mts`
- Create: `apps/web/src/app/api/journal-records/[id]/route.ts`
- Create: `apps/web/src/app/api/journal-records/[id]/route.test.mts`
- Modify: `apps/web/src/lib/authorization.ts`
- Modify: `apps/web/src/lib/authorization.test.mts`
- Modify: `apps/web/src/app/api/captures/route.ts`
- Modify: `apps/web/src/app/api/captures/route.test.mts`

**Interfaces:**
- Consumes: `JournalStore` and Task 1 validators.
- Produces: `GET /api/journal-records?date=YYYY-MM-DD`, `POST /api/journal-records`, `PATCH /api/journal-records/{id}`, and reusable `authorizeClientRequest()`.

- [ ] **Step 1: Add failing authorization tests**

Add `authorizeClientRequest(request)` to the shared authorization module: requests with an `Authorization` header use the Desktop bearer-token path; other requests use the Web session path. Move the equivalent policy out of `captures/route.ts` and keep its existing route tests passing.

- [ ] **Step 2: Add failing handler-factory tests**

Test handlers through injected stores and authorizers, matching the current capture-route pattern. Required cases:

- unauthorized request returns `401` before store access;
- malformed JSON returns `400 INVALID_JSON`;
- invalid date/content returns `400 INVALID_JOURNAL_RECORD`;
- repeated `POST` with one ID returns the same record and `201`;
- `GET` returns newest-first records for exactly one date;
- successful `PATCH` returns `200` with `kind: "updated"`;
- stale `PATCH` returns `200` with `kind: "conflict"` and the conflict record;
- delivered update returns `409 RECORD_LOCKED`;
- missing update returns `404 NOT_FOUND`.

- [ ] **Step 3: Verify the route tests fail**

Run: `pnpm.cmd --filter @capture/web exec node --test src/app/api/journal-records/route.test.mts src/app/api/journal-records/[id]/route.test.mts`

Expected: FAIL because the route files do not exist.

- [ ] **Step 4: Implement thin Route Handlers**

Before editing, reread `apps/web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`. Use native `Request`/`Response.json`, and use the existing Next 16 route context shape:

```ts
type RouteContext = { params: Promise<{ id: string }> };
```

Export handler factories for deterministic tests and production exports bound to `journalStore`. Do not cache `GET`; authenticate before parsing input or touching Mongo.

- [ ] **Step 5: Run route, authorization, and full Web tests**

Run: `pnpm.cmd --filter @capture/web test`

Expected: PASS with legacy capture-route assertions unchanged.

- [ ] **Step 6: Commit the routes**

```powershell
git add apps/web/src/lib/authorization.ts apps/web/src/lib/authorization.test.mts apps/web/src/app/api/captures/route.ts apps/web/src/app/api/captures/route.test.mts apps/web/src/app/api/journal-records
git commit -m "feat(web): expose authenticated Journal record API"
```

### Task 4: Pure mobile session and offline queue model

**Files:**
- Create: `apps/web/src/app/journal-session.ts`
- Create: `apps/web/src/app/journal-session.test.mts`

**Interfaces:**
- Consumes: Journal domain types.
- Produces: Taipei date helpers, `JournalLocalState`, reducer-like transition functions, and serialization guards used by `JournalApp`.

- [ ] **Step 1: Write failing time and queue tests**

Use fixed instants around Taipei midnight and the exact 10-minute boundary:

```ts
test("formats the Journal date in Asia/Taipei", () => {
  assert.equal(toTaipeiJournalDate(new Date("2026-08-17T16:30:00Z")), "2026-08-18");
});

test("resumes at 9:59 but rolls over at 10:00", () => {
  assert.equal(decideForegroundAction(nonEmptyDraft(0), 599_999), "resume");
  assert.equal(decideForegroundAction(nonEmptyDraft(0), 600_000), "finish-and-new");
});

test("finishing offline queues the old record and creates an empty active sheet", () => {
  const initial = createLocalState(new Date("2026-08-18T01:00:00Z"), fixedIdFactory());
  const edited = editActiveArea(initial, "event", "trained legs");
  const finished = finishActive(edited, new Date("2026-08-18T01:01:00Z"), fixedIdFactory(3));
  assert.equal(finished.pending.length, 1);
  assert.equal(finished.pending[0]?.editingState, "idle");
  assert.equal(finished.pending[0]?.areas.event, "trained legs");
  assert.equal(hasJournalContent(finished.active.areas), false);
});

test("acknowledging a conflict switches the active id to the conflict copy", () => {
  const initial = editActiveArea(
    createLocalState(new Date("2026-08-18T01:00:00Z"), fixedIdFactory()),
    "question",
    "why?",
  );
  const conflict = serverRecord({
    id: initial.active.conflictRecordId,
    conflictOf: initial.active.id,
    revision: 0,
  });
  const next = applyServerRecord(initial, initial.active.id, conflict);
  assert.equal(next.active.id, conflict.id);
  assert.equal(next.active.revision, 0);
});

test("invalid localStorage JSON falls back to a clean session", () => {
  const state = readLocalState("{broken", new Date("2026-08-18T01:00:00Z"), fixedIdFactory());
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.pending.length, 0);
  assert.equal(hasJournalContent(state.active.areas), false);
});
```

Define `fixedIdFactory(start = 0)` to return deterministic UUIDs from a fixed array, and `serverRecord(overrides)` to return a complete `JournalRecord` fixture. These helpers keep every assertion executable and independent of browser globals.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm.cmd --filter @capture/web exec node --test src/app/journal-session.test.mts`

Expected: FAIL because the session module does not exist.

- [ ] **Step 3: Implement exact session constants and state**

```ts
export const AUTOSAVE_DELAY_MS = 1_500;
export const BACKGROUND_ROLLOVER_MS = 600_000;
export const JOURNAL_LOCAL_STORAGE_KEY = "capture.journal.v1";

export type LocalJournalDraft = JournalCreateInput & {
  revision: number | null;
  editingState: EditingState;
  conflictRecordId: string;
  backgroundedAt: number | null;
};

export type JournalLocalState = {
  schemaVersion: 1;
  deviceId: string;
  active: LocalJournalDraft;
  pending: LocalJournalDraft[];
};
```

Provide `toTaipeiJournalDate(date)`, `shiftJournalDate(date, delta)`, `createLocalState(now, crypto.randomUUID)`, `readLocalState(raw, now, idFactory)`, `editActiveArea(state, key, value)`, `finishActive(state, now, idFactory)`, `markBackgrounded(state, now)`, `decideForegroundAction(draft, now)`, and `applyServerRecord(state, localId, record)` as pure functions. `finishActive` queues only non-empty content and always returns a blank `○`-focused-ready active draft.

- [ ] **Step 4: Run session and full Web tests**

Run: `pnpm.cmd --filter @capture/web exec node --test src/app/journal-session.test.mts`

Expected: PASS.

Run: `pnpm.cmd --filter @capture/web test`

Expected: PASS.

- [ ] **Step 5: Commit the session model**

```powershell
git add apps/web/src/app/journal-session.ts apps/web/src/app/journal-session.test.mts
git commit -m "feat(web): model Journal autosave sessions"
```

### Task 5: Six-area mobile editor with autosave

**Files:**
- Create: `apps/web/src/app/journal-app.tsx`
- Modify: `apps/web/src/app/page.tsx`

**Interfaces:**
- Consumes: Journal API JSON, Task 4 session transitions, `AccountControls`, and `InstallPrompt`.
- Produces: the authenticated mobile Journal editor and its Cloud/local sync loop.

- [ ] **Step 1: Add the editor shell without replacing the page**

Build `JournalApp` with ordered area metadata:

```ts
const AREA_SYMBOLS: Record<JournalAreaKey, string> = {
  unclassified: "○", event: "*", question: "?",
  insight: "!", next: "+", feeling: "~",
};
```

Render six controlled textareas simultaneously. Symbols are visible; semantic names are `aria-label` only. Do not render a submit button, placeholder sentence, character counter, success card, or permanent instructional copy.

- [ ] **Step 2: Implement local-first autosave**

On every edit, synchronously write `JournalLocalState` to localStorage. Reset one `setTimeout` for `AUTOSAVE_DELAY_MS`; first sync uses `POST /api/journal-records`, subsequent sync uses `PATCH` with `expectedRevision` and a stable `conflictRecordId`. Keep failed mutations in `pending`, retry on the browser `online` event, and never clear local content before a server acknowledgement.

Use an `AbortController` per in-flight request so a superseded component instance cannot apply stale responses. Serialize queue draining so two PATCH requests for one record never overlap.

- [ ] **Step 3: Implement completion and 10-minute behavior**

The lower-right new-record icon appears only for non-empty content. Activating it marks the current record `idle`, queues/syncs it, then opens a blank sheet focused in `unclassified`. On `visibilitychange` to hidden, store `backgroundedAt`; on return, resume before 10 minutes and run `finishActive` at or after 10 minutes. On cold mount, preserve any stored non-empty active draft as queued `idle` and show a new blank sheet.

- [ ] **Step 4: Replace the temporary home form**

Modify `page.tsx` to retain the existing authorization/redirect and render:

```tsx
<JournalApp accountEmail={authorization.email} />
```

Do not delete the legacy capture API or `capture-form.tsx` in this milestone; the verified Desktop pipeline still depends on the legacy API.

- [ ] **Step 5: Run static checks**

Run: `pnpm.cmd --filter @capture/web typecheck`

Expected: PASS.

Run: `pnpm.cmd --filter @capture/web lint`

Expected: PASS.

- [ ] **Step 6: Commit the editor behavior**

```powershell
git add apps/web/src/app/journal-app.tsx apps/web/src/app/page.tsx
git commit -m "feat(web): add autosaving mobile Journal editor"
```

### Task 6: Date navigation, record list, editing, and monochrome styling

**Files:**
- Modify: `apps/web/src/app/journal-app.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Consumes: `GET /api/journal-records?date=...` and `PATCH /api/journal-records/{id}`.
- Produces: the approved top toolbar, newest-first edit mode, record editor, theme setting, and responsive phone presentation.

- [ ] **Step 1: Add the top toolbar and date controls**

Use one compact row with settings, previous day, `M.D`, next day, and edit/list icon. Buttons show icons only and have Chinese `aria-label` values. A visually hidden native date input supports arbitrary date selection; plain previous/next actions use `shiftJournalDate()`.

- [ ] **Step 2: Add list mode and record editing**

List mode fetches the selected date, displays records newest-first in a continuous stream with thin dividers, and previews only non-empty raw areas. Selecting an undelivered record opens all six areas; saving remains automatic. Delivered records show only non-empty areas, a subtle lock, and disabled fields. Returning from a record restores the date and selected row.

- [ ] **Step 3: Add minimal settings behavior**

The settings icon opens a compact overlay containing light/dark selection, `AccountControls`, and `InstallPrompt`. Persist the theme in localStorage and apply it with `data-theme` on `document.documentElement`. Do not add accent-color selection in this milestone.

- [ ] **Step 4: Replace the old visual system in `globals.css`**

Implement black/white surfaces, gray dividers, no gradients, no rounded content cards, and a phone-first full-height layout. Use `100dvh`, safe-area padding via `env(safe-area-inset-*)`, visible keyboard focus rings, and a desktop max-width that does not imitate the later Tauri window. Preserve sign-in page selectors or scope Journal CSS beneath `.journalShell` so authentication remains usable.

- [ ] **Step 5: Run automated verification**

Run: `pnpm.cmd --filter @capture/web test`

Expected: PASS.

Run: `pnpm.cmd --filter @capture/web typecheck`

Expected: PASS.

Run: `pnpm.cmd --filter @capture/web lint`

Expected: PASS.

- [ ] **Step 6: Commit the complete Web UI slice**

```powershell
git add apps/web/src/app/journal-app.tsx apps/web/src/app/globals.css
git commit -m "feat(web): add Journal navigation and record editing"
```

### Task 7: End-to-end verification and documentation boundary

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Consumes: the complete Web + Cloud slice.
- Produces: verified documentation and a clean milestone boundary.

- [ ] **Step 1: Run the full relevant automated suite**

Run from repository root:

```powershell
pnpm.cmd --filter @capture/web test
pnpm.cmd --filter @capture/web typecheck
pnpm.cmd --filter @capture/web lint
pnpm.cmd --filter @capture/web build
```

Expected: every command exits `0`; tests report zero failures.

- [ ] **Step 2: Run a local authenticated smoke test**

Start `pnpm.cmd dev`, sign in with the configured allowed account, and verify on a phone-sized browser viewport:

1. all six areas are visible and `○` is focused on a new sheet;
2. typing survives immediate refresh through local storage;
3. one Cloud request occurs about 1.5 seconds after typing stops;
4. the new-record icon completes a non-empty record and opens blank `○`;
5. previous/next and date picker load the correct date;
6. list mode is newest-first and editing does not reorder a record;
7. a simulated stale revision creates a second conflict record instead of overwriting;
8. delivered fixture data opens read-only;
9. a 9:59 background interval resumes and a 10:00 interval rolls to a new sheet;
10. offline edits remain locally visible and upload after the `online` event.

Record which checks were manual; do not describe them as automated coverage.

- [ ] **Step 3: Update architecture and roadmap with verified facts only**

Document the new `journalRecords` collection, optimistic revision/conflict-copy behavior, localStorage queue boundary, and API routes. Mark the Web + Cloud Journal slice complete only if Step 2 passed against local Mongo or a safe development database. Keep Desktop Quick Capture, Full Journal, daily batching, and AI explicitly future.

- [ ] **Step 4: Review the milestone diff**

Run:

```powershell
git diff --check
git status --short
git diff --stat HEAD~6..HEAD
```

Expected: no whitespace errors; only planned Web and documentation files differ; pre-existing Desktop processor work is absent from this branch/worktree.

- [ ] **Step 5: Commit verified documentation**

```powershell
git add docs/architecture.md docs/roadmap.md
git commit -m "docs: record Journal Web and Cloud verification"
```

## Follow-on Plans (not implemented by this plan)

1. Desktop Quick Capture and target shortcut feasibility.
2. Desktop Full Journal list/edit mode and hidden mode rail.
3. Cloud dirty-date batches, 04:00 scheduling, 15-minute retry, and worker status.
4. Deterministic Markdown formatting plus crash-safe Heptabase Journal append.
5. AI classification/organization after the non-AI pipeline is reliable.
