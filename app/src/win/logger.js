// [win] Rotating file logger for the desktop shell.
//
// The upstream shell logs to the console only, which a packaged Windows app
// never shows. This installs a small, dependency-free logger that mirrors
// every console.* call from the main process into
//   %APPDATA%\Omnigent\logs\omnigent-desktop.log
// (Electron's userData/logs), rotating at 2 MB and keeping five files, and
// records uncaught errors. Lines are timestamped and levelled. Secrets never
// reach this file by construction: the shell never logs tokens, and the CLI
// invocations it records are argv only (see COMPAT.md §23).

"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULTS = { maxBytes: 2 * 1024 * 1024, keep: 5, fileName: "omnigent-desktop.log" };

/**
 * Redact obvious secret-shaped values in a line before it hits disk. Belt and
 * braces: bearer tokens, `token=`/`password=` query pairs, and long hex/base64
 * blobs following "secret"/"key".
 *
 * @param {string} line
 * @returns {string}
 */
function redact(line) {
  return (
    String(line)
      .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1[redacted]")
      .replace(/((?:token|password|passwd|secret|api[_-]?key|cookie)\s*[=:]\s*)[^\s&"',;]+/gi, "$1[redacted]")
      .replace(/(ticket=)[^\s&"']+/gi, "$1[redacted]")
      // Cookie headers dumped by HTTP error objects (e.g. the updater's 404
      // report): `name=value; path=/…` → keep the name, drop the value.
      .replace(/("?set-cookie"?\s*[:=]\s*\[?\s*"?)([^"\]]+)/gi, (m, prefix) => `${prefix}[redacted]`)
      .replace(/\b([A-Za-z0-9_\-]*(?:sess|session|csrf|auth|_octo|logged_in)[A-Za-z0-9_\-]*=)[^;\s"']+/gi, "$1[redacted]")
      // Any long opaque token-looking value after `=` (40+ url-safe chars).
      .replace(/(=)[A-Za-z0-9%._\-]{40,}/g, "$1[redacted]")
  );
}

/**
 * Format one console argument the way util.format would, minus stack noise.
 *
 * @param {unknown} v
 * @returns {string}
 */
function fmt(v) {
  if (v instanceof Error) return v.stack || v.message;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Create a logger writing to `dir`. All methods are synchronous and swallow
 * their own errors: logging must never break the app.
 *
 * @param {object} opts
 * @param {string} opts.dir Log directory (created on demand).
 * @param {number} [opts.maxBytes]
 * @param {number} [opts.keep]
 * @param {string} [opts.fileName]
 * @param {() => Date} [opts.now]
 * @param {typeof fs} [opts.fsImpl]
 */
function createLogger(opts) {
  const cfg = { ...DEFAULTS, ...opts };
  const fsx = cfg.fsImpl || fs;
  const now = cfg.now || (() => new Date());
  const file = path.join(cfg.dir, cfg.fileName);

  function rotateIfNeeded() {
    let size = 0;
    try {
      size = fsx.statSync(file).size;
    } catch {
      return;
    }
    if (size < cfg.maxBytes) return;
    // omnigent-desktop.log → .1 → .2 … up to .(keep-1); the oldest is dropped.
    for (let i = cfg.keep - 1; i >= 1; i -= 1) {
      const from = `${file}.${i}`;
      try {
        if (!fsx.existsSync(from)) continue;
        if (i === cfg.keep - 1) fsx.rmSync(from, { force: true });
        else fsx.renameSync(from, `${file}.${i + 1}`);
      } catch {
        /* best effort */
      }
    }
    try {
      fsx.renameSync(file, `${file}.1`);
    } catch {
      /* best effort */
    }
  }

  function write(level, args) {
    try {
      fsx.mkdirSync(cfg.dir, { recursive: true });
      rotateIfNeeded();
      const line = `${now().toISOString()} [${level}] ${redact(args.map(fmt).join(" "))}\n`;
      fsx.appendFileSync(file, line);
    } catch {
      /* never throw from the logger */
    }
  }

  const api = {
    file,
    dir: cfg.dir,
    info: (...a) => write("info", a),
    warn: (...a) => write("warn", a),
    error: (...a) => write("error", a),
    debug: (...a) => write("debug", a),
    /**
     * Mirror console.log/info/warn/error/debug into the file while keeping the
     * original console behaviour. Returns a function that restores console.
     *
     * @param {Console} [consoleObj]
     */
    captureConsole(consoleObj = console) {
      const originals = {};
      for (const [method, level] of [
        ["log", "info"],
        ["info", "info"],
        ["warn", "warn"],
        ["error", "error"],
        ["debug", "debug"],
      ]) {
        originals[method] = consoleObj[method];
        consoleObj[method] = (...a) => {
          write(level, a);
          try {
            originals[method].apply(consoleObj, a);
          } catch {
            /* console unavailable */
          }
        };
      }
      return () => {
        for (const [m, fn] of Object.entries(originals)) consoleObj[m] = fn;
      };
    },
    /**
     * Record uncaught errors and unhandled rejections (without swallowing them
     * differently from before: Electron still shows its own dialog).
     *
     * @param {NodeJS.Process} [proc]
     */
    captureProcessErrors(proc = process) {
      proc.on("uncaughtException", (err) => write("error", ["uncaughtException", err]));
      proc.on("unhandledRejection", (reason) => write("error", ["unhandledRejection", reason]));
    },
  };
  return api;
}

module.exports = { createLogger, redact, DEFAULTS };
