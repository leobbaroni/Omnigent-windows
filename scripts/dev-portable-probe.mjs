#!/usr/bin/env node
// Launch the portable exe the way Explorer would (detached, own console-less
// env) with a remote-debugging port, attach over CDP, and dump what the setup
// page's bridge reports. Usage: node scripts/dev-portable-probe.mjs <exe>
import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "app", "package.json"));
const { chromium } = require("playwright");
const exe = process.argv[2];
const port = 9223;
const child = spawn(exe, [`--remote-debugging-port=${port}`], { detached: true, stdio: "ignore", windowsHide: false });
child.unref();
console.log("launched pid", child.pid);
let browser = null;
for (let i = 0; i < 60 && !browser; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
}
if (!browser) throw new Error("could not attach over CDP");
const pages = browser.contexts().flatMap((c) => c.pages());
console.log("pages:", pages.map((p) => p.url()));
const setup = pages.find((p) => p.url().includes("/setup/"));
if (setup) {
  await new Promise((r) => setTimeout(r, 2500));
  console.log("cli:", JSON.stringify(await setup.evaluate(() => window.omnigentSetup.getCliStatus()).catch((e) => e.message)));
  console.log("text:", JSON.stringify(await setup.evaluate(() => document.body.innerText.slice(0, 200))));
  console.log("env:", JSON.stringify(await setup.evaluate(() => window.omnigentSetup.winBootstrapStatus()).then((s) => s && s.prereqs).catch((e) => e.message)));
}
await browser.close();
process.exit(0);
