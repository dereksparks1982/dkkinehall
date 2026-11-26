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
  getInterfaceLanguage:fallback=>libIpc.invoke("dk-library:language-get",fallback==="ru"?"ru":"en"),
  setInterfaceLanguage:value=>libIpc.invoke("dk-library:language-set",value==="ru"?"ru":"en"),
  onInterfaceLanguage:callback=>subscribe("dk-library:language-changed",callback),
  networkDiscover:()=>libIpc.invoke("dk-network:discover"),
  networkDescription:id=>libIpc.invoke("dk-network:description",String(id)),
  networkBrowse:(id,control,type,objectId,start)=>libIpc.invoke("dk-network:browse",
    String(id),String(control),String(type),String(objectId),Number(start)),
  networkGrant:(id,url)=>libIpc.invoke("dk-network:grant",id===null?null:String(id),String(url)),
  networkRelease:token=>libIpc.invoke("dk-network:release",String(token)),
  openACP:()=>libIpc.invoke("dk-library:open-acp"),
  recordNavigation:value=>libIpc.invoke("dk-library:record-navigation",value),
  navigateHistory:direction=>libIpc.invoke("dk-library:navigate-history",Number(direction)),
  onRestoreNavigation:callback=>subscribe("dk-library:restore-navigation",callback),
  requestMaintenance:(action,language)=>libIpc.invoke("dk-library:maintenance-request",String(action),String(language)),
  setMaintenanceStatus:value=>libIpc.invoke("dk-library:maintenance-status",value),
  onMaintenanceRequest:callback=>subscribe("dk-library:maintenance-request",callback),
  onMaintenanceStatus:callback=>subscribe("dk-library:maintenance-status",callback),
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
  speechStatus:()=>libIpc.invoke("dk-library:asr-status"),
  cancelSpeech:()=>libIpc.invoke("dk-library:asr-cancel"),
  onSpeechProgress:callback=>subscribe("dk-library:asr-progress",callback),
  exportGeneratedSRT:(content,language)=>libIpc.invoke("dk-library:export-translated-srt",String(content),language==="ru"?"ru":"en",true),
  voiceoverStatus:pair=>libIpc.invoke("dk-library:voiceover-status",String(pair)),
  voiceoverCacheStats:()=>libIpc.invoke("dk-library:voiceover-cache-stats"),
  clearVoiceoverCache:language=>libIpc.invoke("dk-library:voiceover-cache-clear",language==="ru"?"ru":"en"),
  generateVoiceover:(pair,rows,ticket)=>libIpc.invoke("dk-library:voiceover-generate",String(pair),rows,Number(ticket)),
  discardVoiceover:()=>libIpc.invoke("dk-library:voiceover-discard"),
  voiceoverSource:ticket=>libIpc.invoke("dk-library:voiceover-source",Number(ticket)),
  exportVoiceover:(ticket,language)=>libIpc.invoke("dk-library:voiceover-export",Number(ticket),language==="ru"?"ru":"en"),
  onVoiceoverProgress:callback=>subscribe("dk-library:voiceover-progress",callback),
  translationStatus:pair=>libIpc.invoke("dk-library:translation-status",String(pair)),
  translateSubtitles:(pair,lines,ticket)=>libIpc.invoke("dk-library:translate",String(pair),lines,Number(ticket)),
  exportTranslatedSRT:(content,language)=>libIpc.invoke("dk-library:export-translated-srt",String(content),language==="ru"?"ru":"en"),
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
  openSharedSettings:language=>libIpc.invoke("dk-library:settings-open",language==="ru"?"ru":"en"),
  openMediaTool:kind=>libIpc.invoke("dk-library:open-media-tool",String(kind)),
  onOpenMediaTool:callback=>subscribe("dk-library:open-media-tool",callback),
  changeSharedSetting:(id,action,value)=>libIpc.invoke("dk-library:settings-change",String(id),String(action),value),
  onActivatePlayer:callback=>subscribe("dk-library:activate-player",callback),
  discover:manual=>libIpc.invoke("dk-library:discover",Boolean(manual)),
  cancelScan:()=>libIpc.invoke("dk-library:cancel-scan"),
  nativeOpen:(id,filePath)=>libIpc.invoke("dk-library:native-open",
    String(id),String(filePath)),
  readRange:(id,filePath,start,end)=>libIpc.invoke("dk-library:read-range",
    String(id),String(filePath),Number(start),Number(end)),
  localCover:(id,filePath,series,kind)=>libIpc.invoke("dk-library:local-cover",
    String(id),String(filePath),Boolean(series),String(kind)),
  showInFolder:(id,filePath)=>libIpc.invoke("dk-library:show-in-folder",String(id),String(filePath)),
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
