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
 * Parse a CSS colour as reported by getComputedStyle (`rgb(r, g, b)` /
 * `rgba(r, g, b, a)` / `#rrggbb`) into an opaque hex string. Returns null for
 * transparent or unparseable values so the caller can fall back to the theme.
 *
 * @param {string | null | undefined} css
 * @returns {string | null}
 */
function cssColorToHex(css) {
  if (!css) return null;
  const s = String(css).trim();
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (hex) {
    if (hex[2] !== undefined && parseInt(hex[2], 16) === 0) return null;
    return `#${hex[1].toLowerCase()}`;
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null;
  const to2 = (n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0");
  return `#${to2(m[1])}${to2(m[2])}${to2(m[3])}`;
}

/**
 * Caption-glyph colour with enough contrast against `hexBackground`.
 *
 * @param {string} hexBackground `#rrggbb`
 */
function symbolColorFor(hexBackground) {
  const r = parseInt(hexBackground.slice(1, 3), 16);
  const g = parseInt(hexBackground.slice(3, 5), 16);
  const b = parseInt(hexBackground.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.5 ? THEMES.light.symbolColor : THEMES.dark.symbolColor;
}

/**
 * Script run in the page to find the effective background colour under the
 * caption buttons (top-right corner). Walks up from the element at that point
 * until it finds a non-transparent background, then falls back to body/html.
 */
const SAMPLE_BACKGROUND_JS = `(() => {
  const opaque = (c) => c && c !== "transparent" && !/rgba\\([^)]*,\\s*0\\s*\\)$/.test(c);
  const chain = [];
  const x = Math.max(0, window.innerWidth - 20);
  let el = document.elementFromPoint(x, 4);
  while (el) { chain.push(el); el = el.parentElement; }
  chain.push(document.body, document.documentElement);
  for (const node of chain) {
    if (!node) continue;
    const c = getComputedStyle(node).backgroundColor;
    if (opaque(c)) return c;
  }
  return null;
})()`;

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
    // Decode + case-fold: pathToFileURL encodes `~` (%7E) while the live frame
    // URL keeps it (portable builds run from a TUGAPL~1-style temp dir).
    const norm = (p) => {
      try {
        return decodeURIComponent(p).toLowerCase();
      } catch {
        return String(p).toLowerCase();
      }
    };
    return { isServerPage: false, isSetupPage: norm(u.pathname) === norm(setupPagePathname) };
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
  let timer = null;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  wc.on("did-finish-load", () => {
    const kind = classify(wc.getURL(), pinnedOrigin(), setupPagePathname);
    void applyCss(wc, kind).then((applied) => {
      if (applied) log(`[win] chrome css applied (${applied}) to ${wc.getURL().slice(0, 60)}`);
    });
    // Blend the caption buttons into whatever the page paints underneath them
    // (the SPA's theme, a settings page, the setup page): sample now, again
    // shortly after (the SPA hydrates asynchronously), then keep it in step
    // with in-app navigation / theme switches at a low cadence.
    stop();
    const blend = () =>
      blendOverlay(win, isDark()).then((color) => {
        if (color) log(`[win] caption overlay blended to ${color}`);
      });
    void blend();
    setTimeout(() => void blend(), 1200).unref?.();
    timer = setInterval(() => void blend(), 4000);
    timer.unref?.();
  });
  if (typeof win.once === "function") win.once("closed", stop);
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

const lastOverlay = new WeakMap();

/**
 * Sample the page background under the caption buttons and paint the overlay
 * with it (glyph colour picked for contrast). Falls back to the theme colours
 * when the page reports nothing usable. Idempotent per window: only calls
 * setTitleBarOverlay when the colour actually changes.
 *
 * @param {Electron.BrowserWindow} win
 * @param {boolean} dark
 * @returns {Promise<string | null>} the colour applied, or null when unchanged / unavailable
 */
async function blendOverlay(win, dark) {
  try {
    if (win.isDestroyed() || typeof win.setTitleBarOverlay !== "function") return;
    const css = await win.webContents.executeJavaScript(SAMPLE_BACKGROUND_JS, true);
    if (win.isDestroyed()) return;
    const color = cssColorToHex(css) ?? overlayColors(dark).color;
    if (lastOverlay.get(win) === color) return null;
    lastOverlay.set(win, color);
    win.setTitleBarOverlay({ color, symbolColor: symbolColorFor(color), height: OVERLAY_HEIGHT });
    return color;
  } catch {
    /* page not ready / navigating / no overlay support */
    return null;
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
  blendOverlay,
  cssColorToHex,
  symbolColorFor,
  SAMPLE_BACKGROUND_JS,
};
