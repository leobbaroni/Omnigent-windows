// [win] Tests for settings_window.js and the Omnigent-update helpers.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("url");

const { createSettingsWindow } = require("../src/win/settings_window");
const { cliCommandString, createWindowsIntegration } = require("../src/win/integration");

function harness(overrides = {}) {
  let settings = { ...(overrides.settings || {}) };
  let updateConfig = { mode: "default", autoInstall: true, skippedVersion: null };
  const calls = [];
  const integration = {
    syncStartWithWindows: () => calls.push("sync"),
    rebuildTrayMenu: () => calls.push("tray"),
    refreshServerStatus: async () => ({ state: "stopped", url: null, owned: false }),
    startup: { isEnabled: () => false },
    startLocalServer: async () => ({ ok: true }),
    stopLocalServer: async () => ({ ok: true }),
    restartLocalServer: async () => ({ ok: true }),
    checkOmnigentUpdates: async () => ({ ok: true, available: false }),
    upgradeOmnigent: async () => ({ ok: true }),
  };
  const sw = createSettingsWindow({
    BrowserWindow: class {},
    ipcMain: { handle: (name, fn) => calls.push(`ipc:${name}`) },
    shell: { openPath: async () => {}, showItemInFolder() {} },
    clipboard: { writeText: (t) => (sw.copied = t) },
    app: { getVersion: () => "0.12.0", isPackaged: false },
    loadSettings: () => settings,
    saveSettings: (s) => (settings = s),
    integration,
    getCliStatus: async () => overrides.cli || { installed: true, version: "omnigent 0.12.0", path: "C:\\o.exe", source: "path" },
    updater: { getConfig: () => updateConfig, setConfig: (p) => (updateConfig = { ...updateConfig, ...p }), getStatus: () => ({ state: "idle" }) },
    changeServer() {},
    checkForUpdates() {},
    logDir: "C:\\logs",
    settingsPath: "C:\\settings.json",
    log: { info() {}, warn() {} },
  });
  return { sw, settings: () => settings, updateConfig: () => updateConfig, calls };
}

describe("win settings window", () => {
  it("gates IPC on the bundled page's file URL", () => {
    const { sw } = harness();
    const good = { senderFrame: { url: pathToFileURL(sw.PAGE).href } };
    const bad = { senderFrame: { url: "http://127.0.0.1:6767/settings-win/index.html" } };
    assert.equal(sw.isSettingsSender(good), true);
    assert.equal(sw.isSettingsSender(bad), false);
    assert.equal(sw.isSettingsSender({}), false);
  });

  it("applies only allow-listed keys and triggers side effects", () => {
    const h = harness();
    h.sw.applyPatch({ win_close_to_tray: false, win_local_mode: "wsl", win_wsl_distro: " Ubuntu ", update_mode: "manual", server_url: "http://evil", omnigent_path: "x" });
    assert.equal(h.settings().win_close_to_tray, false);
    assert.equal(h.settings().win_local_mode, "wsl");
    assert.equal(h.settings().win_wsl_distro, "Ubuntu");
    assert.equal(h.settings().server_url, undefined);
    assert.equal(h.settings().omnigent_path, undefined);
    assert.equal(h.updateConfig().mode, "manual");
    assert.ok(h.calls.includes("sync") && h.calls.includes("tray"));
    h.sw.applyPatch({ win_local_mode: "bogus" });
    assert.equal(h.settings().win_local_mode, "wsl");
  });

  it("snapshot + diagnostics text include versions, CLI, compat and paths", async () => {
    const { sw } = harness();
    const snap = await sw.snapshot();
    assert.equal(snap.settings.win_close_to_tray, true);
    assert.equal(snap.compat.status, "tested");
    const text = sw.diagnosticsText(snap);
    assert.match(text, /Omnigent for Windows 0\.12\.0/);
    assert.match(text, /CLI: omnigent 0\.12\.0 at C:\\o\.exe/);
    assert.match(text, /Compatibility: tested/);
    assert.match(text, /logs=C:\\logs/);
  });
});

describe("win integration: Omnigent updates", () => {
  it("renders PowerShell command lines for native and WSL CLIs", () => {
    assert.equal(cliCommandString("C:\\Users\\me\\.local\\bin\\omnigent.exe", ["upgrade"]), "& C:\\Users\\me\\.local\\bin\\omnigent.exe upgrade");
    assert.equal(cliCommandString("C:\\Program Files\\o.exe", ["upgrade"]), "& 'C:\\Program Files\\o.exe' upgrade");
    assert.equal(cliCommandString({ executable: "wsl.exe", prefixArgs: ["-d", "Ubuntu", "--", "omnigent"] }, ["upgrade", "--check"]), "wsl.exe -d Ubuntu -- omnigent upgrade --check");
    assert.equal(
      cliCommandString({ executable: "wsl.exe", prefixArgs: ["-d", "Ubuntu", "--", "bash", "-lc", 'exec omnigent "$@"', "omnigent"] }, ["upgrade"]),
      `wsl.exe -d Ubuntu -- bash -lc 'exec omnigent "$@"' omnigent upgrade`,
    );
  });

  function integ({ code, response = 0 }) {
    const dialogs = [];
    const spawned = [];
    const i = createWindowsIntegration({
      app: { isPackaged: false, quit() {} },
      Tray: class {},
      Menu: { buildFromTemplate: (t) => t },
      nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
      dialog: { showMessageBox: async (_w, o) => (dialogs.push(o), { response }) },
      shell: {},
      loadSettings: () => ({}),
      saveSettings() {},
      activeWindow: () => null,
      createWindow: () => ({ on() {}, isVisible: () => true, isMinimized: () => false, focus() {}, show() {}, restore() {}, isDestroyed: () => false, webContents: { getURL: () => "" } }),
      shellWindows: () => [],
      loadServerUrl() {},
      serverManager: {},
      omnigentCli: { runCli: async () => ({ code, stdout: code === 1 ? "omnigent 0.12.0 -> 0.13.0 available" : "up to date", stderr: "" }), localServerHealthy: async () => null },
      resolvedCliPath: () => "C:\\o.exe",
      changeServer() {},
      checkForUpdates() {},
      iconPath: "x",
      logDir: "y",
      log: { info() {}, warn() {}, error() {} },
    });
    return { i, dialogs, spawned };
  }

  it("check: up to date shows an info box; newer offers the guided upgrade", async () => {
    const a = integ({ code: 0 });
    const r = await a.i.checkOmnigentUpdates();
    assert.equal(r.available, false);
    assert.equal(a.dialogs[0].type, "info");

    const b = integ({ code: 1, response: 1 });
    const r2 = await b.i.checkOmnigentUpdates();
    assert.equal(r2.available, true);
    assert.equal(b.dialogs[0].buttons[0], "Upgrade now…");
    assert.equal(b.dialogs.length, 1); // "Later" → no upgrade dialog
  });

  it("check: other exit codes are reported as errors, not as updates", async () => {
    const c = integ({ code: 2 });
    const r = await c.i.checkOmnigentUpdates();
    assert.equal(r.ok, false);
    assert.equal(c.dialogs[0].type, "warning");
  });

  it("upgrade: cancelling the confirmation runs nothing", async () => {
    const d = integ({ code: 0, response: 1 });
    const r = await d.i.upgradeOmnigent();
    assert.equal(r.cancelled, true);
    assert.match(d.dialogs[0].detail, /& C:\\o\.exe upgrade/);
  });
});
