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
const MAX_FILES=25000, MAX_VISITS=300000, MAX_DEPTH=24;
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
async function discover({manual=false,signal,onProgress=()=>{},testRoots=null}={}){
  // testRoots is used solely by isolated maintainer regression fixtures.
  // The IPC handler never supplies it; users always scan native roots.
  const start=Date.now(),roots=Array.isArray(testRoots)?testRoots:rootPath(),
    items=[];
  let visits=0,folders=0,truncated=false,skipped=0;
  const visitedDirs=new Set();
  const maxMillis=manual?180000:60000;
  let lastProgress=0;
  // Recursion is intentionally iterative. Symlinks and hidden/system
  // directories are not traversed, preventing loops and heavy rescans.
  for(const root of roots){
    if(signal?.aborted)throw Error("Library scan cancelled");
    const queue=[{dir:root,depth:0}];
    while(queue.length){
      if(signal?.aborted)throw Error("Library scan cancelled");
      if(Date.now()-start>maxMillis || visits>=MAX_VISITS ||
         items.length>=MAX_FILES){truncated=true;break;}
      const job=queue.shift();
      if(job.depth>MAX_DEPTH){truncated=true;continue;}
      let canonical;
      try{canonical=await fsp.realpath(job.dir);}catch(_){skipped++;continue;}
      if(visitedDirs.has(canonical))continue;
      visitedDirs.add(canonical);
      let handle;
      try{handle=await fsp.opendir(job.dir);}catch(_){skipped++;continue;}
      folders++;
      try{
        for await(const entry of handle){
          if(signal?.aborted)throw Error("Library scan cancelled");
          visits++;
          if(visits>=MAX_VISITS || items.length>=MAX_FILES ||
             Date.now()-start>maxMillis){truncated=true;break;}
          if(entry.isSymbolicLink()||entry.name.startsWith(".")||
             NEVER.has(entry.name))continue;
          const filePath=path.join(job.dir,entry.name);
          if(entry.isDirectory()){
            if(job.depth<MAX_DEPTH)queue.push({dir:filePath,depth:job.depth+1});
            else truncated=true;
            continue;
          }
          if(!entry.isFile()||!VIDEO.test(entry.name))continue;
          try{
            const stat=await fsp.stat(filePath);
            if(!stat.isFile())continue;
            items.push({
              id:fileIdentity(filePath),
              nativePath:filePath,filename:entry.name,
              relative:path.relative(root,filePath).split(path.sep).join("/"),
              size:stat.size,modified:stat.mtimeMs,
              root
            });
          }catch(_){skipped++;}
          if(Date.now()-lastProgress>450){
            lastProgress=Date.now();
            onProgress({folder:job.dir,visits,found:items.length,folders});
            // Yield occasionally to keep the rest of Electron responsive.
            await new Promise(resolve=>setImmediate(resolve));
          }
        }
      }catch(error){
        if(signal?.aborted)throw error;
        skipped++;
      }finally{await handle.close().catch(()=>{});}
      if(truncated)break;
    }
    if(truncated)break;
  }
  return {items,roots,complete:!truncated&&skipped===0,
    partial:truncated||skipped>0,found:items.length,visits,folders,
    skipped,elapsedMs:Date.now()-start};
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
  fileIdentity,checkVideo,rootPath,chooseLocalPoster
};
