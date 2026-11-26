"use strict";
/* Standalone Chromium preload: narrowly scoped local decoder bridge.
 * Uses Electron's supported webUtils API to obtain the path of an actual
 * user-selected File; never exposes arbitrary file paths or raw IPC.
 */
const {contextBridge,ipcRenderer,webUtils}=require("electron");
const localPath=file=>{
  if(file?.nativeVirtual===true &&
     /^native:[a-f0-9]{64}$/.test(String(file.nativeId||"")) &&
     typeof file.nativePath==="string"&&file.nativePath.startsWith("/"))
    return file.nativePath;
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
  start:(file,offset,format="auto",audioIndex=0)=>{
    const name=localPath(file);
    if(!name)return Promise.reject(new Error("A local file must be selected"));
    return ipcRenderer.invoke("dk-codec:start",name,Number(offset)||0,
      ["mp4","webm"].includes(format)?format:"auto",
      Number.isInteger(audioIndex)?audioIndex:0);
  },
  subtitleVtt:(file,index)=>{
    const name=localPath(file);
    if(!name)return Promise.reject(new Error("A local file must be selected"));
    return ipcRenderer.invoke("dk-codec:subtitle-vtt",name,Number(index));
  },
  stop:()=>ipcRenderer.invoke("dk-codec:stop")
});
