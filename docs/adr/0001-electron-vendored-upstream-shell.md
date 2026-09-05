# ADR-0001: Electron, vendoring the upstream desktop shell

Date: 2026-09-05. Status: accepted.

## Context

The implementation prompt asked for a technology evaluation (Tauri vs Electron
vs other). The audit (COMPAT.md §2–§3) found that Omnigent already ships an
Electron shell (`web/electron`) with a substantial native surface the SPA
depends on: `WebContentsView` browser panes for agent browser tools, hardened
OAuth popup handling with COOP stripping, an electron-updater flow, deep links,
host/server lifecycle via the CLI, and a preload contract the SPA detects as
`kind: "electron"`.

## Decision

Build Omnigent for Windows as a Windows-hardened build of the upstream Electron
shell. Vendor `web/electron` at a pinned commit into `app/`; keep every
Windows-specific module under `app/src/win/`; wire them through minimal, marked
hooks; keep a sync script and `upstream.lock.json`.

## Consequences

- Full parity with the existing desktop by construction; no re-implementation of browser panes, OAuth, or the updater.
- A larger binary than Tauri (Chromium bundled). Accepted; the prompt forbids choosing on code size alone.
- Upstream drift is handled by the sync script plus the COMPAT checklist rather than by patch files.
- Windows features (tray, overlay badge, startup, WSL backend, bootstrap, logging) are isolated and could be upstreamed.
