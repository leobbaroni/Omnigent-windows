// [win] Narrow contextBridge for the bundled Windows settings page. Only the
// three calls the page needs; the main-process handlers verify the sender is
// this page before doing anything.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("omnigentWinSettings", {
  get: () => ipcRenderer.invoke("omnigent:win-settings-get"),
  set: (patch) => ipcRenderer.invoke("omnigent:win-settings-set", patch),
  action: (name) => ipcRenderer.invoke("omnigent:win-settings-action", String(name)),
});
