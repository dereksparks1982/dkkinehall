"use strict";
/* Standalone Chromium preload: narrowly scoped local decoder bridge.
 * Uses Electron's supported webUtils API to obtain the path of an actual
 * user-selected File; never exposes arbitrary file paths or raw IPC.
 */
const {contextBridge,ipcRenderer,webUtils}=require("electron");
const localPath=file=>{
  // Main verifies this discovered file's ID, path and library scope.
  if(file?.nativeVirtual===true)
    return {kind:"native",id:file.nativeId,path:file.nativePath};
  try {return typeof webUtils?.getPathForFile==="function"?
    webUtils.getPathForFile(file)||"":"";}
  catch(_){return "";}
};
contextBridge.exposeInMainWorld("DKCodecBridge",{
  status:()=>ipcRenderer.invoke("dk-codec:status"),
  exportVideo:language=>ipcRenderer.invoke("dk-codec:export",language==="ru"?"ru":"en"),
  probe:file=>{
    const name=localPath(file);
    if(!name)return Promise.reject(new Error("A local file must be selected"));
    return ipcRenderer.invoke("dk-codec:probe",name);
  },
  adjacentFrame:(file,position,direction)=>{
    const name=localPath(file);
    if(!name)return Promise.reject(new Error("A local file must be selected"));
    return ipcRenderer.invoke("dk-codec:adjacent-frame",name,Number(position),Number(direction));
  },
  start:(file,offset,format="auto",audioIndex=0,frameStep=false,deinterlace="off",smoothing="off")=>{
    const name=localPath(file);
    if(!name)return Promise.reject(new Error("A local file must be selected"));
    return ipcRenderer.invoke("dk-codec:start",name,Number(offset)||0,
      ["mp4","webm"].includes(format)?format:"auto",
      Number.isInteger(audioIndex)?audioIndex:0,frameStep===true,["auto","on"].includes(deinterlace)?deinterlace:"off",
      ["auto","60","120"].includes(smoothing)?smoothing:"off");
  },
  subtitleVtt:(file,index)=>{
    const name=localPath(file);
    if(!name)return Promise.reject(new Error("A local file must be selected"));
    return ipcRenderer.invoke("dk-codec:subtitle-vtt",name,Number(index));
  },
  stop:()=>ipcRenderer.invoke("dk-codec:stop")
});
