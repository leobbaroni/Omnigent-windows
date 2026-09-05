# COMPAT.md — Omnigent ↔ Omnigent for Windows compatibility record

This file is the single place where every Omnigent-specific assumption the
Windows shell depends on is written down. When Omnigent changes, this file is
what you re-verify. Everything below was read from the repository, not from
memory; each item names its source.

## 1. Omnigent version / commit examined

| Item | Value | Source |
|---|---|---|
| Repository | https://github.com/omnigent-ai/omnigent | clone at `../omnigent-upstream` |
| Commit audited | `5d323ad` (branch `main`, 2026-09-05) | `git log` |
| Package version at that commit | `0.13.0.dev0` | `pyproject.toml` `[project].version`, `omnigent/version.py` |
| Latest published release | `0.12.0` (PyPI, 2026-09-01) | pypi.org/project/omnigent |
| Upstream desktop shell version | `0.12.0` (`web/electron/package.json`) | file |
| Electron | `^42.3.2`; electron-builder `^26.0.0`; electron-updater `^6.3.9` | `web/electron/package.json` |
| Node / pnpm | Node 22, `pnpm@11.15.1` (root `package.json` `packageManager`) | file |
| Python | 3.12+ (`.python-version`, README) | file |
| Licence | Apache-2.0 | `LICENSE` |

The Windows shell vendors `web/electron` from this exact commit (see
`upstream.lock.json`). Re-sync with `scripts/sync-upstream.mjs`.

## 2. Existing desktop implementations discovered

| Implementation | Location | Status |
|---|---|---|
| **Electron desktop shell** (macOS, Linux, Windows targets) | `web/electron/` | Primary. macOS is the polished/signed target; `win: { target: ["nsis"] }` exists but there is no Windows CI, no signing, no tray, and POSIX-only CLI discovery. |
| iOS wrapper (WKWebView) | `web/ios/` | Not relevant. Shares `nativeBridge.ts`. |
| Android wrapper | `web/android/` | Not relevant. Shares `nativeBridge.ts`. |
| VS Code extension | `editors/vscode/` | Not a desktop shell. |

The public docs (omnigent.ai/docs/interact/desktop) list a Windows `.exe`
installer, so upstream intends the Electron shell to be the Windows client.
This project is a **Windows-hardened build of that same shell**, not a new
shell — see `docs/adr/0001-electron-vendored-upstream-shell.md`.

## 3. Web / native bridge architecture

- One `web` SPA bundle, served by the **server** (`omnigent/server/static/web-ui/`,
  mounted in `omnigent/server/app.py`). The shell never ships the SPA; it loads
  the server origin (`web/electron/README.md`, "How it works").
- Detection is runtime feature-detection: the preload exposes
  `window.omnigentDesktop` with `kind: "electron"` (`web/electron/src/preload.js`);
  the SPA reads it through `web/src/lib/nativeBridge.ts` and degrades to
  Web-platform behaviour in a browser.
- Trust boundary: every privileged IPC handler checks `isPinnedOriginSender`
  (the window is pinned to the origin the user connected it to). Setup-page
  IPC (`omnigentSetup`) only works for the bundled setup page.
  `nodeIntegration: false`, `contextIsolation: true`.
- Bridge surface used by the SPA (from `nativeBridge.ts` exports): `notify`,
  `setBadgeCount`, `onNotificationActivated`, `onOpenPath`, `getServerPicker`,
  `switchServer`, `openServerSetup`, `getHostIdentity`, `controlHost`
  (`start|stop|restart`), `getDesktopFeatures`, `onHostStatusChanged`,
  `getCliStatus`, `resetCliPath`, `updates.*` (`getConfig/getStatus/check/
  download/installNow/setConfig/onStatus/getOverlayHeight/onOverlayHeight`),
  `setColorScheme`, and the `browser*` embedded-browser-pane family.
- Additional SPA contract used by the Windows folder-picker enhancement
  (`app/src/win/folder_picker_preload.js`, inlined in `preload.js`): the test
  ids `workspace-picker` / `workspace-picker-home` / `workspace-picker-path-input`
  (`web/src/shell/WorkspacePicker.tsx`) and `workspace-browse-toggle` /
  `workspace-path-input` (`WorkspacePathField.tsx`). If they change, the
  button simply does not appear.
