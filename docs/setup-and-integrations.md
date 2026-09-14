# Setup and integrations

This guide connects a personal Capture deployment from Web input to MongoDB and the Windows worker. It also explains which record types currently reach Codex and Heptabase.

## What is connected

| Input | Cloud storage | Processing | Destination |
| --- | --- | --- | --- |
| Legacy generic capture API | MongoDB | Codex CLI or deterministic Markdown | New Heptabase card |
| Journal | MongoDB, revision-safe queue | Deterministic formatter, optional Codex organization | Append to that date's Heptabase Journal |
| English | MongoDB, revision-safe queue and receipts | Optional Codex note generation | AnkiConnect `English_AI` notes and sync |
| Workout / running | MongoDB | Not implemented | No external destination |
| Food | MongoDB | Not implemented | No external destination |

Journal AI and English-to-Anki are implemented but off by default. Enabling them is an explicit external-write decision in Worker Status.

## 1. Install prerequisites

Install the versions listed in the main README: Node.js and pnpm, Rust with the MSVC build tools, WebView2, and optionally Codex CLI and Heptabase Desktop.

From the repository root:

```powershell
pnpm.cmd install --frozen-lockfile
```

## 2. Configure the Web/API

Copy `apps/web/.env.example` to `apps/web/.env.local`. Never commit the resulting file.

- `MONGODB_URI`: a MongoDB Atlas or compatible MongoDB connection string.
- `MONGODB_DB`: a database name dedicated to this environment.
- `BETTER_AUTH_SECRET`: a random secret of at least 32 characters.
- `BETTER_AUTH_URL`: `http://localhost:3000` locally, or the deployed HTTPS origin in production.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: credentials for the Google sign-in application.
- `AUTHORIZED_EMAIL`: the only account allowed into this personal deployment.
- `CAPTURE_DEVICE_TOKEN`: a random value of at least 32 characters, shared only with the Desktop worker.

Set the same variables in the deployment platform. Use separate databases and secrets for development and production when both contain data worth preserving.

Run locally:

```powershell
pnpm.cmd dev
```

Open `http://localhost:3000`, sign in, and create one disposable record to verify the browser-to-API-to-MongoDB path.

## 3. Configure the installed Desktop app

Open Worker Status with `Ctrl + NumLock` (`Ctrl + Pause` is the fallback). Expand **Connection** and enter:

- **Web API URL**: the deployed Web origin, without a trailing slash.
- **Device Token**: exactly the same `CAPTURE_DEVICE_TOKEN` configured on the server.

Choose **Save and test**. Installed settings are stored only for the current Windows user in the app configuration directory. They are secrets and do not belong in the repository.

For Desktop development, copy `apps/desktop/src-tauri/.env.example` to `.env.local` in the same directory and set `CAPTURE_API_BASE_URL` plus the same token.

## 4. Connect Codex CLI

This step is needed only when Worker Status → Processing uses `codex-cli`.

```powershell
npm install -g @openai/codex
codex login
codex login status
```

Leave the model field blank to use the CLI default, or enter a model supported by the signed-in account. The worker invokes Codex with an ephemeral, read-only sandbox and sends captured text over stdin rather than interpolating it into a shell command.

Selecting `none` bypasses AI and creates deterministic Markdown instead.

In Worker Status → **Processing**, enable **Organize Journal with AI** only after `codex login status` succeeds. If Codex fails or returns empty output, the original MongoDB records remain undelivered and retry later; Capture never substitutes missing AI output or deletes the source.

## 5. Connect Heptabase

Install Heptabase Desktop in its standard Windows location. In Heptabase, enable the CLI under **Settings → AI Features → CLI**.

The worker discovers the local executable and CLI script, starts Heptabase when necessary, then either creates a card or reads and appends a Journal date. Heptabase credentials remain local; the Cloud API never receives them.

## 6. Verify the complete Journal path

