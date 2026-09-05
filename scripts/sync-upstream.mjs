#!/usr/bin/env node
// Sync the vendored Electron shell (app/) from the pinned upstream commit.
//
// Reads upstream.lock.json, verifies the local upstream checkout is at the
// pinned commit, copies web/electron into app/ (minus excludes), never
// overwrites protected Windows-owned files, and for "hooked" upstream files
// (ones this project patched with `// [win]` hooks) writes the new upstream
// version next to ours as `<file>.upstream` and prints a diff hint instead of
// clobbering our hooks. Then (unless --no-build) builds the overlay pages from
// upstream web/ and copies them into app/.
//
// Usage: node scripts/sync-upstream.mjs [--no-build] [--check] [--upstream <dir>]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const args = new Set(process.argv.slice(2));
const noBuild = args.has("--no-build");
const checkOnly = args.has("--check");
const upstreamArg = process.argv[process.argv.indexOf("--upstream") + 1];

const lock = JSON.parse(fs.readFileSync(path.join(root, "upstream.lock.json"), "utf8"));
const upstream = path.resolve(root, process.argv.includes("--upstream") ? upstreamArg : lock.localPath);
const src = path.join(upstream, lock.sourceDir);
const dst = path.join(root, lock.targetDir);

function run(cmd, cmdArgs, opts = {}) {
  const res = spawnSync(cmd, cmdArgs, { encoding: "utf8", stdio: "pipe", shell: process.platform === "win32", ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${cmdArgs.join(" ")} failed:\n${res.stderr || res.stdout}`);
  }
  return (res.stdout || "").trim();
}

function norm(p) {
  return p.split(path.sep).join("/");
}

function matches(list, rel) {
  return list.some((entry) => (entry.endsWith("/") ? rel.startsWith(entry) : rel === entry || rel.startsWith(entry)));
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = norm(path.relative(base, abs)) + (entry.isDirectory() ? "/" : "");
    if (matches(lock.exclude, rel)) continue;
    if (entry.isDirectory()) walk(abs, base, out);
    else out.push(norm(path.relative(base, abs)));
  }
  return out;
}

// 1. Verify the upstream checkout.
if (!fs.existsSync(src)) {
  console.error(`upstream shell not found at ${src}. Clone ${lock.repo} to ${upstream} first.`);
  process.exit(2);
}
const head = run("git", ["-C", upstream, "rev-parse", "--short", "HEAD"]);
if (!head.startsWith(lock.commit) && !lock.commit.startsWith(head)) {
  console.error(`upstream HEAD is ${head}, lock pins ${lock.commit}. Check out the pinned commit (or update upstream.lock.json).`);
  process.exit(2);
}
console.log(`upstream ${lock.repo} @ ${head} (${src})`);

// 2. Copy files.
const files = walk(src);
let copied = 0;
let skippedProtected = 0;
const hookedChanged = [];
for (const rel of files) {
  const from = path.join(src, rel);
  const to = path.join(dst, rel);
  if (matches(lock.protected, rel)) {
    skippedProtected += 1;
    continue;
  }
  if (matches(lock.hooked, rel)) {
    if (fs.existsSync(to)) {
      const ours = fs.readFileSync(to);
      const theirs = fs.readFileSync(from);
      const sidecar = `${to}.upstream`;
      const prev = fs.existsSync(sidecar) ? fs.readFileSync(sidecar) : null;
      if (!ours.equals(theirs)) {
        if (!prev || !prev.equals(theirs)) {
          if (!checkOnly) fs.writeFileSync(sidecar, theirs);
          hookedChanged.push(rel);
        }
      }
      continue;
    }
  }
  if (checkOnly) {
    if (!fs.existsSync(to) || !fs.readFileSync(to).equals(fs.readFileSync(from))) copied += 1;
    continue;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied += 1;
}
console.log(`${checkOnly ? "would copy" : "copied"} ${copied} files; skipped ${skippedProtected} protected`);
if (hookedChanged.length) {
  console.log("hooked upstream files changed; merge by hand from the .upstream sidecars:");
  for (const rel of hookedChanged) console.log(`  ${rel}  (see ${rel}.upstream)`);
}

// 2b. Extra directories outside web/electron that the shell packages.
for (const extra of lock.extras || []) {
  const from = path.join(upstream, extra.from);
  const to = path.join(root, extra.to);
  if (checkOnly) continue;
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  console.log(`copied ${extra.from} -> ${extra.to}`);
}

// 3. Build overlay pages from upstream web/ and copy them in.
if (!noBuild && !checkOnly) {
  const pnpm = ["corepack", ["pnpm", "--filter", "web", "run"]];
  const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" };
  for (const script of ["build:overlay", "build:server-selector-v2"]) {
    console.log(`building ${script} in upstream web/ …`);
    run(pnpm[0], [...pnpm[1], script], { cwd: upstream, env, stdio: "inherit" });
  }
  for (const dir of ["overlay", "server-selector-v2"]) {
    const from = path.join(src, dir);
    const to = path.join(dst, dir);
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true });
    console.log(`copied ${dir}/`);
  }
}

// 4. Record the sync.
if (!checkOnly) {
  const upstreamMd = path.join(dst, "UPSTREAM.md");
  fs.writeFileSync(
    upstreamMd,
    `# Vendored from upstream\n\nSource: ${lock.repo} (${lock.sourceDir}) at commit ${head}, synced ${new Date().toISOString().slice(0, 10)}.\n\n` +
      `Windows-owned files (never overwritten by the sync): ${lock.protected.join(", ")}.\n` +
      `Upstream files carrying \`// [win]\` hooks (merged by hand on sync): ${lock.hooked.join(", ")}.\n\n` +
      `Run \`node scripts/sync-upstream.mjs\` after bumping \`upstream.lock.json\`.\n`,
  );
}
process.exit(hookedChanged.length && checkOnly ? 1 : 0);
