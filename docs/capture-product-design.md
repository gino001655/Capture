# Capture Product Design — Journal v1 and Target Direction

Status: Product design approved by the user

Last updated: 2026-09-08

Purpose: Preserve product decisions made during brainstorming. This is not an implementation plan and does not claim that the target behavior is already implemented.

## Status labels

- **Confirmed**: explicitly accepted by the user.
- **Provisional**: proposed and plausible, but not yet approved or verified.
- **Open**: requires a later product or technical decision.

## Existing system (verified by repository documentation)

The current repository already contains a deployed minimum end-to-end path:

```text
Web / iPhone PWA
→ Cloud API on Vercel
→ MongoDB Atlas
→ Windows Tauri worker
→ local Codex CLI
→ Heptabase CLI
→ Cloud completion state
```

The implemented Desktop shortcuts are `Ctrl + Numpad 5` for Quick Capture and `Ctrl + NumLock` (`Ctrl + Pause` fallback) for Worker Status. The sections below preserve the decisions that led to the implementation; they are product history rather than a live completion checklist.

## Product intent

### Confirmed

- The product is a personal capture system, with the phone as the primary capture surface and Desktop as a second fast-entry surface.
- The common path should minimize friction between having a thought and recording it.
- Captures will eventually be collected and written into the Heptabase Journal approximately once per day.
- The completed product includes automatic AI classification and organization before Journal delivery.
- AI organization is deliberately outside the first implementation milestone. The first goal is reliable capture, storage, editing, and deterministic daily transfer; the AI stage is added only after this path is validated.
- Design the whole application direction first, but implement the Journal vertical slice before deeply building special recorders.

## Shared visual language

### Confirmed

- Use a monochrome visual system: black, white, and restrained gray lines or patterns.
- Avoid explanatory UI copy when the interface can be learned through position and repeated use.
- Controls should use compact symbols or icons instead of labels.
- The initial settings scope includes light and dark appearance.

### Provisional / later

- User-selectable theme or accent colors may be added later; it is not required for the first Journal slice.

## Journal record model

### Confirmed

- A normal Journal capture is one top-level record containing six semantic areas, not six independent records.
- The six areas are:

| Symbol | Meaning |
| --- | --- |
| `○` | Unclassified / free capture |
| `*` | Event / thing (`事`) |
| `?` | Question / doubt (`疑`) |
| `!` | Insight (`悟`) |
| `+` | Next action / continuation (`續`) |
| `~` | Feeling (`心`) |

- `○` is important because the user may not want to classify a thought, may be moving too quickly, or may prefer typing a prefix such as `+: xxx` directly.
- Empty areas remain part of the same conceptual sheet but do not need generated content.

## Mobile Journal experience

### Confirmed

- Opening the app defaults to a new or resumable Journal capture sheet; this is the most common flow.
- The center of the screen presents six seamless writing areas (`○ * ? ! + ~`) at once. The user does not switch among six separate category pages.
- There is no submit button. Editing feels like a notes app and saves automatically.
- The top controls remain on one compact row: settings, compact date such as `8.18` (also a date picker), and records/new action.
- Horizontal swipe moves across nearby dates with a short transition; the date picker supports arbitrary dates. No duplicate edge or toolbar arrows are shown.
- The edit control replaces the center editor with a scrollable list of that day's records. Selecting a record opens its six areas for editing.
- When the current sheet contains content, a small new-record button appears at the lower right. Activating it completes the current record and opens a blank six-area sheet.
- Closing or backgrounding the app for less than 10 minutes resumes the same sheet.
- The 10-minute timer starts when the app enters the background.
- Returning after 10 minutes preserves the previous non-empty sheet as a record and opens a new blank sheet.
- A cold relaunch opens a new blank sheet; empty abandoned sheets are discarded.
- A fixed bottom icon-only rail switches among Journal and special recorders.
- The bottom rail supports horizontal expansion with previous / next controls when more special recorders are added.

## Desktop application surfaces

### Confirmed: two global entry points

- `Ctrl + Numpad 5` is the target shortcut for Quick Capture.
- `Ctrl + NumLock` is the target shortcut for the main control window.
- The main control window contains Worker settings, manual check actions, status, and related operational controls.
- Dedicated global shortcuts for every special recorder are no longer required. Special recorders are reached from Quick Capture with internal keyboard navigation.

