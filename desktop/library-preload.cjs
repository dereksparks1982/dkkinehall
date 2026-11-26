"use strict";
/* Add native discovery controls to the ORIGINAL DKStandalone preload.
 * No arbitrary shell, file-write or raw ipcRenderer exposure.
 */
const {contextBridge:libContextBridge,ipcRenderer:libIpc,webUtils:libWebUtils}=require("electron");
const subscribe=(channel,callback)=>{
  if(typeof callback!=="function")return ()=>{};
  const listener=(_event,value)=>callback(value);
  libIpc.on(channel,listener);
  return ()=>libIpc.removeListener(channel,listener);
};
const nativeLibrary=Object.freeze({
  internalPages:true,
  rememberMedia:(file,key)=>{
    if(!file)return Promise.resolve(false);
    let source;
    if(file.nativeVirtual===true)source={kind:"native",id:file.nativeId,path:file.nativePath};
    else{
      let selected="";
      try{selected=libWebUtils?.getPathForFile?.(file)||"";}catch(_){}
      if(!selected)return Promise.resolve(false);
      source={kind:"picked",path:selected};
    }
    return libIpc.invoke("dk-library:remember-media",{
      ...source,name:file.name,size:file.size,modified:file.lastModified
    },String(key));
  },
  restoreMedia:key=>libIpc.invoke("dk-library:restore-media",String(key)),
  forgetMedia:()=>libIpc.invoke("dk-library:forget-media"),
  translationStatus:pair=>libIpc.invoke("dk-library:translation-status",String(pair)),
  translateSubtitles:(pair,lines)=>libIpc.invoke("dk-library:translate",String(pair),lines),
  cancelTranslation:()=>libIpc.invoke("dk-library:cancel-translation"),
  onTranslationProgress:callback=>subscribe("dk-library:translation-progress",callback),
  metadataRequest:(url,kind)=>libIpc.invoke("dk-library:metadata-request",String(url),String(kind)),
  onLibrarySelection:callback=>subscribe("dk-library:selection",callback),
  requestScan:()=>libIpc.invoke("dk-library:request-scan"),
  onScanRequest:callback=>subscribe("dk-library:scan-request",callback),
  setScanState:value=>libIpc.invoke("dk-library:scan-state",Boolean(value)),
  onScanState:callback=>subscribe("dk-library:scan-state",callback),
  setFullscreen:value=>libIpc.invoke("dk-library:player-fullscreen",Boolean(value)),
  onFullscreenChanged:callback=>subscribe("dk-library:fullscreen-state",callback),
  nativeLibrary:true,
  externalSelection:()=>libIpc.invoke("dk-library:external-selection"),
  onExternalReady:callback=>{
    if(typeof callback!=="function")return ()=>{};
    const listener=()=>callback();
    libIpc.on("dk-library:external-ready",listener);
    return ()=>libIpc.removeListener("dk-library:external-ready",listener);
  },
  openPlayer:id=>libIpc.invoke("dk-library:open-player",String(id)),
  showLibrary:()=>libIpc.invoke("dk-library:show-home"),
  showPlayer:()=>libIpc.invoke("dk-library:show-player"),
  discover:manual=>libIpc.invoke("dk-library:discover",Boolean(manual)),
  cancelScan:()=>libIpc.invoke("dk-library:cancel-scan"),
  nativeOpen:(id,filePath)=>libIpc.invoke("dk-library:native-open",
    String(id),String(filePath)),
  readRange:(id,filePath,start,end)=>libIpc.invoke("dk-library:read-range",
    String(id),String(filePath),Number(start),Number(end)),
  localCover:(id,filePath,series,kind)=>libIpc.invoke("dk-library:local-cover",
    String(id),String(filePath),Boolean(series),String(kind)),
  deleteVideo:(id,filePath)=>libIpc.invoke("dk-library:delete-video",
    String(id),String(filePath)),
  onScanProgress:callback=>{
    if(typeof callback!=="function")return ()=>{};
    const listener=(_event,progress)=>callback(progress);
    libIpc.on("dk-library:scan-progress",listener);
    return ()=>libIpc.removeListener("dk-library:scan-progress",listener);
  }
});
libContextBridge.exposeInMainWorld("DKLibraryBridge",nativeLibrary);
