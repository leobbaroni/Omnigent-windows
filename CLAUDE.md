# Omnigent for Windows — agent instructions

- Push policy: local commits only; no remote configured. Do not add remotes or push.
- Upstream Omnigent is read-only at `../omnigent-upstream` (pinned in `upstream.lock.json`). Never edit it.
- Windows-owned code lives in `app/src/win/`. Hooks into vendored upstream files are marked with `// [win]`.
- Never install Omnigent or any tool silently on the user's machine from the app; the bootstrap must confirm with a dialog and run visibly.
- Keep `COMPAT.md` in sync with any new CLI command, endpoint, or bridge method the shell starts to depend on.
- Tests: `corepack pnpm --dir app test` (node --test). Build: `corepack pnpm --dir app build:win`.
