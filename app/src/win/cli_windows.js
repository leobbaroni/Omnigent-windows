// [win] Windows-specific CLI discovery and process-spawn helpers.
//
// The upstream shell resolves the `omnigent` binary through POSIX conventions
// (`command -v`, ~/.local/bin, Homebrew). On Windows a `uv tool install`
// drops `omnigent.exe` / `omni.exe` into uv's tool bin dir (default
// %USERPROFILE%\.local\bin), which a GUI-launched Electron process may or may
// not have on PATH. This module supplies the Windows candidate list plus the
// spawn options every CLI invocation needs on Windows:
//
//   - `windowsHide: true` — without it each `execFile` of a console program
//     flashes a console window over the app;
//   - a UTF-8 Python environment — the CLI prints "✓ Connected" and other
//     non-ASCII markers, which die with UnicodeEncodeError under the default
//     cp1252 code page (see WINDOWS_ENV_PASSTHROUGH / PYTHONUTF8 upstream).
//
// Pure helpers take injected probes so they are unit-testable on any OS.

"use strict";

const os = require("os");
const path = require("path");
const { execFile, execFileSync } = require("child_process");

const IS_WIN = process.platform === "win32";
const CLI_NAMES = ["omnigent", "omni"];

/** Install one-liner shown on the setup page on Windows (README, "Windows (native)"). */
const INSTALL_COMMAND_WINDOWS = "uv tool install --python 3.12 omnigent";

/**
 * Environment for spawning the Python CLI: force UTF-8 I/O on Windows.
 *
 * @param {NodeJS.ProcessEnv} [base]
 * @returns {NodeJS.ProcessEnv}
 */
function cliEnv(base = process.env) {
  if (!IS_WIN) return base;
  const env = { ...base, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
  // Nested-session markers a Claude Code / Codex terminal exports into every
  // child. If the shell was launched from such a terminal they reach the host
  // daemon and the harness probes, which then report Claude Code as
  // "needs-auth" (observed: `claude -p /model` exits 0xC0000142). They mean
  // nothing to a desktop app, so drop them before any CLI spawn.
  for (const key of Object.keys(env)) {
    if (NESTED_SESSION_ENV.has(key) || /^CLAUDE_CODE_(CHILD_SESSION|SESSION_ID|MESSAGING_|ENTRYPOINT|HOST_SESSION_ID|EXECPATH)/.test(key)) {
      delete env[key];
    }
  }
  return env;
}

/** Exact env names that only exist inside a running Claude Code session. */
const NESTED_SESSION_ENV = new Set(["CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT"]);

/**
 * Extra `child_process` options for any CLI spawn. A no-op off Windows so the
 * upstream call sites stay byte-identical in behaviour there.
 *
 * @param {object} [extra] Caller options (env inside is merged with the UTF-8 vars).
 * @returns {object}
 */
function spawnOptions(extra = {}) {
  if (!IS_WIN) return extra;
  return { windowsHide: true, ...extra, env: cliEnv(extra.env || process.env) };
}

/**
 * uv's tool bin dir (`uv tool dir --bin`), or null when uv is absent. This is
 * authoritative for where `uv tool install omnigent` put the executables.
 *
 * @param {{ exec?: typeof execFileSync }} [deps]
 * @returns {string | null}
 */
function uvToolBinDir({ exec = execFileSync } = {}) {
  try {
    const out = exec("uv", ["tool", "dir", "--bin"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const dir = String(out || "")
      .trim()
      .split(/\r?\n/)
      .pop();
    return dir ? dir.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Well-known Windows install dirs for the CLI, in priority order, de-duplicated
 * case-insensitively. uv's reported bin dir first (authoritative), then uv's
 * and pipx's default (%USERPROFILE%\.local\bin), then scoop shims.
 *
 * @param {{ home?: string, uvBinDir?: string | null }} [opts]
 * @returns {string[]}
 */
function candidateDirs({ home = os.homedir(), uvBinDir = null } = {}) {
  const dirs = [];
  const push = (d) => {
    if (d && !dirs.some((x) => x.toLowerCase() === d.toLowerCase())) dirs.push(d);
  };
  push(uvBinDir);
  push(path.join(home, ".local", "bin"));
  push(path.join(home, "scoop", "shims"));
  return dirs;
}

/**
 * Candidate executable paths: for each dir, `omnigent.exe` then `omni.exe`.
 *
 * @param {{ home?: string, uvBinDir?: string | null }} [opts]
 * @returns {string[]}
 */
function candidatePaths(opts) {
  return candidateDirs(opts).flatMap((dir) => CLI_NAMES.map((name) => path.join(dir, `${name}.exe`)));
}

/**
 * Kill a process tree on Windows (`taskkill /T /F`). Electron's `child.kill()`
 * only reaches the direct child (TerminateProcess); the Python host daemon has
 * no SIGTERM to propagate, so its runners would otherwise be orphaned.
 * Resolves when taskkill exits (never rejects).
 *
 * @param {number} pid
 * @param {{ exec?: typeof execFile }} [deps]
 * @returns {Promise<boolean>} true when taskkill reported success.
 */
function killTree(pid, { exec = execFile } = {}) {
  return new Promise((resolve) => {
    if (!Number.isInteger(pid) || pid <= 0) {
      resolve(false);
      return;
    }
    try {
      exec("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }, (err) =>
        resolve(!err),
      );
    } catch {
      resolve(false);
    }
  });
}

/**
 * Render a CLI command (string path or {executable, prefixArgs}) plus args as
 * a PowerShell command line for the visible console runner.
 *
 * @param {string | { executable: string, prefixArgs?: string[] }} cmd
 * @param {string[]} args
 * @returns {string}
 */
function cliCommandString(cmd, args) {
  const q = (s) => (/[\s'"&|<>()]/.test(s) ? `'${String(s).replace(/'/g, "''")}'` : s);
  if (typeof cmd === "string") return ["&", q(cmd), ...args.map(q)].join(" ");
  return [cmd.executable, ...(cmd.prefixArgs || []), ...args].map(q).join(" ");
}

module.exports = {
  IS_WIN,
  CLI_NAMES,
  cliCommandString,
  INSTALL_COMMAND_WINDOWS,
  cliEnv,
  spawnOptions,
  uvToolBinDir,
  candidateDirs,
  candidatePaths,
  killTree,
};
