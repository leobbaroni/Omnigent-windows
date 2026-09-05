#!/usr/bin/env node
// Launch the shell with an isolated user-data dir via Playwright's Electron
// driver, wait for the first window, and save a screenshot + page text.
//
// Usage: node scripts/dev-screenshot.mjs <out.png> [--server <url>] [--keep-open <ms>] [--settings <json>]
//
// Used during development to look at the app without a manual click-through;
// it is not part of the test suite (see app/e2e for that).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "app");
const require = createRequire(path.join(appRoot, "package.json"));
const { _electron: electron } = require("playwright");

const argv = process.argv.slice(2);
const out = argv[0] || path.join(os.tmpdir(), "omnigent-shot.png");
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i === -1 ? def : argv[i + 1];
};
const serverUrl = opt("--server", null);
const keepOpen = Number(opt("--keep-open", "2500"));
const extraSettings = JSON.parse(opt("--settings", "{}"));
const userDataDir = opt("--user-data", fs.mkdtempSync(path.join(os.tmpdir(), "omni-win-")));
fs.mkdirSync(userDataDir, { recursive: true });
const settings = { ...(serverUrl ? { server_url: serverUrl } : {}), ...extraSettings };
if (Object.keys(settings).length) {
  fs.writeFileSync(path.join(userDataDir, "settings.json"), JSON.stringify(settings, null, 2));
}

const t0 = Date.now();
const stage = (s) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const app = await electron.launch({
  args: [appRoot, `--user-data-dir=${userDataDir}`],
  env: { ...process.env },
});
stage("launched");
app.process().once("exit", (code) => stage(`electron process exited (${code})`));
let win = await app.firstWindow();
stage(`firstWindow ${win.url()}`);
// The shell also opens an update-overlay corner window; prefer the main
// window (setup page or a server origin) when several exist.
const wantSetup = !serverUrl;
for (let i = 0; i < 40; i += 1) {
  const pick = app
    .windows()
    .find((w) => (wantSetup ? w.url().includes("/setup/") : !w.url().includes("overlay")));
  if (pick) {
    win = pick;
    break;
  }
  await new Promise((r) => setTimeout(r, 250));
}
stage(`picked ${win.url()}`);
await win.waitForLoadState("domcontentloaded").catch(() => {});
await new Promise((r) => setTimeout(r, keepOpen));
stage("interactions");
// Optional interactions before the shot: --click <selector> (repeatable).
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--click") {
    await win.click(argv[i + 1]).catch((e) => console.error("click failed:", e.message));
    await new Promise((r) => setTimeout(r, 800));
  }
}
// --wait-url <regex>: after interactions, wait (up to 180 s) for the window
// to navigate somewhere matching the regex (e.g. a started local server).
const waitUrl = opt("--wait-url", null);
if (waitUrl) {
  const re = new RegExp(waitUrl);
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline && !re.test(win.url())) await new Promise((r) => setTimeout(r, 1000));
  stage(`wait-url: ${re.test(win.url()) ? "matched" : "TIMEOUT"} ${win.url()}`);
  await win.waitForLoadState("domcontentloaded").catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));
}
if (argv.includes("--full")) {
  // Grow the window so long modals are fully visible.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setSize(1100, 1000);
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
}
stage("screenshot");
await win.screenshot({ path: out });
const title = await win.title().catch(() => "");
const text = await win.evaluate(() => document.body.innerText).catch(() => "");
console.log(JSON.stringify({ out, userDataDir, url: win.url(), title, text: text.slice(0, 1500) }, null, 2));
stage("closing");
const closed = app.close();
await Promise.race([closed, new Promise((r) => setTimeout(r, 15000))]);
stage("closed (or gave up waiting)");
process.exit(0);
