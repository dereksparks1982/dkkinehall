"use strict";

// The desktop edition loads the EXISTING web player verbatim.
// No Tkinter interface, forked CSS, or replacement playback controls.
const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

app.setName("DK Kinehall");
app.setAppUserModelId("org.dksoftworks.dk-kinehall");

function openWindow() {
  const player = path.join(__dirname, "docs", "index.html");
  const playerURL = pathToFileURL(player).href;
  const icon = path.join(__dirname, "docs", "icons", "dk-media-player-512.png");

  const win = new BrowserWindow({
    width: 1450,
    height: 900,
    minWidth: 900,
    minHeight: 580,
    backgroundColor: "#16080d",
    autoHideMenuBar: true,
    show: false,
    title: "DK Kinehall",
    icon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    }
  });
  Menu.setApplicationMenu(null);
  win.once("ready-to-show", () => win.show());

  // Artwork links open the system browser, never an arbitrary page in player.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== playerURL && url !== playerURL + "#") {
      event.preventDefault();
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  win.webContents.on("did-fail-load", (_event, code, message) => {
    if (process.env.DK_KINEHALL_SMOKE === "1") {
      console.error("DK_KINEHALL_LOAD_FAILED", code, message);
      app.exit(1);
    }
  });

  if (process.env.DK_KINEHALL_SMOKE === "1") {
    win.webContents.once("did-finish-load", async () => {
      try {
        const state = await win.webContents.executeJavaScript("(() => {\n const media = document.getElementById(\"media\");\n const queue = document.getElementById(\"queue\");\n const screen = document.getElementById(\"screen\");\n const css = screen ? getComputedStyle(screen) : null;\n return {title:document.title,media:Boolean(media),queue:Boolean(queue),controls:Boolean(document.getElementById(\"screenControls\")),fullscreen:Boolean(document.getElementById(\"fullscreen\")),background:css?css.backgroundColor:null,stylesheets:document.styleSheets.length,scripts:document.scripts.length,secureContext:window.isSecureContext,pickerSupported:typeof window.showOpenFilePicker===\"function\"};\n})()");
        if (!state.media || !state.queue || !state.controls ||
            !state.fullscreen || state.stylesheets < 1 || state.scripts < 10) {
          throw new Error("Existing web player assets did not load: " + JSON.stringify(state));
        }
        console.log("DK_KINEHALL_WEB_PLAYER_LOADED", JSON.stringify(state));
        app.exit(0);
      } catch (error) {
        console.error("DK_KINEHALL_SMOKE_FAILED", String(error));
        app.exit(1);
      }
    });
  }

  void win.loadFile(player);
}

app.whenReady().then(openWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
