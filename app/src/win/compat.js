// [win] Omnigent version compatibility gate for the Windows shell.
//
// The shell shells out to the CLI and reads a handful of endpoints (see
// COMPAT.md §4 and §7). This module records the range this build was tested
// against and turns a detected CLI version into an assessment the UI can show.
// It NEVER disables functionality: an untested version gets a one-time warning
// (per version) and everything keeps working.

"use strict";

/** Keep in sync with COMPAT.md §15. */
const SUPPORT = {
  /** Oldest CLI with `omnigent server --background` (older ones only have `server start`). */
  minimum: "0.7.0",
  /** Releases this build was exercised against (Phase 6 test runs). */
  tested: ["0.12.0"],
  /** Upstream commit the vendored shell came from. */
  upstreamPin: "5d323ad",
};

/**
 * Parse a version out of `omnigent --version` output or a bare string.
 * Accepts `omnigent 0.12.0 (abc12345, built …)` and `0.13.0.dev0`.
 *
 * @param {string | null | undefined} text
 * @returns {{ major: number, minor: number, patch: number, pre: string | null, text: string } | null}
 */
function parseVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)(?:[.\-]?((?:dev|rc|a|b|alpha|beta|post)\d*))?/i.exec(text || "");
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].toLowerCase() : null,
    text: `${m[1]}.${m[2]}.${m[3]}${m[4] ? `.${m[4]}` : ""}`,
  };
}

/** Compare two parsed versions by major/minor/patch (pre-release tags ignored). */
function compare(a, b) {
  for (const k of ["major", "minor", "patch"]) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  return 0;
}

/**
 * Assess a detected CLI version against SUPPORT.
 *
 * @param {string | null | undefined} versionText
 * @param {typeof SUPPORT} [support]
 * @returns {{ status: "unknown" | "unsupported" | "tested" | "untested-newer" | "untested-older", version: string | null, message: string | null }}
 */
function assess(versionText, support = SUPPORT) {
  const v = parseVersion(versionText);
  if (!v) {
    return {
      status: "unknown",
      version: null,
      message: "Could not read the Omnigent version. Server management may not work until the CLI reports a version.",
    };
  }
  const min = parseVersion(support.minimum);
  const tested = support.tested.map(parseVersion).filter(Boolean);
  const newest = tested.reduce((acc, t) => (acc && compare(acc, t) >= 0 ? acc : t), null);
  if (compare(v, min) < 0) {
    return {
      status: "unsupported",
      version: v.text,
      message: `Omnigent ${v.text} is older than the minimum this app supports (${support.minimum}). Starting and stopping the local server will not work. Run \`omni upgrade\` or reinstall with \`uv tool install --python 3.12 omnigent\`.`,
    };
  }
  if (tested.some((t) => compare(t, v) === 0 && !v.pre)) {
    return { status: "tested", version: v.text, message: null };
  }
  if (newest && compare(v, newest) > 0) {
    return {
      status: "untested-newer",
      version: v.text,
      message: `Omnigent ${v.text} is newer than the versions this app was tested with (${support.tested.join(", ")}). Everything should keep working; if server start/stop, hosting, or notifications misbehave, check for an app update.`,
    };
  }
  return {
    status: "untested-older",
    version: v.text,
    message: `Omnigent ${v.text} was not specifically tested with this app (tested: ${support.tested.join(", ")}). Consider \`omni upgrade\`.`,
  };
}

/** Settings key holding versions already warned about. */
const WARNED_KEY = "win_compat_warned_versions";

/**
 * Whether a warning for `version` should be shown (not shown before).
 *
 * @param {Record<string, unknown>} settings
 * @param {string} version
 */
function shouldWarn(settings, version) {
  const list = Array.isArray(settings[WARNED_KEY]) ? settings[WARNED_KEY] : [];
  return !list.includes(version);
}

/**
 * Return a copy of settings with `version` recorded as warned.
 *
 * @param {Record<string, unknown>} settings
 * @param {string} version
 */
function markWarned(settings, version) {
  const list = Array.isArray(settings[WARNED_KEY]) ? settings[WARNED_KEY] : [];
  return { ...settings, [WARNED_KEY]: list.includes(version) ? list : [...list, version] };
}

/**
 * Show the one-time warning dialog when warranted. Never throws.
 *
 * @param {object} deps
 * @param {string | null | undefined} deps.versionText
 * @param {() => Record<string, unknown>} deps.loadSettings
 * @param {(s: Record<string, unknown>) => void} deps.saveSettings
 * @param {{ showMessageBox: Function }} deps.dialog
 * @param {object | undefined} [deps.win]
 * @param {(msg: string) => void} [deps.log]
 * @returns {Promise<ReturnType<typeof assess>>}
 */
async function maybeWarn({ versionText, loadSettings, saveSettings, dialog, win, log = () => {} }) {
  const result = assess(versionText);
  try {
    if (result.status === "tested" || !result.message) return result;
    const key = result.version || "unknown";
    const settings = loadSettings();
    if (!shouldWarn(settings, key)) return result;
    saveSettings(markWarned(settings, key));
    log(`[omnigent][win] compat ${result.status}: ${result.message}`);
    await dialog.showMessageBox(win ?? undefined, {
      type: result.status === "unsupported" ? "warning" : "info",
      title: "Omnigent version check",
      message:
        result.status === "unsupported"
          ? "This Omnigent version is not supported"
          : "Untested Omnigent version",
      detail: `${result.message}\n\nThis notice is shown once per version.`,
      buttons: ["OK"],
    });
  } catch (err) {
    log(`[omnigent][win] compat warning failed: ${err && err.message}`);
  }
  return result;
}

module.exports = { SUPPORT, WARNED_KEY, parseVersion, compare, assess, shouldWarn, markWarned, maybeWarn };
