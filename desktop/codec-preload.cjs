"use strict";
/* Standalone Chromium preload: narrowly scoped local decoder bridge.
 * Uses Electron's supported webUtils API to obtain the path of an actual
 * user-selected File; never exposes arbitrary file paths or raw IPC.
 */
const {contextBridge,ipcRenderer,webUtils}=require("electron");
const localPath=file=>{
  if(typeof file?.networkToken==="string"&&/^[a-f0-9]{48}$/.test(file.networkToken))return {kind:"network",token:file.networkToken};
  if(typeof file?.dvdToken==="string"&&/^dvd:[a-f0-9]{48}$/.test(file.dvdToken))
    return {kind:"dvd",id:file.dvdToken};
  // Main verifies this discovered file's ID, path and library scope.
  if(file?.nativeVirtual===true)
    return {kind:"native",id:file.nativeId,path:file.nativePath};
  try {return typeof webUtils?.getPathForFile==="function"?
    webUtils.getPathForFile(file)||"":"";}
  catch(_){return "";}
};
contextBridge.exposeInMainWorld("DKCodecBridge",{
  status:()=>ipcRenderer.invoke("dk-codec:status"),
  selectDVD:(kind,title,chapter,angle,language)=>ipcRenderer.invoke("dk-codec:dvd-select",
    kind,Number(title),Number(chapter),Number(angle),language==="ru"?"ru":"en"),
  changeDVD:(id,title,chapter,angle)=>ipcRenderer.invoke("dk-codec:dvd-change",String(id),Number(title),Number(chapter),Number(angle)),
  exportVideo:language=>ipcRenderer.invoke("dk-codec:export",language==="ru"?"ru":"en"),
  commercialCandidates:file=>{const name=localPath(file);if(!name)return Promise.reject(Error("Select a local video"));return ipcRenderer.invoke("dk-codec:commercial-candidates",name);},
  previewFrame:(file,seconds)=>{const name=localPath(file);if(!name)return Promise.resolve(null);return ipcRenderer.invoke("dk-codec:preview-frame",name,Number(seconds));},
  cancelPreview:()=>ipcRenderer.invoke("dk-codec:preview-cancel"),
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
  streamStatus:token=>ipcRenderer.invoke("dk-codec:stream-status",String(token)),
  start:(file,offset,format="auto",audioIndex=0,frameStep=false,deinterlace="off",smoothing="off",subtitleIndex=-1,hardwareEnabled=true)=>{
    const name=localPath(file);
    if(!name)return Promise.reject(new Error("A local file must be selected"));
    return ipcRenderer.invoke("dk-codec:start",name,Number(offset)||0,
      ["mp4","webm"].includes(format)?format:"auto",
      Number.isInteger(audioIndex)?audioIndex:0,frameStep===true,["auto","on"].includes(deinterlace)?deinterlace:"off",
      ["auto","60","120"].includes(smoothing)?smoothing:"off",Number.isInteger(subtitleIndex)?subtitleIndex:-1,hardwareEnabled!==false);
  },
  identifySpeakers:(file,audioIndex,ticket)=>{
    const name=localPath(file);
    if(!name)return Promise.reject(new Error("A local file must be selected"));
    return ipcRenderer.invoke("dk-library:speaker-identify",name,Number(audioIndex),Number(ticket));
  },
  recognizeSpeech:(file,language,audioIndex,ticket)=>{
    const name=localPath(file);
    if(!name)return Promise.reject(new Error("A local file must be selected"));
    return ipcRenderer.invoke("dk-library:asr-generate",name,String(language),Number(audioIndex),Number(ticket));
  },
  subtitleVtt:(file,index)=>{
    const name=localPath(file);
    if(!name)return Promise.reject(new Error("A local file must be selected"));
    return ipcRenderer.invoke("dk-codec:subtitle-vtt",name,Number(index));
  },
  stop:()=>ipcRenderer.invoke("dk-codec:stop")
});
