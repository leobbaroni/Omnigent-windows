# Omnigent for Windows — agent instructions

- Push policy: `origin` is the user's GitHub repo (added 2026-09-05 at the user's request). Commit locally as you go; push to `main` only when the user asks. Never force-push.
- Upstream Omnigent is not kept on disk. `scripts/sync-upstream.mjs` needs a clone of omnigent-ai/omnigent at the commit pinned in `upstream.lock.json` (default `../omnigent-upstream`, or `--upstream <dir>`); clone it when re-vendoring, never edit it, delete it after.
- Windows-owned code lives in `app/src/win/`. Hooks into vendored upstream files are marked with `// [win]`.
- Never install Omnigent or any tool silently on the user's machine from the app; the bootstrap must confirm with a dialog and run visibly.
- Keep `COMPAT.md` in sync with any new CLI command, endpoint, or bridge method the shell starts to depend on.
- Tests: `corepack pnpm --dir app test` (node --test). Build: `corepack pnpm --dir app build:win`.
