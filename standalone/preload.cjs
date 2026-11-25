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
  },
  // Bytes are supplied from a user-selected File, never a disk pathname.
  // One pending input write and one acknowledged output chunk at a time.
  transcodeCapabilities: () =>
    ipcRenderer.invoke("dk-kinehall:transcode-capabilities"),
  startTranscode: options =>
    ipcRenderer.invoke("dk-kinehall:transcode-start", options),
  writeTranscode: (id, bytes) =>
    ipcRenderer.invoke("dk-kinehall:transcode-write", {id,bytes}),
  finishTranscode: id =>
    ipcRenderer.invoke("dk-kinehall:transcode-finish",id),
  ackTranscode: id =>
    ipcRenderer.invoke("dk-kinehall:transcode-ack",id),
  cancelTranscode: id =>
    ipcRenderer.invoke("dk-kinehall:transcode-cancel",id),
  onTranscodeEvent: callback => {
    if(typeof callback !== "function")return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("dk-kinehall:transcode-event",listener);
    return () => ipcRenderer.removeListener("dk-kinehall:transcode-event",listener);
  }
}));

window.addEventListener("error", event => {
  ipcRenderer.send("dk-kinehall:renderer-error", {
    message: event.message, file: event.filename, line: event.lineno, col: event.colno,
    stack: String(event.error && event.error.stack || "")
  });
}, true);
window.addEventListener("unhandledrejection", event => {
  ipcRenderer.send("dk-kinehall:renderer-error", {
    message: "Unhandled rejection", stack: String(event.reason && event.reason.stack || event.reason)
  });
});