- Seamless chrome CSS (`app/src/win/chrome.js`) relies on the SPA classes
  `.app-shell`, `.chat-header`, `aside[aria-label="Workspace"]`,
  `.workspace-tab-strip`, `.settings-sidebar-header` (`web/src/index.css`,
  `AppShell.tsx`, `ChatHeader.tsx`, `WorkspacePanel.tsx`).
- **The Windows shell must not change this contract.** Windows-only features
  are added as additional optional fields/methods, never by altering existing
  ones (an older or newer SPA must keep working).

## 4. CLI commands the desktop depends on

Entry points: `omnigent` and `omni` (same program, `pyproject.toml`
`[project.scripts]`). On Windows a `uv tool install` puts `omnigent.exe` and
`omni.exe` in `%USERPROFILE%\.local\bin` (uv default tool bin dir; confirm
with `uv tool dir --bin`).

| Command | Used for | Source |
|---|---|---|
| `omnigent --version` | detection; output `omnigent X.Y.Z (sha, built …)` | `cli.py::_format_version` |
| `omnigent server --background` | start (or reuse) the detached managed local server; prints `Started background server at URL` or `Background server already running at URL`, then `log: <path>` | `cli.py::server`, `_run_background_server` |
| `omnigent server status --json` | `{running,pid,port,url,log_path,live_sessions,daemon_attached}` | `cli.py::server_status` |
| `omnigent server stop [--force]` | stop managed server + local host daemon | `cli.py::server_stop` |
| `omnigent server start` | deprecated hidden alias (kept for old desktop builds) | `cli.py::server_start` |
| `omnigent host --server <url> --non-interactive` | foreground host daemon; prints `✓ Connected` when the tunnel is up | `cli.py::host`, `server_manager.js` CONNECTED_MARKER |
| `omnigent host stop` (per target) | stop a host daemon the shell adopted | `omnigent_cli.js::stopHost` |
| `omnigent login <url>` | browser/OIDC/Databricks sign-in before hosting a remote server | `server_manager.js::ensureServerAuth` |
| `omnigent upgrade [--check] [--dry-run] [--force]` | Omnigent (not shell) updates; detects uv-tool/pipx installs | `cli.py::upgrade` |
| `omnigent stop` | stop everything | `cli.py::stop` |

Installation on native Windows (README, "Windows (native)"):

```powershell
uv tool install --python 3.12 omnigent
```

The POSIX `install_oss.sh` one-liner that the upstream shell shows
(`INSTALL_COMMAND` in `omnigent_cli.js`) is **wrong on Windows**; the Windows
shell replaces it.

## 5. Server lifecycle

- Data dir: `~/.omnigent` or `OMNIGENT_DATA_DIR` (`host/local_server.py::_local_data_dir`).
- Managed local server pidfile: `~/.omnigent/local_server.pid` (two lines:
  pid, port); sidecars `local_server.sig` (config signature including the
  package version, so the server respawns after an upgrade) and
  `local_server.logpath`.
- Server logs: `~/.omnigent/logs/server/server-*.log`.
- Spawn: `python -m omnigent.cli server --host 127.0.0.1 --port <free> --database-uri sqlite:///~/.omnigent/chat.db --artifact-location ~/.omnigent/artifacts`, detached with `CREATE_NEW_PROCESS_GROUP` on Windows (`inner/_proc.py::spawn_kwargs`).
- Default port `6767` (`_DEFAULT_LOCAL_PORT`), but the managed server picks a
  free loopback port; always read the URL from `server status --json`.
- Readiness: `GET /health` (timeout 45 s, boot ceiling 120 s).
- Ownership rule (upstream `server_manager.js`): only stop a server the shell
  started; adopt an already-healthy one without claiming ownership.
- Foreground `omnigent server` (deploys, Docker) is not managed by the shell.

## 6. Host / runner lifecycle

- Host daemon registry: `~/.omnigent/daemons/*.json` (target = server URL or
  `local`), read directly by the shell (`omnigent_cli.js::readDaemonRecords`).
- Windows: no `fcntl` lock (`daemon_lifecycle.py` falls back to lock-less
  records), no orphan reaping (`host/connect.py`), process tree containment
  via **Job Objects** for agents (README). Runners on Windows: SDK-based
  harnesses only; tmux/PTY wrappers unavailable.
