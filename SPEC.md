# SPEC.md — Omnigent for Windows

## Goal

A production-quality Windows desktop application that delivers the full
Omnigent experience: it manages (or attaches to) a local Omnigent server,
connects to remote servers, supports multiple windows and servers, integrates
natively with Windows (tray, toasts, taskbar badge, startup), keeps both the
shell and the Omnigent installation up to date, and, when Omnigent is not
installed, guides the user through installation **without ever installing
anything silently**.

Success criteria (all must hold):

1. On a machine without Omnigent, the app launches, detects the missing CLI and
   prerequisites, and shows a bootstrap experience with exact commands; nothing
   is installed unless the user explicitly confirms a dialog that shows the
   exact command, and the install then runs in a visible console window.
2. With Omnigent installed (`uv tool install omnigent`), "Start locally" starts
   or reuses the managed server, shows progress, and opens the SPA.
3. Multiple windows on multiple servers work; closing a window never quits the
   app while the tray is enabled; Quit stops only what the app started.
4. Notifications, badge, tray, start-with-Windows, deep links and updates work
   on Windows 10/11.
5. `COMPAT.md`, `ARCHITECTURE.md`, `README.md`, CI, installer + portable build,
   unit tests, and a feature-parity report exist.

## Scope

In scope: a Windows-hardened build of the upstream Electron shell
(`web/electron` at the pinned upstream commit), Windows-owned modules, packaging,
CI, docs, tests.

Non-goals:
- Changing Omnigent server/web code (no upstream change was found to be required).
- macOS/Linux builds (upstream owns those).
- Procuring a code-signing certificate (hooks are wired; signing is opt-in via env).
- Re-implementing any Omnigent feature in the shell.
- Replacing the embedded browser pane, OAuth policy or updater with new designs.

## Requirements (numbered, testable)

### CLI discovery and bootstrap
- R1. Discover the CLI on Windows: configured path, then PATH (`where`), then
  `%USERPROFILE%\.local\bin\{omnigent,omni}.exe`, then `uv tool dir --bin`,
  then an optional WSL distro. Done when: unit tests cover each source with
  fakes and a real `uv tool install` is detected without configuration.
- R2. Every CLI spawn uses `windowsHide: true` and a UTF-8 environment
  (`PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`). Done when: no console window
  appears during status polling and the `✓ Connected` marker is parsed.
- R3. Bootstrap panel (setup page, Windows only) shows: CLI status, Python 3.12+,
  uv, Node 22+, WSL distros; exact commands with Copy; "Open install docs";
  "Re-detect"; "Install with uv…" buttons that open a native confirmation
  dialog listing the exact command, then run it in a visible PowerShell
  window. Nothing runs without the dialog. Done when: a test asserts the dialog
  gate and the spawned argv; manual run on this machine.
- R4. Bootstrap explains native-Windows Omnigent limitations (no PTY terminals,
  no sandbox) and offers the WSL/remote alternatives.

### Server lifecycle
- R5. Start / Stop / Restart / Status / Reconnect / Change server / Open logs
  available from the tray menu and the Server menu; states shown: stopped,
  starting, running, unhealthy, restarting, unavailable, remote, WSL, local-managed.
- R6. Attach to an existing healthy managed server instead of spawning; stop on
  quit only if owned (upstream rule preserved). Done when: `server_manager`
  tests pass and a manual test shows a user-started server survives Quit.
- R7. Unexpected termination of the owned server is detected (a 30 s heartbeat
  only while a managed server is owned) and surfaced with a Restart action.

### WSL (optional backend)
- R8. Settings: local mode `native | wsl`, WSL distro. When `wsl`, every CLI
  invocation runs `wsl.exe -d <distro> -- omnigent …`; status/health are read
  via `server status --json` (no pidfile access). Done when: unit tests for
  command construction pass; manual test only if a distro with Omnigent exists
  (this machine has only docker-desktop, so it is documented as untested).

### Native Windows integration
- R9. Tray icon with menu: Open Omnigent, New Window, server status line,
  Start/Stop/Restart local server, Check for updates, Settings, Open logs, Quit.
- R10. Close-to-tray setting (default on). First close shows a one-time toast
  "Omnigent keeps running in the tray". `window-all-closed` does not quit while
  close-to-tray is on. Quit is explicit.
- R11. Start with Windows setting (`setLoginItemSettings`, launches hidden to tray).
- R12. Badge: taskbar overlay icon with the unread count (1–9, 9+), cleared at 0;
  plus `flashFrame` when a notification fires and the window is not focused.
- R13. Toast notifications (existing) verified on Windows; clicking restores a
  hidden or minimized window and navigates. Notification enable/disable setting.
- R14. Deep links `omnigent://…` handled via `second-instance` argv on Windows.

### Updates and compatibility
- R15. Shell updates via electron-updater against the project's own GitHub
  Releases feed; modes none/manual/start/default preserved; unsigned build
  documented.
