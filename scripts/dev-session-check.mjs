#!/usr/bin/env node
// Drive a real session through the shell against a running server:
//  1. slash-command menu in the composer ("/"),
//  2. start a session that asks a question with the AskUserQuestion tool,
//  3. screenshot the result.
// Usage: node scripts/dev-session-check.mjs <server-url> <outDir> [prompt]
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
const prompt =
  process.argv[4] ||
  "Use your AskUserQuestion tool to ask me which colour I prefer, red or blue. Wait for my answer, then reply with just that colour.";
fs.mkdirSync(outDir, { recursive: true });
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-sess-"));
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
if (!page) throw new Error("no window on the server URL");
await page.waitForSelector('[data-testid="new-chat-landing-input"]', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));

// 1. Slash menu.
const input = page.locator('[data-testid="new-chat-landing-input"]');
await input.click();
await page.keyboard.type("/");
await new Promise((r) => setTimeout(r, 1500));
const slash = await page.evaluate(() => {
  const items = [...document.querySelectorAll('[role="option"], [role="menuitem"], [cmdk-item], [data-slot="command-item"]')];
  const pops = [...document.querySelectorAll('[role="listbox"], [role="dialog"], [data-radix-popper-content-wrapper], [data-slot="popover-content"]')].map((e) => e.innerText.slice(0, 300));
  return { items: items.slice(0, 15).map((e) => e.textContent.trim().slice(0, 60)), pops };
});
stage(`slash menu items: ${JSON.stringify(slash)}`);
await shot(page, "session-slash.png");
await page.keyboard.press("Escape");
await page.keyboard.press("Control+A");
await page.keyboard.press("Backspace");

// 2. Pick a working directory (submit stays disabled until one is chosen).
const wsDir = process.env.OMNIGENT_E2E_WORKSPACE || path.join(os.homedir(), "omnigent-e2e-workspace");
fs.mkdirSync(wsDir, { recursive: true });
await page.click('[data-testid="new-chat-landing-workspace-chip"]');
await page.waitForSelector('[data-testid="workspace-picker-path-input"]', { timeout: 15000 });
await page.fill('[data-testid="workspace-picker-path-input"]', wsDir);
await page.keyboard.press("Enter");
await new Promise((r) => setTimeout(r, 1500));
await page.click('[data-testid="workspace-picker-select"]').catch(() => {});
await new Promise((r) => setTimeout(r, 1000));
stage(`workspace chip: ${await page.locator('[data-testid="new-chat-landing-workspace-chip"]').innerText().catch(() => "?")}`);
await shot(page, "session-workspace.png");

// 2a. Pick the harness (native terminal harnesses do not run on a native
// Windows host; default to the first SDK-based option).
const wantHarness = new RegExp(process.env.OMNIGENT_E2E_HARNESS || "sdk", "i");
await page.click('[data-testid="new-chat-landing-agent-select"]');
await new Promise((r) => setTimeout(r, 1200));
const harnessOptions = await page.evaluate(() => [...document.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], [cmdk-item]')].map((e) => e.textContent.trim().slice(0, 50)));
stage(`harness options: ${JSON.stringify(harnessOptions)}`);
await shot(page, "session-harness-menu.png");
const pickedHarness = await page.evaluate((src) => {
  const re = new RegExp(src, "i");
  const el = [...document.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], [cmdk-item]')].find((e) => re.test(e.textContent));
  if (el) {
    el.click();
    return el.textContent.trim().slice(0, 50);
  }
  return null;
}, wantHarness.source);
stage(`picked harness: ${pickedHarness}`);
if (!pickedHarness) await page.keyboard.press("Escape");
await new Promise((r) => setTimeout(r, 1000));

// 2b. Start a session.
await input.click();
await page.keyboard.type(prompt);
await new Promise((r) => setTimeout(r, 500));
await shot(page, "session-prompt.png");
await page.click('[data-testid="new-chat-landing-submit"]');
stage("submitted");
let questionSeen = false;
for (let i = 0; i < 60; i += 1) {
  await new Promise((r) => setTimeout(r, 3000));
  const state = await page
    .evaluate(() => ({
      url: location.pathname,
      text: document.body.innerText.slice(0, 4000),
      buttons: [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter((t) => /^(red|blue|submit|answer|approve|allow|deny|yes|no)$/i.test(t)).slice(0, 10),
      elicitation: Boolean(document.querySelector('[data-testid*="elicitation"], [data-testid*="question"], [role="radiogroup"]')),
    }))
    .catch(() => null);
  if (!state) break;
  if (i % 5 === 0) {
    stage(`t+${i * 3}s ${state.url} buttons=${JSON.stringify(state.buttons)} elicitation=${state.elicitation}`);
    await shot(page, `session-progress-${i}.png`);
  }
  if (state.elicitation || state.buttons.some((b) => /^(red|blue)$/i.test(b))) {
    questionSeen = true;
    stage(`question UI detected: buttons=${JSON.stringify(state.buttons)}`);
    await shot(page, "session-question.png");
    // Answer "blue" if a button offers it.
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /^blue$/i.test(x.textContent.trim()));
      if (b) {
        b.click();
        return true;
      }
      return false;
    });
    stage(`answered via button: ${clicked}`);
    if (clicked) {
      await new Promise((r) => setTimeout(r, 1500));
      const submit = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => /^(submit|send|answer|confirm)$/i.test(x.textContent.trim()));
        if (b) {
          b.click();
          return true;
        }
        return false;
      });
      stage(`submit clicked: ${submit}`);
    }
    await new Promise((r) => setTimeout(r, 12000));
    await shot(page, "session-after-answer.png");
    break;
  }
  if (/error|failed|isn't configured|needs auth/i.test(state.text) && i > 3) {
    stage(`error text seen: ${state.text.match(/.{0,80}(error|failed|isn't configured|needs auth).{0,120}/i)?.[0]}`);
  }
}
const finalText = await page.evaluate(() => document.body.innerText.slice(0, 3000)).catch(() => "");
await shot(page, "session-final.png");
stage(`questionSeen=${questionSeen}\n--- page text ---\n${finalText}`);
await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("quit_app")?.click());
await new Promise((r) => setTimeout(r, 3000));
stage(`exited=${exited}`);
if (!exited) {
  try {
    process.kill(app.process().pid);
  } catch {}
}
process.exit(0);
