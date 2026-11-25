"use strict";
// Minimal window-control bridge. The existing HTML/CSS/JS player is unchanged
// apart from fullscreen event handling. No Node.js access in the renderer.
const {contextBridge, ipcRenderer} = require("electron");
contextBridge.exposeInMainWorld("DKStandalone", Object.freeze({
  setFullscreen: enabled => ipcRenderer.invoke("dk-kinehall:set-fullscreen", Boolean(enabled)),
  onFullscreenChanged: callback => {
    if (typeof callback !== "function") return;
    ipcRenderer.on("dk-kinehall:fullscreen-changed", (_event, enabled) => {
      callback(Boolean(enabled));
    });
  }
}));
