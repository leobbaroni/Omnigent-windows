// [win] Tests for src/win/integration.js with fake Electron objects.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { createWindowsIntegration } = require("../src/win/integration");

function fakeWindow(url = "http://127.0.0.1:6767/") {
  const handlers = {};
  return {
    visible: true,
    minimized: false,
    focused: false,
    overlay: undefined,
    destroyed: false,
    on(ev, fn) {
      handlers[ev] = fn;
    },
    emitClose() {
      let prevented = false;
      handlers.close?.({ preventDefault: () => (prevented = true) });
      return prevented;
    },
    hide() {
      this.visible = false;
    },
    show() {
      this.visible = true;
    },
    isVisible() {
      return this.visible;
    },
    isMinimized() {
      return this.minimized;
    },
    restore() {
      this.minimized = false;
    },
    focus() {
      this.focused = true;
    },
    isDestroyed() {
      return this.destroyed;
    },
    setOverlayIcon(img, desc) {
      this.overlay = { img, desc };
    },
    webContents: { getURL: () => url },
  };
}

function harness(overrides = {}) {
  let settings = { ...(overrides.settings || {}) };
  const log = { lines: [], info: (...a) => log.lines.push(a.join(" ")), warn: (...a) => log.lines.push(a.join(" ")), error: (...a) => log.lines.push(a.join(" ")) };
  const windows = [];
  const trayInstances = [];
  const dialogs = [];
  const cli = {
    healthy: null,
    localServerHealthy: async () => cli.healthy,
    stopLocalServer: async () => ({ ok: true, viaCli: true }),
  };
  const sm = {
    owned: null,
    ownedLocalServer: () => sm.owned,
    startLocalServer: async () => {
      sm.owned = { url: "http://127.0.0.1:6767", pid: 1, port: 6767 };
      cli.healthy = { url: "http://127.0.0.1:6767", pid: 1, port: 6767 };
      return { ok: true, url: "http://127.0.0.1:6767" };
    },
    stopOwnedLocalServer: async () => {
      sm.owned = null;
      cli.healthy = null;
      return { ok: true };
    },
  };
  class Tray {
    constructor(img) {
      this.img = img;
      this.menu = null;
      this.handlers = {};
      this.balloons = [];
      trayInstances.push(this);
    }
    setToolTip(t) {
      this.tip = t;
    }
    setContextMenu(m) {
      this.menu = m;
    }
    on(ev, fn) {
      this.handlers[ev] = fn;
    }
    displayBalloon(b) {
      this.balloons.push(b);
    }
  }
  const loaded = [];
  const integ = createWindowsIntegration({
    app: { isPackaged: false, quit: () => (integ.quitCalled = true), getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings() {} },
    Tray,
    Menu: { buildFromTemplate: (t) => ({ template: t }) },
    nativeImage: { createFromPath: () => ({ isEmpty: () => false }), createFromBuffer: (b) => ({ len: b.length }) },
    dialog: { showMessageBox: async (_w, o) => (dialogs.push(o), { response: overrides.dialogResponse ?? 0 }) },
    shell: { openPath: async (p) => (integ.opened = p) },
    loadSettings: () => settings,
    saveSettings: (s) => (settings = s),
    activeWindow: () => windows[0] ?? null,
    createWindow: (url) => {
      const w = fakeWindow(url);
      windows.push(w);
      integ.onWindowCreated(w);
      return w;
    },
    shellWindows: () => windows,
    loadServerUrl: (w, url) => loaded.push(url),
    serverManager: sm,
    omnigentCli: cli,
    resolvedCliPath: () => overrides.cliPath === undefined ? "C:\\omni.exe" : overrides.cliPath,
    changeServer: () => (integ.changed = true),
    checkForUpdates: () => (integ.checked = true),
    iconPath: "C:\\icon.ico",
    logDir: "C:\\logs",
    log,
    argv: overrides.argv || [],
  });
  return { integ, windows, trayInstances, dialogs, cli, sm, loaded, log, settings: () => settings };
}

