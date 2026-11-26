"use strict";
/* Add native discovery controls to the ORIGINAL DKStandalone preload.
 * No arbitrary shell, file-write or raw ipcRenderer exposure.
 */
const {contextBridge:libContextBridge,ipcRenderer:libIpc}=require("electron");
const nativeLibrary=Object.freeze({
  nativeLibrary:true,
  openPlayer:id=>libIpc.invoke("dk-library:open-player",String(id)),
  showLibrary:()=>libIpc.invoke("dk-library:show-home"),
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
