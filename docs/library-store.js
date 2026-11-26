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
const erase=(table,key)=>operation(table,"readwrite",s=>s.delete(key));
async function putBatch(table,rows){
  if(!rows.length)return;
  const db=await open();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(table,"readwrite"),s=tx.objectStore(table);
    for(const row of rows){
      if(table!=="entries"){s.put(row);continue;}
      // A scan may have started before the latest playback update.
      // Preserve live history from within this same write transaction.
      const request=s.get(row.id);
      request.onsuccess=()=>{
        const live=request.result;
        if(live?.userHidden) return;
        s.put(live?{...row,position:live.position||0,duration:live.duration||0,
          lastPlayed:live.lastPlayed||0,completed:!!live.completed,continueHidden:!!live.continueHidden}:row);
      };
    }
    tx.oncomplete=resolve;
    tx.onabort=()=>reject(tx.error||new Error("Library save failed"));
  });
}
function classify(name,relative=name){
  if(!/\.(mp4|m4v|mov|mkv|avi|webm|ogv|ts|mts|m2ts|mpeg|mpg|m2v|mxf|vob|wmv|asf|flv|f4v|3gp|3g2|dv|divx|rm|rmvb|mpv|nut)$/i.test(name))return null;
  if(/(?:^|[ ._-])sample(?:[ ._-]|$)/i.test(name))return null;
  const parsed=typeof window!=="undefined"?window.DKMediaMetadata?.parseFilename?.(name):null;
  if(parsed?.type==="episode")return {
    kind:"tv",title:parsed.series,series:parsed.series,season:parsed.season,
    episode:parsed.episode,episodeTitle:parsed.episodeTitle||"",
    year:parsed.year||null
  };
  // TV libraries are often stored as Show / Season 1 / 01 - Title.mkv,
  // without S01E01 in the filename. Use folder context, not the mere fact
  // that a name starts with a number (which may be a movie).
  const folders=String(relative).split("/").slice(0,-1);
  const seasonAt=folders.findIndex(part=>
    /^(?:season|series|сезон|s)[ ._-]*0*\d{1,2}(?:\b|$)/i.test(part));
  if(seasonAt>0){
    const found=/^(?:season|series|сезон|s)[ ._-]*0*(\d{1,2})(?:\b|$)/i
      .exec(folders[seasonAt]);
    const indexed=/^(?:episode|ep|e)?[ ._-]*0*(\d{1,3})(?:[ ._-]+|$)/i
      .exec(String(name).replace(/\.[^.]+$/,""));
    const season=found?Number(found[1]):NaN;
    const episode=indexed?Number(indexed[1]):NaN;
    let series=folders[seasonAt-1].replace(/[._]+/g," ").trim();
    if(/^south[ ._-]+park$/i.test(series))series="South Park";
    if(Number.isSafeInteger(season)&&season<=99&&
       Number.isSafeInteger(episode)&&episode>=1&&episode<=999&&
       series.length>=2){
      const episodeTitle=String(name).replace(/\.[^.]+$/,"")
        .slice(indexed[0].length).replace(/^[ ._-]+/,"")
        .replace(/[._]+/g," ").trim().slice(0,140);
      return {kind:"tv",title:series,series,season,episode,
        episodeTitle,year:null};
    }
  }
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
// Repair existing Golden Gun records before painting either library view.
// No schema reset, full rescan, media rename or playback-history rewrite.
let goldenGunRepair=null;
function goldenGunIdentity(row){
  if(row?.kind!=="movie")return false;
  const parsed=typeof window!=="undefined"?window.DKMediaMetadata?.parseFilename?.(row.filename):null;
  const norm=value=>String(value||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  return parsed?.type==="movie"&&parsed.year===1974&&norm(parsed.title)==="the man with the golden gun"||
    Number(row.year)===1974&&["the with the golden gun","the man with the golden gun"].includes(norm(row.title));
}
async function repairGoldenGun(){
  if(goldenGunRepair)return goldenGunRepair;
  goldenGunRepair=(async()=>{
    const db=await open();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(["entries","art"],"readwrite"),entries=tx.objectStore("entries"),art=tx.objectStore("art");
      const request=entries.index("kind").openCursor(IDBKeyRange.only("movie"));
      request.onsuccess=()=>{
        const cursor=request.result;if(!cursor)return;
        const row=cursor.value;
        if(!row.userHidden&&goldenGunIdentity(row)&&(row.title!=="The Man with the Golden Gun"||Number(row.year)!==1974)){
          cursor.update({...row,title:"The Man with the Golden Gun",year:1974,
            movieMetadataVerified:false,movieDetails:null,movieProvider:null});
          // Only invalidate this row's old provider artwork. Local covers
          // are independent of provider title identity and are retained.
          const cached=art.get(row.id);
          cached.onsuccess=()=>{
            if(cached.result&&!/^Local(?:\s|$)/i.test(String(cached.result.credit||"")))art.delete(row.id);
          };
        }
        cursor.continue();
      };
      tx.oncomplete=resolve;
      tx.onabort=()=>reject(tx.error||new Error("Movie metadata repair failed"));
    });
  })().catch(error=>{goldenGunRepair=null;throw error;});
  return goldenGunRepair;
}
async function entries(){
  if(typeof window!=="undefined"&&window.DKLibraryBridge?.internalPages)await repairGoldenGun();
  return list("entries");
}
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
  const seen=new Set(),pending=[],newRows=[];
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
        const info=classify(name,next.path+name);
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
          // Verified titles survive a file timestamp or size change.
          episodeTitle:previous?.metadataVerified?
            previous.episodeTitle:info.episodeTitle,
          filename:file.name,size:file.size,modified:file.lastModified,
          missing:false,updatedAt:Date.now(),
          position:previous?.position||0,duration:previous?.duration||0,
          lastPlayed:previous?.lastPlayed||0,completed:previous?.completed||false
        };
        pending.push(row);
        if(previous)updated++;
        else {added++;newRows.push(row);}
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
    // Reconcile true renames without reading movie bytes: unchanged size
    // AND modification time must uniquely match a missing original and a
    // new discovery. Ambiguous duplicate files are never auto-merged.
    const vanished=old.filter(row=>!seen.has(row.id)&&!row.missing);
    const identity=row=>String(row.size)+":"+String(row.modified);
    const oldMatches=new Map(),newMatches=new Map();
    for(const row of vanished){
      const key=identity(row);
      oldMatches.set(key,[...(oldMatches.get(key)||[]),row]);
    }
    for(const row of newRows){
      const key=identity(row);
      newMatches.set(key,[...(newMatches.get(key)||[]),row]);
    }
    const renamedIds=new Set();
    for(const [key,discovered] of newMatches){
      const previous=oldMatches.get(key)||[];
      if(previous.length!==1||discovered.length!==1)continue;
      const from=previous[0],to=discovered[0];
      const merged={...to,
        position:from.position||0,duration:from.duration||0,
        lastPlayed:from.lastPlayed||0,completed:from.completed||false,
        episodeTitle:from.metadataVerified?
          from.episodeTitle:to.episodeTitle,
        metadataVerified:from.metadataVerified||false,
        renamedFrom:from.relative};
      await put("entries",merged);
      // An unambiguous rename is the same video, not a deleted movie.
      // Remove only the superseded catalog row, never the media file.
      await erase("entries",from.id);
      const poster=await artwork(from.id);
      if(poster?.blob){
        await saveArtwork(to.id,poster.blob,poster.credit||"");
        await erase("art",from.id);
      }
      renamedIds.add(from.id);
      added--;updated++;
    }
    const trulyMissing=vanished.filter(row=>!renamedIds.has(row.id));
    missing=trulyMissing.length;
    for(let i=0;i<trulyMissing.length;i+=80)
      await putBatch("entries",trulyMissing.slice(i,i+80)
        .map(row=>({...row,missing:true})));
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
// Quarantine catalog noise without deleting files, artwork or history.
function excludedDiscovery(row){
  if(!row)return false;
  if(row.userHidden||row.libraryExcluded)return true;
  if(row.source!=="native")return false;
  const parts=String(row.nativePath||"").split("/").map(p=>p.toLowerCase());
  return parts.some(p=>["node_modules","__pycache__","cmakefiles","testdata","test-data","fixtures","test-fixtures","desktop-codecs","_internal","vendor","site-packages"].includes(p))||
    parts.some((p,i)=>p==="dklab"&&["projects","archives"].includes(parts[i+1]))||
    /^(?:av1|apv|cardimageurl|compiler[._ -]?depend)\.[^.]+$/i.test(row.filename||"")||
    Number.isFinite(row.size)&&row.size<1024*1024;
}
async function ingestNative(scan){
  if(!scan||!Array.isArray(scan.items))
    throw new Error("Invalid native library scan");
  const existing=(await entries()).filter(row=>row.source==="native");
  const old=new Map(existing.map(row=>[row.id,row]));
  const rejected=new Set(Array.isArray(scan.rejected)?scan.rejected.filter(id=>/^native:[a-f0-9]{64}$/.test(id)):[]);
  const seen=new Set(),changes=[];
  let added=0,updated=0,missing=0;
  for(const file of scan.items){
    if(!file||typeof file.id!=="string"||
       !/^native:[a-f0-9]{64}$/.test(file.id)||
       typeof file.nativePath!=="string"||
       !file.nativePath.startsWith("/")||
       !Number.isFinite(file.size)||!Number.isFinite(file.modified))
      continue;
    let info=classify(file.filename,file.relative);
    if(!info)continue;
    seen.add(file.id);
    const previous=old.get(file.id);
    if(previous?.userHidden)continue;
    if(info.kind==="movie"&&goldenGunIdentity({...previous,filename:file.filename,kind:"movie"}))
      info={...info,title:"The Man with the Golden Gun",year:1974};
    // A provider label must not preserve an obviously wrong title/year
    // once the original filename has been classified correctly.
    const normalized=value=>window.DKMediaMetadata?.normalize(value)||String(value||"").toLowerCase().trim();
    const validMovie=info.kind==="movie"&&previous?.kind==="movie"&&previous.movieMetadataVerified&&
      normalized(previous.title)===normalized(info.title)&&(!info.year||!previous.year||Number(previous.year)===Number(info.year));
    const staleMovie=info.kind==="movie"&&previous?.movieMetadataVerified&&!validMovie;
    const sameClass=previous&&previous.kind===info.kind&&previous.series===info.series&&
      previous.season===info.season&&previous.episode===info.episode&&
      !staleMovie&&(validMovie||previous.title===info.title)&&(!info.year||Number(previous.year)===Number(info.year));
    if(sameClass&&previous.size===file.size&&previous.modified===file.modified&&!previous.missing&&!previous.libraryExcluded&&previous.volumeIdentity===(file.volumeIdentity||null))continue;
    changes.push({...previous,...info,
      // A verified metadata provider title survives unchanged film contents.
      episodeTitle:previous?.kind===info.kind&&previous?.metadataVerified?
        previous.episodeTitle:info.episodeTitle,
      title:validMovie?previous.title:info.title,
      year:validMovie?(info.year||previous.year):info.year,
      movieMetadataVerified:!!validMovie,
      movieDetails:validMovie?previous.movieDetails:null,
      movieProvider:validMovie?previous.movieProvider:null,
      metadataVerified:previous?.kind===info.kind&&Boolean(previous?.metadataVerified),
      id:file.id,source:"native",nativePath:file.nativePath,
      nativeRoot:file.root,volumeIdentity:file.volumeIdentity||null,filename:file.filename,relative:file.relative,
      size:file.size,modified:file.modified,missing:false,libraryExcluded:false,
      position:previous?.position||0,duration:previous?.duration||0,
      lastPlayed:previous?.lastPlayed||0,completed:previous?.completed||false,
      updatedAt:Date.now()});
    if(previous)updated++;else added++;
  }
  for(const row of existing){
    if(!seen.has(row.id)&&(rejected.has(row.id)||excludedDiscovery(row))&&!row.libraryExcluded){changes.push({...row,libraryExcluded:true});}
  }
  if(scan.complete===true){
    for(const row of existing){
      if(!seen.has(row.id)&&!row.missing&&!rejected.has(row.id)&&!excludedDiscovery(row)){
        changes.push({...row,missing:true});
        missing++;
      }
    }
  }
  for(let i=0;i<changes.length;i+=80)
    await putBatch("entries",changes.slice(i,i+80));
  if(changes.length)changed({entries:true,native:true});
  return {added,updated,missing,found:seen.size,complete:scan.complete===true};
}
// Consolidate obsolete catalog records, not physical media. Keep two
// independently available native paths even if their fingerprints match.
async function reconcileNative(){
  const rows=await entries(),live=new Map(),legacyFolders=new Map((await folders()).map(f=>[f.id,f]));
  const fingerprint=row=>JSON.stringify([row.filename,row.size,Math.trunc(row.modified)]);
  for(const row of rows){
    if(row.source!=="native"||row.missing||excludedDiscovery(row))continue;
    const key=fingerprint(row);
    if(!live.has(key))live.set(key,[]);
    live.get(key).push(row);
  }
  let merged=0;
  for(const old of rows){
    if(excludedDiscovery(old))continue;
    if(old.source==="native"&&!old.missing)continue;
    if(!Number.isFinite(old.modified)||!Number.isFinite(old.size))continue;
    const candidates=live.get(fingerprint(old))||[];
    if(candidates.length!==1)continue;
    const target=candidates[0];
    if(target.id===old.id)continue;
    if(old.source!=="native"){
      const folder=legacyFolders.get(old.folderId);
      const relative=String(old.relative||old.filename).replace(/\\/g,"/");
      const suffix=folder?.name?"/"+folder.name+"/"+relative:"";
      if(!suffix||!target.nativePath?.endsWith(suffix))continue;
    }
    // Atomic merge with the current playback history, even when the player
    // is writing progress in another internal view.
    const db=await open();
    let didMerge=false;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(["entries","art"],"readwrite"),entries=tx.objectStore("entries"),art=tx.objectStore("art");
      const a=entries.get(old.id),b=entries.get(target.id);
      let count=0;
      const combine=()=>{
        if(++count!==2||!a.result||!b.result||b.result.missing||a.result.userHidden||b.result.userHidden)return;
        const from=a.result,to=b.result;
        let recent=(from.lastPlayed||0)>(to.lastPlayed||0)?from:to;
        // A newly created zero-progress row is not evidence of completion.
        const other=recent===from?to:from;
        if(!recent.completed&&!(Number(recent.position)>2)&&
          !other.completed&&Number(other.position)>2)recent=other;
        const updated={...to,position:recent.position||0,duration:recent.duration||to.duration||0,
          lastPlayed:recent.lastPlayed||0,completed:!!recent.completed};
        if(from.metadataVerified&&!to.metadataVerified){
          updated.episodeTitle=from.episodeTitle;updated.metadataVerified=true;
        }
        if(from.movieMetadataVerified&&!to.movieMetadataVerified){
          for(const field of ["title","year","movieDetails","movieProvider","movieMetadataVerified"])
            if(from[field]!==undefined)updated[field]=from[field];
        }
        entries.put(updated);entries.delete(from.id);
        const oldArt=art.get(from.id),newArt=art.get(to.id);
        let read=0;
        const transfer=()=>{
          if(++read!==2)return;
          if(oldArt.result?.blob&&!newArt.result?.blob)art.put({...oldArt.result,id:to.id});
          art.delete(from.id);
        };
        oldArt.onsuccess=transfer;newArt.onsuccess=transfer;didMerge=true;
      };
      a.onsuccess=combine;b.onsuccess=combine;
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error("Library reconciliation failed"));
    });
    if(didMerge)merged++;
  }
  if(merged)changed({entries:true,native:true});
  return merged;
}
async function emptyTrash(confirmedIds=[]){
  // Only positively checked paths may be removed. An unavailable record
  // on a disconnected disk is not proof of deletion.
  const ids=[...new Set(confirmedIds)];
  let removed=0;
  for(let start=0;start<ids.length;start+=80){
    const db=await open();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(["entries","art"],"readwrite"),entries=tx.objectStore("entries"),art=tx.objectStore("art");
      for(const id of ids.slice(start,start+80)){
        const request=entries.get(id);
        request.onsuccess=()=>{if(request.result?.source==="native"){entries.delete(id);art.delete(id);removed++;}};
      }
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error("Empty Trash failed"));
    });
  }
  if(removed)changed({entries:true,native:true});
  return removed;
}
async function hideEntry(id){
  const db=await open();let hidden=false;
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(["entries","art"],"readwrite"),entries=tx.objectStore("entries");
    const request=entries.get(id);
    request.onsuccess=()=>{
      const row=request.result;if(!row||row.source!=="native")return;
      // Retain a path-specific exclusion, not a title-wide ban.
      entries.put({id:row.id,kind:row.kind,source:row.source,nativePath:row.nativePath,
        nativeRoot:row.nativeRoot,volumeIdentity:row.volumeIdentity,filename:row.filename,
        relative:row.relative,size:row.size,modified:row.modified,userHidden:true,
        position:row.position,duration:row.duration,lastPlayed:row.lastPlayed,
        completed:row.completed,continueHidden:true});
      tx.objectStore("art").delete(id);hidden=true;
    };
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error("Remove from library failed"));
  });
  if(hidden)changed({entries:true,id});return hidden;
}
async function removeEntry(id){
  const itemRow=await item(id);
  if(!itemRow)return false;
  const db=await open();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(["entries","art"],"readwrite");
    tx.objectStore("entries").delete(id);
    tx.objectStore("art").delete(id);
    tx.oncomplete=resolve;
    tx.onabort=()=>reject(tx.error||new Error("Unable to remove library entry"));
  });
  changed({entries:true,id});
  return true;
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
// Recover the catalog identity of a manually opened or restored local file.
async function resolvePlaybackEntry(file,preferredId=null){
  if(!file||typeof file.name!=="string"||!Number.isFinite(file.size)||
     !Number.isFinite(file.lastModified))return null;
  const rows=await entries();
  const exact=rows.find(row=>row.id===preferredId||row.id===file.nativeId);
  if(exact)return exact;
  if(file.nativePath){
    const paths=rows.filter(row=>row.source==="native"&&row.nativePath===file.nativePath);
    if(paths.length===1)return paths[0];
    // Do not associate a known path with a different copy of the same file.
    return null;
  }
  const relative=String(file.webkitRelativePath||"").replace(/\\/g,"/");
  const matches=rows.filter(row=>row.filename===file.name&&row.size===file.size&&
    Number.isFinite(row.modified)&&Math.abs(row.modified-file.lastModified)<=1&&
    (!relative||row.relative===relative||row.nativePath?.endsWith("/"+relative)));
  const live=matches.filter(row=>row.source==="native"&&!row.missing);
  return live.length===1?live[0]:matches.length===1?matches[0]:null;
}
async function setContinueHidden(id,hidden=true){
  const db=await open();let saved=false;
  await new Promise((resolve,reject)=>{
    const tx=db.transaction("entries","readwrite"),object=tx.objectStore("entries");
    const request=object.get(id);
    request.onsuccess=()=>{const row=request.result;if(!row)return;object.put({...row,continueHidden:!!hidden});saved=true;};
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error("Could not update Continue Watching"));
  });
  if(saved)changed({progress:true,id});
  return saved;
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
      // Never classify a stopped or just-opened short video as finished.
      // Completion requires a positive playback position near the end.
      const standalone=typeof window!=="undefined"&&Boolean(window.DKLibraryBridge?.internalPages);
      if(standalone&&!completed&&(!Number.isFinite(seconds)||progress<=2))return;
      const finishWindow=Math.min(12,total*0.05);
      const done=Boolean(completed)||(!standalone&&
        (total>0&&progress>0&&progress>=Math.max(1,total-finishWindow)));
      object.put({...row,position:done?0:progress,duration:total,
        lastPlayed:Date.now(),completed:done});
      saved=true;
    };
    tx.oncomplete=resolve;
    tx.onabort=()=>reject(tx.error||new Error("Playback history could not be saved"));
  });
  if(saved)changed({progress:true,id});
  return saved;
}
async function updateMetadata(id,{episodeTitle,movieTitle,movieYear,movieDetails,movieProvider}={}){
  // Only verified metadata (from an actual provider result) is written.
  // Use a read/write transaction so a simultaneous playback-position save
  // cannot be overwritten by an older copy of a catalog record.
  const title=typeof episodeTitle==="string"?episodeTitle.trim().slice(0,180):"";
  const film=typeof movieTitle==="string"?movieTitle.trim().slice(0,180):"";
  const year=Number(movieYear)||null;
  if(!title&&!film)return false;
  const db=await open();
  let changedRow=false;
  await new Promise((resolve,reject)=>{
    const tx=db.transaction("entries","readwrite");
    const s=tx.objectStore("entries");
    const request=s.get(id);
    request.onsuccess=()=>{
      const row=request.result;
      if(!row||row.userHidden)return;
      if(row.kind==="tv"&&title){
        if(row.episodeTitle===title&&row.metadataVerified)return;
        s.put({...row,episodeTitle:title,metadataVerified:true});
      }else if(row.kind==="movie"&&film){
        // Reject a stale provider result which would reintroduce the bad title.
        if(goldenGunIdentity(row)&&(film.toLowerCase()!=="the man with the golden gun"||(year&&year!==1974)))return;
        const details=movieDetails&&typeof movieDetails==="object"?movieDetails:row.movieDetails;
        const provider=typeof movieProvider==="string"?movieProvider:row.movieProvider;
        if(row.title===film&&row.movieMetadataVerified&&(!year||row.year===year)&&
           JSON.stringify(row.movieDetails)===JSON.stringify(details)&&row.movieProvider===provider)return;
        s.put({...row,title:film,year:year||row.year,movieMetadataVerified:true,movieDetails:details,movieProvider:provider});
      }else return;
      changedRow=true;
    };
    tx.oncomplete=resolve;
    tx.onabort=()=>reject(tx.error||new Error("Episode metadata save failed"));
  });
  if(changedRow)changed({metadata:true,id});
  return changedRow;
}
async function artwork(id){return get("art",id);}
async function removeArtwork(id){await erase("art",id);}
async function saveArtwork(id,blob,credit=""){
  if(!(blob instanceof Blob)||blob.size<=0||blob.size>MAX_IMAGE_BYTES||
     !/^image\/(jpeg|png|webp)$/i.test(blob.type))return false;
  if(/^native:[a-f0-9]{64}$/.test(id)){
    const db=await open();let saved=false;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(["entries","art"],"readwrite"),request=tx.objectStore("entries").get(id);
      request.onsuccess=()=>{if(request.result&&!request.result.userHidden){tx.objectStore("art").put({id,blob,credit,updatedAt:Date.now()});saved=true;}};
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error("Artwork save failed"));
    });
    if(!saved)return false;
  }else await put("art",{id,blob,credit,updatedAt:Date.now()});
  changed({artwork:true,id});
  return true;
}
return Object.freeze({excludedDiscovery,
  folders,addFolder,removeFolder,entries,item,classify,scanFolder,scanAll,
  ingestNative,reconcileNative,emptyTrash,removeEntry,hideEntry,
  checkReadPermission,openFile,resolvePlaybackEntry,updateProgress,setContinueHidden,updateMetadata,artwork,saveArtwork,removeArtwork,onChange,
  MAX_FILES,MAX_VISITS
});
});
