# Contributing

Capture values fast, quiet capture over feature count. Small fixes and focused recorder pages are welcome.

## Before coding

1. Read [Architecture](docs/architecture.md) for the Web → Cloud → Desktop boundary.
2. For a new workflow, read [Recorder Page Guide](docs/recorder-pages.md) and start with `pnpm.cmd create:recorder -- <id> <label> <symbol>`.
3. Describe the repeated user action being shortened. Prefer one small vertical slice over a general framework.

## Local checks

Install the versions listed in the README, copy both `.env.example` files when integration testing is needed, and never commit the resulting `.env.local` secrets.

Before opening a pull request, run:

```powershell
pnpm.cmd test
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
```

Desktop or device-facing changes also need a short manual test description. Automated checks do not prove that a shortcut, iPhone Home Screen app, Heptabase append, or sleep/resume behavior works on real hardware.

## Pull requests

- Keep one coherent behavior change per pull request.
- Add a regression test for data loss, validation, synchronization, or queue-state fixes.
- Explain what was verified automatically and what still needs manual verification.
- Do not commit generated build output, credentials, personal journal data, or database exports.
- Avoid adding a dependency when a short, readable implementation is sufficient.

Use GitHub's private vulnerability reporting instead of a public issue for security-sensitive findings; see [Security](SECURITY.md).
