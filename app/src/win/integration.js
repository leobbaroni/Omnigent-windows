// [win] Windows desktop integration: tray, close-to-tray vs quit, taskbar
// badge overlay, start-with-Windows, notification gate, owned-server heartbeat.
//
// Everything the main process needs from Windows lives behind this one
// factory. All Electron objects and shell callbacks are injected so the logic
// is unit-testable with fakes and stays a no-op off Windows (main.js only
// constructs it on win32). Settings keys (all optional, in settings.json):
//
//   win_close_to_tray        boolean, default true
//   win_start_with_windows   boolean, default false (mirrors the OS login item)
//   win_notifications_enabled boolean, default true
//   win_auto_start_local     boolean, default false (Phase 4 settings page)
//   win_local_mode           "native" | "wsl" (Phase 4)
//   win_wsl_distro           string (Phase 4)
//   win_tray_hint_shown      boolean (one-time "still running" balloon)

"use strict";

const path = require("path");
const badge = require("./badge");
const bootstrap = require("./bootstrap");
const { createStartup } = require("./startup");
const { cliCommandString } = require("./cli_windows");

const HEARTBEAT_MS = 30000;

/**
 * @param {object} deps
 * @param {import("electron").App} deps.app
 * @param {typeof import("electron").BrowserWindow} deps.BrowserWindow
 * @param {typeof import("electron").Tray} deps.Tray
 * @param {typeof import("electron").Menu} deps.Menu
 * @param {typeof import("electron").nativeImage} deps.nativeImage
 * @param {import("electron").Dialog} deps.dialog
 * @param {import("electron").Shell} deps.shell
 * @param {typeof import("electron").Notification} [deps.Notification]
 * @param {() => Record<string, unknown>} deps.loadSettings
 * @param {(s: Record<string, unknown>) => void} deps.saveSettings
 * @param {() => Electron.BrowserWindow | null} deps.activeWindow
 * @param {(url?: string) => Electron.BrowserWindow} deps.createWindow
 * @param {() => Electron.BrowserWindow[]} deps.shellWindows All shell windows (not popups/overlays).
 * @param {(win: Electron.BrowserWindow, url: string) => void} deps.loadServerUrl Navigate a window to a server.
 * @param {object} deps.serverManager
 * @param {object} deps.omnigentCli
 * @param {() => string | null} deps.resolvedCliPath
 * @param {() => void} deps.changeServer
 * @param {() => void} deps.checkForUpdates
 * @param {() => void} [deps.openSettings]
 * @param {() => void} [deps.checkOmnigentUpdates]
 * @param {string} deps.iconPath Path to icon.ico / icon.png for the tray.
 * @param {string} deps.logDir Log folder for "Open log folder".
 * @param {{ info: Function, warn: Function, error: Function }} deps.log
 * @param {string[]} [deps.argv]
 */
