// [win] "Start with Windows" via Electron's login-item API.
//
// Registers the packaged exe under HKCU\...\Run with a `--hidden` argument so
// a login launch goes straight to the tray (main.js honours the flag). Dev
// builds (`electron .`) are never registered: that would register electron.exe.

"use strict";

const HIDDEN_ARG = "--hidden";

/**
 * @param {object} deps
 * @param {import("electron").App} deps.app
 * @param {boolean} [deps.isPackaged]
 */
function createStartup({ app, isPackaged = app.isPackaged }) {
  return {
    HIDDEN_ARG,
    /** Whether the OS is set to launch the app at login. */
    isEnabled() {
      try {
        return Boolean(app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin);
      } catch {
        return false;
      }
    },
    /**
     * Enable/disable. Returns the effective state (false in dev builds).
     *
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
      if (!isPackaged) return false;
      try {
        app.setLoginItemSettings({ openAtLogin: Boolean(enabled), args: [HIDDEN_ARG] });
      } catch {
        return this.isEnabled();
      }
      return this.isEnabled();
    },
    /** True when this process was launched with the hidden flag (login start). */
    launchedHidden(argv = process.argv) {
      return argv.includes(HIDDEN_ARG);
    },
  };
}

module.exports = { createStartup, HIDDEN_ARG };