### Confirmed: fixed Capture window

- Quick Capture and the other capture modes share one fixed-size, portrait, sticky-note-like window.
- The window does not expand or shrink when changing modes.
- Visual direction A was selected: compact portrait proportions and information density. The `300 × 430` browser mockup was a visual scale, not a final physical pixel requirement.
- The Capture window is frameless and omits a title bar, date, navigation bar, explanatory labels, and visible mode-navigation controls in Quick Capture.
- Switching modes replaces only the interior layout. Window dimensions and position remain stable.
- Each mode's own content structure is enough to indicate the mode; no page name, page dots, arrows, or other mode indicator is added.
- Desktop Quick Capture and Full Journal operate on the same Journal data, but they are not the same editor with different chrome.
- Quick Capture is the focused six-area editor for one active record. Full Journal opens directly as a day-based list containing many records.
- Moving from Quick Capture to Full Journal does not by itself complete, copy, or replace the active Quick Capture record.
- Desktop Full Journal does not reproduce the phone's bottom special-recorder rail. Its additional visible chrome is limited to the compact settings, date, and record-list controls; special modes remain keyboard-driven through `Ctrl + Left / Right`.

### Confirmed: hidden horizontal mode rail

The capture modes form a bounded, bidirectional rail:

```text
Full Journal ↔ Quick Capture ↔ English ↔ Workout ↔ Food ↔ Future modes
```

- `Ctrl + Left Arrow` moves one page left.
- `Ctrl + Right Arrow` moves one page right.
- Navigation stops at the first and last pages; it does not wrap.
- These keys change pages only while the Capture window is focused. Other applications retain their normal shortcuts.
- Each special recorder retains its own independent active record.
- Switching views or modes never submits an active record or creates an empty record. The explicit Quick-Capture discard confirmation is the only currently confirmed exception that may delete an active record while navigating.
- `Ctrl + Numpad 5` should bring the user directly to Quick Capture even if the Capture window is already open on another page.
- `Ctrl + NumLock` should bring the user directly to the separate main control window.

### Confirmed: Quick Capture keyboard behavior

- Quick Capture shows only the six Journal areas.
- Up / Down uses boundary-aware navigation:
  - inside multiline text, the keys move the caret normally;
  - pressing Up at the first visual line moves to the previous area;
  - pressing Down at the last visual line moves to the next area.
- With any content, the first `Enter` enters a completion-confirmation state; it does not complete the record yet.
- In that confirmation state, a second `Enter` confirms completion and saves the record, while the Capture window remains open and immediately presents a new blank Quick Capture sheet.
- In that confirmation state, `Escape` cancels completion and returns to the Quick Capture editor with its content intact.
- `Enter` while every area is blank hides the window without creating a record.
- `Shift + Enter` inserts a newline.
- When every area is blank, `Escape` hides the window immediately without creating a record.
- When every area is blank, `Ctrl + Left Arrow` enters Full Journal and `Ctrl + Right Arrow` enters the adjacent special recorder immediately, without creating a record.
- When Quick Capture contains content, pressing `Escape` opens a discard-and-hide confirmation instead of hiding immediately.
- When Quick Capture contains content, pressing `Ctrl + Left Arrow` opens a discard-and-enter-Full-Journal confirmation instead of navigating immediately.
- When Quick Capture contains content, pressing `Ctrl + Right Arrow` likewise opens a discard-and-enter-the-adjacent-special-recorder confirmation instead of navigating immediately.
- In a discard confirmation, arrow keys may change the selected option, `Escape` cancels and returns to the editor, and `Enter` activates the selected option.
- Confirming discard removes the entire undelivered Quick Capture record, including its locally autosaved and cloud-synchronized draft state. It cannot affect Heptabase because the record has not been delivered.
- After confirming `Escape`, the Capture window hides. After confirming either `Ctrl + Arrow` navigation, Capture discards the Quick Capture record and continues to the requested adjacent mode.
- The normal Quick Capture editor remains text-free. Only a temporary confirmation state may show microcopy.
- A confirmation lightly quiets the six-area editor and presents a small centered two-option prompt rather than opening a conventional large dialog.
- Completion shows `完成？` with `取消 / 完成`; `完成` is initially selected so the second consecutive `Enter` confirms it.
- `完成` means ending the current writing session and changing that record from `active` to undelivered `idle`. It does not claim that Heptabase delivery has already happened.
- After completion, Quick Capture remains visible and resets to a blank six-area sheet ready for the next record. The blank sheet is only an editor state and does not become a record until content is entered.
- Each new blank Quick Capture sheet focuses the top `○` unclassified area, regardless of which area was active in the completed record.
- While the completion confirmation is visible, typing any printable character automatically cancels the confirmation and inserts that character into the field that previously had focus. The keystroke is not lost.
- Discard shows `不保存？` with `取消 / 離開`; `離開` is initially selected so `Enter` confirms the requested exit or navigation.
- While the discard confirmation is visible, typing any printable character automatically cancels the confirmation and inserts that character into the field that previously had focus. The keystroke is not lost.
- The selected option uses only a restrained monochrome underline or inversion. There is no warning color.
- `Ctrl + N` is not part of Quick Capture. There should be only one completion interaction rather than a second shortcut with different post-completion behavior.

