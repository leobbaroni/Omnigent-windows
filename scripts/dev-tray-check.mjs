#!/usr/bin/env node
// Development check for the Windows tray / close-to-tray / quit path:
// launch with an isolated user-data dir, close the only window, verify the
// app is still alive with the window hidden, then quit via the tray's path
// and verify the process exits. Prints the shell log tail.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "app");
const require = createRequire(path.join(appRoot, "package.json"));
const { _electron: electron } = require("playwright");

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-tray-"));
const t0 = Date.now();
const stage = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const app = await electron.launch({ args: [appRoot, `--user-data-dir=${userDataDir}`] });
let exited = false;
app.process().once("exit", (c) => {
  exited = true;
  stage(`process exit ${c}`);
});
await app.firstWindow();
await new Promise((r) => setTimeout(r, 3000));

const before = await app.evaluate(({ BrowserWindow }) => {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.webContents.getURL().includes("overlay"));
  return { count: wins.length, visible: wins.map((w) => w.isVisible()) };
});
stage(`windows before close: ${JSON.stringify(before)}`);

await app.evaluate(({ BrowserWindow }) => {
  const main = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes("overlay"));
  main.close();
});
await new Promise((r) => setTimeout(r, 1500));
const after = await app
  .evaluate(({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows().filter((w) => !w.webContents.getURL().includes("overlay"));
    return { count: wins.length, visible: wins.map((w) => w.isVisible()), destroyed: wins.map((w) => w.isDestroyed()) };
  })
  .catch((e) => `evaluate failed: ${e.message.split("\n")[0]}`);
stage(`after close: alive=${!exited} ${JSON.stringify(after)}`);

// Badge overlay: drive the same path the SPA uses (updateBadge via a window state).
const badge = await app
  .evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes("overlay"));
    return typeof main.setOverlayIcon === "function";
  })
  .catch(() => "n/a");
stage(`setOverlayIcon available: ${badge}`);

// Quit through the menu item (same path as the tray's Quit).
await app.evaluate(({ Menu }) => {
  const item = Menu.getApplicationMenu()?.getMenuItemById("quit_app");
  if (!item) throw new Error("quit_app menu item missing");
  item.click();
});
await new Promise((r) => setTimeout(r, 4000));
stage(`after quit: exited=${exited}`);
const logFile = path.join(userDataDir, "logs", "omnigent-desktop.log");
stage("log tail:\n" + (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").slice(-12).join("\n") : "(no log file)"));
if (!exited) {
  try {
    process.kill(app.process().pid);
  } catch {}
}
process.exit(exited && after && after.visible && after.visible[0] === false ? 0 : 1);