- The shell spawns `omnigent host --server <url> --non-interactive` as a
  child for remote servers and terminates it on quit (SIGTERM then SIGKILL; on
  Windows both map to `TerminateProcess`).

## 7. API endpoints used by the shell

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /health` | none | local server readiness / reuse |
| `GET /.well-known/omnigent.json` | none | `{manifest_version, server_version, min_desktop_version, ui:{server_picker}}`; gate on `manifest_version >= N`; 404 means pre-manifest baseline (`app.py`) |
| `GET /api/version` | none | `{version}` display |
| `GET /v1/info` | none | SPA capability probe (`dictation_available`, …) |
| `GET /v1/me` | cookie/bearer | auth probe before hosting (`probeServerAuth`) |
| `GET /v1/hosts` | auth | host tunnel probe (`probeHostTunnel`) |
| `GET /v1/sessions/{id}/items` | auth | notification body preview (best-effort) |

The full surface is in `openapi.json` (558 KB); the shell must never depend on
more than the rows above.

## 8. WebSocket / SSE events

The SPA owns event consumption: `GET /v1/sessions/{id}/stream` (SSE) and the
inbox/session stores (`web/src/lib/events.ts`, `sessionEvents.ts`, `inbox.ts`).
The shell does not subscribe to events; the SPA calls `nativeNotify` and
`setBadgeCount` on transitions (turn end, elicitation, runner offline). This
is deliberate: no duplicate event connections, no shell-side event parsing.
Browser-pane actions arrive as `browser.action_request` on the same stream and
are claimed by the SPA (`useBrowserAgentRelay.ts`).

## 9. Authentication and OAuth

- Server auth modes: header (default local), accounts, OIDC, Databricks
  (`server/auth.py`, `resolve_auth_source`).
- CLI tokens: `~/.omnigent/auth_tokens.json` (read by the shell for bearer
  probes only; never logged).
- OAuth popups: `window.open` popups are allowed as real child windows only for
  the pinned origin, well-known IdP hosts, or `settings.popup_allowed_origins`
  (`src/popupPolicy.js`). COOP header stripped inside those popups. Everything
  else goes to the system browser. **Must be preserved on Windows.**
- Return banner (`return_banner.js`) when a sign-in navigates the window away.

## 10. Native integrations the web app relies on

Notifications, badge, notification click → navigate, server picker, host
control (start/stop/restart this machine as a host), CLI status, updates
overlay, embedded browser pane (`WebContentsView`), microphone permission for
dictation, color-scheme sync, `omnigent://host/c/<session>` deep links
(`setAsDefaultProtocolClient("omnigent")`, `deepLink.js`).

## 11. Update / upgrade mechanisms

| Layer | Mechanism | Windows notes |
|---|---|---|
| Desktop shell | `electron-updater`, generic provider `https://omnigent.ai/_desktop/updates/` (`latest.yml`), modes `none/manual/start/default`, explicit download/install with native confirm dialogs (`desktop_updater.js`) | This build publishes to **its own** feed (GitHub Releases). Unsigned builds work with electron-updater on Windows but SmartScreen warns. Signing hooks reserved (`CSC_LINK`/`CSC_KEY_PASSWORD`). |
| Omnigent package | `omni upgrade` (uv tool / pipx aware; drains sessions, stops server, next command respawns); `omni upgrade --check` | uv-tool installs are the Windows path; `omni upgrade` works there. The shell offers check + guided upgrade. |
| Future compatibility | manifest gate (`manifest_version >=`), `min_desktop_version`, feature detection through `/v1/info`, `server start` alias kept for old shells | Keep this file's tables in sync. |

## 12. Known platform-specific limitations (native Windows Omnigent)

From README "Windows (native)" and `_platform.py`:

- Native tmux/PTY terminal wrappers (`omnigent claude/codex/cursor`) are unavailable, so **shell/terminal panes for a native-Windows host are not available**; use a WSL or remote host.
- **Verified 2026-09-05 against 0.12.0:** the SPA's default "Claude Code" harness on a native Windows host is the *native terminal* harness (`claude-native-ui`); a session started with it fails at launch with `Native terminal harnesses (tmux/PTY) are not supported on Windows` (runner log, `omnigent/runner/native/orchestration.py`). SDK harnesses (`claude-sdk`, `codex`, `cursor`, `copilot`) are reported ready by the host and are the working choice on native Windows; the WSL backend gives the full native-harness experience. The shell surfaces this in the bootstrap panel and README; it cannot change the SPA's default.
- **Test-environment note:** a host daemon started from inside a Claude Code / Codex terminal inherits nested-session env vars (`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, …) and then reports native Claude as `needs-auth` (`claude -p /model` exits 0xC0000142). The shell strips these before every CLI spawn (`cli_windows.js::cliEnv`).
- No `bwrap`/`seatbelt` sandboxing and no L7 egress proxy: Job Objects contain the process tree but do not isolate filesystem or network.
- `--follow` log tailing is not supported on Windows (`cli.py`).
- Git symlink stubs on no-symlink checkouts are handled by `resolve_repo_symlink`.
- The `install_oss.sh` installer is POSIX-only.

## 13. Features requiring special Windows handling in the shell

| Area | Upstream state | Windows handling |
|---|---|---|
| CLI discovery | POSIX candidate dirs, no `.exe` | add `%USERPROFILE%\.local\bin\omnigent.exe`, `uv tool dir --bin`, `where`, WSL probe |
| Child process spawn | no `windowsHide` | `windowsHide: true` on every spawn/execFile (otherwise console windows flash) |
| Badge | `app.setBadgeCount` (no-op on Windows) | taskbar overlay icon with count + `flashFrame` |
| Tray / close-to-tray / quit vs close | none; `window-all-closed` quits | tray icon + menu, close-to-tray setting, explicit Quit |
| Start with Windows | none | `app.setLoginItemSettings` |
| Notifications | `Notification` + `setAppUserModelId("ai.omnigent.desktop")` | verify toast + click; settings |
| Logging | console only | rotating file logs in `%APPDATA%\Omnigent\logs` + "Open log folder" |
| Install guidance | POSIX one-liner | Windows bootstrap panel (uv/Python/Node/WSL detection, exact commands, explicit visible install, never silent) |
| WSL | none | optional WSL-hosted CLI backend (`wsl.exe -d <distro> -- omnigent …`) |
| Packaging | nsis default (one-click) | assisted NSIS (per-user, choose dir) + portable; signing-ready |
| Deep links | protocol registered by electron-builder | verify `second-instance` argv on Windows |

## 14. Compatibility checklist for a new Omnigent release

1. Bump `upstream.lock.json`; run `scripts/sync-upstream.mjs` and review the
   diff of `web/electron` against `app/` (Windows-owned files live under
   `app/src/win/` and are never overwritten).
2. Re-verify every row in §4 (`--help` of each command; `server status --json` keys).
3. Re-verify §7 endpoints against `openapi.json`.
4. Re-verify the preload/nativeBridge surface (§3): new methods are fine, renamed or removed ones are breaking.
5. Run `app` unit tests (`node --test`) and the Windows e2e.
6. Test against a real `uv tool install omnigent==<new>`: first launch, start/stop/restart, notifications, tray, multi-window, multi-server, deep link, update check.
7. Update §15 and the tested-version row in §1.

## 15. Version compatibility record

| Field | Value |
|---|---|
| Tested Omnigent (server + CLI) | 0.12.0 (PyPI) — pending the Phase 6 test run |
| Shell vendored from | main @ `5d323ad` (shell reports 0.12.0) |
| Minimum supported Omnigent | 0.7.0 (`server --background` flag; older CLIs only have `server start`) |
| Known-good | 0.12.0 (pending) |
| Known-incompatible | < 0.7.0 |
| Required CLI commands | §4 |
| Required endpoints | §7 |
| Required events | none consumed by the shell (§8) |
| Required bridge contract | §3 (`window.omnigentDesktop.kind === "electron"`) |

## 16. Capability matrix

Legend: ✅ supported · ⚠️ partial / conditional · ❌ unsupported · ⏳ to verify in Phase 6.
"Owner" is who implements the capability.

| Capability | Browser | Existing Desktop (macOS) | Windows App | Owner | Notes |
|---|---|---|---|---|---|
| Conversations | ✅ | ✅ | ✅⏳ | Omnigent web/server | served SPA |
| Multiple agents | ✅ | ✅ | ✅⏳ | Omnigent | |
| Sub-agents | ✅ | ✅ | ✅⏳ | Omnigent | |
| Shell/terminal | ✅ (POSIX hosts) | ✅ | ⚠️ remote/WSL hosts only; native-Windows host ❌ (Omnigent limitation, §12) | Omnigent | shell surfaces the limitation |
| Native terminal harnesses (Claude Code, Codex, Cursor terminal mode) | ✅ (POSIX hosts) | ✅ | ❌ on a native-Windows host (Omnigent, §12); ✅ via WSL/remote host | Omnigent | SDK harnesses work natively |
| Working-directory chooser | ✅ (server-side browser) | ✅ | ✅ + native Windows folder dialog (new) | Shell (preload enhancement) | contract: SPA test ids in §3 |
| Seamless window (no native title/menu bar) | n/a | ✅ hiddenInset | ✅ Window Controls Overlay + injected drag CSS (new) | Shell (Windows) | menu via Alt |
| Todos/plans (agent) | ✅ | ✅ | ✅⏳ | Omnigent | |
| Scheduled tasks | ✅ | ✅ | ✅⏳ | Omnigent (`server/scheduled`) | |
| Skills | ✅ | ✅ | ✅⏳ | Omnigent | |
| MCP | ✅ | ✅ | ✅⏳ (OAuth popups preserved) | Omnigent + shell popup policy | |
| Plugins / extensions | ✅ | ✅ | ✅⏳ | Omnigent | |
| Connectors | ✅ | ✅ | ✅⏳ | Omnigent | |
| Browser tools (embedded pane) | ❌ | ✅ | ✅⏳ | Shell (`browserIpc.js`) | Electron `WebContentsView` |
| File operations (upload, drag/drop, download, open) | ✅ | ✅ | ✅⏳ | Web + Chromium | no shell interception |
| OAuth | ✅ | ✅ | ✅⏳ | Shell popup policy + server | |
| Notifications | ⚠️ Web Notifications | ✅ native + sound | ✅ toast + flash (⏳) | Shell | sound: Windows default toast sound |
| Badge | ❌ | ✅ dock badge | ✅ overlay icon (new) | Shell (Windows) | |
| Multiple windows | ❌ | ✅ | ✅⏳ | Shell | |
| Multiple servers | ❌ | ✅ | ✅⏳ | Shell | |
| Server lifecycle (start/stop/restart/status) | ❌ | ✅ | ✅⏳ + tray controls (new) | Shell via CLI | |
| Host/runner lifecycle | ❌ | ✅ | ✅⏳ | Shell via CLI | |
| WSL-hosted Omnigent | ❌ | n/a | ⚠️ new, optional | Shell (Windows) | |
| Desktop updates | n/a | ✅ | ✅ own feed (⏳ unsigned) | Shell | |
| Omnigent updates | CLI | About → `omni upgrade` hint | ✅ check + guided upgrade (new) | Shell via CLI | |
| Tray / close-to-tray / start with Windows | n/a | n/a | ✅ new | Shell (Windows) | |
| Deep links `omnigent://` | n/a | ✅ | ✅⏳ | Shell | |
| Microphone / dictation | ✅ | ✅ (server fallback) | ⚠️ server-side dictation only (Electron has no Google speech) | Shell + server | same as macOS |
| Managed preferences (MDM) | n/a | ✅ macOS | ❌ (macOS-only mechanism; no Windows policy source yet) | Shell | documented limitation |
| Diagnostics / logs | n/a | console | ✅ new | Shell (Windows) | |

## 17. Differences between the implementation prompt and the repository

| Prompt said | Repository says |
|---|---|
| "Tauri v2 is preferred only if materially better" | Existing shell is Electron with a large native surface (browser pane, OAuth popup hardening, updater). Electron chosen. |
| "official lifecycle commands (assumed `omnigent server start`)" | `omnigent server --background`; `server start` is a deprecated hidden alias. |
| "update command (assumed)" | `omni upgrade` / `omni upgrade --check`. |
| "port 6767" | default for foreground `omnigent server`; the managed server picks a free port; read it from `server status --json`. |
| "install Omnigent from the app" | Upstream never installs the CLI; user constraint: never install silently. The Windows bootstrap only runs an install after an explicit confirmation showing the exact command, in a visible console. |