### Confirmed: Full Journal keyboard behavior

- Entering Full Journal opens the selected day's multi-record list immediately; there is no extra landing page or initial six-area editor.
- Multiple records are visible at once in the fixed portrait window.
- The list uses a continuous, cardless stream. Thin gray dividers separate records; there are no rounded card containers.
- The selected row is indicated only by a restrained background change and/or a thin edge line.
- Each row previews its raw non-empty Journal areas with their symbols rather than generating an AI summary.
- Each record row has a stable compact height and shows at most approximately 3–4 preview lines.
- Overflow is truncated with an ellipsis. Moving the selection never expands a row or shifts surrounding records; `Enter` opens the full record.
- The list is ordered by record creation time descending, with newly created records above older records.
- Editing an undelivered record does not change its position; only creating a new record places a new row at the top.
- When moving from Quick Capture into Full Journal, a non-empty active Quick Capture record appears at the top of its assigned day's list, remains `active`, and is selected by default.
- An empty active Quick Capture record does not appear in the Full Journal list and does not occupy a placeholder row.
- While the list has focus, Left / Right moves one Journal date backward or forward.
- While the list has focus, Up / Down changes the selected record.
- In the Full Journal list (`edit mode`), `Enter` opens the selected record. An undelivered record opens for editing; a delivered record opens read-only.
- An opened undelivered record shows all six Journal areas, including empty areas, so content can be added anywhere.
- An opened delivered record omits empty areas and shows only its non-empty content, together with the subtle locked state.
- Inside an opened undelivered record, `Enter` inserts a normal newline; it does not complete the record or close the window.
- Inside an opened record, arrow keys return to normal text-caret behavior.
- For an opened undelivered record, `Escape` saves the latest local state, queues the normal cloud sync, changes it from `active` back to `idle`, and returns to the same date and list selection.
- For an opened delivered read-only record, `Escape` simply returns to the same date and list selection; there is nothing to save.
- These keys are context-specific: only Quick Capture uses two confirmation-stage `Enter` presses to complete and save the current record and immediately begin a blank next sheet (`Shift + Enter` still inserts a newline there).
- While the Full Journal list itself has focus, `Escape` hides the Capture window.
- Losing focus through `Alt + Tab` does not trigger navigation, completion, or closing; the current Full Journal date and selection remain in memory while the window stays open.
- Invoking `Ctrl + Numpad 5` again always brings the Capture window back at Quick Capture rather than restoring Full Journal as its entry page.

### Provisional

- Exact window dimensions, monitor placement, DPI scaling, focus restoration, and show/hide animation remain implementation-time UX checks.

## Special recorders

### Confirmed product direction

- Special recorders are not merely Journal tags. Each may adapt its layout and interaction model to the activity being recorded.
- All Desktop special recorders must fit the same fixed Capture window used by Quick Capture.
- Phone special recorders use the shared bottom rail; Desktop uses the hidden horizontal rail.