describe("win integration: close-to-tray and quit", () => {
  it("hides on close while the tray exists and close-to-tray is on (default)", () => {
    const h = harness();
    h.integ.createTray();
    const w = h.integ.createWindowDep ? null : h.windows;
    const win = fakeWindow();
    h.integ.onWindowCreated(win);
    assert.equal(win.emitClose(), true);
    assert.equal(win.isVisible(), false);
    assert.equal(h.trayInstances[0].balloons.length, 1);
    assert.equal(h.settings().win_tray_hint_shown, true);
    assert.equal(h.integ.shouldQuitOnAllClosed(), false);
    void w;
  });

  it("lets close through when close-to-tray is off or a quit is in progress", () => {
    const h = harness({ settings: { win_close_to_tray: false } });
    h.integ.createTray();
    const win = fakeWindow();
    h.integ.onWindowCreated(win);
    assert.equal(win.emitClose(), false);
    assert.equal(h.integ.shouldQuitOnAllClosed(), true);

    const h2 = harness();
    h2.integ.createTray();
    const win2 = fakeWindow();
    h2.integ.onWindowCreated(win2);
    h2.integ.requestQuit();
    assert.equal(h2.integ.quitCalled, true);
    assert.equal(win2.emitClose(), false);
    assert.equal(h2.integ.shouldQuitOnAllClosed(), true);
  });

  it("falls back to quit-on-last-window when the tray cannot be created", () => {
    const h = harness();
    // Force a Tray failure.
    const failing = createWindowsIntegration({
      ...Object.getOwnPropertyDescriptors ? {} : {},
      app: { isPackaged: false, quit() {} },
      Tray: class {
        constructor() {
          throw new Error("no tray");
        }
      },
      Menu: { buildFromTemplate: (t) => t },
      nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
      dialog: {},
      shell: {},
      loadSettings: () => ({}),
      saveSettings() {},
      activeWindow: () => null,
      createWindow: () => fakeWindow(),
      shellWindows: () => [],
      loadServerUrl() {},
      serverManager: {},
      omnigentCli: { localServerHealthy: async () => null },
      resolvedCliPath: () => null,
      changeServer() {},
      checkForUpdates() {},
      iconPath: "x",
      logDir: "y",
      log: h.log,
    });
    assert.equal(failing.createTray(), null);
    assert.equal(failing.shouldQuitOnAllClosed(), true);
    assert.ok(h.log.lines.some((l) => l.includes("tray unavailable")));
  });

  it("hides the first window on a --hidden (login) launch", () => {
    const h = harness({ argv: ["electron", "--hidden"] });
    const win = fakeWindow();
    h.windows.push(win);
    h.integ.onWindowCreated(win);
    assert.equal(win.isVisible(), false);
  });
});

describe("win integration: badge and reveal", () => {
  it("applies the overlay to all windows and to windows created later", () => {
    const h = harness();
    const a = fakeWindow();
    h.windows.push(a);
    h.integ.onWindowCreated(a);
    h.integ.applyBadge(3);
    assert.equal(a.overlay.desc, "3 unread Omnigent sessions");
    const b = fakeWindow();
    h.windows.push(b);
    h.integ.onWindowCreated(b);
    assert.equal(b.overlay.desc, "3 unread Omnigent sessions");
    h.integ.applyBadge(0);
    assert.equal(a.overlay.img, null);
  });

  it("reveal shows a hidden window, restores a minimized one, or creates one", () => {
    const h = harness();
    const w = fakeWindow();
    w.visible = false;
    w.minimized = true;
    h.windows.push(w);
    h.integ.reveal();
    assert.equal(w.visible, true);
    assert.equal(w.minimized, false);
    assert.equal(w.focused, true);
    const h2 = harness();
    const created = h2.integ.reveal();
    assert.ok(created);
    assert.equal(h2.windows.length, 1);
  });
});

describe("win integration: local server actions", () => {
  it("start: reuses/starts via serverManager, reveals a window and navigates it", async () => {
    const h = harness();
    h.integ.createTray();
    const w = fakeWindow("file:///setup/index.html");
    h.windows.push(w);
    h.integ.onWindowCreated(w);
    const res = await h.integ.startLocalServer();
    assert.equal(res.ok, true);
    assert.deepEqual(h.loaded, ["http://127.0.0.1:6767"]);
    assert.equal(h.integ.serverStatus.state, "running");
    assert.equal(h.integ.serverStatus.owned, true);
    const labels = h.trayInstances[0].menu.template.map((i) => i.label);
    assert.ok(labels.some((l) => l && l.includes("running at http://127.0.0.1:6767")));
  });

  it("start without a CLI explains and reveals instead of failing silently", async () => {
    const h = harness({ cliPath: null });
    const res = await h.integ.startLocalServer();
    assert.equal(res.ok, false);
    assert.match(h.dialogs[0].message, /not installed/);
    assert.equal(h.windows.length, 1);
  });

  it("stop: owned server stops via serverManager; foreign server asks first", async () => {
    const h = harness();
    await h.integ.startLocalServer();
    const res = await h.integ.stopLocalServer();
    assert.equal(res.ok, true);
    assert.equal(h.dialogs.length, 0);
    assert.equal(h.integ.serverStatus.state, "stopped");

    const h2 = harness({ dialogResponse: 1 });
    h2.cli.healthy = { url: "http://127.0.0.1:7000", pid: 9, port: 7000 };
    const cancelled = await h2.integ.stopLocalServer();
    assert.equal(cancelled.cancelled, true);
    assert.match(h2.dialogs[0].message, /not started by Omnigent for Windows/);

    const h3 = harness({ dialogResponse: 0 });
    h3.cli.healthy = { url: "http://127.0.0.1:7000", pid: 9, port: 7000 };
    const stopped = await h3.integ.stopLocalServer();
    assert.equal(stopped.viaCli, true);
  });

  it("menu template carries every required action", () => {
    const h = harness();
    const labels = h.integ.trayMenuTemplate().map((i) => i.label).filter(Boolean);
    for (const l of ["Open Omnigent", "New Window", "Start local server", "Stop local server", "Restart local server", "Change Server…", "Check for App Updates…", "Open Log Folder", "Quit Omnigent"]) {
      assert.ok(labels.includes(l), `missing ${l}`);
    }
  });

  it("notifications gate follows the setting", () => {
    assert.equal(harness().integ.allowNotification(), true);
    assert.equal(harness({ settings: { win_notifications_enabled: false } }).integ.allowNotification(), false);
  });
});