function createWindowsIntegration(deps) {
  const {
    app,
    Tray,
    Menu,
    nativeImage,
    dialog,
    shell,
    Notification,
    loadSettings,
    saveSettings,
    activeWindow,
    createWindow,
    shellWindows,
    loadServerUrl,
    serverManager,
    omnigentCli,
    resolvedCliPath,
    changeServer,
    checkForUpdates,
    iconPath,
    logDir,
    log,
  } = deps;
  const startup = createStartup({ app });
  let tray = null;
  let quitting = false;
  let heartbeat = null;
  let lastServerStatus = { state: "unknown", url: null, owned: false };
  let lastBadgeTotal = 0;
  let busy = false;

  // ---- settings -----------------------------------------------------------

  function setting(key, def) {
    const v = loadSettings()[key];
    return v === undefined || v === null ? def : v;
  }
  function setSetting(key, value) {
    const s = loadSettings();
    s[key] = value;
    saveSettings(s);
  }
  const closeToTray = () => setting("win_close_to_tray", true) !== false;
  const notificationsEnabled = () => setting("win_notifications_enabled", true) !== false;

  // ---- quit vs close ------------------------------------------------------

  /**
   * Mark that a real quit is in progress so window close handlers let it
   * through. Called from the shell's before-quit (menu Quit, Ctrl+Q, updater
   * restart) as well as from the tray's Quit.
   */
  function markQuitting() {
    quitting = true;
    stopHeartbeat();
  }

  function requestQuit() {
    markQuitting();
    app.quit();
  }

  /** window-all-closed hook: keep running in the tray when enabled. */
  function shouldQuitOnAllClosed() {
    return quitting || !tray || !closeToTray();
  }

  /**
   * Called for every new shell window. Installs close-to-tray, applies the
   * current badge overlay, and hides the first window on a login launch.
   *
   * @param {Electron.BrowserWindow} win
   */
  function onWindowCreated(win) {
    win.on("close", (event) => {
      if (quitting || !tray || !closeToTray()) return;
      event.preventDefault();
      win.hide();
      showTrayHintOnce();
    });
    if (lastBadgeTotal > 0) badge.applyBadge(lastBadgeTotal, { nativeImage, windows: [win] });
    if (startup.launchedHidden(deps.argv) && shellWindows().length <= 1) {
      // Login launch: stay in the tray until the user opens the app.
      win.hide();
    }
  }

  function showTrayHintOnce() {
    if (setting("win_tray_hint_shown", false)) return;
    setSetting("win_tray_hint_shown", true);
    try {
      tray.displayBalloon({
        title: "Omnigent is still running",
        content: "Agents keep running in the background. Use the tray icon to open Omnigent or quit.",
        iconType: "info",
      });
    } catch (err) {
      log.warn("[win] tray balloon failed", err);
    }
  }

  // ---- badge --------------------------------------------------------------

  /** Replaces app.setBadgeCount on Windows: taskbar overlay icon per window. */
  function applyBadge(total) {
    lastBadgeTotal = Math.max(0, Number(total) || 0);
    const n = badge.applyBadge(lastBadgeTotal, { nativeImage, windows: shellWindows() });
    log.info(`[win] badge overlay ${lastBadgeTotal} -> ${n} window(s)`);
  }

  // ---- notifications ------------------------------------------------------

  /** Whether a notification may be shown (user setting). */
  function allowNotification() {
    return notificationsEnabled();
  }

  /**
   * Bring a window to the front even when hidden in the tray (notification
   * click, tray click, second instance).
   *
   * @param {Electron.BrowserWindow | null} [win]
   */
  function reveal(win = activeWindow()) {
    let target = win;
    if (!target || target.isDestroyed()) target = shellWindows()[0] ?? null;
    if (!target) {
      target = createWindow();
      return target;
    }
    if (!target.isVisible()) target.show();
    if (target.isMinimized()) target.restore();
    target.focus();
    return target;
  }

  // ---- local server -------------------------------------------------------

  async function refreshServerStatus() {
    const owned = typeof serverManager.ownedLocalServer === "function" ? serverManager.ownedLocalServer() : null;
    let healthy = null;
    try {
      healthy = await omnigentCli.localServerHealthy();
    } catch {
      healthy = null;
    }
    if (healthy) {
      lastServerStatus = { state: "running", url: healthy.url, owned: Boolean(owned) };
    } else if (owned) {
      lastServerStatus = { state: "unhealthy", url: owned.url, owned: true };
    } else {
      lastServerStatus = { state: "stopped", url: null, owned: false };
    }
    return lastServerStatus;
  }

  function statusLabel() {
    const s = lastServerStatus;
    if (busy) return "Local server: working…";
    if (s.state === "running") return `Local server: running at ${s.url}${s.owned ? "" : " (not started by this app)"}`;
    if (s.state === "unhealthy") return `Local server: not responding (${s.url})`;
    if (s.state === "stopped") return "Local server: stopped";
    return "Local server: unknown";
  }

  async function startLocalServer() {
    const cliPath = resolvedCliPath();
    if (!cliPath) {
      await dialog.showMessageBox(activeWindow() ?? undefined, {
        type: "info",
        title: "Omnigent",
        message: "Omnigent is not installed",
        detail: "Open Omnigent and follow the setup steps to install the Omnigent CLI first.",
        buttons: ["OK"],
      });
      reveal();
      return { ok: false, error: "cli missing" };
    }
    busy = true;
    rebuildTrayMenu();
    try {
      const res = await serverManager.startLocalServer(cliPath, (line) => log.info(`[win][server] ${line}`));
      if (res.ok && res.url) {
        log.info(`[win] local server ${res.alreadyRunning ? "reused" : "started"} at ${res.url}`);
        const win = reveal();
        const current = win.webContents.getURL();
        if (!current.startsWith(res.url)) loadServerUrl(win, res.url);
        startHeartbeat();
        // Let the shell re-enrol this machine as the host when the user set
        // that up before (win_auto_host).
        if (typeof deps.onLocalServerReady === "function") {
          try {
            deps.onLocalServerReady(res.url);
          } catch (err) {
            log.warn("[win] onLocalServerReady failed", err);
          }
        }
      } else {
        log.warn(`[win] local server start failed: ${res.error}`);
        await dialog.showMessageBox(activeWindow() ?? undefined, {
          type: "error",
          title: "Omnigent",
          message: "Could not start the local Omnigent server",
          detail: `${res.error || "Unknown error"}\n\nSee the log folder for details.`,
          buttons: ["OK"],
        });
      }
      return res;
    } finally {
      busy = false;
      await refreshServerStatus();
      rebuildTrayMenu();
    }
  }

  async function stopLocalServer({ confirmForeign = true } = {}) {
    const cliPath = resolvedCliPath();
    if (!cliPath) return { ok: false, error: "cli missing" };
    await refreshServerStatus();
    if (lastServerStatus.state === "stopped") return { ok: true, skipped: true };
    if (!lastServerStatus.owned && confirmForeign) {
      const { response } = await dialog.showMessageBox(activeWindow() ?? undefined, {
        type: "question",
        title: "Stop the local server?",
        message: "This server was not started by Omnigent for Windows",
        detail: `It is running at ${lastServerStatus.url}. Stopping it ends its sessions and web UI. Stop it anyway?`,
        buttons: ["Stop server", "Cancel"],
        defaultId: 1,
        cancelId: 1,
      });
      if (response !== 0) return { ok: false, cancelled: true };
    }
    busy = true;
    rebuildTrayMenu();
    try {
      const res = lastServerStatus.owned
        ? await serverManager.stopOwnedLocalServer(cliPath)
        : await omnigentCli.stopLocalServer(cliPath);
      log.info(`[win] local server stop -> ${JSON.stringify(res)}`);
      stopHeartbeat();
      return res;
    } finally {
      busy = false;
      await refreshServerStatus();
      rebuildTrayMenu();
    }
  }

  async function restartLocalServer() {
    const stopped = await stopLocalServer({ confirmForeign: true });
    if (stopped.cancelled) return stopped;
    return startLocalServer();
  }

  // ---- Omnigent (CLI/server package) updates --------------------------------

  /**
   * `omni upgrade --check`: exit 0 = up to date, non-zero = newer release (or
   * an error, which the text distinguishes). Shows the result and offers the
   * guided upgrade. Returns the parsed outcome.
   */
  async function checkOmnigentUpdates({ interactive = true } = {}) {
    const cmd = resolvedCliPath();
    if (!cmd) {
      if (interactive) reveal();
      return { ok: false, error: "cli missing" };
    }
    const res = await omnigentCli.runCli(cmd, ["upgrade", "--check"], { timeoutMs: 60000 });
    const text = `${res.stdout}\n${res.stderr}`.trim();
    const errored = res.code !== 0 && res.code !== 1;
    const available = res.code === 1;
    log.info(`[win] omni upgrade --check -> code ${res.code}: ${text.slice(0, 300)}`);
    const outcome = { ok: !errored, available, text, code: res.code };
    if (!interactive) return outcome;
    if (errored) {
      await dialog.showMessageBox(activeWindow() ?? undefined, {
        type: "warning",
        title: "Omnigent updates",
        message: "Could not check for Omnigent updates",
        detail: text || `omni upgrade --check exited with code ${res.code}.`,
        buttons: ["OK"],
      });
      return outcome;
    }
    if (!available) {
      await dialog.showMessageBox(activeWindow() ?? undefined, {
        type: "info",
        title: "Omnigent updates",
        message: "Omnigent is up to date",
        detail: text || undefined,
        buttons: ["OK"],
      });
      return outcome;
    }
    const { response } = await dialog.showMessageBox(activeWindow() ?? undefined, {
      type: "question",
      title: "Omnigent updates",
      message: "A newer Omnigent release is available",
      detail: `${text}\n\nUpgrading drains running sessions and restarts the local server on the new version.`,
      buttons: ["Upgrade now…", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) await upgradeOmnigent();
    return outcome;
  }

  /**
   * Guided `omni upgrade`: confirm the exact command, then run it in a visible
   * PowerShell window (never silently). The CLI itself handles draining and
   * stopping the server; the next command respawns it on the new version.
   */
  async function upgradeOmnigent() {
    const cmd = resolvedCliPath();
    if (!cmd) return { ok: false, error: "cli missing" };
    const command = cliCommandString(cmd, ["upgrade"]);
    const { response } = await dialog.showMessageBox(activeWindow() ?? undefined, {
      type: "question",
      title: "Upgrade Omnigent?",
      message: "Run the Omnigent upgrade now?",
      detail:
        "Omnigent will open a PowerShell window and run exactly this command:\n\n" +
        `${command}\n\n` +
        "In-flight agent sessions are allowed to finish first, then the local server stops and comes back on the new version the next time it is needed. Nothing runs without this confirmation.",
      buttons: ["Run in PowerShell", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return { ok: false, cancelled: true };
    try {
      const { pid } = bootstrap.runInConsole(command);
      log.info(`[win] omni upgrade started in a console window (pid ${pid})`);
      return { ok: true, pid, command };
    } catch (err) {
      log.warn("[win] omni upgrade failed to start", err);
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  /** One click: (re)connect this machine as the host for the current server. */
  async function reconnectHost() {
    if (typeof deps.reconnectHost !== "function") return { ok: false, error: "unavailable" };
    busy = true;
    rebuildTrayMenu();
    try {
      const res = await deps.reconnectHost();
      if (!res.ok) {
        await dialog.showMessageBox(activeWindow() ?? undefined, {
          type: "warning",
          title: "Omnigent",
          message: "Could not connect this machine as a host",
          detail: res.error || "Unknown error",
          buttons: ["OK"],
        });
      } else {
        log.info(`[win] host ${res.adopted ? "adopted" : "connected"} for ${res.serverUrl}`);
      }
      return res;
    } finally {
      busy = false;
      rebuildTrayMenu();
    }
  }

  /**
   * Open Claude Code inside the active backend so the user can manage its
   * plugins and skills (`/plugin`, `/skills`) — Claude Code owns those, and
   * Omnigent passes `/name` commands to it verbatim inside sessions.
   */
  async function manageClaudeCode() {
    const cmd = resolvedCliPath();
    const distro = typeof cmd === "object" && cmd && cmd.prefixArgs ? cmd.prefixArgs[1] : null;
    const command = distro ? `wsl -d ${distro} --shell-type login -- claude` : "claude";
    const { response } = await dialog.showMessageBox(activeWindow() ?? undefined, {
      type: "question",
      title: "Claude Code plugins & skills",
      message: distro ? `Open Claude Code inside ${distro}?` : "Open Claude Code?",
      detail:
        `Omnigent will open a PowerShell window running:\n\n${command}\n\n` +
        "Inside it, use /plugin to install or remove plugins and /skills to list skills. Omnigent sessions pass /commands straight to Claude Code, so anything enabled here works in the app. Type /exit when done.",
      buttons: ["Open", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return { ok: false, cancelled: true };
    try {
      const { pid } = bootstrap.runInConsole(command);
      return { ok: true, pid };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  /**
   * Guided `omni setup` (the interactive harness/model/credential picker):
   * confirm, then run in a visible PowerShell window. This is what the SPA's
   * "<harness> isn't configured on <host> — run omni setup" notice asks for.
   */
  async function setupHarnesses() {
    const cmd = resolvedCliPath();
    if (!cmd) {
      reveal();
      return { ok: false, error: "cli missing" };
    }
    const command = cliCommandString(cmd, ["setup"]);
    const { response } = await dialog.showMessageBox(activeWindow() ?? undefined, {
      type: "question",
      title: "Set up agent harnesses",
      message: "Run Omnigent's interactive setup?",
      detail:
        "Omnigent will open a PowerShell window and run exactly this command:\n\n" +
        `${command}\n\n` +
        "It lets you pick a model provider and credentials for each harness (Claude Code, Codex, Cursor, …) and set defaults. Nothing runs without this confirmation.",
      buttons: ["Run in PowerShell", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return { ok: false, cancelled: true };
    try {
      const { pid } = bootstrap.runInConsole(command);
      log.info(`[win] omni setup started in a console window (pid ${pid})`);
      return { ok: true, pid, command };
    } catch (err) {
      log.warn("[win] omni setup failed to start", err);
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  // ---- heartbeat for an owned server ---------------------------------------

  function startHeartbeat() {
    stopHeartbeat();
    heartbeat = setInterval(async () => {
      const owned = typeof serverManager.ownedLocalServer === "function" ? serverManager.ownedLocalServer() : null;
      if (!owned) {
        stopHeartbeat();
        return;
      }
      const before = lastServerStatus.state;
      await refreshServerStatus();
      if (lastServerStatus.state === "unhealthy" && before !== "unhealthy") {
        log.warn(`[win] owned local server stopped responding at ${owned.url}`);
        rebuildTrayMenu();
        if (Notification && Notification.isSupported && Notification.isSupported() && allowNotification()) {
          try {
            const n = new Notification({
              title: "Omnigent server stopped",
              body: "The local Omnigent server stopped responding. Click to restart it.",
            });
            n.on("click", () => void restartLocalServer());
            n.show();
          } catch (err) {
            log.warn("[win] heartbeat notification failed", err);
          }
        }
      }
    }, HEARTBEAT_MS);
    if (typeof heartbeat.unref === "function") heartbeat.unref();
  }

  function stopHeartbeat() {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  }

  // ---- tray ---------------------------------------------------------------

  function trayMenuTemplate() {
    const s = lastServerStatus;
    return [
      { label: "Open Omnigent", click: () => reveal() },
      { label: "New Window", click: () => createWindow() },
      { type: "separator" },
      { label: statusLabel(), enabled: false },
      {
        label: "Start local server",
        enabled: !busy && s.state !== "running",
        click: () => void startLocalServer(),
      },
      {
        label: "Stop local server",
        enabled: !busy && s.state !== "stopped",
        click: () => void stopLocalServer(),
      },
      {
        label: "Restart local server",
        enabled: !busy && s.state !== "stopped",
        click: () => void restartLocalServer(),
      },
      { label: "Change Server…", click: () => changeServer() },
      {
        label: "Reconnect This Machine as Host",
        enabled: !busy,
        click: () => void reconnectHost(),
      },
      { type: "separator" },
      {
        label: "Manage",
        submenu: [
          { label: "New Session (agents, skills, MCP connectors)", click: () => deps.openInApp?.("/") },
          { label: "Automations", click: () => deps.openInApp?.("/tasks") },
          { label: "Inbox", click: () => deps.openInApp?.("/inbox") },
          { type: "separator" },
          { label: "Omnigent Settings", click: () => deps.openInApp?.("/settings/general") },
          { label: "Sandbox Integrations", click: () => deps.openInApp?.("/settings/integrations") },
          { label: "Policies", click: () => deps.openInApp?.("/settings/policies") },
          { label: "Local CLI", click: () => deps.openInApp?.("/settings/cli") },
          { type: "separator" },
          { label: "Claude Code Plugins & Skills…", click: () => void manageClaudeCode() },
          { label: "Set Up Agent Harnesses (omni setup)…", click: () => void setupHarnesses() },
        ],
      },
      { type: "separator" },
      { label: "Check for App Updates…", click: () => checkForUpdates() },
      { label: "Check for Omnigent Updates…", click: () => void checkOmnigentUpdates() },
      ...(deps.openSettings ? [{ label: "Settings…", click: () => deps.openSettings() }] : []),
      { label: "Open Log Folder", click: () => void shell.openPath(logDir) },
      { type: "separator" },
      { label: "Quit Omnigent", click: () => requestQuit() },
    ];
  }

  function rebuildTrayMenu() {
    if (!tray) return;
    try {
      tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
      tray.setToolTip(`Omnigent — ${statusLabel()}`);
    } catch (err) {
      log.warn("[win] tray menu rebuild failed", err);
    }
  }

  function createTray() {
    if (tray) return tray;
    try {
      const image = nativeImage.createFromPath(iconPath);
      tray = new Tray(image.isEmpty && image.isEmpty() ? iconPath : image);
      tray.setToolTip("Omnigent");
      tray.on("click", () => reveal());
      tray.on("double-click", () => reveal());
      // Refresh the status line right before the menu pops (right-click).
      tray.on("right-click", () => {
        void refreshServerStatus().then(rebuildTrayMenu);
      });
      rebuildTrayMenu();
      void refreshServerStatus().then(rebuildTrayMenu);
      log.info("[win] tray created");
    } catch (err) {
      tray = null;
      log.error("[win] tray unavailable; falling back to quit-on-last-window", err);
    }
    return tray;
  }

  // ---- startup ------------------------------------------------------------

  function syncStartWithWindows() {
    const wanted = setting("win_start_with_windows", false) === true;
    if (!app.isPackaged) return;
    const effective = startup.setEnabled(wanted);
    if (effective !== wanted) log.warn(`[win] start-with-Windows wanted=${wanted} effective=${effective}`);
  }

  return {
    HEARTBEAT_MS,
    createTray,
    rebuildTrayMenu,
    trayMenuTemplate,
    onWindowCreated,
    shouldQuitOnAllClosed,
    markQuitting,
    requestQuit,
    isQuitting: () => quitting,
    applyBadge,
    allowNotification,
    reveal,
    refreshServerStatus,
    startLocalServer,
    stopLocalServer,
    restartLocalServer,
    checkOmnigentUpdates,
    upgradeOmnigent,
    setupHarnesses,
    reconnectHost,
    manageClaudeCode,
    startHeartbeat,
    stopHeartbeat,
    syncStartWithWindows,
    startup,
    settings: { get: setting, set: setSetting, closeToTray, notificationsEnabled },
    get tray() {
      return tray;
    },
    get serverStatus() {
      return lastServerStatus;
    },
    iconPath: path.normalize(iconPath),
  };
}

module.exports = { createWindowsIntegration, cliCommandString, HEARTBEAT_MS };