- R16. Omnigent updates: "Check for Omnigent updates" (`omni upgrade --check`)
  and "Update Omnigent…" (confirm dialog, then a visible console running `omni upgrade`).
- R17. Compatibility gate: on CLI detection compare the version with the
  supported range in `app/src/win/compat.js` (min 0.7.0; tested list); warn once
  per version when untested or newer, never disable features. Server manifest
  (`/.well-known/omnigent.json`) `min_desktop_version` respected.

### Settings, diagnostics, logging
- R18. Windows settings page (shell-owned, bundled): connection (default server,
  local mode, distro, auto-start local server), application (close-to-tray,
  start with Windows, notifications, update mode), diagnostics (versions,
  server status, log/settings paths, Open log folder, Copy diagnostics).
  Persisted in `settings.json` (existing file, new keys only).
- R19. Rotating file logger (`%APPDATA%\Omnigent\logs\omnigent-desktop.log`,
  5 × 2 MB) that captures main-process console output, uncaught errors,
  lifecycle, and command invocations (argv only); never tokens or secrets.

### Packaging, CI, docs, tests
- R20. NSIS installer (assisted, per-user default, choose directory, desktop
  shortcut optional) + portable `.exe`; icon; version metadata; `latest.yml`.
  Signing via env if provided.
- R21. GitHub Actions: build + unit tests on push/PR; release artifacts +
  update metadata on `v*` tags.
- R22. Docs: README (install, first launch, local/WSL/remote, multi-window,
  tray, notifications, updates, troubleshooting, dev, build, release, manual
  test procedures), COMPAT (audit + matrix), ARCHITECTURE.
- R23. Tests: `node --test` for all new Windows modules; upstream tests still
  pass; Playwright-Electron smoke against a real local server (skips when
  Omnigent is absent).
- R24. Final feature-parity report (supported / partial / unsupported / known
  limitations / tested version / next work).

## Key decisions (with provenance)

- D1. Electron, vendoring upstream `web/electron` (verified: repo audit,
  ADR-0001). Tauri would require re-implementing the WebContentsView browser
  pane, OAuth popup hardening, and the updater; the SPA bridge expects `kind: "electron"`.
- D2. Windows-owned code lives under `app/src/win/` and is wired into upstream
  files through minimal, marked hooks (`// [win]` comments) so upstream syncs
  are mechanical (decision).
- D3. Never install Omnigent silently (user).
- D4. Upstream pin `main@5d323ad`; test server `0.12.0` from PyPI
  [assumed: the shell on main declares 0.12.0 and the manifest contract is tolerant;
  if wrong: pin to the `v0.12.0` tag instead].
- D5. Same `appId` (`ai.omnigent.desktop`) and `userData` dir as upstream so an
  official Windows build and this one share settings [assumed; if wrong:
  change `appId`/`productName` in `app/package.json`].
- D6. Own update feed (GitHub Releases `provider: github`) (verified: this
  project cannot publish to omnigent.ai).
- D7. Push policy: local commits only, no remote [assumed: no remote exists;
  if wrong: the user adds a remote and pushes].
- D8. Installing Omnigent for Phase 6 testing via `uv tool install` is allowed
  and reversible (`uv tool uninstall omnigent`) (user: "you can install it at any time").

## Data / interface changes

- `settings.json` new keys: `win_close_to_tray`, `win_start_with_windows`,
  `win_notifications_enabled`, `win_local_mode` (`native|wsl`), `win_wsl_distro`,
  `win_auto_start_local`, `win_compat_warned_versions`.
- No new methods are exposed to the SPA (the SPA must stay platform-neutral).
  Windows features are shell-owned UI (tray, settings page, bootstrap panel)
  with IPC limited to bundled pages.

## Edge cases

- CLI found but not Omnigent (`--version` does not match `/\bomni/`): treated as not installed.
- Stale pidfile or dead pid: not reused (upstream behaviour).
- WSL selected but the distro is missing: clear error, offer native/remote.
- Tray unavailable: fall back to quit-on-last-window with a warning in the log.
- Update feed unreachable: silent in default mode, error shown only on a manual check.
- Portable build: updates disabled (electron-updater cannot replace a portable exe); shown in About.

## Spec corrections

- 2026-09-05 (user): the window must look seamless (no native title bar or
  menu bar). Implemented with Window Controls Overlay + injected drag CSS
  (`app/src/win/chrome.js`); menu bar stays reachable with Alt.
- 2026-09-05 (user): a native Windows folder dialog must set the working
  directory. Implemented as a preload enhancement on the SPA's workspace
  picker (`omnigent:win-pick-directory`).
- 2026-09-05 (verified): on a native Windows host Omnigent refuses its
  terminal harnesses (Claude Code, Codex, …). R4 now recommends WSL as the
  local mode for the full experience; R8's WSL backend uses
  `wsl --shell-type login`, verified on Ubuntu 26.04 (D4/A7 confirmed).
- 2026-09-05: R3 gained an `omni setup` step and a WSL section (install
  distro, install Omnigent inside).