### Shared special-recorder lifecycle — Confirmed

- Mobile uses one horizontally extensible bottom rail in the order `Journal / English / Workout / Food`; Quick Capture is an entry mode rather than a bottom-rail item.
- Desktop uses the fixed Capture window and `Ctrl + Left / Right` rail. Mobile and Desktop share data and lifecycle rules but may optimize their layouts separately.
- Special recorders save locally on every edit and synchronize after a short delay. Switching recorder or closing never asks for confirmation.
- Only a non-empty Quick Capture asks `不保存就離開？` before entering a special recorder.
- Special records use a versioned `specialRecords` Cloud collection. Every module owns its payload while sharing module ID, Journal date, revision, timestamps, lock state, and processing state.
- English and Food have at most one document per date. Workout can contain multiple sessions per date.
- Empty English days are not persisted.
- Only Journal writes to the Heptabase Journal. Destinations and processors for special recorders are separate later decisions.
- Future open-source modules should be discoverable through a small registry and contribute their own payload/schema and Mobile/Desktop page rather than requiring edits throughout the application.

### English — Confirmed

- English is the first special-recorder vertical slice.
- It is one plain-text memo document per Taipei calendar date, without Journal's six semantic areas, submit controls, or completion action.
- Opening English goes directly to today, focuses the editor, and opens the phone keyboard.
- While the phone keyboard is visible, the bottom module rail hides.
- Today is editable. Earlier dates use the same page in read-only form with a subtle lock mark; future dates cannot be selected.
- At Taipei midnight, the old document locks and a blank current-day editor opens. Edits made offline before midnight remain eligible for delayed synchronization after midnight.
- A compact date/history entry will show only dates containing text and a short preview. Full-text search is deferred but must remain possible.
- There is no delete-document or clear-document command. The current day's text can be edited or erased normally; erasing all content removes the empty Cloud document.
- The Desktop worker will eventually forward locked, unprocessed English documents to an Anki-card workflow. AI organization, export, and Anki synchronization are later milestones.
- No user-facing version history or device-provenance interface is required.

### Workout — Confirmed; core implemented

- A date can contain multiple optional-name sessions. Entry continues today's open session when one exists; otherwise it offers recent sessions/actions and a blank session.
- Recent exercises appear first. The exercise library supports create, rename, sort, and archive; an unused exercise may be deleted, while an exercise referenced by history may only be renamed or archived.
- Each weight-training exercise contains repeated sets with weight, repetitions, optional RPE, optional RIR, set type (working, warm-up, drop, or failure), and an optional short set note. Exercises and sessions also have free-text notes.
- Opening an exercise presents the previous complete workout as gray ghost sets. One tap or Enter confirms an unchanged set; typing edits it first. Confirmation turns it final, starts the rest timer, and advances to the next set. After the copied sets, `+` clones the last confirmed set.
- The compact rest timer starts after set confirmation, survives navigation, and supports pause/resume plus reset/skip. OS notifications are not required initially.
- History initially shows the last complete record, recent weight/repetition trend, maximum weight, estimated 1RM, and recent notes. The initial PR indicators are highest weight and highest estimated 1RM.
- Bodyweight and assisted movements use the ordinary weight × repetitions structure. Superset/circuit grouping is reserved in the payload but not implemented initially.
- Running is a workout exercise type. It supports manual total distance and duration, derived average pace, optional average/maximum heart rate, temperature, elevation gain, RPE, notes, and optional distance/duration segments with derived pace. GPS and COROS import are deferred.
- English, Workout, and Food permit edits only on the current Taipei date. Earlier dates remain available as read-only history; future dates cannot be selected.

### Food — Confirmed; core implemented

- Food is one autosaved daily record containing a flat chronological list rather than meal groups.
- The header shows calorie and protein totals against configurable daily targets.
- An entry contains food name, serving quantity, unit, calories, and protein. Carbohydrate and fat are deferred.
- Recent foods appear first. Choosing one loads its previous serving and nutrition for one-tap confirmation or quantity editing.
- Its food library follows the exercise-library rules: unused items can be deleted; historically referenced items can be renamed or archived.

## Draft and record lifecycle

### Confirmed

