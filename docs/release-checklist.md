# Release checklist

Capture publishes only source and a Windows installer. Personal data, local settings, and build directories stay outside Git.

## Before the release commit

1. Run `pnpm.cmd install --frozen-lockfile`.
2. Run `pnpm.cmd lint`, `pnpm.cmd typecheck`, `pnpm.cmd test`, and `pnpm.cmd build`.
3. Run `pnpm.cmd desktop:build` and install the generated NSIS package on Windows.
4. Manually verify Quick Capture, every recorder's keyboard navigation, a long scrolling Food/Workout page, and a historical workout session.
5. With disposable content, verify Journal → optional Codex → Heptabase and English → optional Codex → AnkiConnect.
6. If enabled, verify one explicit `續` append, one Windows test notification, and one installed-iPhone Web Push subscription.
7. Confirm `git status --short` contains no `.env.local`, `connection.json`, journal exports, database backups, `.next`, `dist`, or `target` files.
8. Review the complete staged diff and confirm `.superpowers/` is not staged.

## GitHub release

1. Commit one coherent release candidate after manual verification.
2. Push only with explicit approval.
3. Tag the verified commit with the current pre-1.0 version rather than tagging an untested working tree. Reserve `v1.0.0` for the later public release.
4. Start from the matching file in `docs/releases/`, then update its manual evidence before publishing.
5. Attach the matching `Personal Capture_<version>_x64-setup.exe` and its SHA-256 checksum.

The installer is currently unsigned, so Windows may show a reputation warning. Code signing is useful only when distribution grows enough to justify a protected signing identity and recurring cost.
