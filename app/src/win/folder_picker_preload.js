// [win] Native folder picker for the SPA's working-directory field.
//
// The SPA's WorkspacePathField renders a text input plus a "Browse
// directories" toggle that browses the HOST's filesystem through the server
// API. On Windows a real folder dialog is what users expect, so this preload
// enhancement adds a second button next to that toggle: it asks the main
// process to show `dialog.showOpenDialog({ openDirectory })` and writes the
// chosen path into the input the way a user typing would (native value setter
// + input event, so React's controlled input picks it up).
//
// NOTE: shell windows are sandboxed (Electron default), so preload.js cannot
// `require` this file at runtime; it carries an inlined copy of this logic
// (marked `[win]`). This module is the readable, unit-tested reference — keep
// the two in sync.
//
// This is a progressive enhancement over two SPA test ids
// (`workspace-path-input`, `workspace-browse-toggle`; see COMPAT.md §3). If
// they are absent the observer simply never finds anything. The IPC handler
// in main.js is gated on the pinned server origin like every other bridge
// call, and the picker returns nothing but the chosen path.

"use strict";

const TOGGLE_SELECTOR = '[data-testid="workspace-browse-toggle"]';
const INPUT_SELECTOR = '[data-testid="workspace-path-input"]';
/** The main folder browser (WorkspacePicker): anchor after its Home button. */
const PICKER_HOME_SELECTOR = '[data-testid="workspace-picker-home"]';
const PICKER_INPUT_SELECTOR = '[data-testid="workspace-picker-path-input"]';
const BUTTON_TEST_ID = "win-pick-directory";
const IPC_CHANNEL = "omnigent:win-pick-directory";

const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6"/><path d="m9 13 3-3 3 3"/></svg>';

/**
 * Write `value` into a React-controlled input so its onChange fires.
 *
 * @param {HTMLInputElement} input
 * @param {string} value
 * @param {typeof HTMLInputElement} [InputCtor]
 */
function setControlledInputValue(input, value, InputCtor = HTMLInputElement) {
  const desc = Object.getOwnPropertyDescriptor(InputCtor.prototype, "value");
  if (desc && typeof desc.set === "function") desc.set.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Install the enhancement. Returns a disposer.
 *
 * @param {object} deps
 * @param {{ invoke: (channel: string) => Promise<{ path?: string } | null> }} deps.ipcRenderer
 * @param {Document} [deps.doc]
 * @param {string} [deps.platform]
 * @param {(msg: string) => void} [deps.log]
 */
function installFolderPicker({ ipcRenderer, doc = globalThis.document, platform = process.platform, log = () => {} }) {
  if (platform !== "win32" || !doc) return () => {};

  /**
   * Add the native-picker button after `anchor`, writing the chosen path into
   * the input found by `inputSelector` (scoped to the anchor's nearest picker
   * container when possible). `commitWithEnter` also presses Enter, which the
   * WorkspacePicker's path input uses to navigate to the typed folder.
   */
  function enhance(anchor, { inputSelector, commitWithEnter }) {
    if (anchor.dataset.winPicker === "1") return;
    anchor.dataset.winPicker = "1";
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = anchor.className;
    btn.title = "Choose a folder on this PC…";
    btn.setAttribute("aria-label", "Choose a folder on this PC");
    btn.dataset.testid = BUTTON_TEST_ID;
    btn.innerHTML = ICON_SVG;
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      btn.disabled = true;
      try {
        const res = await ipcRenderer.invoke(IPC_CHANNEL);
        if (res && typeof res.path === "string" && res.path) {
          const scope = anchor.closest('[data-testid="workspace-picker"]') || doc;
          const input = scope.querySelector(inputSelector) || doc.querySelector(inputSelector);
          if (input) {
            setControlledInputValue(input, res.path);
            input.focus();
            if (commitWithEnter) {
              input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            }
          }
        }
      } catch (err) {
        log(`[win] folder picker failed: ${err && err.message}`);
      } finally {
        btn.disabled = false;
      }
    });
    // Tooltip-wrapped icon buttons sit alone inside a wrapper; place ours
    // beside the wrapper so it lands in the toolbar row, not under the icon.
    const wrapper = anchor.parentElement;
    const target = wrapper && wrapper.children.length === 1 && wrapper.parentElement ? wrapper : anchor;
    target.insertAdjacentElement("afterend", btn);
  }

  const scan = () => {
    for (const toggle of doc.querySelectorAll(TOGGLE_SELECTOR)) {
      enhance(toggle, { inputSelector: INPUT_SELECTOR, commitWithEnter: false });
    }
    for (const home of doc.querySelectorAll(PICKER_HOME_SELECTOR)) {
      enhance(home, { inputSelector: PICKER_INPUT_SELECTOR, commitWithEnter: true });
    }
  };
  const observer = new MutationObserver(scan);
  const start = () => {
    scan();
    if (doc.body) observer.observe(doc.body, { childList: true, subtree: true });
  };
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  return () => observer.disconnect();
}

module.exports = {
  installFolderPicker,
  setControlledInputValue,
  TOGGLE_SELECTOR,
  INPUT_SELECTOR,
  PICKER_HOME_SELECTOR,
  PICKER_INPUT_SELECTOR,
  BUTTON_TEST_ID,
  IPC_CHANNEL,
};
