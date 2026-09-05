#!/usr/bin/env node
// Launch a PACKAGED build (portable exe or installed Omnigent.exe) under
// Playwright with an isolated user-data dir, confirm it boots to the setup
// page as a packaged app, screenshot, and quit through the menu.
// Usage: node scripts/dev-packaged-smoke.mjs <path-to-exe> <out.png>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "app", "package.json"));
const { _electron: electron } = require("playwright");
const exe = process.argv[2];
const out = process.argv[3] || path.join(os.tmpdir(), "omnigent-packaged.png");
if (!exe || !fs.existsSync(exe)) throw new Error(`exe not found: ${exe}`);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-pkg-"));
const t0 = Date.now();
const stage = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

const app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${userDataDir}`], timeout: 120000 });
let exited = false;
app.process().once("exit", (c) => {
  exited = true;
  stage(`process exit ${c}`);
});
await app.firstWindow();
let page = null;
for (let i = 0; i < 80 && !page; i += 1) {
  page = app.windows().find((w) => w.url().includes("/setup/")) ?? null;
  if (!page) await new Promise((r) => setTimeout(r, 250));
}
if (!page) throw new Error("setup page did not appear");
await page.waitForLoadState("domcontentloaded");
await new Promise((r) => setTimeout(r, 3000));
const info = await app.evaluate(({ app: a }) => ({ packaged: a.isPackaged, version: a.getVersion(), name: a.getName(), exe: process.execPath }));
stage(`packaged=${info.packaged} version=${info.version} name=${info.name}\n  exe=${info.exe}`);
const text = await page.evaluate(() => document.body.innerText.slice(0, 300));
stage(`setup text: ${JSON.stringify(text)}`);
await page.screenshot({ path: out });
await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("quit_app")?.click());
await new Promise((r) => setTimeout(r, 4000));
stage(`exited=${exited}`);
if (!exited) {
  try {
    process.kill(app.process().pid);
  } catch {}
}
process.exit(exited ? 0 : 1);
