// [win] Shell-owned Windows settings window + its IPC.
//
// A small bundled page (settings-win/index.html) with three IPC calls, each
// gated on the sender being that exact page (same technique as the setup
// page). Owns: connection settings (default server, local mode native/WSL,
// distro, auto-start), application settings (close-to-tray, start with
// Windows, notifications, app update mode), diagnostics (versions, CLI and
// server status, compatibility, paths, copy/open actions).

"use strict";

const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const wsl = require("./wsl");
const compat = require("./compat");

const PAGE = path.join(__dirname, "..", "..", "settings-win", "index.html");
const PRELOAD = path.join(__dirname, "settings_preload.js");

const BOOL_KEYS = ["win_close_to_tray", "win_start_with_windows", "win_notifications_enabled", "win_auto_start_local"];

/**
 * @param {object} deps
 * @param {typeof import("electron").BrowserWindow} deps.BrowserWindow
 * @param {import("electron").IpcMain} deps.ipcMain
 * @param {import("electron").Shell} deps.shell
 * @param {import("electron").Clipboard} deps.clipboard
 * @param {import("electron").App} deps.app
 * @param {() => Record<string, unknown>} deps.loadSettings
 * @param {(s: Record<string, unknown>) => void} deps.saveSettings
 * @param {object} deps.integration createWindowsIntegration() result
 * @param {() => Promise<object>} deps.getCliStatus
 * @param {{ getConfig: Function, setConfig: Function, getStatus: Function }} deps.updater
 * @param {() => void} deps.changeServer
 * @param {() => void} deps.checkForUpdates
 * @param {string} deps.logDir
 * @param {string} deps.settingsPath
 * @param {{ info: Function, warn: Function }} deps.log
 * @param {() => string | null} [deps.activeWindowServerUrl]
 */
