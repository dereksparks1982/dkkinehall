"use strict";
/* Library Home is the original application's start window. Launch the
 * unchanged docs/index.html player into a SECOND Electron BrowserWindow.
 * No network server, background service, icon redesign or alternative UI.
 */
const {ipcMain,BrowserWindow,app,dialog,shell}=require("electron");
const native=require("./library-indexer.cjs");
const path=require("node:path");
const fs=require("node:fs");
let installed=false,home=null,player=null,playerFile=null;
let scanController=null,scanPromise=null;
function onlyPlayer(event){
  return player&&!player.isDestroyed()&&
    event.sender===player.webContents&&
    event.senderFrame?.url?.startsWith("file://")&&
    event.senderFrame.url.includes("/index.html");
}
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
  // The native app discovers the local filesystem directly. The renderer
  // receives small metadata records, never video bytes or root access.
  ipcMain.handle("dk-library:discover",async(event,manual=false)=>{
    if(!allowed(event))throw Error("Native discovery rejected");
    if(scanPromise)return scanPromise;
    scanController=new AbortController();
    scanPromise=native.discover({
      manual:Boolean(manual),signal:scanController.signal,
      onProgress:p=>{
        if(home&&!home.isDestroyed())
          home.webContents.send("dk-library:scan-progress",p);
      }
    });
    try{return await scanPromise;}
    finally{scanPromise=null;scanController=null;}
  });
  ipcMain.handle("dk-library:cancel-scan",event=>{
    if(!allowed(event))throw Error("Scan cancellation rejected");
    if(scanController)scanController.abort();
    return true;
  });
  ipcMain.handle("dk-library:native-open",(event,id,filePath)=>{
    if(!onlyPlayer(event))throw Error("Native media launch rejected");
    return native.openVideo(id,filePath);
  });
  ipcMain.handle("dk-library:read-range",(event,id,filePath,start,end)=>{
    if(!onlyPlayer(event))throw Error("Native media access rejected");
    return native.readRange(id,filePath,start,end);
  });
  ipcMain.handle("dk-library:local-cover",(event,id,filePath,series,kind)=>{
    if(!allowed(event))throw Error("Local artwork request rejected");
    return native.localArtwork(id,filePath,{
      series:Boolean(series),kind:kind==="tv"?"tv":"movie"});
  });
  ipcMain.handle("dk-library:delete-video",(event,id,filePath)=>{
    if(!allowed(event))throw Error("Native deletion rejected");
    return native.deleteVideo(id,filePath,{dialog,shell,window:home});
  });
  ipcMain.handle("dk-library:show-home",event=>{
    if(!home||home.isDestroyed())return false;
    // A request from the video player may focus the existing library.
    if(event.sender!==player?.webContents &&
       event.sender!==home.webContents)return false;
    home.show();home.focus();return true;
  });
  home.on("closed",()=>{
    scanController?.abort();
    if(installedWindow())player.close();
    home=null;
  });
}
module.exports={install};
