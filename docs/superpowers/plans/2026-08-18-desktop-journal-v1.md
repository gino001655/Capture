# Desktop Journal v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an installable Windows Desktop Journal with the approved six-area Quick Capture, Full Journal, Cloud synchronization, and global shortcuts.

**Architecture:** Keep the existing Tauri worker/control window. Add a small pure TypeScript Desktop Journal state module, use Tauri Rust commands as the authenticated transport to the existing Journal REST API, and replace only the capture window UI. Persist the active Desktop draft in the capture WebView's localStorage and debounce Cloud writes.

**Tech Stack:** React 19, TypeScript, Vite, Tauri 2, Rust, reqwest, NSIS

**Spec:** `docs/capture-product-design.md`

## Global Constraints

- Implement only Quick Capture and Full Journal; special recorders remain future work.
- Quick Capture is text-free outside temporary confirmation/error states.
- Use `Ctrl + Numpad 5` for Quick Capture and `Ctrl + NumLock` for Worker Status.
- Reuse the deployed Journal API and saved Desktop bearer token.
- Preserve the existing background worker and Heptabase processing path.

---

### Task 1: Desktop Journal state

**Files:**
- Create: `apps/desktop/src/journal.ts`
- Create: `apps/desktop/src/journal.test.mts`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Produces `JournalAreas`, `DesktopDraft`, `DesktopJournalState`, `createDesktopJournalState()`, `readDesktopJournalState()`, `editDraftArea()`, `finishDraft()`, `hasJournalContent()`, `shiftJournalDate()`.

- [ ] Write tests proving six-area order, durable decoding, edits, finish-to-new-blank behavior, and Taipei date shifting.
- [ ] Run `node --test src/journal.test.mts`; expect failure because the module does not exist.
- [ ] Implement the minimal pure state module and add it to the Desktop test script.
- [ ] Run the focused test; expect pass.

### Task 2: Authenticated Desktop Journal transport

**Files:**
- Create: `apps/desktop/src-tauri/src/journal.rs`
- Modify: `apps/desktop/src-tauri/src/config.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Produces Tauri commands `list_journal_records`, `create_journal_record`, `update_journal_record`, and `delete_journal_record`.
- Each command loads `WorkerConfig`, sends `Authorization: Bearer <device token>`, and returns the existing API JSON contract or a concise error.

- [ ] Write Rust tests for URL construction, bearer header construction, and API error decoding; verify they fail before `journal.rs` exists.
- [ ] Implement typed request/response structures and the four commands using the existing reqwest dependency.
- [ ] Register commands in `lib.rs` and run `cargo test`.

### Task 3: Capture window, shortcuts, and keyboard flow

**Files:**
- Create: `apps/desktop/src/DesktopJournal.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/App.css`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`

**Interfaces:**
- `DesktopJournal` owns `quick | list | record` view state and invokes Task 2 commands.
- Quick Capture writes localStorage synchronously and debounces POST/PATCH by 1500 ms.
- Full Journal lists newest-first records, switches dates, and opens undelivered records for editing.

- [ ] Add focused pure tests for completion/discard keyboard transitions before adding UI behavior.
- [ ] Build the six controlled textareas, two-stage completion/discard prompt, Full Journal list/edit view, and compact monochrome styling.
- [ ] Register `Ctrl+Numpad5` and `Ctrl+NumLock`; emit `open-quick-capture` before showing the capture window.
- [ ] Make the capture window fixed-size and frameless; keep the worker window unchanged.
- [ ] Run Desktop tests and typecheck.

### Task 4: Package and smoke-check

**Files:**
- Modify: `apps/desktop/package.json`
- Generated: `apps/desktop/src-tauri/target/release/bundle/nsis/Personal Capture_0.3.0_x64-setup.exe`

- [ ] Set Desktop/Tauri/Cargo version to `0.3.0`.
- [ ] Run `pnpm --filter @capture/desktop test` and `pnpm --filter @capture/desktop typecheck`.
- [ ] Run `pnpm desktop:build` and confirm the NSIS installer exists.
- [ ] Record installer size, SHA-256, and unsigned SmartScreen limitation.