1. Keep the Desktop worker running and unpaused.
2. Create a Journal capture and complete it.
3. A Journal date becomes eligible after the 04:00 Asia/Taipei boundary once its date is earlier than the active boundary. A capture added later for an older date may therefore be eligible immediately.
4. Open Worker Status and choose **Check now**.
5. Confirm the date moves from pending/processing to no longer queued.
6. Open that date in Heptabase and confirm the new divider and bullet-list record were appended once.
7. Return to Capture and confirm the delivered record is read-only.

If processing fails, the raw MongoDB record remains undelivered and visible in the retry queue. Do not manually duplicate it in Heptabase before deciding how to recover.

## 7. Connect English to Anki

1. Install Anki Desktop. Open **Tools → Add-ons → Get Add-ons**, enter the official [AnkiConnect](https://git.sr.ht/~foosoft/anki-connect) code `2055492159`, and restart Anki. Anki's general add-on workflow is documented in the [Anki Manual](https://docs.ankiweb.net/addons.html).
2. Keep Anki running. AnkiConnect should listen locally at `http://127.0.0.1:8765`; Capture intentionally rejects non-loopback endpoints.
3. Open Worker Status → **Processing**. Keep `English` as the deck or enter another deck, then enable **Send past English notes to Anki** and save. Capture creates the `English_AI` note type when it is missing.
4. Choose **Send Anki test card** to bypass the Cloud queue and date cutoff. This creates one clearly tagged disposable card and syncs it, proving the local Desktop → AnkiConnect → Anki path without changing or locking an English record.
5. With `codex-cli`, every meaningful item in each eligible past daily document becomes a structured `English_AI` note. With `none`, write paragraphs as `front :: back`; a paragraph without `::` becomes a review note without AI rewriting. Capture applies no daily note limit.
6. Choose **Check now**. Capture creates the deck when missing, checks for stable per-date/per-index tags before adding, and asks AnkiConnect to sync.
7. Verify the cards in Anki and confirm the English queue shows zero failed items.

Today's English document is never claimed. After the 04:00 Taipei boundary, older documents become eligible. A failed AI, AnkiConnect, add, or sync call retains the Cloud source and retries after 15 minutes or on **Check now**. External Anki verification remains required because automated tests use the adapter contract without modifying a real collection.

## 8. Keyboard operation

- `Ctrl + Numpad 5`: open Quick Capture.
- `Ctrl + NumLock` or `Ctrl + Pause`: show or hide Worker Status.
- `Ctrl + Left/Right`: move between Capture modules.
- `Up/Down`: move through visible controls; at a multiline text boundary, move to the previous or next field.
- `Left/Right`: move through non-text controls; inside text, keep normal cursor behavior.
- `Enter`: activate, expand, confirm, or complete the current action.
- `Escape`: close the current detail/history layer first, then return to Quick Capture; in Worker Status it hides the window.
- `Tab` / `Shift + Tab`: universal fallback using standard Windows focus order.

Focus movement scrolls the selected control into view. A new workout exercise or food entry opens expanded; existing entries can remain collapsed for scanning.

## 9. Before publishing a fork

- Run `pnpm.cmd lint`, `pnpm.cmd typecheck`, `pnpm.cmd test`, and both builds.
- Confirm `.env.local`, `connection.json`, `node_modules`, `.next`, `dist`, and `target` are untracked.
- Rotate any token that may have appeared in a log, screenshot, commit, or issue.
- State the current single-user, Windows, Codex CLI, and Heptabase limitations clearly.
- Perform one production Journal smoke test before calling the complete delivery path production-verified.

Database stores accept injected persistence collections, the AI provider is selected at runtime, and Heptabase/Anki are isolated destination adapters. MongoDB is the only packaged production database. Supporting PostgreSQL, a hosted AI API, or another destination requires a small adapter and tests; Capture deliberately does not load arbitrary remote plug-ins.
