# Omnigent for Windows

A first-class Windows desktop application for [Omnigent](https://omnigent.ai): the
same web UI Omnigent serves, in a native window, with the pieces a browser cannot
provide on Windows: a local server you can start, stop and restart from the tray,
remote and WSL-hosted servers, multiple windows on multiple servers, toast
notifications, a taskbar badge, close-to-tray, start-with-Windows, guided setup
when Omnigent is not installed yet, and independent updates for the app and for
Omnigent.

It is a Windows-hardened build of Omnigent's own Electron desktop shell
(`web/electron` upstream), not a rewrite: every Omnigent feature stays owned by
Omnigent. See `COMPAT.md` for the exact upstream commit, the capability matrix
and every contract the app depends on, and `ARCHITECTURE.md` for how it fits
together.

## Prerequisites

| Need | Why | Notes |
|---|---|---|
| Windows 10 (1809+) or Windows 11, x64 | toast notifications, WSL2 | tested on Windows 10 22H2 (19045) |
| [uv](https://docs.astral.sh/uv/) | installs Omnigent and fetches Python 3.12 for it | `winget install --id=astral-sh.uv -e` |
| Omnigent CLI (`omnigent` / `omni`) | the local server, hosting, updates | `uv tool install --python 3.12 omnigent` — the app guides you through this |
| Node.js 22 (optional) | harness CLIs shipped through npm (Claude Code, Codex, …) | `winget install --id=OpenJS.NodeJS.LTS -e` |
| WSL2 distro (optional) | terminals and sandboxing, which native Windows Omnigent lacks | `wsl --install` |

Nothing is required to *connect to a remote server*: the app works without any
local Omnigent.

## Installation

Download from the project's GitHub Releases:

- `Omnigent-Setup-<version>.exe` — installer (per-user by default, you can pick the
  folder). Adds Start-menu and desktop shortcuts, registers `omnigent://` links,
  and enables in-app updates.
- `Omnigent-<version>-portable.exe` — runs from anywhere, no install. Portable
  builds cannot self-update.

Builds are unsigned unless the release pipeline was given a certificate
(see *Release process*), so Windows SmartScreen shows "unknown publisher" on
first run: choose *More info → Run anyway*.

## First launch

1. The **Connect** page opens. Click **Start locally** to run Omnigent on this
   PC, or enter a server URL and **Connect**.
2. If Omnigent is not installed, the gear (⚙, top-right) shows a red dot and
   **Set up Omnigent on Windows** appears: what was detected (uv, Python, Node,
   WSL), the exact commands, **Copy**, and **Run in PowerShell…**.
   *Run* first shows a native dialog quoting the command; only when you confirm
   does a PowerShell window open and run it. Nothing is ever installed silently.
3. After installing, click **Re-detect**, then **Start locally**.

## Native Windows vs WSL

| | Native Windows Omnigent | Omnigent in WSL (recommended) |
|---|---|---|
| Server, web UI, sessions, automations, inbox | ✅ | ✅ |
| Custom SDK agents (`claude-sdk`, `codex`, `cursor`, `copilot`) | ✅ | ✅ |
| Claude Code / Codex harnesses (slash commands, skills, plugins, question tool) | ❌ Omnigent refuses terminal harnesses on Windows | ✅ |
| Terminal panes, sandboxing | ❌ | ✅ |

The app's setup panel and this table say the same thing on purpose: nothing is
hidden; pick the mode that fits.

## Local server

**Start locally** runs `omnigent server --background` through the CLI, streams
the boot log, and opens the server's UI. The server is Omnigent's own managed
local server (`~/.omnigent/local_server.pid`), so `omni` commands in a terminal
share it.

- A server that is already running is **attached**, never duplicated.
- The app only **stops servers it started** (on Quit, or Stop in the tray). A
  server you started yourself is left alone unless you confirm stopping it.
- Tray ▸ *Start / Stop / Restart local server*, *Change Server…*, status line.
- If a server the app started stops responding, a notification offers Restart.

## WSL setup (recommended)

A native Windows Omnigent can only run custom SDK agents: the Claude Code,
Codex and other terminal harnesses that give you slash commands, skills,
plugins, the question tool and terminal panes need a Linux host, and Omnigent
refuses them on Windows (`COMPAT.md` §12). Running Omnigent inside WSL gives
you the full experience, and the app drives it for you:

1. `wsl --install -d Ubuntu` (the bootstrap panel offers this step), open
   Ubuntu once to create your Linux user.
2. Inside the distro: `curl -fsSL https://omnigent.ai/install.sh | sh` (also
   offered as a step; it installs uv, tmux and bubblewrap as needed).
3. Sign in to the harness inside the distro once, e.g. `wsl -d Ubuntu -- claude`
   then `/login` (Codex: `wsl -d Ubuntu -- codex login`).
4. **Server ▸ Windows Settings… ▸ Local mode ▸ WSL distro**, pick the distro.
5. **Start locally** now runs `wsl.exe -d <distro> --shell-type login -- omnigent
   server --background`; the server's `http://127.0.0.1:<port>` is reachable
   from Windows through WSL2's loopback forwarding, and hosting this machine
   enrols the distro as the host.

Verified on this machine with Ubuntu 26.04 up to host enrolment; the harness
sign-in is interactive and was left to the user (see `PARITY.md`).

## Remote servers

Enter the server URL on the Connect page (plain `http://` to a non-local host
warns first). Sign-in flows (OIDC, Databricks, GitHub, Google, Slack, Atlassian,
Microsoft) open as hardened popup windows inside the app so OAuth hand-offs
work; anything else opens in your default browser. To make this PC a host for a
remote server use the host controls inside Omnigent's UI; the app runs
`omnigent login` and `omnigent host --server <url>` for you.

## Multiple servers and windows

- **Server ▸ New Window** (Ctrl+Shift+N): another window on the same server.
- **Server ▸ New Window on Different Server…**: a window pinned to another server.
- Notifications are prefixed with the server host when more than one server is
  connected; the badge sums unread sessions across servers.
- `omnigent://<host>/c/<session>` links open (or focus) the right window.

## Tray behaviour

Closing the last window **hides** the app in the tray by default (agents keep
running). Quit from **tray ▸ Quit Omnigent** or **Server ▸ Quit Omnigent**
(Ctrl+Q). Turn close-to-tray off in Windows Settings. **Start with Windows**
launches hidden in the tray at sign-in (installed builds only).

## Notifications and badge

Windows toasts when an agent finishes, needs input, or a runner disconnects,
except for the session you are viewing. Clicking a toast focuses (and un-hides)
the window and opens the session. The taskbar icon shows an overlay badge with
the unread count and the frame flashes when the window is not focused. Toggle
notifications in Windows Settings.

## Updates

- **App**: Server ▸ Check for Updates… (or the tray). Modes: automatic, at
  launch, manual, never; downloads and installs are always explicit.
- **Omnigent**: tray ▸ *Check for Omnigent Updates…* runs `omni upgrade --check`;
  *Update Omnigent…* confirms the exact `omni upgrade` command, then runs it in a
  visible PowerShell window. The CLI drains sessions and stops the local
  server; the next start brings it back on the new version.
- **Compatibility**: the app records the Omnigent versions it was tested with
  (`COMPAT.md` §15). An untested or newer version shows a one-time notice; nothing
  is disabled.

## Settings

**Server ▸ Windows Settings…** (Ctrl+,) or tray ▸ Settings…:

- Connection: default server, local mode (native / WSL), distro, auto-start the
  local server at launch, server Start/Stop/Restart.
- Application: close to tray, start with Windows, notifications, app update mode.
- Diagnostics: versions, CLI path and version, compatibility status, server
  status, `settings.json` and log locations, *Open Log Folder*, *Copy Diagnostics*.

Settings live in `%APPDATA%\Omnigent\settings.json` (installed builds).

## Troubleshooting

| Symptom | What to do |
|---|---|
| "Omnigent CLI not found" but it is installed | Click **Re-detect**; the app looks in `%USERPROFILE%\.local\bin`, uv's tool bin dir and PATH. Otherwise set the path with **Browse…** (pick `omnigent.exe`). |
| Start locally fails | Read the boot log on the Connect page, then `%USERPROFILE%\.omnigent\logs\server\`. Run `omni server --background` in PowerShell to see the CLI's own error. |
| Server "not started by this app" | It was started outside the app (a terminal). The app attaches to it and will ask before stopping it. |
| No toasts | Windows Settings ▸ Notifications on; check Windows *Focus assist*; toasts are suppressed for the session you are viewing. |
| SmartScreen warning | Unsigned build; see *Installation*. |
| App update fails | The installed version is untouched; download the installer from Releases manually. |
| Omnigent upgrade fails | `omni upgrade` leaves the previous version in place; rerun it in PowerShell to see the error. |
| Terminals unavailable | Native Windows host limitation; use a WSL or remote host. |
| Logs | `%APPDATA%\Omnigent\logs\omnigent-desktop.log` (rotating, secrets redacted). Tray ▸ Open Log Folder. |

## Development

```bash
corepack enable                 # pnpm 11 via corepack (no global install)
cd app && pnpm install          # downloads Electron
pnpm test                       # node --test (unit tests)
pnpm start                      # run the shell (electron .)
```

Handy scripts (from the repo root):

```bash
node scripts/dev-screenshot.mjs out.png --click "#cli-gear"   # launch + screenshot
node scripts/dev-tray-check.mjs                                # close-to-tray / quit check
node scripts/dev-settings-shot.mjs out.png                     # settings window
node --test app/e2e/win_smoke.e2e.js                           # real-install e2e (skips without Omnigent)
```

Layout: `app/` is the vendored upstream shell plus Windows code under
`app/src/win/`; `upstream.lock.json` pins the upstream commit;
`scripts/sync-upstream.mjs` re-vendors it (see `app/UPSTREAM.md`).

## Build

```bash
cd app
pnpm run build:win        # NSIS installer + portable exe + latest.yml in app/dist/
pnpm run build:win:dir    # unpacked app only (fast smoke)
```

electron-builder shells out to a `pnpm` binary to list dependencies, so `pnpm`
must be on PATH (not only reachable as `corepack pnpm`). Without a global
install, create user-level shims once and prepend them:

```powershell
corepack enable --install-directory "$env:LOCALAPPDATA\corepack-shims"
$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"
```

Builds are unsigned unless `CSC_LINK`/`CSC_KEY_PASSWORD` are set. The portable
exe re-launches itself from a temp directory, so drive the unpacked build
(`app/dist/win-unpacked/Omnigent.exe`) when automating; see
`scripts/dev-packaged-smoke.mjs`.

## Release process

1. Bump `app/package.json` `version` (semver; electron-updater compares it).
2. Update `COMPAT.md` §15 with the Omnigent version you tested against.
3. Commit, tag `v<version>`, push the tag. `.github/workflows/release.yml`
   builds, tests, and publishes the installer, portable exe and `latest.yml` to
   a GitHub Release; installed apps pick it up through their update check.
4. Code signing: add repository secrets `CSC_LINK` (base64 PFX) and
   `CSC_KEY_PASSWORD`; electron-builder signs automatically. No workflow
   changes needed.

## Manual test procedure

Run through this list before a release (results for the current release are in
`PARITY.md`):

1. **Fresh machine** (no Omnigent): app opens the Connect page; gear shows the
   red dot; the bootstrap panel lists correct detections; *Run in PowerShell…*
   shows the confirm dialog and opens a console; Cancel runs nothing.
2. **Start locally**: server boots, log streams, UI loads; tray status shows
   *running*; `omni server status` agrees.
3. **Existing server**: start `omni server --background` in a terminal first;
   Start locally attaches (status says *not started by this app*); Quit leaves
   it running.
4. **Stop / Restart** from the tray and from Windows Settings.
5. **Crash recovery**: kill the owned server process (`taskkill /PID`); within
   30 s the tray shows *not responding* and a toast offers Restart.
6. **Notifications**: run an agent turn in a session you are not viewing; toast
   appears; click focuses the window and opens the session; badge shows the
   count; count clears when viewed.
7. **Tray**: close the last window (stays in tray, balloon once); tray click
   restores; Quit exits and stops the owned server only.
8. **Multiple windows / servers**: New Window; New Window on Different Server
   against a second server (`omni server --port 7000` in a terminal); titles
   and notification prefixes are per server.
9. **Deep link**: `start omnigent://127.0.0.1:<port>/c/<session_id>` opens the
   session in the running instance (single-instance focus).
10. **OAuth**: connect an MCP server needing GitHub/Google sign-in; the popup
    opens inside the app and completes.
11. **Files**: drag an image onto the composer; download an artifact; open it.
12. **External links**: a link in a message opens in the default browser.
13. **Updates**: Check for Updates… (app), Check for Omnigent Updates…, Update
    Omnigent… dialog → console.
14. **Compatibility**: with a newer Omnigent (`omni upgrade --nightly` in a test
    env), the one-time notice appears; features keep working.
15. **Settings**: every toggle persists across a restart; Copy Diagnostics.
16. **Installer**: install, launch from the Start menu, uninstall (settings kept).
