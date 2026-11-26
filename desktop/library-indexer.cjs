"use strict";
/* DK Kinehall native library discovery. No daemon, server, external codecs
 * or all-files-in-memory cache. Runs only while the application is open.
 * A native scan covers the user's home and mounted removable/local volumes.
 */
const fs=require("node:fs");
const fsp=fs.promises;
const path=require("node:path");
const os=require("node:os");
const crypto=require("node:crypto");
const {pathToFileURL}=require("node:url");
const VIDEO=/\.(mp4|m4v|mov|mkv|avi|webm|ogv|ts|mts|m2ts|mpeg|mpg|m2v|mxf|vob|wmv|asf|flv|f4v|3gp|3g2|dv|divx|rm|rmvb|mpv|nut)$/i;
const NEVER=new Set([
  ".git",".cache",".config",".local",".npm",".cargo",".rustup",
  ".gradle",".venv","venv","node_modules","__pycache__","site-packages",
  "proc","sys","dev","run","lost+found","Trash","Trash-1000",
  "$RECYCLE.BIN","System Volume Information","snap","flatpak",
  "Cache","Caches",".thumbnails",".Trash-1000"
]);

// Do not treat source-code .ts files or development fixtures as movies.
// Keep manual opening independent of automatic library eligibility.
const DEVELOPMENT=new Set(["node_modules","__pycache__","cmakefiles","testdata","test-data","fixtures","test-fixtures","desktop-codecs","_internal","vendor","site-packages"]);
function excludedPath(filePath){
  const parts=path.resolve(filePath).split(path.sep).map(p=>p.toLowerCase());
  if(parts.some(p=>DEVELOPMENT.has(p)))return true;
  if(parts.some((p,i)=>p==="dklab"&&["projects","archives"].includes(parts[i+1])))return true;
  const stem=path.basename(filePath,path.extname(filePath));
  return /^(?:av1|apv|cardimageurl|compiler[._ -]?depend)$/i.test(stem);
}
const verificationCache=new Map();
async function inspectCandidate(file,stat,signal,probe){
  if(excludedPath(file)||stat.size<1024*1024)return false;
  const key=JSON.stringify([file,stat.size,stat.mtimeMs,!!probe]);
  if(verificationCache.has(key))return verificationCache.get(key);
  // Reject obvious source/text masquerading as transport-stream video.
  const handle=await fsp.open(file,"r");
  let bytes;
  try{const buffer=Buffer.alloc(8192);const read=await handle.read(buffer,0,buffer.length,0);bytes=buffer.subarray(0,read.bytesRead);}
  finally{await handle.close();}
  const sample=bytes.subarray(0,2048);
  const text=sample.length>0&&sample.every(b=>b===9||b===10||b===13||b>=32&&b<=126);
  if(text)return false;
  let result=null;
  if(probe){
    if(signal?.aborted)throw Error("Library scan cancelled");
    result=await probe(file,signal);
  }
  if(result===null){
    // Recognize common binary containers if the bundled probe is absent.
    const ascii=(from,to)=>bytes.toString("ascii",from,to);
    const ts=[188,192,204].some(stride=>[0,4].some(offset=>bytes[offset]===0x47&&bytes[offset+stride]===0x47&&bytes[offset+stride*2]===0x47));
    result=ts||ascii(4,8)==="ftyp"||bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))||
      ascii(0,4)==="RIFF"&&ascii(8,12)==="AVI "||ascii(0,4)==="OggS"||ascii(0,3)==="FLV"||
      bytes.subarray(0,4).equals(Buffer.from([0,0,1,0xba]))||
      bytes.subarray(0,4).equals(Buffer.from([0x30,0x26,0xb2,0x75]));
    // Unknown binary types are unverified, not definitely invalid.
    if(!result)return null;
  }
  verificationCache.set(key,result);
  if(verificationCache.size>30000)verificationCache.delete(verificationCache.keys().next().value);
  return result;
}

const MAX_BYTES_PER_READ=8*1024*1024;
const fileIdentity=p=>"native:"+crypto.createHash("sha256")
  .update(path.resolve(p)).digest("hex");
