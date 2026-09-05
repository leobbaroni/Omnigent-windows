#!/usr/bin/env node
// Open the most recent session, answer a pending question if any, then type
// "/" in the session composer and capture the slash-command menu.
// Usage: node scripts/dev-session-slash.mjs <server-url> <outDir>
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
const outDir = process.argv[3] || os.tmpdir();
fs.mkdirSync(outDir, { recursive: true });
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-slash-"));
fs.writeFileSync(path.join(userDataDir, "settings.json"), JSON.stringify({ server_url: serverUrl }));
const t0 = Date.now();
const stage = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const shot = (page, name) => page.screenshot({ path: path.join(outDir, name) }).catch(() => {});

const app = await electron.launch({ args: [appRoot, `--user-data-dir=${userDataDir}`] });
let exited = false;
app.process().once("exit", () => (exited = true));
await app.firstWindow();
let page = null;
for (let i = 0; i < 80 && !page; i += 1) {
  page = app.windows().find((w) => w.url().startsWith(serverUrl)) ?? null;
  if (!page) await new Promise((r) => setTimeout(r, 250));
}
await page.waitForSelector('[data-testid="sidebar-conversation-list"]', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));
// Open the first session in the sidebar.
await page.evaluate(() => {
  const list = document.querySelector('[data-testid="sidebar-conversation-list"]');
  const link = list && list.querySelector("a, button, [role='link'], [role='button']");
  if (link) link.click();
});
// SPA routing (no document load): poll the path.
await page.waitForFunction(() => location.pathname.includes("/c/"), null, { timeout: 20000 }).catch(async () => {
  // Fallback: open the newest session by id from the API.
  const id = await page.evaluate(async () => {
    const r = await fetch("/v1/sessions?order=desc&sort_by=updated_at&limit=1");
    const d = await r.json();
    return d.data && d.data[0] && d.data[0].id;
  });
  if (!id) throw new Error("no session found");
  await page.evaluate((sid) => history.pushState({}, "", `/c/${sid}`), id);
  await page.evaluate(() => dispatchEvent(new PopStateEvent("popstate")));
});
await new Promise((r) => setTimeout(r, 3000));
stage(`session ${page.url()}`);

// Answer a pending question: pick "Blue" (radio/button) then Submit.
const answered = await page.evaluate(() => {
  const clickText = (re) => {
    const el = [...document.querySelectorAll("button, [role='radio'], [role='option'], label")].find((x) => re.test(x.textContent.trim()));
    if (el) {
      el.click();
      return el.textContent.trim().slice(0, 40);
    }
    return null;
  };
  const a = clickText(/^Blue/);
  return { picked: a };
});
await new Promise((r) => setTimeout(r, 800));
const submitted = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /^Submit$/.test(x.textContent.trim()) && !x.disabled);
  if (b) {
    b.click();
    return true;
  }
  return false;
});
stage(`answered: ${JSON.stringify(answered)} submitted=${submitted}`);
await new Promise((r) => setTimeout(r, 15000));
await shot(page, "slash-after-answer.png");
const reply = await page.evaluate(() => document.body.innerText.slice(0, 2500));
stage(`page text after answer:\n${reply}`);

// Type "/" in the session composer.
const focused = await page.evaluate(() => {
  const els = [...document.querySelectorAll("textarea, [contenteditable='true']")].filter((e) => e.offsetParent !== null);
  const el = els[els.length - 1];
  if (!el) return null;
  el.focus();
  return el.tagName + " " + (el.getAttribute("placeholder") || el.getAttribute("aria-label") || "");
});
stage(`composer: ${focused}`);
await page.keyboard.type("/");
await new Promise((r) => setTimeout(r, 1500));
const menu = await page.evaluate(() => {
  const items = [...document.querySelectorAll('[role="option"], [role="menuitem"], [cmdk-item], [data-slot="command-item"], [data-testid*="slash"] li, [data-testid*="slash"] button')];
  return items.slice(0, 40).map((e) => e.textContent.trim().replace(/\s+/g, " ").slice(0, 80));
});
stage(`slash menu (${menu.length}): ${JSON.stringify(menu)}`);
await shot(page, "slash-menu.png");
await page.keyboard.type("he");
await new Promise((r) => setTimeout(r, 800));
await shot(page, "slash-menu-filtered.png");
await page.keyboard.press("Escape");
await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("quit_app")?.click());
await new Promise((r) => setTimeout(r, 3000));
stage(`exited=${exited}`);
if (!exited) {
  try {
    process.kill(app.process().pid);
  } catch {}
}
process.exit(0);
