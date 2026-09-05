# CONTEXT.md — ubiquitous language

- **Omnigent**: the upstream open-source agent framework (server + web SPA + CLI + host/runner). Never modified here.
- **Shell**: the Electron desktop application (`app/`). Vendored from upstream `web/electron`, extended for Windows.
- **SPA**: Omnigent's web UI, served by the server; the shell loads it from the server origin and never bundles it.
- **CLI**: the `omnigent` / `omni` executable (Python, installed with `uv tool install`). The shell's single source of truth for local state.
- **Managed local server**: the detached `omnigent server` started by `omnigent server --background`, tracked in `~/.omnigent/local_server.pid`.
- **Owned**: a process the shell itself started and is therefore allowed to stop. Anything else is **adopted** (used, never stopped).
- **Host**: this machine enrolled with a server so runners can execute here (`omnigent host --server`).
- **Runner**: the per-session agent process launched by the host.
- **Bootstrap**: the shell-owned Windows setup experience shown when the CLI or its prerequisites are missing. It never installs anything silently.
- **Backend (local mode)**: how the CLI is invoked: `native` (Windows exe) or `wsl` (`wsl.exe -d <distro> -- omnigent`).
- **Pinned origin**: the server origin a window was explicitly connected to; the shell's trust boundary for privileged IPC.
- **Manifest**: `GET /.well-known/omnigent.json`, the server's version/capability envelope for non-browser clients.
- **Close vs Quit**: Close hides the window (to the tray, when enabled); Quit exits the app and stops owned processes.
- **Upstream sync**: re-copying `web/electron` at a new pinned commit into `app/` while preserving `app/src/win/` and marked hooks.