function createSettingsWindow(deps) {
  const { BrowserWindow, ipcMain, shell, clipboard, app, loadSettings, saveSettings, integration, getCliStatus, updater, changeServer, checkForUpdates, logDir, settingsPath, log } = deps;
  let win = null;

  function isSettingsSender(event) {
    try {
      const url = new URL(event.senderFrame?.url ?? "");
      return url.protocol === "file:" && url.pathname === pathToFileURL(PAGE).pathname;
    } catch {
      return false;
    }
  }

  function open(parent) {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      return win;
    }
    win = new BrowserWindow({
      width: 680,
      height: 760,
      minWidth: 560,
      minHeight: 520,
      title: "Omnigent Settings",
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      autoHideMenuBar: true,
      backgroundColor: "#f6f6f7",
      webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setMenuBarVisibility(false);
    win.on("closed", () => {
      win = null;
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    void win.loadFile(PAGE);
    return win;
  }

  async function snapshot() {
    const s = loadSettings();
    const cli = await getCliStatus().catch(() => ({ installed: false, version: null, path: null }));
    const server = await integration.refreshServerStatus().catch(() => ({ state: "unknown" }));
    let distros = [];
    try {
      distros = wsl.listDistros();
    } catch {
      distros = [];
    }
    return {
      settings: {
        win_close_to_tray: s.win_close_to_tray !== false,
        win_start_with_windows: s.win_start_with_windows === true,
        win_notifications_enabled: s.win_notifications_enabled !== false,
        win_auto_start_local: s.win_auto_start_local === true,
        win_local_mode: s.win_local_mode === "wsl" ? "wsl" : "native",
        win_wsl_distro: typeof s.win_wsl_distro === "string" ? s.win_wsl_distro : "",
        server_url: typeof s.server_url === "string" ? s.server_url : null,
        omnigent_path: typeof s.omnigent_path === "string" ? s.omnigent_path : null,
      },
      update: { ...updater.getConfig(), status: updater.getStatus() },
      versions: {
        app: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        os: `Windows ${os.release()}`,
        arch: process.arch,
        packaged: app.isPackaged,
      },
      cli,
      compat: compat.assess(cli.version),
      support: compat.SUPPORT,
      server,
      startWithWindowsEffective: integration.startup.isEnabled(),
      wsl: { distros },
      paths: { settings: settingsPath, logs: logDir, dataDir: path.join(os.homedir(), ".omnigent") },
    };
  }

  function diagnosticsText(snap) {
    const lines = [
      `Omnigent for Windows ${snap.versions.app} (packaged=${snap.versions.packaged})`,
      `Electron ${snap.versions.electron}, Chromium ${snap.versions.chrome}, Node ${snap.versions.node}, ${snap.versions.os} ${snap.versions.arch}`,
      `CLI: ${snap.cli.installed ? `${snap.cli.version} at ${snap.cli.path} (${snap.cli.source})` : "not found"}`,
      `Compatibility: ${snap.compat.status}${snap.compat.message ? ` — ${snap.compat.message}` : ""} (tested ${snap.support.tested.join(", ")}, min ${snap.support.minimum}, upstream ${snap.support.upstreamPin})`,
      `Local server: ${snap.server.state}${snap.server.url ? ` at ${snap.server.url}` : ""}${snap.server.owned ? " (owned by this app)" : ""}`,
      `Local mode: ${snap.settings.win_local_mode}${snap.settings.win_wsl_distro ? ` (${snap.settings.win_wsl_distro})` : ""}; WSL distros: ${snap.wsl.distros.join(", ") || "none"}`,
      `Default server: ${snap.settings.server_url || "(none)"}`,
      `Settings: close-to-tray=${snap.settings.win_close_to_tray}, start-with-windows=${snap.settings.win_start_with_windows} (effective ${snap.startWithWindowsEffective}), notifications=${snap.settings.win_notifications_enabled}, auto-start-local=${snap.settings.win_auto_start_local}, updates=${snap.update.mode}`,
      `Paths: settings=${snap.paths.settings}; logs=${snap.paths.logs}; data=${snap.paths.dataDir}`,
    ];
    return lines.join("\n");
  }

  function applyPatch(patch) {
    const s = loadSettings();
    const p = patch && typeof patch === "object" ? patch : {};
    for (const k of BOOL_KEYS) if (typeof p[k] === "boolean") s[k] = p[k];
    if (p.win_local_mode === "wsl" || p.win_local_mode === "native") s.win_local_mode = p.win_local_mode;
    if (typeof p.win_wsl_distro === "string") s.win_wsl_distro = p.win_wsl_distro.trim();
    saveSettings(s);
    if (p.update_mode || typeof p.update_auto_install === "boolean") {
      updater.setConfig({
        ...(p.update_mode ? { mode: p.update_mode } : {}),
        ...(typeof p.update_auto_install === "boolean" ? { autoInstall: p.update_auto_install } : {}),
      });
    }
    integration.syncStartWithWindows();
    integration.rebuildTrayMenu();
    log.info(`[win] settings updated: ${Object.keys(p).join(", ")}`);
  }

  function registerIpc() {
    ipcMain.handle("omnigent:win-settings-get", async (event) => {
      if (!isSettingsSender(event)) throw new Error("win-settings-get is only available to the settings page");
      return snapshot();
    });
    ipcMain.handle("omnigent:win-settings-set", async (event, patch) => {
      if (!isSettingsSender(event)) throw new Error("win-settings-set is only available to the settings page");
      applyPatch(patch);
      return snapshot();
    });
    ipcMain.handle("omnigent:win-settings-action", async (event, name) => {
      if (!isSettingsSender(event)) throw new Error("win-settings-action is only available to the settings page");
      switch (name) {
        case "open-logs":
          await shell.openPath(logDir);
          return { ok: true };
        case "show-settings-file":
          shell.showItemInFolder(settingsPath);
          return { ok: true };
        case "copy-diagnostics":
          clipboard.writeText(diagnosticsText(await snapshot()));
          return { ok: true };
        case "change-server":
          changeServer();
          return { ok: true };
        case "start-server":
          return integration.startLocalServer();
        case "stop-server":
          return integration.stopLocalServer();
        case "restart-server":
          return integration.restartLocalServer();
        case "check-app-updates":
          checkForUpdates();
          return { ok: true };
        case "check-omnigent-updates":
          return integration.checkOmnigentUpdates();
        case "upgrade-omnigent":
          return integration.upgradeOmnigent();
        case "setup-harnesses":
          return integration.setupHarnesses();
        default:
          return { ok: false, error: `unknown action ${name}` };
      }
    });
  }

  return { open, registerIpc, snapshot, diagnosticsText, applyPatch, isSettingsSender, PAGE };
}

module.exports = { createSettingsWindow, BOOL_KEYS };
