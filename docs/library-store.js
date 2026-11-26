/* DK Kinehall persistent, server-free Movies/TV catalog.
 * Only IndexedDB metadata and optional artwork blobs are cached; movie bytes
 * remain in their original directories. There are no background processes.
 */
(function(root,factory) {
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.DKLibraryStore=api;
})(typeof window!=="undefined"?window:globalThis,function(){
"use strict";
const DB_NAME="dk-kinehall.local-library.v1",VERSION=1;
const MAX_FILES=25000,MAX_VISITS=60000,MAX_DEPTH=12,MAX_IMAGE_BYTES=3*1024*1024;
const CHANNEL="dk-kinehall-library";
let dbPromise=null;
const listeners=new Set();
let channel=null;
if(typeof BroadcastChannel==="function"){
  try{
    channel=new BroadcastChannel(CHANNEL);
    channel.addEventListener("message",event=>{
      if(event.data?.type==="updated")notify(event.data);
    });
  }catch(_){}
}
function notify(event) {
  listeners.forEach(callback=>{try{callback(event);}catch(_){}});
}
function changed(detail={}) {
  const event={type:"updated",...detail};
  notify(event);
  try{channel?.postMessage(event);}catch(_){}
}
function onChange(callback) {
  listeners.add(callback);
  return ()=>listeners.delete(callback);
}
function open() {
  if(dbPromise)return dbPromise;
  if(typeof indexedDB==="undefined")return Promise.reject(
    new Error("Local library database is not available in this browser"));
  dbPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains("folders"))
        db.createObjectStore("folders",{keyPath:"id"});
      if(!db.objectStoreNames.contains("entries")) {
        const entries=db.createObjectStore("entries",{keyPath:"id"});
        entries.createIndex("folderId","folderId");
        entries.createIndex("kind","kind");
      }
      if(!db.objectStoreNames.contains("art"))
        db.createObjectStore("art",{keyPath:"id"});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>{
      dbPromise=null;
      reject(request.error||new Error("Library database could not be opened"));
    };
    request.onblocked=()=>{dbPromise=null;reject(new Error("Close other Kinehall library windows and retry"));};
  });
  return dbPromise;
}
async function operation(table,mode,action) {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(table,mode),store=tx.objectStore(table);
    let result;
    try{
      const request=action(store);
      if(request){
        request.onsuccess=()=>{result=request.result;};
      }
    }catch(error){tx.abort();reject(error);return;}
    tx.oncomplete=()=>resolve(result);
    tx.onabort=()=>reject(tx.error||new Error("Local library database transaction failed"));
    tx.onerror=()=>{};
  });
}
const get=(table,key)=>operation(table,"readonly",s=>s.get(key));
const list=table=>operation(table,"readonly",s=>s.getAll());
const put=(table,row)=>operation(table,"readwrite",s=>s.put(row));
async function putBatch(table,rows){
  if(!rows.length)return;
  const db=await open();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(table,"readwrite"),s=tx.objectStore(table);
    for(const row of rows)s.put(row);
    tx.oncomplete=resolve;
    tx.onabort=()=>reject(tx.error||new Error("Library save failed"));
  });
}
function classify(name){
  if(!/\.(mp4|m4v|mov|mkv|avi|webm|ogv|ts|mts|m2ts|mpeg|mpg|m2v|mxf|vob|wmv|asf|flv|f4v|3gp|3g2|dv|divx|rm|rmvb|mpv|nut)$/i.test(name))return null;
  const parsed=typeof window!=="undefined"?window.DKMediaMetadata?.parseFilename?.(name):null;
  if(parsed?.type==="episode")return {
    kind:"tv",title:parsed.series,series:parsed.series,season:parsed.season,
    episode:parsed.episode,episodeTitle:parsed.episodeTitle||"",
    year:parsed.year||null
  };
  const fallback=String(name).replace(/\.[^.]+$/,"").replace(/[._]+/g," ").trim();
  return {kind:"movie",title:parsed?.title||fallback,
    year:parsed?.year||null,series:null,season:null,episode:null,episodeTitle:""};
}
function nameSort(a,b){
  return String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:"base"});
}
function stableId(folderId,relative){return folderId+"|"+relative;}
function nextId(){
  if(typeof crypto!=="undefined"&&crypto.randomUUID)return crypto.randomUUID();
  return "folder-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2);
}
async function folders(){return (await list("folders")).sort((a,b)=>nameSort(a.name,b.name));}
async function addFolder(handle,category="both"){
  if(!handle||handle.kind!=="directory")throw new Error("Choose a local folder");
  const saved=await folders();
  for(const folder of saved){
    if(typeof handle.isSameEntry==="function"&&folder.handle){
      try{
        if(await handle.isSameEntry(folder.handle))return folder;
      }catch(_){}
    }
  }
  const folder={id:nextId(),name:handle.name,handle,category,
    addedAt:Date.now(),lastScan:0};
  await put("folders",folder);
  changed({folders:true});
  return folder;
}
async function removeFolder(id) {
  const all=await list("entries");
  const db=await open();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(["folders","entries","art"],"readwrite");
    tx.objectStore("folders").delete(id);
    for(const entry of all){
      if(entry.folderId!==id)continue;
      tx.objectStore("entries").delete(entry.id);
      tx.objectStore("art").delete(entry.id);
    }
    tx.oncomplete=resolve;
    tx.onabort=()=>reject(tx.error||new Error("Unable to remove folder"));
  });
  changed({folders:true,entries:true});
}
async function entries(){return list("entries");}
async function folderEntries(folderId){
  return operation("entries","readonly",s=>s.index("folderId").getAll(folderId));
}
async function item(id){return get("entries",id);}
function yieldControl(){return new Promise(resolve=>setTimeout(resolve,0));}
async function checkReadPermission(folder,allowPrompt=false){
  const handle=folder?.handle;
  if(!handle||handle.kind!=="directory")return false;
  try{
    if(typeof handle.queryPermission!=="function")return true;
    const state=await handle.queryPermission({mode:"read"});
    if(state==="granted")return true;
    return allowPrompt&&typeof handle.requestPermission==="function"&&
      await handle.requestPermission({mode:"read"})==="granted";
  }catch(_){return false;}
}
async function scanFolder(folder,{manual=false,onProgress=()=>{},signal}={}){
  if(!await checkReadPermission(folder,manual))
    return {folder:folder.name,needsPermission:true,added:0,updated:0,missing:0};
  // Use the folder index, not the complete library, for each scan. This
  // avoids repeatedly loading every film across different folders.
  const old=await folderEntries(folder.id);
  const existing=new Map(old.map(row=>[row.id,row]));
  const seen=new Set(),pending=[];
  const work=[{handle:folder.handle,path:"",depth:0}];
  let visits=0,added=0,updated=0,missing=0;
  let complete=true;
  const maxFiles=manual?MAX_FILES:Math.min(MAX_FILES,10000);
  const visitLimit=manual?MAX_VISITS:10000;
  while(work.length){
    if(signal?.aborted)throw new Error("Library scan cancelled");
    const next=work.shift();
    if(next.depth>MAX_DEPTH){complete=false;continue;}
    try{
      for await(const [name,handle] of next.handle.entries()){
        visits++;
        if(signal?.aborted)throw new Error("Library scan cancelled");
        if(visits>visitLimit){complete=false;work.length=0;break;}
        if(handle.kind==="directory"){
          if(next.depth<MAX_DEPTH)work.push({
            handle,path:next.path+name+"/",depth:next.depth+1});
          else complete=false;
          continue;
        }
        if(handle.kind!=="file")continue;
        const info=classify(name);
        if(!info||(folder.category!=="both"&&folder.category!==info.kind))continue;
        if(seen.size>=maxFiles){complete=false;continue;}
        const relative=next.path+name,id=stableId(folder.id,relative);
        seen.add(id);
        let file;
        try{file=await handle.getFile();}catch(_){complete=false;continue;}
        const previous=existing.get(id);
        if(previous&&previous.size===file.size&&
           previous.modified===file.lastModified&&!previous.missing)continue;
        const row={
          ...(previous||{}),...info,id,folderId:folder.id,relative,
          filename:file.name,size:file.size,modified:file.lastModified,
          missing:false,updatedAt:Date.now(),
          position:previous?.position||0,duration:previous?.duration||0,
          lastPlayed:previous?.lastPlayed||0,completed:previous?.completed||false
        };
        pending.push(row);
        if(previous)updated++;else added++;
        if(pending.length>=80){
          await putBatch("entries",pending.splice(0));
          onProgress({folder:folder.name,visits,added,updated,missing});
          await yieldControl();
        }
      }
    }catch(error){
      if(signal?.aborted)throw error;
      complete=false;
    }
    if(visits%400<100){
      onProgress({folder:folder.name,visits,added,updated,missing});
      await yieldControl();
    }
  }
  if(pending.length)await putBatch("entries",pending);
  if(complete){
    const vanished=old.filter(row=>!seen.has(row.id)&&!row.missing);
    missing=vanished.length;
    for(let i=0;i<vanished.length;i+=80)
      await putBatch("entries",vanished.slice(i,i+80).map(row=>({...row,missing:true})));
  }
  folder.lastScan=Date.now();
  folder.lastScanPartial=!complete;
  await put("folders",folder);
  changed({entries:true,folder:folder.id});
  return {folder:folder.name,added,updated,missing,visits,complete};
}
async function scanAll({manual=false,onProgress=()=>{},signal}={}){
  const configured=await folders(),results=[];
  for(const folder of configured){
    if(signal?.aborted)break;
    results.push(await scanFolder(folder,{manual,onProgress,signal}));
  }
  return results;
}
async function openFile(row,{requestPermission=false}={}){
  if(!row||row.missing)throw new Error("This file is unavailable. Reconnect its drive and scan the library.");
  const folder=await get("folders",row.folderId);
  if(!folder?.handle)throw new Error("This library folder is no longer available");
  if(!await checkReadPermission(folder,requestPermission))
    throw new Error("Access to this library folder needs permission");
  const parts=String(row.relative).split("/").filter(Boolean);
  let parent=folder.handle;
  for(const segment of parts.slice(0,-1))
    parent=await parent.getDirectoryHandle(segment,{create:false});
  const handle=await parent.getFileHandle(parts.at(-1),{create:false});
  const file=await handle.getFile();
  return {file,handle};
}
async function updateProgress(id,position,duration,completed=false){
  // One read/write transaction prevents overlapping updates from separate
  // library/player windows clobbering a newer playback position.
  const db=await open();
  let saved=false;
  await new Promise((resolve,reject)=>{
    const tx=db.transaction("entries","readwrite");
    const object=tx.objectStore("entries");
    const request=object.get(id);
    request.onsuccess=()=>{
      const row=request.result;
      if(!row)return;
      const seconds=Number(position),length=Number(duration);
      const progress=Number.isFinite(seconds)?Math.max(0,seconds):row.position||0;
      const total=Number.isFinite(length)&&length>0?length:row.duration||0;
      const done=Boolean(completed)||(total>0&&progress>=Math.max(0,total-12));
      object.put({...row,position:done?0:progress,duration:total,
        lastPlayed:Date.now(),completed:done});
      saved=true;
    };
    tx.oncomplete=resolve;
    tx.onabort=()=>reject(tx.error||new Error("Playback history could not be saved"));
  });
  if(saved)changed({progress:true,id});
}
async function artwork(id){return get("art",id);}
async function saveArtwork(id,blob,credit=""){
  if(!(blob instanceof Blob)||blob.size<=0||blob.size>MAX_IMAGE_BYTES||
     !/^image\/(jpeg|png|webp)$/i.test(blob.type))return false;
  await put("art",{id,blob,credit,updatedAt:Date.now()});
  changed({artwork:true,id});
  return true;
}
return Object.freeze({
  folders,addFolder,removeFolder,entries,item,classify,scanFolder,scanAll,
  checkReadPermission,openFile,updateProgress,artwork,saveArtwork,onChange,
  MAX_FILES,MAX_VISITS
});
});
