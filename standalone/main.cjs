"use strict";

// The desktop edition loads the EXISTING web player verbatim.
// No Tkinter interface, forked CSS, or replacement playback controls.
const { app, BrowserWindow, Menu, shell, ipcMain } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

app.setName("DK Kinehall");
// Linux dock icons are matched by the installed desktop-entry filename and
// the window class. The portable root launcher registers this entry at launch.
if (process.platform === "linux") {
  app.setDesktopName("dk-kinehall.desktop");
  app.commandLine.appendSwitch("class", "dk-kinehall");
  // An explicit file-open action must start playback without browser autoplay
  // restrictions when this player is running as its own desktop application.
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
}
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
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    }
  });
  Menu.setApplicationMenu(null);
  win.once("ready-to-show", () => win.show());

  const broadcastFullscreen = () => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send("dk-kinehall:fullscreen-changed", win.isFullScreen());
    }
  };
  win.on("enter-full-screen", broadcastFullscreen);
  win.on("leave-full-screen", broadcastFullscreen);
  ipcMain.handle("dk-kinehall:set-fullscreen", (event, enabled) => {
    if (win.isDestroyed() || event.sender !== win.webContents) {
      throw new Error("Fullscreen is only allowed from DK Kinehall");
    }
    win.setFullScreen(Boolean(enabled));
    return win.isFullScreen();
  });
  win.on("closed", () => ipcMain.removeHandler("dk-kinehall:set-fullscreen"));

  // Artwork links open the system browser, never an arbitrary page in player.
  win.webContents.on("console-message", (...args) => {
    console.error("DK_RENDERER_LOG", args.slice(1).map(x => {
      if (x && typeof x === "object") {
        return JSON.stringify({message:x.message,level:x.level,line:x.lineNumber,
          source:x.sourceId});
      }
      return String(x);
    }).join(" | "));
  });
  ipcMain.on("dk-kinehall:renderer-error", (event, payload) => {
    if (event.sender === win.webContents) {
      console.error("DK_KINEHALL_RENDERER_EXCEPTION", JSON.stringify(payload));
    }
  });
  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("DK_KINEHALL_PRELOAD_ERROR", preloadPath, String(error));
  });
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
        const initial = await win.webContents.executeJavaScript("(() => ({video:!!document.getElementById(\"media\"),queue:!!document.getElementById(\"queue\"),controls:!!document.getElementById(\"screenControls\"),fullscreen:!!document.getElementById(\"fullscreen\"),bridge:typeof window.DKStandalone?.setFullscreen === \"function\",stylesheets:document.styleSheets.length,scripts:document.scripts.length}))()");
        if (!initial.video || !initial.queue || !initial.controls ||
            !initial.fullscreen || !initial.bridge ||
            initial.stylesheets < 1 || initial.scripts < 10) {
          throw new Error("Original web player or desktop bridge failed to load: " + JSON.stringify(initial));
        }
        console.log("DK_KINEHALL_WEB_PLAYER_LOADED", JSON.stringify(initial));
        const folderAPIs = await win.webContents.executeJavaScript(
          '({picker:typeof window.showDirectoryPicker === "function",' +
          'indexedDB:typeof window.indexedDB !== "undefined",' +
          'scanner:!!window.DKFolderAccess})');
        console.log("DK_KINEHALL_FOLDER_APIS", JSON.stringify(folderAPIs));
        if (process.env.DK_KINEHALL_ARTWORK_LIVE === "1") {
          const artworkTest = require("node:fs").readFileSync(
            path.join(__dirname, "artwork-smoke.js"), "utf8");
          const artworkState = await win.webContents.executeJavaScript(artworkTest);
          if (!artworkState || artworkState.passed !== true)
            throw new Error("Live movie poster rendering test did not pass");
          console.log("DK_KINEHALL_MOVIE_POSTER_LIVE_PASS", JSON.stringify(artworkState));
        }

        if (!folderAPIs.picker || !folderAPIs.indexedDB || !folderAPIs.scanner)
          throw new Error("Persistent folder APIs unavailable in standalone Chromium");
        const initialized = await win.webContents.executeJavaScript(
          'document.getElementById("fullscreen").getAttribute("aria-pressed") === "false"');
        if (!initialized) throw new Error("Player JavaScript initialization did not finish");

        const wait = () => new Promise(resolve => setTimeout(resolve, 700));
        const assertMode = async (label, expected) => {
          await wait();
          const state = await win.webContents.executeJavaScript("(() => { const screen = document.getElementById(\"screen\"); const rect = screen.getBoundingClientRect(); return {css:screen.classList.contains(\"desktop-fullscreen\"), pressed:document.getElementById(\"fullscreen\").getAttribute(\"aria-pressed\"), width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight}; })()");
          const native = win.isFullScreen();
          console.log("DK_KINEHALL_FULLSCREEN", label, JSON.stringify({native,...state}));
          if (native !== expected || state.css !== expected ||
              state.pressed !== String(expected) ||
              (expected && (Math.abs(state.width-state.viewportWidth) > 3 ||
                            Math.abs(state.height-state.viewportHeight) > 3))) {
            throw new Error("Fullscreen failed: " + label);
          }
        };
        // Test the actual native window, not merely existence of the button.
        await win.webContents.executeJavaScript('document.getElementById("fullscreen").click()');
        await assertMode("button-enter", true);
        await win.webContents.executeJavaScript('document.getElementById("fullscreen").click()');
        await assertMode("button-exit", false);
        await win.webContents.executeJavaScript('document.getElementById("screen").dispatchEvent(new MouseEvent("dblclick", {bubbles:true}))');
        await assertMode("double-click-enter", true);
        win.webContents.sendInputEvent({type:"keyDown",keyCode:"Escape"});
        win.webContents.sendInputEvent({type:"keyUp",keyCode:"Escape"});
        await assertMode("escape-exit", false);
        console.log("DK_KINEHALL_FULLSCREEN_PASS");
        const queueTest = require("node:fs").readFileSync(
          path.join(__dirname, "queue-smoke.js"), "utf8");
        const queueState = await win.webContents.executeJavaScript(queueTest);
        if (!queueState || queueState.passed !== true)
          throw new Error("Automatic playback/queue test did not pass");
        console.log("DK_KINEHALL_QUEUE_AUTOPLAY_PASS", JSON.stringify(queueState));
        const folderTest = require("node:fs").readFileSync(
          path.join(__dirname, "folder-smoke.js"), "utf8");
        const folderState = await win.webContents.executeJavaScript(folderTest);
        if (!folderState || folderState.passed !== true)
          throw new Error("Persistent media-folder test did not pass");
        console.log("DK_KINEHALL_FOLDER_ACCESS_PASS", JSON.stringify(folderState));
        const codecTest = require("node:fs").readFileSync(
          path.join(__dirname, "codec-smoke.js"), "utf8");
        const codecState = await win.webContents.executeJavaScript(codecTest);
        if (!codecState || codecState.passed !== true)
          throw new Error("MKV codec/subtitle smoke test did not pass");
        console.log("DK_KINEHALL_MKV_CODECS_PASS", JSON.stringify(codecState));

        if (process.env.DK_KINEHALL_FIXTURE_DIR) {
          // Only CI sets this path. The release does not ship fixtures.
          const fs = require("node:fs");
          const payload = Object.fromEntries(
            ["mp3","flac","vorbis"].map(name => [
              name,fs.readFileSync(path.join(
                process.env.DK_KINEHALL_FIXTURE_DIR,name+".mka")).toString("base64")
            ])
          );
          const source = fs.readFileSync(path.join(__dirname,
            "expanded-codec-smoke.js"),"utf8")
            .replace("__DK_CODEC_FIXTURES__",JSON.stringify(payload));
          const decoded = await win.webContents.executeJavaScript(source);
          if (!decoded?.passed) throw new Error("Real encoded MKV audio frames were not decoded");
          console.log("DK_KINEHALL_EXPANDED_CODEC_PASS",JSON.stringify(decoded));
        }

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
