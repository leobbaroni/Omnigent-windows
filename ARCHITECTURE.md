# ARCHITECTURE.md — Omnigent for Windows

## 1. Desktop architecture

```
┌───────────────────────────── Electron main process (app/src) ─────────────────────────────┐
│ main.js (upstream)  ── window mgmt, menu, IPC gates, notifications, badge, deep links,     │
│                        updater, OAuth popup policy, browser panes, host/server control     │
│   └─ // [win] hooks → src/win/                                                            │
│        integration.js  tray · close-to-tray/quit · badge overlay · heartbeat · omni upgrade│
│        bootstrap.js    prerequisite detection · exact commands · confirmed console runner  │
│        cli_windows.js  .exe discovery (uv bin dir) · windowsHide · UTF-8 env · taskkill    │
│        wsl.js          wsl.exe -d <distro> -- omnigent … backend                          │
│        compat.js       tested-version record → one-time notice                            │
│        logger.js       rotating, redacting file log                                        │
│        badge.js        PNG overlay renderer (no deps)                                      │
│        startup.js      login item (--hidden)                                               │
│        settings_window.js + settings_preload.js  shell-owned settings page                 │
│ omnigent_cli.js / server_manager.js (upstream + [win] hooks)  ── the ONLY process spawners │
└───────────────────────────────────────────────────────────────────────────────────────────┘
        │ contextBridge (preload.js → window.omnigentDesktop / window.omnigentSetup)
        ▼
┌───────────── renderer ─────────────┐   ┌──────── bundled shell pages (file://) ────────┐
│ Omnigent SPA, served by the server │   │ setup/index.html (+ win-bootstrap.js)          │
│ nativeBridge.ts feature-detects    │   │ settings-win/ · about/ · find/ · overlay/ …    │
│ kind: "electron"                   │   └───────────────────────────────────────────────┘
└────────────────────────────────────┘
        │ HTTP + SSE (owned entirely by the SPA)
        ▼
┌──────── Omnigent server ────────┐   local: `omnigent server --background` (native or WSL)
│ /health · /.well-known/… · /v1  │   remote: any URL the user connects to
└─────────────────────────────────┘
```

The shell never bundles the SPA; it loads the server's origin. That is what
keeps Omnigent the single source of truth and what makes the app survive
Omnigent upgrades: UI and API changes ship in the server, the shell only relies
on the small contract in `COMPAT.md`.

## 2. Web/native bridge

`preload.js` (upstream) exposes `window.omnigentDesktop` (`kind: "electron"`) to
server pages and `window.omnigentSetup` to the bundled setup page. The SPA's
`nativeBridge.ts` feature-detects these and falls back to web behaviour in a
browser. Windows adds **nothing** the SPA can see: the Windows additions are
shell-owned pages (setup bootstrap panel, settings window) with their own
narrow IPC, each gated on the sender frame being that exact bundled file. This
keeps the SPA platform-neutral and the contract unchanged for upstream.

Trust boundaries (unchanged from upstream, verified in COMPAT.md §3/§16):

- `nodeIntegration: false`, `contextIsolation: true`, sandboxed shell pages.
- Every privileged IPC handler checks its sender: pinned server origin for
  SPA calls (`isPinnedOriginSender`), the setup page's file URL for
  `omnigentSetup`, the settings page's file URL for `omnigentWinSettings`.
- The renderer can never run an arbitrary command: the bootstrap and upgrade
  runners take a **step id**, resolve the command in the main process, show a
  native dialog quoting it, and only then spawn a visible PowerShell.
- External URLs: OAuth popups only for allow-listed hosts (`popupPolicy.js`);
  docs links from the bootstrap only for allow-listed https hosts; everything
  else goes to the system browser.
- Protocol handler `omnigent://` routes through the single-instance lock and
  upstream's consent flow for unknown servers.

## 3. Server lifecycle

State is never cached in the shell: `omnigent_cli.js` re-reads the CLI's own
files (`~/.omnigent/local_server.pid`, daemon registry) and probes `/health`.

