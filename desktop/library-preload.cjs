"use strict";
/* Added to original Electron preload without replacing DKStandalone. */
const {contextBridge:libContextBridge,ipcRenderer:libIpc}=require("electron");
libContextBridge.exposeInMainWorld("DKLibraryBridge",Object.freeze({
  openPlayer:id=>libIpc.invoke("dk-library:open-player",String(id)),
  showLibrary:()=>libIpc.invoke("dk-library:show-home")
}));