- There is no general-purpose submit button in the mobile Journal experience.
- Switching pages or modes does not complete a record.
- Switching between Quick Capture, Full Journal, and special recorders does not implicitly finalize an active record; each record retains its state while navigating the rail.
- Empty drafts do not become records.
- Desktop Quick Capture completes a non-empty record only after two consecutive confirmation-stage `Enter` presses; `Escape` after the first press cancels completion.
- Mobile Journal completes the current record when the new-record control is used or when the 10-minute background rule creates a new session.
- Draft changes are saved to the current device immediately.
- After input has been idle for approximately 1–2 seconds, the draft synchronizes to the Cloud.
- While offline, changes remain in a local pending queue and are uploaded after connectivity returns.
- Active drafts are device-specific. A phone draft and a Desktop draft do not become one shared live editing session.
- Completed records from every device synchronize into the shared record list for their assigned day.
- Cloud records carry a revision so a stale device cannot silently overwrite a newer edit to the same undelivered record.
- When a stale edit reaches the Cloud, the newer Cloud version remains unchanged and the stale device's content is preserved as a separate undelivered conflict copy. Both records appear in the day's list for later review; data is favored over automatic merging or last-write-wins deletion.
- Record state has two independent dimensions:
  - delivery is either `undelivered` or `delivered`;
  - editing is either `active` or `idle`.
- `undelivered + active` is a record currently being written; `undelivered + idle` is a pending record; `delivered + idle` is a locked record.
- Opening a pending record for editing changes only its editing state to `active`. It keeps the same record ID and does not create a new record.
- Intentionally leaving that editor returns the same undelivered record to `idle` immediately, making it pending again.
- If the App or Capture window moves to the background while editing, the record returns to `idle` after 10 minutes.
- As long as the editor remains in the foreground, the record stays `active` even during a typing pause; thinking time is not treated as completion.
- A delivered record can never enter the active editing state in Capture.
- A record remains editable in Capture only until it has been written successfully to Heptabase.
- After successful Heptabase delivery, the Capture copy is immutable: it cannot be edited or deleted through Capture.
- If the user wants to change delivered content, the change is made directly in Heptabase. Capture does not synchronize that edit back and does not later overwrite it.
- Delivered records remain visible in Capture's daily record list as read-only content.
- A subtle lock or completion symbol distinguishes delivered records without adding explanatory text to the normal interface.

- Local data is retained until the Cloud acknowledges it.
- Each special recorder still requires its own completion boundary; merely visiting a page never creates a record.

## Daily Heptabase flow

### Confirmed

- Captures should be collected during the day and written into Heptabase approximately once per day.
- The user should not need to manually copy, paste, submit, and wait for each capture.
- AI organization is not part of the first version of this daily flow.
- The daily cutoff is 04:00 in the Asia/Taipei timezone.
- The Cloud owns a set of Journal dates with changes that have not yet been successfully written to Heptabase.
- Creating a record, or editing a record that has not yet been delivered, marks that record's assigned Journal date as pending, even if the date was processed previously.
- At the cutoff, the Desktop worker processes every pending Journal date, rather than assuming that only the previous calendar day needs work.
- Example: if records assigned to both 8.17 and 8.19 change on 8.19, the next run updates both the 8.17 and 8.19 Heptabase Journals.
- Within each pending date, only records that have not yet been delivered are appended. Previously delivered content is never rewritten by Capture.
- Each record is marked delivered only after its append operation succeeds; delivered records are then locked in Capture.
- The 04:00 batch considers only `undelivered + idle` records. A record actively being edited is not claimed by the batch.
- A date is removed from the pending set only after its Heptabase update succeeds.
- If the Desktop worker is unavailable at 04:00, all pending dates remain in the Cloud and run after the worker next starts or regains connectivity.
- When the Desktop worker is online and a Heptabase update fails, it retries pending work approximately every 15 minutes.
- The main control window shows pending and failed work and provides a manual retry action. Unattended failure does not open a disruptive Capture dialog.
- Records appear newest-first inside Capture, but each Heptabase append orders newly delivered records from oldest to newest so the Journal reads chronologically.

### Confirmed: deterministic Markdown format for the first version

