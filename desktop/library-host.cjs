"use strict";
/* Library Home is the original application's start window. Launch the
 * unchanged docs/index.html player into a SECOND Electron BrowserWindow.
 * No network server, background service, icon redesign or alternative UI.
 */
const {ipcMain,BrowserWindow,app}=require("electron");
const path=require("node:path");
const fs=require("node:fs");
let installed=false,home=null,player=null,playerFile=null;
function allowed(event){
  if(!home||home.isDestroyed()||event.sender!==home.webContents)return false;
  const frame=event.senderFrame?.url||"";
  return frame.startsWith("file://")&&frame.includes("/library.html");
}
function installedWindow(){
  return player&&!player.isDestroyed();
}
function openPlayer(id) {
  if(!home||home.isDestroyed())throw new Error("Library window was closed");
  if(typeof id!=="string"||id.length<1||id.length>500||id.includes("\0"))
    throw new Error("Invalid library selection");
  if(!installedWindow()){
    // Inherit the approved original Electron runtime preferences and preload
    // so DKStandalone and the optional native codec bridge still work.
    const webPreferences={...home.webContents.getLastWebPreferences()};
    const icon=path.join(app.getAppPath(),"docs","icons","dk-media-player-512.png");
    player=new BrowserWindow({
      width:1250,height:790,minWidth:720,minHeight:480,
      backgroundColor:"#110407",icon,
      webPreferences
    });
    // The native decoder belongs to the PLAYER webContents, never the
    // library process. Keep the bridge optional until bundled binaries exist.
    if(fs.existsSync(path.join(app.getAppPath(),"desktop","codec-host.cjs")))
      require("./codec-host.cjs").install(player);
    player.on("closed",()=>{player=null;});
  }
  player.show();
  player.focus();
  // Each library selection replaces playback in this SAME second window;
  // the library window remains open and independent.
  return player.loadFile(playerFile,{query:{libraryItem:id}}).then(()=>true);
}
function install(originalWindow,originalPlayer){
  if(installed)return;
  if(!originalWindow?.webContents||typeof originalPlayer!=="string")
    throw new Error("Existing DK Kinehall window was not provided");
  installed=true;home=originalWindow;playerFile=originalPlayer;
  ipcMain.handle("dk-library:open-player",(event,id)=>{
    if(!allowed(event))throw new Error("Library command rejected");
    return openPlayer(id);
  });
  ipcMain.handle("dk-library:show-home",event=>{
    if(!home||home.isDestroyed())return false;
    // A request from the video player may focus the existing library.
    if(event.sender!==player?.webContents &&
       event.sender!==home.webContents)return false;
    home.show();home.focus();return true;
  });
  home.on("closed",()=>{
    if(installedWindow())player.close();
    home=null;
  });
}
module.exports={install};