```
Start locally / tray Start
   ├─ localServerHealthy()?  ── yes → attach (ownedByDesktop = false)
   └─ no → `omnigent server --background` (tail boot log) → `server status --json` → URL
Quit / tray Stop
   ├─ owned      → `omnigent server stop`
   └─ not owned  → leave running (Stop asks for confirmation first)
Heartbeat (owned only, 30 s) → /health fails → tray "not responding" + toast → Restart
```

On Windows every spawn carries `windowsHide: true` and `PYTHONUTF8=1`; the host
child is torn down with `taskkill /T` so its runner tree does not orphan.
Upgrades: `omni upgrade` (run visibly) drains sessions and stops the server; the
package version is part of the server's config signature, so the next start
respawns it on the new code.

## 4. Host/runner lifecycle

Hosting this machine for a server is `omnigent host --server <url>
--non-interactive`, spawned and owned by `server_manager.js`: adopt a live daemon
if one exists (never kill what we did not start), otherwise spawn and wait for
the `✓ Connected` marker; auth goes through `omnigent login` first for remote
servers. Runners are Omnigent's; on native Windows they run under Job Objects
(SDK harnesses only). The shell surfaces the native-Windows limitations
(terminals, sandbox) in the bootstrap panel instead of hiding them.

## 5. Multi-server / multi-window model

Each `BrowserWindow` is pinned to one origin (`windows` map in `main.js`):
server identity, badge count, browser-pane registry and away-watch are
per-window. Windows on different servers coexist; notification titles carry the
host when more than one server is active; the badge sums per-origin maxima.
The WSL/native choice is a per-app *local* backend; remote windows are
unaffected by it.

## 6. Update architecture

- **App**: `electron-updater` against the project's GitHub Releases
  (`latest.yml` + blockmap). Explicit download/install with native dialogs;
  modes `default | start | manual | none`; portable builds never update.
- **Omnigent**: detection via `omni upgrade --check` (exit code contract), guided
  `omni upgrade` in a visible console.
- **Compatibility**: `compat.js` holds tested/minimum versions; the server's
  `/.well-known/omnigent.json` (`manifest_version`, `min_desktop_version`) is
  read by upstream code and gated with `>=`, so newer servers keep working.

## 7. Security model

See §2. Additional Windows specifics: the bootstrap runner spawns
`powershell.exe -NoExit -ExecutionPolicy Bypass -Command <script>` **detached**
so it is never a child the shell would kill, and the script only ever contains
the command the dialog displayed. Logs redact bearer tokens, cookies, and
long opaque tokens (`logger.js`). Settings writes are restricted to an
allow-list of keys (`settings_window.js`); a page can never re-point the saved
server URL or the CLI path through the settings IPC.

## 8. Failure handling

| Failure | Behaviour |
|---|---|
| CLI missing | Setup page bootstrap panel; tray/settings actions explain and open the app. |
| Server unreachable | Upstream: setup page with the error, URL prefilled, Retry/Change Server. |
| Owned server dies | Heartbeat → status + toast with Restart. |
| Start fails | Boot log shown on the setup page; error dialog from the tray; server logs in `~/.omnigent/logs/server`. |
| Tray unavailable | Logged; app falls back to quit-on-last-window. |
| Notification failure | Caught per call; never affects the app. |
| Quit hang (upstream Windows bug: overlay child window) | Fixed in `update_overlay.js` `[win]` hook; 10 s force-exit cap remains as backstop. |
| Update feed unreachable | Silent unless a manual check; installed version untouched. |
| Untested Omnigent version | One-time notice; nothing disabled. |

## 9. Upstream sync

`upstream.lock.json` pins the commit; `scripts/sync-upstream.mjs` copies
`web/electron` into `app/`, skips Windows-owned files, writes `.upstream`
sidecars for hooked files that changed upstream, rebuilds the overlay pages,
and refreshes `app/UPSTREAM.md`. Hooks are marked `// [win]` so a three-way
merge is a grep away. The CI build runs the sync in `--check` mode.
