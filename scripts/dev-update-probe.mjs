#!/usr/bin/env node
// End-to-end update-feed check on a PACKAGED build: launch the exe with an
// isolated user-data dir pointed at a running server, attach over CDP, open
// Omnigent's Settings → Updates page, press "Check for updates now" and print
// the status the page shows. Usage:
//   node scripts/dev-update-probe.mjs <exe> [serverUrl]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "app", "package.json"));
const { chromium } = require("playwright");
const exe = process.argv[2];
const serverUrl = process.argv[3] || "http://127.0.0.1:6767/";
const port = 9224;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-upd-"));
fs.writeFileSync(
  path.join(userDataDir, "settings.json"),
  JSON.stringify({ server_url: serverUrl, allowed_hosting_origins: [serverUrl.replace(/\/$/, "")], win_auto_host: false, win_auto_start_local: false }),
);
const child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`], {
  detached: true,
  stdio: "ignore",
  windowsHide: false,
});
child.unref();
console.log("launched pid", child.pid, "userData", userDataDir);
let browser = null;
for (let i = 0; i < 90 && !browser; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
}
if (!browser) throw new Error("could not attach over CDP");
let page = null;
for (let i = 0; i < 60 && !page; i += 1) {
  page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(serverUrl)) ?? null;
  if (!page) await new Promise((r) => setTimeout(r, 1000));
}
if (!page) throw new Error("server page did not appear: " + browser.contexts().flatMap((c) => c.pages()).map((p) => p.url()));
await page.waitForLoadState("domcontentloaded");
await new Promise((r) => setTimeout(r, 3000));
await page.evaluate(() => history.pushState({}, "", "/settings/updates"));
await page.evaluate(() => dispatchEvent(new PopStateEvent("popstate")));
await new Promise((r) => setTimeout(r, 2500));
const btn = page.getByRole("button", { name: /check for updates/i });
await btn.click({ timeout: 10000 });
let last = "";
for (let i = 0; i < 30; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  const text = await page.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
  const m = /Updates[\s\S]*?(Last check[^\n]*(?:\n[^\n]*)?|Update available[^\n]*|up to date[^\n]*|No update[^\n]*|\d+\.\d+\.\d+ is available[^\n]*)/i.exec(text);
  last = m ? m[1] : text.slice(0, 400);
  if (m) break;
}
console.log("UPDATES PAGE:", last.replace(/\s+/g, " ").slice(0, 400));
const full = await page.evaluate(() => (document.querySelector("main")?.innerText ?? "").slice(0, 900));
console.log("---\n" + full);
try {
  process.kill(child.pid);
} catch {}
spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
process.exit(0);
