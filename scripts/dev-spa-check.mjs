#!/usr/bin/env node
// Launch against a running server, wait for the SPA, report the Windows
// enhancements (chrome CSS applied, folder-picker button present, bridge kind)
// and screenshot. Usage: node scripts/dev-spa-check.mjs <server-url> <out.png>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "app");
const require = createRequire(path.join(appRoot, "package.json"));
const { _electron: electron } = require("playwright");
const serverUrl = process.argv[2] || "http://127.0.0.1:6767";
const out = process.argv[3] || path.join(os.tmpdir(), "omnigent-spa.png");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-spa-"));
fs.writeFileSync(path.join(userDataDir, "settings.json"), JSON.stringify({ server_url: serverUrl }));
const t0 = Date.now();
const stage = (s) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

const app = await electron.launch({ args: [appRoot, `--user-data-dir=${userDataDir}`] });
let exited = false;
app.process().once("exit", () => (exited = true));
await app.firstWindow();
let page = null;
for (let i = 0; i < 80 && !page; i += 1) {
  page = app.windows().find((w) => w.url().startsWith(serverUrl)) ?? null;
  if (!page) await new Promise((r) => setTimeout(r, 250));
}
if (!page) throw new Error("no window on the server URL");
const consoleLines = [];
page.on("console", (m) => consoleLines.push(`${m.type()}: ${m.text().slice(0, 200)}`));
await page.waitForLoadState("domcontentloaded");
await page.waitForFunction(() => document.querySelector(".app-shell") !== null, null, { timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 6000));
// Open the working-directory picker if a folder chip is visible.
const opened = await page.evaluate(() => {
  const chip = [...document.querySelectorAll("button")].find((b) => /^\s*\/?\s*$/.test(b.textContent || "") && b.querySelector("svg"));
  const byLabel = document.querySelector('[data-testid="new-chat-landing-workspace-chip"], [data-testid="workspace-picker-trigger"], button[aria-label*="orking director" i]');
  const target = byLabel || chip;
  if (target) {
    target.click();
    return target.outerHTML.slice(0, 160);
  }
  return null;
});
await new Promise((r) => setTimeout(r, 1200));
const report = await page.evaluate(() => ({
  bridge: window.omnigentDesktop && window.omnigentDesktop.kind,
  appShell: Boolean(document.querySelector(".app-shell")),
  dragStripCss: getComputedStyle(document.querySelector(".app-shell") || document.body, "::before").getPropertyValue("-webkit-app-region"),
  pathInput: Boolean(document.querySelector('[data-testid="workspace-path-input"], [data-testid="workspace-picker-path-input"]')),
  browseToggle: Boolean(document.querySelector('[data-testid="workspace-browse-toggle"], [data-testid="workspace-picker-home"]')),
  hostChip: (document.querySelector('[data-testid="new-chat-landing-host-chip"]') || {}).textContent,
  winPicker: Boolean(document.querySelector('[data-testid="win-pick-directory"]')),
  testids: [...document.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")).filter((v, i, a) => a.indexOf(v) === i).slice(0, 60),
}));
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, opened, ...report, console: consoleLines.filter((l) => /win\]|folder|preload|Error/i.test(l)).slice(0, 10) }, null, 2));
await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("quit_app")?.click());
await new Promise((r) => setTimeout(r, 3000));
stage(`exited=${exited}`);
if (!exited) {
  try {
    process.kill(app.process().pid);
  } catch {}
}
process.exit(0);