const containment=(root,target)=>{
  const rel=path.relative(root,target);
  return rel!==""&&!rel.startsWith(".."+path.sep)&&rel!==".."&&
    !path.isAbsolute(rel);
};
const rootPath=()=>{
  const home=os.homedir();
  const user=os.userInfo().username;
  return [home,path.join("/media",user),path.join("/run/media",user),"/mnt"]
    .filter((r,i,a)=>a.indexOf(r)===i)
    .filter(r=>{try{return fs.statSync(r).isDirectory();}catch(_){return false;}});
};
function ensureVideo(id,filePath){
  if(typeof id!=="string"||typeof filePath!=="string"||
     filePath.length>4096||filePath.includes("\0")||
     !path.isAbsolute(filePath)||!VIDEO.test(filePath)||
     id!==fileIdentity(filePath))
    throw Error("Invalid video selection");
  const resolved=path.resolve(filePath);
  if(!rootPath().some(root=>containment(root,resolved)))
    throw Error("Video is outside the local library scope");
  return resolved;
}
async function checkVideo(id,filePath){
  const target=ensureVideo(id,filePath);
  const real=await fsp.realpath(target);
  if(!rootPath().some(root=>containment(root,real)))
    throw Error("Video points outside the local library scope");
  const stat=await fsp.lstat(target);
  if(!stat.isFile()||stat.isSymbolicLink())throw Error("Not a regular local video");
  return {target,stat};
}
// Read Linux mount topology rather than assuming that /mnt or /media
// being present means a removable volume is attached.
async function mountedPaths(){
  const decode=value=>value.replace(/\\([0-7]{3})/g,(_match,octal)=>String.fromCharCode(parseInt(octal,8)));
  const data=await fsp.readFile("/proc/self/mountinfo","utf8");
  return data.trim().split("\n").map(line=>{
    const fields=line.split(" "),separator=fields.indexOf("-");
    return {point:decode(fields[4]||""),identity:[fields[2],decode(fields[3]||""),decode(fields[separator+2]||"")].join("|")};
  }).filter(m=>m.point.startsWith("/")).sort((a,b)=>b.point.length-a.point.length);
}
const mountFor=(mounts,target)=>mounts.find(m=>target===m.point||containment(m.point,target));
async function checkCatalogPaths(rows){
  if(!Array.isArray(rows)||rows.length>128)throw Error("Invalid file status batch");
  let mounts;try{mounts=await mountedPaths();}catch(_){mounts=[];}
  const results=[];
  for(const row of rows){
    let target;
    try{target=ensureVideo(row?.id,row?.nativePath);}
    catch(_){results.push({id:row?.id,state:"unknown"});continue;}
    try{
      await checkVideo(row.id,target);
      results.push({id:row.id,state:"present"});continue;
    }catch(error){
      if(error?.code!=="ENOENT"){results.push({id:row.id,state:"unknown"});continue;}
    }
    // Missing is conclusive only with a real, accessible parent directory
    // and a currently mounted expected volume. Otherwise leave the card.
    try{
      const parent=path.dirname(target),real=await fsp.realpath(parent);
      if(real!==parent||!(await fsp.stat(real)).isDirectory())throw Error("Uncertain parent");
      await fsp.access(real,fs.constants.R_OK|fs.constants.X_OK);
      const mount=mountFor(mounts,real);
      if(!mount)throw Error("Mount state unavailable");
      if(row.volumeIdentity&&row.volumeIdentity!==mount.identity)throw Error("Volume changed");
      const removable=["/media","/run/media","/mnt"].some(root=>containment(root,target));
      if(removable&&!["/media","/run/media","/mnt"].some(root=>containment(root,mount.point)))throw Error("Volume not mounted");
      results.push({id:row.id,state:"missing"});
    }catch(_){results.push({id:row.id,state:"unknown"});}
  }
  return results;
}
async function discover({manual=false,signal,onProgress=()=>{},testRoots=null,probe=null}={}){
  // Neither automatic nor manual native scans have an arbitrary duration,
  // directory depth, file count or visited-entry limit. Cancel explicitly.
  const start=Date.now(),roots=Array.isArray(testRoots)?testRoots:rootPath(),
    items=[],rejected=[],errors=[];
  let visits=0,folders=0,lastProgress=0;
  let mounts;try{mounts=await mountedPaths();}catch(_){mounts=[];}
  const visitedDirs=new Set(),visitedPaths=new Set(),seenFiles=new Set();
  const record=(file,operation,error)=>errors.push({path:file,operation,
    code:typeof error?.code==="string"?error.code:"UNKNOWN"});
  const progress=async(folder,force=false)=>{
    if(!force&&Date.now()-lastProgress<450)return;
    lastProgress=Date.now();
    onProgress({folder,visits,found:items.length,folders,skipped:errors.length});
    await new Promise(resolve=>setImmediate(resolve));
  };
  // Iterative depth-first traversal, without following directory symlinks.
  // Real paths and device/inode identities also prevent bind-mount cycles.
  for(const root of roots){
    if(signal?.aborted)break;
    const pending=[root];
    while(pending.length&&!signal?.aborted){
      const dir=pending.pop();
      let handle;
      try{
        const canonical=await fsp.realpath(dir),stat=await fsp.stat(canonical);
        if(!stat.isDirectory())continue;
        const identity=stat.ino?String(stat.dev)+":"+String(stat.ino):canonical;
        if(visitedDirs.has(identity)||visitedPaths.has(canonical))continue;
        visitedDirs.add(identity);visitedPaths.add(canonical);
        handle=await fsp.opendir(dir);
      }catch(error){if(!signal?.aborted)record(dir,"open-directory",error);continue;}
      folders++;
      try{
        for await(const entry of handle){
          if(signal?.aborted)break;
          visits++;
          // Yield for every kind of directory entry, not only video files.
          if(Date.now()-lastProgress>=450)await progress(dir);
          if(signal?.aborted)break;
          if(entry.isSymbolicLink()||entry.name.startsWith(".")||NEVER.has(entry.name))continue;
          const filePath=path.join(dir,entry.name);
          if(entry.isDirectory()){
            if(!excludedPath(filePath))pending.push(filePath);
            continue;
          }
          if(!entry.isFile()||!VIDEO.test(entry.name)||/(?:^|[ ._-])sample(?:[ ._-]|$)/i.test(entry.name))continue;
          try{
            const stat=await fsp.stat(filePath);
            if(!stat.isFile())continue;
            const valid=await inspectCandidate(filePath,stat,signal,probe);
            if(signal?.aborted)break;
            const id=fileIdentity(filePath);
            if(seenFiles.has(id))continue;
            seenFiles.add(id);
            if(valid===false){rejected.push(id);continue;}
            if(valid===null){record(filePath,"inspect-video",{code:"UNVERIFIED_VIDEO"});continue;}
            items.push({id,nativePath:filePath,filename:entry.name,
              relative:path.relative(root,filePath).split(path.sep).join("/"),
              size:stat.size,modified:stat.mtimeMs,root,volumeIdentity:mountFor(mounts,filePath)?.identity||null});
          }catch(error){if(!signal?.aborted)record(filePath,"inspect-video",error);}
        }
      }catch(error){if(!signal?.aborted)record(dir,"read-directory",error);}
      finally{await handle.close().catch(()=>{});}
    }
  }
  const cancelled=Boolean(signal?.aborted);
  await progress("",true);
  return {items,roots,rejected,complete:!cancelled&&errors.length===0,
    partial:cancelled||errors.length>0,cancelled,errors,
    found:items.length,visits,folders,skipped:errors.length,elapsedMs:Date.now()-start};
}
async function openVideo(id,filePath){
  const {target,stat}=await checkVideo(id,filePath);
  return {url:pathToFileURL(target).href,name:path.basename(target),
    nativePath:target,size:stat.size,modified:stat.mtimeMs};
}
async function readRange(id,filePath,start,end){
  const {target,stat}=await checkVideo(id,filePath);
  const from=Number(start),until=Number(end);
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(until)||
     from<0||until<from||until>stat.size||
     until-from>MAX_BYTES_PER_READ)
    throw Error("Invalid video byte range");
  const handle=await fsp.open(target,"r");
  try{
    const result=Buffer.allocUnsafe(until-from);
    let used=0;
    while(used<result.length){
      const {bytesRead}=await handle.read(result,used,result.length-used,from+used);
      if(!bytesRead)break;
      used+=bytesRead;
    }
    return new Uint8Array(result.subarray(0,used));
  }finally{await handle.close();}
}
function chooseLocalPoster(filePath,{series=false}={}){
  const folder=path.dirname(filePath);
  const ext=path.extname(filePath);
  const stem=path.basename(filePath,ext);
  const episodeNames=[
    stem+".jpg",stem+".png",stem+".webp",
    stem+"-still.jpg",stem+"-still.png",stem+"-still.webp"
  ];
  const posterNames=["poster.jpg","poster.png","poster.webp",
    "folder.jpg","folder.png","folder.webp","cover.jpg","cover.png","cover.webp"];
  const parent=path.dirname(folder);
  const inSeason=/^(season|series|s|сезон)\s*0*\d{1,2}$/i.test(path.basename(folder));
  const seriesDir=inSeason?parent:folder;
  // Generic posters do not belong to every movie in a shared "Movies" root.
  return series?{dir:seriesDir,names:posterNames}:
    {dir:folder,names:episodeNames};
}
async function localArtwork(id,filePath,{series=false,kind="movie"}={}){
  const {target}=await checkVideo(id,filePath);
  const selection=chooseLocalPoster(target,{series});
  // A generic folder poster is safe for a movie ONLY when the folder has
  // one video; shared collections may contain hundreds of unrelated movies.
  if(!series&&kind==="movie"){
    try{
      const siblings=await fsp.readdir(selection.dir);
      if(siblings.filter(name=>VIDEO.test(name)).length===1)
        selection.names.push("poster.jpg","poster.png","poster.webp",
          "folder.jpg","folder.png","folder.webp",
          "cover.jpg","cover.png","cover.webp");
    }catch(_){}
  }
  for(const name of selection.names){
    const candidate=path.join(selection.dir,name);
    try{
      const s=await fsp.lstat(candidate);
      if(!s.isFile()||s.isSymbolicLink()||s.size>3*1024*1024)continue;
      const ext=path.extname(name).toLowerCase();
      const mime=ext===".png"?"image/png":ext===".webp"?"image/webp":"image/jpeg";
      return {bytes:new Uint8Array(await fsp.readFile(candidate)),mime};
    }catch(_){}
  }
  return null;
}
async function deleteVideo(id,filePath,{dialog,shell,window}={}){
  if(!dialog||!shell)throw Error("Desktop confirmation is required");
  const {target}=await checkVideo(id,filePath);
  const prompt=await dialog.showMessageBox(window,{
    type:"warning",
    title:"Delete video from disk",
    message:"Delete this video from your device?",
    detail:target+"\n\nThis changes your actual filesystem, not just the library.",
    buttons:["Cancel","Move to Trash","Delete Permanently"],
    defaultId:0,cancelId:0,noLink:true
  });
  if(prompt.response===0)return {deleted:false,cancelled:true};
  if(prompt.response===2){
    const final=await dialog.showMessageBox(window,{
      type:"warning",title:"Permanently delete video?",
      message:"Permanently delete this file?",
      detail:target+"\n\nThis cannot be undone.",
      buttons:["Cancel","Delete Permanently"],defaultId:0,cancelId:0,noLink:true
    });
    if(final.response!==1)return {deleted:false,cancelled:true};
    // Revalidate immediately before a destructive operation.
    await checkVideo(id,target);
    await fsp.unlink(target);
    return {deleted:true,method:"permanent"};
  }
  await checkVideo(id,target);
  await shell.trashItem(target);
  return {deleted:true,method:"trash"};
}
module.exports={
  discover,openVideo,readRange,localArtwork,deleteVideo,
  fileIdentity,checkVideo,rootPath,chooseLocalPoster,checkCatalogPaths
};
