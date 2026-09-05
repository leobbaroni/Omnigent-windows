// [win] WSL-hosted Omnigent backend.
//
// Native Windows Omnigent is degraded (no PTY terminals, no sandboxing — see
// COMPAT.md §12). When the user has a WSL distro with Omnigent installed, the
// shell can drive that CLI instead: every command becomes
//   wsl.exe -d <distro> -- omnigent …
// which the upstream `cliCommandParts` already understands (an object with
// `executable` + `prefixArgs`). The managed server then runs inside WSL and
// binds 127.0.0.1 there; WSL2 forwards loopback to Windows, so the same
// http://127.0.0.1:<port> URL works from the shell. State files (pidfile,
// daemon registry, tokens) live inside the distro, so status must be read
// through the CLI (`server status --json`) rather than the Windows filesystem
// — the shell's fast-path disk reads simply see "nothing" and fall through to
// the CLI, which is correct.

"use strict";

const bootstrap = require("./bootstrap");

const MODE_KEY = "win_local_mode";
const DISTRO_KEY = "win_wsl_distro";

/**
 * Whether settings select the WSL backend with a distro.
 *
 * @param {Record<string, unknown>} settings
 */
function isWslMode(settings) {
  return settings[MODE_KEY] === "wsl" && typeof settings[DISTRO_KEY] === "string" && settings[DISTRO_KEY].trim() !== "";
}

/**
 * The CLI command object for a distro (shape consumed by cliCommandParts).
 *
 * @param {string} distro
 * @param {string} [cliName]
 */
function wslCliCommand(distro, cliName = "omnigent") {
  const d = String(distro).trim();
  if (!d) throw new TypeError("distro required");
  return {
    executable: "wsl.exe",
    prefixArgs: ["-d", d, "--", cliName],
    displayName: `wsl -d ${d} -- ${cliName}`,
  };
}

/**
 * The active CLI command when WSL mode is on, else null (use the native path).
 *
 * @param {Record<string, unknown>} settings
 */
function activeCliCommand(settings) {
  return isWslMode(settings) ? wslCliCommand(String(settings[DISTRO_KEY])) : null;
}

/**
 * Detect installed distros (UTF-16 aware; see bootstrap.detectWsl).
 *
 * @param {{ exec?: Function }} [deps]
 */
function listDistros(deps = {}) {
  const r = bootstrap.detectPrerequisites({ exec: deps.exec, platform: "win32" }).wsl;
  return r.distros.filter((d) => d !== "docker-desktop" && d !== "docker-desktop-data");
}

/**
 * CLI status for a WSL command: runs `--version` through wsl.exe.
 *
 * @param {object} command wslCliCommand()
 * @param {(cmd: object, args: string[], opts?: object) => Promise<{ code: number, stdout: string, stderr: string }>} runCli
 */
async function cliStatus(command, runCli) {
  const res = await runCli(command, ["--version"], { timeoutMs: 15000 });
  const version = (res.stdout || res.stderr || "").trim();
  const ok = res.code === 0 && /\bomni/i.test(version);
  return {
    installed: ok,
    path: ok ? command.displayName : null,
    version: ok ? version : null,
    source: ok ? "wsl" : null,
    installCommand: "uv tool install --python 3.12 omnigent   # inside the WSL distro",
    wsl: true,
    distro: command.prefixArgs[1],
  };
}

/**
 * Convert a Windows path to its WSL mount path (`C:\Users\x` → `/mnt/c/Users/x`).
 * UNC and already-POSIX paths are returned unchanged.
 *
 * @param {string} p
 * @returns {string}
 */
function toWslPath(p) {
  const s = String(p || "");
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(s);
  if (!m) return s;
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`.replace(/\/+$/, "") || `/mnt/${m[1].toLowerCase()}`;
}

module.exports = { MODE_KEY, DISTRO_KEY, isWslMode, wslCliCommand, activeCliCommand, listDistros, cliStatus, toWslPath };
