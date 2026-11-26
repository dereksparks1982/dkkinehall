"use strict";
/* Library Home is the original application's start window. Launch the
 * unchanged docs/index.html player into a SECOND Electron BrowserWindow.
 * No network server, background service, icon redesign or alternative UI.
 */
const {ipcMain,BrowserWindow,app,dialog,shell}=require("electron");
const native=require("./library-indexer.cjs");
const path=require("node:path");
const fs=require("node:fs");
const {fileURLToPath}=require("node:url");
const VERSION="0.9.3";
let externalSelections=[],externalWork=Promise.resolve();
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
function openPlayer(id,external=false) {
  if(!home||home.isDestroyed())throw new Error("Library window was closed");
  if(typeof id!=="string"||id.length<1||id.length>500||id.includes("\0"))
    throw new Error("Invalid library selection");
  if(!installedWindow()){
    // Inherit the approved original Electron runtime preferences and preload
    // so DKStandalone and the optional native codec bridge still work.
    // getLastWebPreferences is an internal Electron API and is not always
    // exported. Resolve the actual approved DKStandalone preload instead
    // of risking a second player window with no native bridges.
    const originalPrefs=typeof home.webContents.getLastWebPreferences==="function"?
      home.webContents.getLastWebPreferences():null;
    const appRoot=app.getAppPath();
    const candidates=[
      originalPrefs?.preload,
      path.join(appRoot,"preload.cjs"),
      path.join(appRoot,"preload.js")
    ].filter(Boolean);
    const preload=candidates.find(candidate=>{
      try{
        return fs.statSync(candidate).isFile()&&
          fs.readFileSync(candidate,"utf8").includes("DKStandalone");
      }catch(_){return false;}
    });
    if(!preload)
      throw Error("Original DKStandalone preload missing; player window refused");
    const webPreferences={
      ...(originalPrefs||{}),
      preload,
      contextIsolation:originalPrefs?.contextIsolation!==false,
      nodeIntegration:originalPrefs?.nodeIntegration===true,
      sandbox:originalPrefs?.sandbox===true
    };
    const icon=path.join(appRoot,"docs","icons","dk-media-player-512.png");
    player=new BrowserWindow({
      width:1250,height:790,minWidth:720,minHeight:480,
      backgroundColor:"#110407",icon,
      webPreferences
    });
    // The native decoder belongs to the PLAYER webContents, never the
    // library process. Keep the bridge optional until bundled binaries exist.
    if(fs.existsSync(path.join(app.getAppPath(),"desktop","codec-host.cjs")))
      require("./codec-host.cjs").install(player);
    player.on("page-title-updated",event=>{event.preventDefault();player?.setTitle("DK Kinehall v"+VERSION);});
    player.setTitle("DK Kinehall v"+VERSION);
    player.on("closed",()=>{player=null;externalSelections=[];});
  }
  player.show();
  player.focus();
  // Each library selection replaces playback in this SAME second window;
  // the library window remains open and independent.
  return player.loadFile(playerFile,{query:external?{externalItem:id}:{libraryItem:id}}).then(()=>true);
}
async function openExternal(argv,cwd){
  const entries=[],seen=new Set();
  for(const arg of argv.slice(1)){
    if(typeof arg!=="string"||arg.startsWith("-"))continue;
    try{
      const target=arg.startsWith("file://")?fileURLToPath(arg):path.resolve(cwd,arg);
      const id=native.fileIdentity(target);
      if(seen.has(id))continue;
      const opened=await native.openVideo(id,target);
      seen.add(id);
      entries.push({row:{id,nativePath:target,filename:opened.name,
        size:opened.size,modified:opened.modified},opened});
      if(entries.length>=256)break;
    }catch(_){/* Ignore non-media arguments and out-of-scope paths. */}
  }
  if(!entries.length||!home||home.isDestroyed())return false;
  externalSelections.push(...entries);
  if(installedWindow()){
    player.show();player.focus();
    player.webContents.send("dk-library:external-ready");
  }else{
    await openPlayer("pending",true);
  }
  return true;
}
function enqueueExternal(argv,cwd){
  externalWork=externalWork.catch(()=>{}).then(()=>openExternal(argv,cwd));
  void externalWork.catch(()=>{});
}
function install(originalWindow,originalPlayer){
  if(installed)return;
  if(!originalWindow?.webContents||typeof originalPlayer!=="string")
    throw new Error("Existing DK Kinehall window was not provided");
  installed=true;home=originalWindow;playerFile=originalPlayer;
  if(!app.requestSingleInstanceLock()){app.quit();return;}
  app.on("second-instance",(_event,argv,cwd)=>enqueueExternal(argv,cwd));
  ipcMain.handle("dk-library:external-selection",event=>{
    if(!onlyPlayer(event))throw Error("External selection rejected");
    return externalSelections.splice(0);
  });
  enqueueExternal(process.argv,process.cwd());
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
