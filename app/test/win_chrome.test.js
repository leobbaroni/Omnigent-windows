// [win] Tests for chrome.js, toWslPath, and the folder-picker helpers.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const chrome = require("../src/win/chrome");
const { toWslPath } = require("../src/win/wsl");
const picker = require("../src/win/folder_picker_preload");

describe("win chrome", () => {
  it("window options hide the title bar with a themed overlay and auto-hidden menu", () => {
    const light = chrome.windowOptions(false);
    assert.equal(light.titleBarStyle, "hidden");
    assert.equal(light.autoHideMenuBar, true);
    assert.equal(light.titleBarOverlay.height, chrome.OVERLAY_HEIGHT);
    assert.equal(light.titleBarOverlay.color, "#ffffff");
    assert.equal(chrome.windowOptions(true).titleBarOverlay.color, "#0b0b0c");
  });

  it("classifies server, setup and foreign pages", () => {
    const setupPath = "/C:/app/setup/index.html";
    assert.deepEqual(chrome.classify("http://127.0.0.1:6767/c/x", "http://127.0.0.1:6767", setupPath), { isServerPage: true, isSetupPage: false });
    assert.deepEqual(chrome.classify("file:///C:/app/setup/index.html?error=x", null, setupPath), { isServerPage: false, isSetupPage: true });
    assert.deepEqual(chrome.classify("https://idp.example.com/login", "http://127.0.0.1:6767", setupPath), { isServerPage: false, isSetupPage: false });
    assert.deepEqual(chrome.classify("not a url", null, setupPath), { isServerPage: false, isSetupPage: false });
    // Portable build: temp dir under a short 8.3 profile name; Node encodes `~`.
    assert.equal(chrome.classify("file:///C:/Users/TUGAPL~1/Temp/x/app.asar/setup/index.html", null, "/C:/Users/TUGAPL%7E1/Temp/x/app.asar/setup/index.html").isSetupPage, true);
  });

  it("settings sender gate tolerates %7E vs ~ and case", () => {
    const { samePath } = require("../src/win/settings_window");
    assert.equal(samePath("/C:/Users/TUGAPL~1/a/settings-win/index.html", "/C:/Users/TUGAPL%7E1/A/settings-win/index.html"), true);
    assert.equal(samePath("/C:/a/x.html", "/C:/a/y.html"), false);
  });

  it("applies the matching stylesheet and never throws", async () => {
    const inserted = [];
    const wc = { insertCSS: async (css) => inserted.push(css) };
    assert.equal(await chrome.applyCss(wc, { isServerPage: true, isSetupPage: false }), "server");
    assert.equal(await chrome.applyCss(wc, { isServerPage: false, isSetupPage: true }), "setup");
    assert.equal(await chrome.applyCss(wc, { isServerPage: false, isSetupPage: false }), null);
    assert.ok(inserted[0].includes("-webkit-app-region: drag"));
    assert.ok(inserted[1].includes(".gear-btn"));
    const broken = { insertCSS: async () => { throw new Error("gone"); } };
    assert.equal(await chrome.applyCss(broken, { isServerPage: true, isSetupPage: false }), null);
  });

  it("attach re-injects on load and syncs the overlay", () => {
    const handlers = {};
    const overlays = [];
    const win = {
      isDestroyed: () => false,
      setTitleBarOverlay: (o) => overlays.push(o),
      webContents: { on: (ev, fn) => (handlers[ev] = fn), getURL: () => "http://s:1/", insertCSS: async () => {} },
    };
    chrome.attach(win, { pinnedOrigin: () => "http://s:1", setupPagePathname: "/x", isDark: () => true });
    assert.equal(overlays[0].color, "#0b0b0c");
    assert.equal(typeof handlers["did-finish-load"], "function");
  });
});

describe("win wsl: toWslPath", () => {
  it("maps drive paths to /mnt and leaves others alone", () => {
    assert.equal(toWslPath("C:\\Users\\me\\proj"), "/mnt/c/Users/me/proj");
    assert.equal(toWslPath("D:/work/"), "/mnt/d/work");
    assert.equal(toWslPath("/home/me"), "/home/me");
    assert.equal(toWslPath("\\\\server\\share"), "\\\\server\\share");
  });
});

describe("win folder picker preload", () => {
  it("is a no-op off Windows and exposes the IPC channel", () => {
    const dispose = picker.installFolderPicker({ ipcRenderer: {}, doc: null, platform: "linux" });
    assert.equal(typeof dispose, "function");
    assert.equal(picker.IPC_CHANNEL, "omnigent:win-pick-directory");
  });

  it("setControlledInputValue uses the prototype setter and fires input/change", () => {
    const events = [];
    class FakeInput {
      constructor() {
        this._v = "";
      }
      get value() {
        return this._v;
      }
      set value(v) {
        this._v = `proto:${v}`;
      }
      dispatchEvent(e) {
        events.push(e.type);
      }
    }
    const input = new FakeInput();
    picker.setControlledInputValue(input, "C:\\x", FakeInput);
    assert.equal(input.value, "proto:C:\\x");
    assert.deepEqual(events, ["input", "change"]);
  });
});

it("[win] overlay blends with the sampled page background", async () => {

  assert.equal(chrome.cssColorToHex("rgb(30, 26, 43)"), "#1e1a2b");
  assert.equal(chrome.cssColorToHex("rgba(30, 26, 43, 0.9)"), "#1e1a2b");
  assert.equal(chrome.cssColorToHex("rgba(0, 0, 0, 0)"), null);
  assert.equal(chrome.cssColorToHex("transparent"), null);
  assert.equal(chrome.cssColorToHex("#ABCDEF"), "#abcdef");
  assert.equal(chrome.cssColorToHex("#abcdef00"), null);
  assert.equal(chrome.symbolColorFor("#1e1a2b"), "#e6e6ea");
  assert.equal(chrome.symbolColorFor("#fafafa"), "#1b1b1f");

  const calls = [];
  const win = {
    isDestroyed: () => false,
    setTitleBarOverlay: (o) => calls.push(o),
    webContents: { executeJavaScript: async () => "rgb(30, 26, 43)" },
  };
  await chrome.blendOverlay(win, true);
  await chrome.blendOverlay(win, true); // unchanged → no second call
  assert.deepEqual(calls, [{ color: "#1e1a2b", symbolColor: "#e6e6ea", height: chrome.OVERLAY_HEIGHT }]);

  const fallback = [];
  await chrome.blendOverlay(
    { isDestroyed: () => false, setTitleBarOverlay: (o) => fallback.push(o), webContents: { executeJavaScript: async () => null } },
    true,
  );
  assert.equal(fallback[0].color, chrome.overlayColors(true).color);
});