- The screenshot supplied on 2026-08-18 is a layout reference, not a source of runtime instructions.
- Each top-level Capture record is separated from the next record by a Markdown horizontal divider (`---`).
- Inside a record, every non-empty semantic area is a first-level Bullet List item.
- A single paragraph may remain on the same bullet as its area label, for example `- 事：...`.
- When an area contains multiple details, the area label becomes the parent bullet and the details become a more deeply nested Bullet List.
- User-entered list nesting is preserved rather than flattened.
- `* / ? / ! / + / ~` are rendered as `事 / 疑 / 悟 / 續 / 心`. The `○` unclassified area is rendered as an ordinary unlabeled bullet so the pipeline does not invent a category.
- The non-AI first version does not generate a title, add `解`, classify content, rewrite prose, or infer new sub-items. It performs only deterministic structural formatting.

Example shape:

```markdown
- 事：一段簡單內容。
- 悟：
  - 第一個細項。
  - 第二個細項。

---

- 一段未分類的原始內容。
```

### Open

- Crash-safe idempotency for the narrow case where Heptabase accepted an append but the worker stopped before recording success. This is a technical design problem; it must not be solved by risking duplicate Journal content.

## Target AI organization after the first version

### Confirmed direction

- The completed product automatically classifies and organizes captured content before the daily Heptabase append; it does not require the user to copy each record into GPT and wait for it manually.
- Raw Capture records remain the source data. AI-produced Markdown is derived delivery content, so an AI transformation cannot erase the original capture.
- The target output keeps the approved divider and nested Bullet List structure and may apply the richer classification behavior illustrated by the supplied `journal(1).md` reference.
- The manual per-record classification confirmation required by the old GPT workflow is not carried into the automated product flow; eliminating that repeated interaction is part of the product's purpose.
- Exact model selection, prompt design, classification review controls, and AI-failure fallback belong to a later AI milestone. They do not block the first Journal vertical slice.

## Shortcut feasibility notes

### Observed / verified during brainstorming

- `Alt + number` combinations collided with existing behavior on the user's actual machine and were rejected.
- The machine is an Acer Nitro AN515-58.
- Arbitrary `Fn + key` shortcuts are not a reliable application-level option: the Fn layer is typically handled by keyboard firmware and is not exposed as a normal modifier to the current Windows / Tauri shortcut stack.
- The dedicated NitroSense key was considered but not selected because remapping it may interfere with Acer's fan and performance controls.

### Historical verification checklist

- Confirm that `Ctrl + Numpad 5` can be registered without collision.
- Confirm behavior with NumLock both on and off; Windows may expose the physical Numpad 5 key differently when NumLock is off.
- Confirm that `Ctrl + NumLock` can be registered and does not undesirably toggle NumLock state.
- Confirm that replacing `Ctrl + Left / Right` word navigation inside the Capture window feels acceptable in real use.
- Retain a fallback shortcut if either target global shortcut is unavailable.

## Implementation order

### Confirmed direction

1. Preserve the current working end-to-end system.
2. Implement the Journal vertical slice across the existing Web / Cloud / Desktop boundaries.
3. Validate real phone and Desktop capture behavior.
4. Add a simple, reliable daily Heptabase transfer without AI organization.
5. The first version stops at the Journal vertical slice: mobile Journal, Desktop Quick Capture, Desktop Full Journal, Cloud synchronization, and daily Heptabase delivery.
6. English, Workout, Food, and future special recorders are designed and implemented incrementally only after the Journal slice is validated.

## Remaining follow-up work

No unresolved user-facing decision currently blocks the approved first Journal design. Remaining work is either technical verification or a later milestone:

1. Design crash-safe, duplicate-resistant Heptabase append recovery.
2. Run a non-persistent shortcut feasibility test on the Acer machine.
3. Validate exact window size, placement, focus restoration, and keyboard feel on the real Desktop.
4. Design each special recorder as a separate later milestone.

## Non-goals for the first Journal implementation milestone

- AI rewriting, classification, or summarization in the first implementation milestone. This remains part of the completed product direction.
- Building every special recorder before validating the Journal slice.
- Adding new infrastructure merely to anticipate future scale.
- Replacing the current verified end-to-end pipeline before a new vertical slice requires a change.
