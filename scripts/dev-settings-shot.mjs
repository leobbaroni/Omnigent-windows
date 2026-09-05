#!/usr/bin/env node
// Open the Windows settings window through its menu item and screenshot it.
// Usage: node scripts/dev-settings-shot.mjs <out.png>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "app");
const require = createRequire(path.join(appRoot, "package.json"));
const { _electron: electron } = require("playwright");
const out = process.argv[2] || path.join(os.tmpdir(), "omnigent-settings.png");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-settings-"));
const t0 = Date.now();
const stage = (s) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

const app = await electron.launch({ args: [appRoot, `--user-data-dir=${userDataDir}`] });
let exited = false;
app.process().once("exit", () => (exited = true));
await app.firstWindow();
await new Promise((r) => setTimeout(r, 3000));
await app.evaluate(({ Menu }) => {
  const item = Menu.getApplicationMenu()?.getMenuItemById("win_settings");
  if (!item) throw new Error("win_settings menu item missing");
  item.click();
});
stage("settings requested");
let page = null;
for (let i = 0; i < 40 && !page; i += 1) {
  page = app.windows().find((w) => w.url().includes("settings-win")) ?? null;
  if (!page) await new Promise((r) => setTimeout(r, 250));
}
if (!page) throw new Error("settings window did not open");
await page.waitForLoadState("domcontentloaded").catch(() => {});
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: out, fullPage: true });
const text = await page.evaluate(() => document.body.innerText).catch(() => "");
console.log(JSON.stringify({ out, text: text.slice(0, 2500) }, null, 2));
await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("quit_app")?.click());
await new Promise((r) => setTimeout(r, 3000));
stage(`exited=${exited}`);
if (!exited) {
  try {
    process.kill(app.process().pid);
  } catch {}
}
process.exit(0);
