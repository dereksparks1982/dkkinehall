"use strict";
/* One native window, persistent Library and Player views. */
const {ipcMain,WebContentsView,app,dialog,shell}=require("electron");
const native=require("./library-indexer.cjs");
const path=require("node:path");
const fs=require("node:fs");
const {fileURLToPath}=require("node:url");
const VERSION="0.9.3";
let externalSelections=[],externalWork=Promise.resolve();
let installed=false,home=null,player=null,playerFile=null,playerLoading=null,activePage="library",scanActive=false;
let scanController=null,scanPromise=null;
let metadataBusy=0;
async function metadataRequest(raw,kind){
  if(typeof raw!=="string"||raw.length>1500||!["json","image"].includes(kind))throw Error("Invalid metadata request");
  const url=new URL(raw);
  const h=url.hostname;
  const json=kind==="json"&&(
    (h==="v3-cinemeta.strem.io"&&url.pathname.startsWith("/catalog/movie/top/search="))||
    (h==="itunes.apple.com"&&url.pathname==="/search")||
    (h==="api.tvmaze.com"&&(/^\/search\/shows$/.test(url.pathname)||/^\/shows\/\d+\/episodes$/.test(url.pathname))));
  const image=kind==="image"&&(["images.metahub.space","static.tvmaze.com","images.tvmaze.com","image.tmdb.org"].includes(h)||/^(?:is\d+-ssl|a\d+|is\d+)\.mzstatic\.com$/.test(h));
  if(url.protocol!=="https:"||url.username||url.password||url.port||(!json&&!image))throw Error("Metadata provider rejected");
  if(metadataBusy>=4)return {ok:false,status:429};
  metadataBusy++;
  try{
    const response=await fetch(url,{redirect:"error",credentials:"omit",signal:AbortSignal.timeout(15000)});
    if(!response.ok)return {ok:false,status:response.status};
    const limit=3*1024*1024;
    const mime=(response.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
    if(kind==="image"&&!/^image\/(jpeg|png|webp)$/.test(mime))return {ok:false,status:415};
    if(Number(response.headers.get("content-length"))>limit)return {ok:false,status:413};
    const reader=response.body?.getReader();
    if(!reader)return {ok:false,status:502};
    const chunks=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
      if(size>limit){await reader.cancel();return {ok:false,status:413};}chunks.push(Buffer.from(value));}
    const data=Buffer.concat(chunks);
    return kind==="json"?{ok:true,status:200,text:data.toString("utf8")}:{ok:true,status:200,mime,bytes:new Uint8Array(data)};
  }catch(_){return {ok:false,status:502};}
  finally{metadataBusy--;}
}
function onlyPlayer(event){
  return player&&!player.webContents.isDestroyed()&&
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
  return player&&!player.webContents.isDestroyed();
}
function resizePlayer(){
  if(!home||home.isDestroyed()||!installedWindow())return;
  const [width,height]=home.getContentSize();
  player.setBounds({x:0,y:0,width,height});
}
function focusWindow(win){
  if(win.isMinimized())win.restore();
  win.show();win.focus();
}
function showPage(page){
  if(!home||home.isDestroyed())return false;
  if(page==="player"&&!installedWindow())return false;
  activePage=page;
  if(installedWindow()){
    resizePlayer();
    player.setVisible(page==="player");
  }
  focusWindow(home);
  if(page==="player")player.webContents.focus();
  else home.webContents.focus();
  return true;
}
async function openPlayer(id,external=false){
  if(!home||home.isDestroyed())throw Error("Library window was closed");
  const nav=id===null&&!external;
  if(!nav&&(typeof id!=="string"||id.length<1||id.length>500||id.includes("\0")))
    throw Error("Invalid library selection");
  if(installedWindow()){
    if(playerLoading)await playerLoading;
    showPage("player");
    if(external)player.webContents.send("dk-library:external-ready");
    else if(!nav)player.webContents.send("dk-library:selection",id);
    return true;
  }
  if(typeof WebContentsView!=="function")throw Error("Installed Electron does not support internal player views");
  const originalPrefs=home.webContents.getLastWebPreferences?.()||{};
  const appRoot=app.getAppPath();
  const preload=[originalPrefs.preload,path.join(appRoot,"preload.cjs"),path.join(appRoot,"preload.js")]
    .filter(Boolean).find(candidate=>{
      try{return fs.statSync(candidate).isFile()&&fs.readFileSync(candidate,"utf8").includes("DKStandalone");}
      catch(_){return false;}
    });
  if(!preload)throw Error("Original DKStandalone preload missing");
  const view=new WebContentsView({webPreferences:{
    preload,contextIsolation:true,nodeIntegration:false,
    sandbox:originalPrefs.sandbox===true,session:home.webContents.session,
    backgroundThrottling:false
  }});
  player=view;
  home.contentView.addChildView(view);
  resizePlayer();
  view.setVisible(false);
  view.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  view.webContents.on("will-navigate",(event,url)=>{
    try{if(fileURLToPath(url)!==playerFile)event.preventDefault();}
    catch(_){event.preventDefault();}
  });
  if(fs.existsSync(path.join(appRoot,"desktop","codec-host.cjs")))
    require("./codec-host.cjs").install(home,view.webContents);
  const options=nav?{}:{query:external?{externalItem:id}:{libraryItem:id}};
  playerLoading=view.webContents.loadFile(playerFile,options);
  try{
    await playerLoading;
    if(home.isDestroyed())return false;
    showPage("player");
    view.webContents.send("dk-library:scan-state",scanActive);
    return true;
  }finally{playerLoading=null;}
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
    await openPlayer("pending",true);
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
  home.setTitle("DK Kinehall v"+VERSION);
  home.on("page-title-updated",event=>{event.preventDefault();home?.setTitle("DK Kinehall v"+VERSION);});
  home.on("resize",resizePlayer);
  for(const event of ["enter-full-screen","leave-full-screen"])home.on(event,()=>{
    resizePlayer();
    if(installedWindow())player.webContents.send("dk-library:fullscreen-state",home.isFullScreen());
  });
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
  ipcMain.handle("dk-library:metadata-request",(event,url,kind)=>{
    if(!allowed(event))throw Error("Metadata request rejected");
    return metadataRequest(url,kind);
  });
  ipcMain.handle("dk-library:show-player",event=>{
    if(!allowed(event))throw new Error("Library navigation rejected");
    return openPlayer(null);
  });
  ipcMain.handle("dk-library:player-fullscreen",(event,value)=>{
    if(!onlyPlayer(event)||activePage!=="player")throw Error("Fullscreen rejected");
    home.setFullScreen(Boolean(value));return Boolean(value);
  });
  ipcMain.handle("dk-library:request-scan",event=>{
    if(!onlyPlayer(event))throw Error("Scan request rejected");
    home.webContents.send("dk-library:scan-request");return true;
  });
  ipcMain.handle("dk-library:scan-state",(event,value)=>{
    if(!allowed(event))throw Error("Scan state rejected");
    scanActive=Boolean(value);
    if(installedWindow())player.webContents.send("dk-library:scan-state",scanActive);
    return true;
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
    if(!onlyPlayer(event)&&!allowed(event))return false;
    if(home.isFullScreen())home.setFullScreen(false);
    return showPage("library");
  });
  home.on("closed",()=>{
    scanController?.abort();
    if(installedWindow())player.webContents.close();
    player=null;home=null;
  });
}
module.exports={install};
