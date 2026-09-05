// [win] Seamless window chrome on Windows.
//
// Upstream hides the native title bar only on macOS (titleBarStyle
// "hiddenInset" + the SPA's [data-electron-mac] rules). On Windows the shell
// showed the classic title bar and menu bar. Here we use Electron's
// Window Controls Overlay: `titleBarStyle: "hidden"` with `titleBarOverlay`
// draws only the minimize / maximize / close caption buttons (themed) over the
// page's top-right corner, and the page supplies the drag region. The SPA
// cannot know about this (it keys its frameless CSS on the macOS user agent),
// so the shell injects a small stylesheet into server pages and the setup
// page: a 2.25rem drag strip across the top (interactive elements opt out),
// and right-hand clearance where the SPA's own controls would sit under the
// caption buttons. Everything is CSS; no SPA change and no UA spoofing.

"use strict";

/** Height of the overlay strip (matches the SPA's 2.25rem title-bar band). */
const OVERLAY_HEIGHT = 36;
/** Width Windows reserves for the three caption buttons (≈138px at 100%). */
const CAPTION_WIDTH_REM = 9;

const THEMES = {
  light: { color: "#ffffff", symbolColor: "#1b1b1f" },
  dark: { color: "#0b0b0c", symbolColor: "#e6e6ea" },
};

/**
 * Overlay colours for a theme.
 *
 * @param {boolean} dark
 */
function overlayColors(dark) {
  return { ...THEMES[dark ? "dark" : "light"], height: OVERLAY_HEIGHT };
}

/**
 * Extra BrowserWindow options for the seamless look. The menu bar stays
 * available (Alt reveals it) so the Server / Edit / View menus and their
 * accelerators keep working.
 *
 * @param {boolean} dark
 */
function windowOptions(dark) {
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: overlayColors(dark),
    autoHideMenuBar: true,
  };
}

/** Injected into pages loaded from a connected server (the Omnigent SPA). */
const SERVER_PAGE_CSS = `
/* [win] Window Controls Overlay: drag strip across the top, minus the caption
   buttons on the right. Drag regions are geometric, so interactive elements
   opt out with no-drag below. */
.app-shell::before {
  content: "";
  position: fixed;
  top: 0;
  left: 0;
  right: ${CAPTION_WIDTH_REM}rem;
  height: 2.25rem;
  -webkit-app-region: drag;
  z-index: 0;
}
.app-shell :is(a, button, input, textarea, select, [role="button"], [role="option"], [contenteditable]) {
  -webkit-app-region: no-drag;
}
/* Keep the chat header's right-hand action cluster out from under the caption
   buttons when no workspace panel is docked to the right of it. */
.app-shell:not(:has(aside[aria-label="Workspace"])) .chat-header {
  padding-right: ${CAPTION_WIDTH_REM + 0.5}rem;
}
/* A docked or maximized workspace rail owns the top-right corner instead. */
aside[aria-label="Workspace"] .workspace-tab-strip {
  padding-right: ${CAPTION_WIDTH_REM}rem;
}
/* The settings page and other full-width headers: give their top row the same
   clearance so nothing hides under the caption buttons. */
.app-shell .settings-sidebar-header {
  -webkit-app-region: drag;
}
`;

/** Injected into the bundled setup page (its gear sits top-right). */
const SETUP_PAGE_CSS = `
/* [win] Move the gear out from under the caption buttons. */
.gear-btn { right: ${CAPTION_WIDTH_REM}rem !important; }
.drag-strip { right: ${CAPTION_WIDTH_REM}rem !important; }
`;

/**
 * Apply the right stylesheet for what a webContents just loaded. Never throws.
 *
 * @param {Electron.WebContents} webContents
 * @param {{ isServerPage: boolean, isSetupPage: boolean }} kind
 * @returns {Promise<"server" | "setup" | null>}
 */
async function applyCss(webContents, kind) {
  try {
    if (kind.isSetupPage) {
      await webContents.insertCSS(SETUP_PAGE_CSS);
      return "setup";
    }
    if (kind.isServerPage) {
      await webContents.insertCSS(SERVER_PAGE_CSS);
      return "server";
    }
  } catch {
    /* page went away mid-insert */
  }
  return null;
}

/**
 * Classify a loaded URL.
 *
 * @param {string} url
 * @param {string | null} pinnedOrigin
 * @param {string} setupPagePathname file:// pathname of setup/index.html
 */
function classify(url, pinnedOrigin, setupPagePathname) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { isServerPage: false, isSetupPage: false };
  }
  if (u.protocol === "file:") {
    return { isServerPage: false, isSetupPage: u.pathname === setupPagePathname };
  }
  return { isServerPage: Boolean(pinnedOrigin) && u.origin === pinnedOrigin, isSetupPage: false };
}

/**
 * Wire a window: re-inject CSS on every main-frame load (SPA navigations are
 * in-page, so one insert per load is enough) and keep the caption-button
 * colours in step with the theme.
 *
 * @param {Electron.BrowserWindow} win
 * @param {object} deps
 * @param {() => string | null} deps.pinnedOrigin
 * @param {string} deps.setupPagePathname
 * @param {() => boolean} deps.isDark
 * @param {(msg: string) => void} [deps.log]
 */
function attach(win, { pinnedOrigin, setupPagePathname, isDark, log = () => {} }) {
  const wc = win.webContents;
  wc.on("did-finish-load", () => {
    const kind = classify(wc.getURL(), pinnedOrigin(), setupPagePathname);
    void applyCss(wc, kind).then((applied) => {
      if (applied) log(`[win] chrome css applied (${applied}) to ${wc.getURL().slice(0, 60)}`);
    });
  });
  syncOverlay(win, isDark());
}

/**
 * Update caption-button colours (no-op when the window has no overlay).
 *
 * @param {Electron.BrowserWindow} win
 * @param {boolean} dark
 */
function syncOverlay(win, dark) {
  try {
    if (win.isDestroyed() || typeof win.setTitleBarOverlay !== "function") return;
    win.setTitleBarOverlay(overlayColors(dark));
  } catch {
    /* frameless window without overlay support */
  }
}

module.exports = {
  OVERLAY_HEIGHT,
  CAPTION_WIDTH_REM,
  SERVER_PAGE_CSS,
  SETUP_PAGE_CSS,
  overlayColors,
  windowOptions,
  classify,
  applyCss,
  attach,
  syncOverlay,
};
