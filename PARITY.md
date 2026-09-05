# PARITY.md — feature-parity report

Tested on Windows 10 22H2 (19045), x64, with **Omnigent 0.12.0** (PyPI wheel via
`uv tool install`, and the same release installed inside WSL Ubuntu 26.04 by
Omnigent's Linux installer). Shell vendored from upstream `main@5d323ad`.
"Verified" means driven on this machine through the app (Playwright-Electron or
by hand) and observed; "unit-tested" means covered by `node --test` only.

## Supported (verified)

| Area | Evidence |
|---|---|
| First launch without Omnigent: Connect page, gear dot, guided bootstrap panel (detections, exact commands, Copy, confirm-dialog-gated *Run in PowerShell…*) | screenshots `phase2-bootstrap`, unit tests for the dialog gate and argv |
| CLI discovery after `uv tool install` with no configuration | "Found: omnigent 0.12.0" on the setup page |
| Start locally (native): `server --background`, boot log, SPA loads, `omni server status` agrees | `dev-spa-check`, e2e `win_smoke` |
| Attach to an existing server; stop only what the app started; foreign server asks first | `server_manager` + integration tests; manual: user-started server survived Quit |
| Start locally through **WSL** (`wsl -d Ubuntu --shell-type login -- omnigent …`): server inside the distro, SPA reachable at `127.0.0.1:<port>`, owned server stopped on Quit | `wsl-start` screenshot + `server status` inside the distro |
| Seamless window: no native title bar or menu bar, Windows caption buttons over the page, drag strip, caption clearance; menu on Alt | `phase6-spa` screenshots; `chrome.js` tests |
| Native folder picker button in the workspace picker and path field; path handed to the SPA (`C:/…`, or `/mnt/c/…` in WSL mode) | `phase6-picker` screenshot; IPC gated on pinned origin |
| Tray: Open, New Window, status line, Start/Stop/Restart, Change Server, app/Omnigent update checks, `omni setup`, Settings, Open Log Folder, Quit | `dev-tray-check`; tray menu template tests |
| Close-to-tray with one-time balloon; explicit Quit (menu, Ctrl+Q, tray); quit completes in ~0.3 s | `dev-tray-check` (also fixed an upstream Windows quit hang, see below) |
| Taskbar badge overlay (1–9, 9+) on every window; frame flash | `badge.js` tests; overlay applied on `setBadgeCount` |
| Toast notifications with click → focus/unhide + navigate; notifications toggle | code path verified (upstream) + Windows show/restore hooks |
| Windows Settings window: connection (default server, native/WSL mode, distro, auto-start), application (close-to-tray, start with Windows, notifications, update mode/auto-install), diagnostics (versions, CLI, compatibility, server, paths, copy) | `phase4-settings` screenshot; settings tests |
| Rotating, redacting file log; Open Log Folder | logger tests; cookie/token redaction verified against a real updater error dump |
| Compatibility gate: tested/min versions, one-time notice for untested versions | compat tests; 0.12.0 recognised as tested |
| Omnigent updates: `omni upgrade --check` result dialog; guided `omni upgrade` in a visible console | integration tests (exit-code contract) |
| Multiple windows / multiple servers / deep links / OAuth popups / browser panes / file drag-drop | upstream code paths unchanged; unit tests green (490) — not re-driven by hand on Windows in this pass |
| Real-install e2e (`app/e2e/win_smoke.e2e.js`): Start locally → SPA (bridge `kind: electron`, no Windows IPC exposed to the page) → Settings shows running server + CLI version → Quit exits → owned server stopped | `ok 1` in 17 s |
| Packaged build: `Omnigent-Setup-0.12.0.exe` (NSIS, per-user, choose folder), `Omnigent-0.12.0-portable.exe`, `latest.yml` + blockmap; unpacked app boots as `isPackaged=true`, shows setup, quits | electron-builder 26.15.3 output; `dev-packaged-smoke` |
| Unit suite | 490 tests, 0 failures |

## Partially supported

| Area | State |
|---|---|
| Claude Code / Codex terminal harnesses on a **native Windows host** | Not possible: Omnigent 0.12.0 refuses native terminal harnesses on Windows (`Native terminal harnesses (tmux/PTY) are not supported on Windows`). The SPA's quick-pick harnesses (Claude Code, Codex, OpenCode, …) all take that path, so on native Windows only custom SDK agents (`Create custom agent`, `claude-sdk`/`codex` SDK harnesses) can run. The app explains this in the bootstrap panel and README and recommends WSL. |
| Claude Code inside **WSL** | **Verified** after the user signed in once inside the distro: a Claude Code session on the WSL host asked a question with `AskUserQuestion` and the app rendered it natively ("Claude has questions", Red/Blue/Submit); answering from the app produced Claude's reply. The in-session composer shows the slash menu (`/compact /context /effort /model /help`, filtered as you type; session skills appear there when the harness reports them). On the *landing* composer Omnigent deliberately hides the menu for Claude Code/Codex because those harnesses interpret `/` commands themselves. |
| WSL working-directory paths | The SPA's picker accepts drive paths but the native-Windows host mapped typed paths oddly (`/` ↔ `C:\`) in testing; in WSL mode the app hands `/mnt/<drive>/…` paths. Verify on your distro. |
| Start with Windows | Implemented via login items; only effective in the packaged app (not `electron .`). Verify after installing. |
| Desktop auto-update | Implemented against this project's GitHub Releases; needs a published release to exercise. Unsigned builds trigger SmartScreen. |

## Unsupported

| Area | Reason |
|---|---|
| Terminal panes on a native-Windows host | Omnigent limitation (no tmux/PTY on Windows). Use WSL or a remote host. |
| Filesystem/network sandboxing on native Windows | Omnigent limitation (Job Objects only). |
| Managed preferences (MDM server lists) | macOS-only mechanism upstream; no Windows policy source implemented. |
| Web Speech dictation | Electron has no Google speech backend (same as macOS); server-side dictation works when the server has the extra. |

## Known limitations and findings

- Upstream setup-page IPC gate compared `pathToFileURL()` pathnames (which encode `~` as `%7E`) with the live frame URL (which keeps `~`); the portable build runs from a temp dir under a short 8.3 profile name (`TUGAPL~1`), so every setup IPC was rejected ("CLI not found", Run buttons dead). Fixed by decoding + case-folding both sides (`main.js` `[win]`, `settings_window.js`, `chrome.js`).
- Upstream Windows quit hang: with the update-overlay child window alive, `app.quit()` never completed on Windows (reproduced on the untouched upstream shell). Fixed by destroying the overlay when its parent starts closing (`update_overlay.js` `[win]` hook).
- Upstream CLI discovery had no Windows paths and spawned console windows; fixed (`cli_windows.js`).
- A host daemon started from inside a Claude Code/Codex terminal inherits nested-session env vars and then reports Claude as `needs-auth`; the shell strips them (`cliEnv`).
- `wsl -- cmd` uses a non-login shell without `~/.local/bin`; the WSL backend uses `--shell-type login` (WSL 2.x).
- pnpm 11 `pnpm run` re-verifies deps through a `pnpm` shim; disabled in `pnpm-workspace.yaml` (`verifyDepsBeforeRun: false`).

## Tested versions

- Omnigent 0.12.0 (native Windows and WSL Ubuntu 26.04); shell upstream `5d323ad`; Electron 42.11.1; WSL 2.7.8.

## Recommended next work

1. Sign in to Claude inside the WSL distro and run the manual test list (README) for slash commands, skills, and the question tool; record results here.
2. Upstream candidates: the Windows quit-hang fix, Windows CLI discovery, `windowsHide`, the WSL backend, and a native `pickDirectory` bridge method (so the folder picker no longer depends on SPA test ids).
3. Publish a first GitHub Release to exercise electron-updater end to end; add a code-signing certificate (secrets only, no workflow change).
4. Consider making WSL the default local mode when a distro with Omnigent is detected.
