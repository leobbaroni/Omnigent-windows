# PROJECT_LOG.md

## 2026-09-05 — Phase 0: audit + plan
- Cloned upstream omnigent-ai/omnigent to `../omnigent-upstream` (main @ 5d323ad, 0.13.0.dev0; PyPI latest 0.12.0).
- Found the existing Electron shell at `web/electron` (Windows NSIS target configured, no Windows-specific integration).
- Wrote COMPAT.md (audit + capability matrix), SPEC.md, PLAN.md, CONTEXT.md, ADR-0001, CLAUDE.md.
- Machine state: Omnigent not installed; uv 0.12.7, Python 3.13.3, Node 22.16, pnpm via corepack; WSL had only docker-desktop.

## 2026-09-05 — Phases 1–7 (same day)
- Phase 1: vendored `web/electron` into `app/` with `scripts/sync-upstream.mjs` + `upstream.lock.json`; overlay pages built and committed; 427 upstream tests green on Windows.
- Phase 2: Windows CLI discovery (`.exe`, uv bin dir), `windowsHide` + UTF-8 env, bootstrap panel with confirm-gated visible installs, compatibility gate.
- Phase 3: rotating redacting logger, tray, close-to-tray/quit, badge overlay, start-with-Windows, heartbeat. Found and fixed an upstream Windows quit hang (update-overlay child window).
- Phase 4: WSL backend + Windows settings window. Phase 5: `omni upgrade --check` / guided `omni upgrade`.
- Phase 6: installed Omnigent 0.12.0 (`uv tool install`, retry needed for an AV file-lock race). Verified first launch, detection, Start locally, settings, quit. User feedback: seamless window, folder picker, harness setup → implemented WCO chrome, native folder picker, `omni setup` action. Discovered Omnigent refuses terminal harnesses on native Windows; installed WSL Ubuntu 26.04 + Omnigent inside; verified WSL Start locally + host enrolment from the app; Claude sign-in inside WSL left to the user (interactive; credential copy was refused by the permission classifier).
- Phase 7: installer + portable + latest.yml built (electron-builder needs a `pnpm` shim on PATH); GitHub Actions for build and release; README, ARCHITECTURE, COMPAT, PARITY written. e2e `win_smoke` green.
- Machine changes left in place (all reversible): `uv tool install omnigent` (uninstall: `uv tool uninstall omnigent`), WSL distro `Ubuntu` with Omnigent + Claude CLI (`wsl --unregister Ubuntu`), `%LOCALAPPDATA%\corepack-shims`, `%USERPROFILE%\omnigent-e2e-workspace`, `~/.omnigent` data dirs (Windows and WSL).

## Open / next
- Sign in to Claude inside WSL and run the README manual list for slash commands, skills, question tool.
- First GitHub Release to exercise electron-updater; code-signing secrets.
- Upstream the Windows fixes (quit hang, CLI discovery, windowsHide, WSL backend, folder picker bridge).
