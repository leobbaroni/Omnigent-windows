// [win] End-to-end smoke against a REAL Omnigent installation (no mocks).
//
// Launches the shell with an isolated user-data dir, clicks "Start locally",
// waits for the window to land on the managed local server, checks the SPA
// rendered, exercises the settings window, then quits through the menu and
// verifies the process exits and the owned server was stopped.
//
// Skips (does not fail) when playwright/electron are not installed, when the
// platform is not Windows, or when no `omnigent` CLI is detectable — so a
// checkout without Omnigent stays green. Run:
//
//   node --test e2e/win_smoke.e2e.js
//
// Set OMNIGENT_E2E_KEEP_SERVER=1 to leave a pre-existing (adopted) server
// running; an owned server is always stopped by the quit path.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_ROOT = path.resolve(__dirname, "..");

function depsAvailable() {
  try {
    require.resolve("playwright");
    require.resolve("electron");
    return true;
  } catch {
    return false;
  }
}

function cliAvailable() {
  const cli = require("../src/omnigent_cli");
  return cli.resolveCliPath(null) !== null;
}

const skip =
  process.platform !== "win32"
    ? "Windows only"
    : !depsAvailable()
      ? "playwright/electron not installed"
      : !cliAvailable()
        ? "no omnigent CLI on this machine"
        : false;

test("Windows shell: start locally → SPA → settings → quit", { skip, timeout: 240_000 }, async () => {
  const { _electron: electron } = require("playwright");
  const cli = require("../src/omnigent_cli");
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-e2e-"));
  const preexisting = await cli.localServerHealthy();
  const app = await electron.launch({ args: [APP_ROOT, `--user-data-dir=${userDataDir}`] });
  let exited = false;
  app.process().once("exit", () => (exited = true));
  try {
    // Main window = the setup page (the overlay window may come first).
    let setup = null;
    for (let i = 0; i < 40 && !setup; i += 1) {
      setup = app.windows().find((w) => w.url().includes("/setup/")) ?? null;
      if (!setup) await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(setup, "setup page window");
    await setup.waitForLoadState("domcontentloaded");
    // The page detects the CLI asynchronously; until then Start locally opens
    // the CLI dialog instead of starting. The gear loses its attention dot
    // once a CLI was found.
    await setup.waitForSelector("#cli-gear:not([hidden]):not(.attention)", { timeout: 30_000 });
    await setup.waitForSelector("#start-local:not([disabled])", { timeout: 20_000 });
    await new Promise((r) => setTimeout(r, 500));
    await setup.click("#start-local");

    // The click hands off to the server URL; the same page object navigates.
    await setup.waitForURL(/^https?:\/\/127\.0\.0\.1:\d+/, { timeout: 150_000 });
    await setup.waitForLoadState("domcontentloaded");
    await setup.waitForFunction(() => document.body && document.body.innerText.trim().length > 0, null, {
      timeout: 60_000,
    });
    const url = setup.url();
    const status = await cli.localServerHealthy();
    assert.ok(status, "local server healthy after Start locally");
    assert.ok(url.startsWith(status.url), `window on ${url}, server at ${status.url}`);

    // Bridge is live on the server page (kind: electron) and Windows-only IPC
    // is NOT exposed to it.
    const bridge = await setup.evaluate(() => ({
      kind: window.omnigentDesktop && window.omnigentDesktop.kind,
      hasSetup: typeof window.omnigentSetup,
      hasWinSettings: typeof window.omnigentWinSettings,
    }));
    assert.equal(bridge.kind, "electron");
    assert.equal(bridge.hasWinSettings, "undefined");

    // Settings window opens and reports the CLI + running server.
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("win_settings").click());
    let settings = null;
    for (let i = 0; i < 40 && !settings; i += 1) {
      settings = app.windows().find((w) => w.url().includes("settings-win")) ?? null;
      if (!settings) await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(settings, "settings window");
    await settings.waitForFunction(() => /Running at/.test(document.body.innerText), null, { timeout: 20_000 });
    const text = await settings.evaluate(() => document.body.innerText);
    assert.match(text, /omnigent \d+\.\d+\.\d+/);

    // Quit through the explicit menu item (same path as the tray).
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("quit_app").click());
    for (let i = 0; i < 60 && !exited; i += 1) await new Promise((r) => setTimeout(r, 500));
    assert.equal(exited, true, "process exited after Quit");

    const after = await cli.localServerHealthy();
    if (preexisting) {
      assert.ok(after, "a pre-existing (adopted) server is left running");
    } else {
      assert.equal(after, null, "the owned server was stopped on quit");
    }
  } finally {
    if (!exited) {
      try {
        process.kill(app.process().pid);
      } catch {
        /* already gone */
      }
    }
  }
});
