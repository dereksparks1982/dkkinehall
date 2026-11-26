"use strict";
/* Standalone Chromium preload: narrowly scoped local decoder bridge.
 * Uses Electron's supported webUtils API to obtain the path of an actual
 * user-selected File; never exposes arbitrary file paths or raw IPC.
 */
const {contextBridge,ipcRenderer,webUtils}=require("electron");
const localPath=file=>{
  try {return typeof webUtils?.getPathForFile==="function"?
    webUtils.getPathForFile(file)||"":"";}
  catch(_){return "";}
};
contextBridge.exposeInMainWorld("DKCodecBridge",{
  status:()=>ipcRenderer.invoke("dk-codec:status"),
  probe:file=>{
    const name=localPath(file);
    if(!name)return Promise.reject(new Error("A local file must be selected"));
    return ipcRenderer.invoke("dk-codec:probe",name);
  },
  start:(file,offset,format="mp4",audioIndex=0)=>{
    const name=localPath(file);
    if(!name)return Promise.reject(new Error("A local file must be selected"));
    return ipcRenderer.invoke("dk-codec:start",name,Number(offset)||0,
      format==="webm"?"webm":"mp4",Number.isInteger(audioIndex)?audioIndex:0);
  },
  stop:()=>ipcRenderer.invoke("dk-codec:stop")
});
