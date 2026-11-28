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
let selectedRoots=[];
function setSelectedRoots(roots){selectedRoots=roots.filter(r=>typeof r==="string"&&path.isAbsolute(r));}
const rootPath=()=>{
  const home=os.homedir();
  const user=os.userInfo().username;
  return [home,path.join("/media",user),path.join("/run/media",user),"/mnt",...selectedRoots]
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
          if(!entry.isFile()||!VIDEO.test(entry.name)||/(?:^|[ ._-])(?:sample|partial|incomplete|crdownload|part|tmp)(?:[ ._-]|$)/i.test(entry.name))continue;
          try{
            const stat=await fsp.stat(filePath);
            if(!stat.isFile())continue;
            const valid=await inspectCandidate(filePath,stat,signal,probe);
            const after=await fsp.stat(filePath);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs){record(filePath,"inspect-video",{code:"FILE_CHANGING"});continue;}
            if(signal?.aborted)break;
            const id=fileIdentity(filePath);
            if(seenFiles.has(id))continue;
            seenFiles.add(id);
            if(valid===false){rejected.push(id);continue;}
            if(valid===null){record(filePath,"inspect-video",{code:"UNVERIFIED_VIDEO"});continue;}
            items.push({id,nativePath:filePath,filename:entry.name,
              relative:path.relative(root,filePath).split(path.sep).join("/"),
              size:stat.size,modified:stat.mtimeMs,fileNode:stat.ino?String(stat.dev)+":"+String(stat.ino):null,root,volumeIdentity:mountFor(mounts,filePath)?.identity||null});
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
// Non-destructive availability check, independent of Empty Trash.
async function playbackAvailability(id,filePath){
 try{await checkVideo(id,filePath);return true;}catch(_){return false;}
}
async function relocationCandidate(filePath){
 const target=path.resolve(filePath),id=fileIdentity(target),{stat}=await checkVideo(id,target);
 const root=rootPath().find(r=>containment(r,target));
 let mounts=[];try{mounts=await mountedPaths();}catch(_){}
 return {id,nativePath:target,filename:path.basename(target),relative:path.relative(root,target).split(path.sep).join("/"),root,size:stat.size,modified:stat.mtimeMs,fileNode:stat.ino?String(stat.dev)+":"+String(stat.ino):null,volumeIdentity:mountFor(mounts,target)?.identity||null};
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
  fileIdentity,checkVideo,rootPath,setSelectedRoots,chooseLocalPoster,checkCatalogPaths,playbackAvailability,relocationCandidate
};


// Detached account-free HTTP service, launched by the existing desktop
// server power control. Uses the actual desktop catalog snapshot, not an
// independent scan or a publicly exposed metadata-engine admin API.
function runKinehallViewer(dataDir){
 const netHTTP=require("node:http"),PORT=8097;
 const stateFile=path.join(dataDir,"viewer-state.json"),catalogFile=path.join(dataDir,"viewer-catalog.json"),sourceFile=path.join(dataDir,"library-sources-v1.json"),powerFile=path.join(dataDir,"jellyfin-power.json");
 if(!path.isAbsolute(dataDir)||!fs.statSync(dataDir).isDirectory())throw Error("Invalid server data directory");
 const readJSON=(file,limit)=>{const st=fs.lstatSync(file);if(!st.isFile()||st.uid!==process.getuid()||(st.mode&0o077)||st.size>limit)throw Error("Invalid server data");return JSON.parse(fs.readFileSync(file,"utf8"));};
 const enabled=()=>{try{return readJSON(powerFile,4096).enabled!==false;}catch(error){return error.code==="ENOENT";}};
 const roots=()=>{try{const value=readJSON(sourceFile,1024*1024);return Array.isArray(value)?value.filter(r=>typeof r?.path==="string"&&path.isAbsolute(r.path)&&r.path!==path.parse(r.path).root&&["movie","tv"].includes(r.kind)).map(r=>r.path):[];}catch(_){return [];}};
 const validRow=(r,selected)=>!!r&&typeof r.nativePath==="string"&&path.isAbsolute(r.nativePath)&&VIDEO.test(r.nativePath)&&r.id===fileIdentity(r.nativePath)&&["movie","tv"].includes(r.kind)&&selected.some(root=>containment(root,r.nativePath));
 const stateIdentity=crypto.randomBytes(16).toString("hex"),started=fs.readFileSync("/proc/self/stat","utf8").split(")").pop().trim().split(/\s+/)[19];
 const atomic=(file,value)=>{const tmp=file+"."+stateIdentity+".tmp";fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600,flag:"w"});fs.renameSync(tmp,file);};
 const viewerPreviewPage="<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>DK Kinehall Viewer</title><style>body{font:16px system-ui;background:#15100f;color:#eee1cc;margin:0;padding:24px}main{max-width:1200px;margin:auto}h1,strong,a{color:#e2b956}article{display:grid;gap:10px;background:#261d18;padding:16px;border-radius:8px;border:1px solid #806b42;overflow-wrap:anywhere}input,button,select{font:inherit;padding:10px;border:1px solid #806b42;border-radius:5px}button{background:#e2b956;color:#462a25;cursor:pointer}input:not([type=checkbox]),select{background:#15100f;color:#fff;min-width:0}#catalog{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:20px 0}#status{min-height:1.5em}p{margin:0}header{display:flex;align-items:center;gap:12px;flex-wrap:wrap}video{width:100%;max-height:65vh;background:#000}[hidden]{display:none!important}</style><main><h1 id=\"heading\"></h1><p id=\"status\" role=\"status\"></p><header><input id=\"filter\" type=\"search\"><select id=\"kind\"><option value=\"\" id=\"allKind\"></option><option value=\"movie\" id=\"movieKind\"></option><option value=\"tv\" id=\"tvKind\"></option></select><label><input id=\"saved\" type=\"checkbox\"><span id=\"savedLabel\"></span></label><button id=\"refresh\" type=\"button\"></button><span id=\"count\"></span></header><section id=\"player\" hidden><h2 id=\"playingTitle\"></h2><video id=\"video\" controls playsinline preload=\"metadata\"></video><button id=\"stopPlayback\" type=\"button\"></button></section><div id=\"catalog\"></div><button id=\"more\" type=\"button\" hidden></button></main><script>\nconst $=id=>document.getElementById(id),ru=navigator.language.toLowerCase().startsWith(\"ru\"),t=(en,r)=>ru?r:en;\ndocument.documentElement.lang=ru?\"ru\":\"en\";\ndocument.title=t(\"DK Kinehall Viewer\",\"ДК Кинехолл\");\nconst el=(tag,txt)=>{const n=document.createElement(tag);if(txt)n.textContent=txt;return n;};\nconst button=(text,action)=>{const b=el(\"button\",text);b.type=\"button\";b.onclick=action;return b;};\nconst msg=text=>{$(\"status\").textContent=text;};\nconst storageKey=\"dk-kinehall.viewer.browser.v1\";\nlet state={saved:[],progress:{}};\ntry{const x=JSON.parse(localStorage.getItem(storageKey)||\"null\");if(x&&Array.isArray(x.saved)&&x.progress&&typeof x.progress===\"object\")state=x;}catch(_){}\nfunction persist(){try{localStorage.setItem(storageKey,JSON.stringify(state));return true;}catch(_){msg(t(\"This browser could not save your viewing history.\",\"Не удалось сохранить историю просмотра в браузере.\"));return false;}}\nlet rows=[],query=\"\",savedOnly=false,playing=null,progressAt=0,visible=100;\nconst video=$(\"video\");\nfunction saveProgress(force=false){\n if(!playing||!Number.isFinite(video.duration)||video.duration<=0||(!force&&Date.now()-progressAt<15000))return;\n progressAt=Date.now();playing.position=video.ended?0:video.currentTime;\n state.progress[playing.id]={position:playing.position,completed:video.ended};persist();\n}\nfunction stopPlayback(){saveProgress(true);playing=null;video.pause();video.removeAttribute(\"src\");video.load();$(\"player\").hidden=true;}\nfunction play(row){\n stopPlayback();playing=row;progressAt=Date.now();$(\"playingTitle\").textContent=row.title;$(\"player\").hidden=false;\n video.src=\"/media/\"+encodeURIComponent(row.id);$(\"player\").scrollIntoView({block:\"start\"});\n void video.play().catch(()=>{});\n}\nvideo.addEventListener(\"loadedmetadata\",()=>{if(playing&&playing.position>0&&playing.position<video.duration-2)video.currentTime=playing.position;});\nvideo.addEventListener(\"timeupdate\",()=>saveProgress());\nvideo.addEventListener(\"pause\",()=>saveProgress(true));\nvideo.addEventListener(\"ended\",()=>saveProgress(true));\nvideo.addEventListener(\"error\",()=>{if(playing)msg(t(\"This browser cannot play this file directly. Open the original in a compatible player; transcoding is planned.\",\"Браузер не может воспроизвести этот файл напрямую. Откройте оригинал в совместимом проигрывателе; перекодирование будет добавлено позже.\"));});\nwindow.addEventListener(\"pagehide\",()=>saveProgress(true));\n$(\"stopPlayback\").textContent=t(\"Close Player\",\"Закрыть проигрыватель\");$(\"stopPlayback\").onclick=()=>{stopPlayback();render();};\nfunction render(){\n const catalog=$(\"catalog\");catalog.replaceChildren();\n const q=query.toLocaleLowerCase().trim(),saved=new Set(state.saved);\n const matches=rows.filter(r=>(!savedOnly||saved.has(r.id))&&(!q||r.title.toLocaleLowerCase().includes(q))&&(!$(\"kind\").value||r.kind===$(\"kind\").value));\n for(const row of matches.slice(0,visible)){\n  const card=el(\"article\"),title=el(\"strong\",row.title),detail=el(\"p\",[row.kind===\"movie\"?t(\"Movie\",\"Фильм\"):t(\"TV\",\"Сериал\"),row.year||\"\",row.episode||\"\",row.format||\"\"].filter(Boolean).join(\" · \"));\n  const save=button(saved.has(row.id)?t(\"Remove from watchlist\",\"Убрать из списка\"):t(\"Add to watchlist\",\"Добавить в список\"),()=>{const ids=new Set(state.saved);if(ids.has(row.id))ids.delete(row.id);else ids.add(row.id);state.saved=[...ids];persist();render();});\n  const original=el(\"a\",t(\"Open original file\",\"Открыть исходный файл\"));original.href=\"/media/\"+encodeURIComponent(row.id);original.target=\"_blank\";original.rel=\"noopener\";\n  card.append(title,detail,button(row.position>0?t(\"Resume\",\"Продолжить\"):t(\"Play\",\"Воспроизвести\"),()=>play(row)),original,save);catalog.append(card);\n }\n if(!matches.length)catalog.append(el(\"p\",t(\"No matching titles.\",\"Нет подходящих наименований.\")));\n $(\"more\").hidden=visible>=matches.length;$(\"count\").textContent=String(matches.length)+\" \"+t(\"titles\",\"наименований\");\n}\nasync function load(){\n try{\n  const r=await fetch(\"/api/catalog\",{cache:\"no-store\"});if(!r.ok)throw Error();\n  const data=await r.json();rows=(data.items||[]).map(row=>({...row,position:Number(state.progress[row.id]?.position)||0}));render();msg(\"\");\n }catch(_){msg(t(\"Catalog unavailable. Open Kinehall and check your library.\",\"Каталог недоступен. Откройте Кинехолл и проверьте медиатеку.\"));}\n}\n$(\"heading\").textContent=t(\"DK Kinehall Viewer\",\"ДК Кинехолл\");\n$(\"filter\").placeholder=t(\"Search titles\",\"Поиск наименований\");\n$(\"savedLabel\").textContent=t(\"Watchlist only\",\"Только список просмотра\");\n$(\"allKind\").textContent=t(\"All titles\",\"Все наименования\");$(\"movieKind\").textContent=t(\"Movies\",\"Фильмы\");$(\"tvKind\").textContent=t(\"TV Shows\",\"Сериалы\");\n$(\"more\").textContent=t(\"Show more\",\"Показать ещё\");$(\"more\").onclick=()=>{visible+=100;render();};\n$(\"refresh\").textContent=t(\"Refresh\",\"Обновить\");$(\"refresh\").onclick=()=>void load();\n$(\"filter\").oninput=()=>{query=$(\"filter\").value;visible=100;render();};\n$(\"saved\").onchange=()=>{savedOnly=$(\"saved\").checked;visible=100;render();};\n$(\"kind\").onchange=()=>{visible=100;render();};\nvoid load();\n</script></html>";
 const viewerCSP="default-src 'none'; script-src 'sha256-"+crypto.createHash("sha256").update("\nconst $=id=>document.getElementById(id),ru=navigator.language.toLowerCase().startsWith(\"ru\"),t=(en,r)=>ru?r:en;\ndocument.documentElement.lang=ru?\"ru\":\"en\";\ndocument.title=t(\"DK Kinehall Viewer\",\"ДК Кинехолл\");\nconst el=(tag,txt)=>{const n=document.createElement(tag);if(txt)n.textContent=txt;return n;};\nconst button=(text,action)=>{const b=el(\"button\",text);b.type=\"button\";b.onclick=action;return b;};\nconst msg=text=>{$(\"status\").textContent=text;};\nconst storageKey=\"dk-kinehall.viewer.browser.v1\";\nlet state={saved:[],progress:{}};\ntry{const x=JSON.parse(localStorage.getItem(storageKey)||\"null\");if(x&&Array.isArray(x.saved)&&x.progress&&typeof x.progress===\"object\")state=x;}catch(_){}\nfunction persist(){try{localStorage.setItem(storageKey,JSON.stringify(state));return true;}catch(_){msg(t(\"This browser could not save your viewing history.\",\"Не удалось сохранить историю просмотра в браузере.\"));return false;}}\nlet rows=[],query=\"\",savedOnly=false,playing=null,progressAt=0,visible=100;\nconst video=$(\"video\");\nfunction saveProgress(force=false){\n if(!playing||!Number.isFinite(video.duration)||video.duration<=0||(!force&&Date.now()-progressAt<15000))return;\n progressAt=Date.now();playing.position=video.ended?0:video.currentTime;\n state.progress[playing.id]={position:playing.position,completed:video.ended};persist();\n}\nfunction stopPlayback(){saveProgress(true);playing=null;video.pause();video.removeAttribute(\"src\");video.load();$(\"player\").hidden=true;}\nfunction play(row){\n stopPlayback();playing=row;progressAt=Date.now();$(\"playingTitle\").textContent=row.title;$(\"player\").hidden=false;\n video.src=\"/media/\"+encodeURIComponent(row.id);$(\"player\").scrollIntoView({block:\"start\"});\n void video.play().catch(()=>{});\n}\nvideo.addEventListener(\"loadedmetadata\",()=>{if(playing&&playing.position>0&&playing.position<video.duration-2)video.currentTime=playing.position;});\nvideo.addEventListener(\"timeupdate\",()=>saveProgress());\nvideo.addEventListener(\"pause\",()=>saveProgress(true));\nvideo.addEventListener(\"ended\",()=>saveProgress(true));\nvideo.addEventListener(\"error\",()=>{if(playing)msg(t(\"This browser cannot play this file directly. Open the original in a compatible player; transcoding is planned.\",\"Браузер не может воспроизвести этот файл напрямую. Откройте оригинал в совместимом проигрывателе; перекодирование будет добавлено позже.\"));});\nwindow.addEventListener(\"pagehide\",()=>saveProgress(true));\n$(\"stopPlayback\").textContent=t(\"Close Player\",\"Закрыть проигрыватель\");$(\"stopPlayback\").onclick=()=>{stopPlayback();render();};\nfunction render(){\n const catalog=$(\"catalog\");catalog.replaceChildren();\n const q=query.toLocaleLowerCase().trim(),saved=new Set(state.saved);\n const matches=rows.filter(r=>(!savedOnly||saved.has(r.id))&&(!q||r.title.toLocaleLowerCase().includes(q))&&(!$(\"kind\").value||r.kind===$(\"kind\").value));\n for(const row of matches.slice(0,visible)){\n  const card=el(\"article\"),title=el(\"strong\",row.title),detail=el(\"p\",[row.kind===\"movie\"?t(\"Movie\",\"Фильм\"):t(\"TV\",\"Сериал\"),row.year||\"\",row.episode||\"\",row.format||\"\"].filter(Boolean).join(\" · \"));\n  const save=button(saved.has(row.id)?t(\"Remove from watchlist\",\"Убрать из списка\"):t(\"Add to watchlist\",\"Добавить в список\"),()=>{const ids=new Set(state.saved);if(ids.has(row.id))ids.delete(row.id);else ids.add(row.id);state.saved=[...ids];persist();render();});\n  const original=el(\"a\",t(\"Open original file\",\"Открыть исходный файл\"));original.href=\"/media/\"+encodeURIComponent(row.id);original.target=\"_blank\";original.rel=\"noopener\";\n  card.append(title,detail,button(row.position>0?t(\"Resume\",\"Продолжить\"):t(\"Play\",\"Воспроизвести\"),()=>play(row)),original,save);catalog.append(card);\n }\n if(!matches.length)catalog.append(el(\"p\",t(\"No matching titles.\",\"Нет подходящих наименований.\")));\n $(\"more\").hidden=visible>=matches.length;$(\"count\").textContent=String(matches.length)+\" \"+t(\"titles\",\"наименований\");\n}\nasync function load(){\n try{\n  const r=await fetch(\"/api/catalog\",{cache:\"no-store\"});if(!r.ok)throw Error();\n  const data=await r.json();rows=(data.items||[]).map(row=>({...row,position:Number(state.progress[row.id]?.position)||0}));render();msg(\"\");\n }catch(_){msg(t(\"Catalog unavailable. Open Kinehall and check your library.\",\"Каталог недоступен. Откройте Кинехолл и проверьте медиатеку.\"));}\n}\n$(\"heading\").textContent=t(\"DK Kinehall Viewer\",\"ДК Кинехолл\");\n$(\"filter\").placeholder=t(\"Search titles\",\"Поиск наименований\");\n$(\"savedLabel\").textContent=t(\"Watchlist only\",\"Только список просмотра\");\n$(\"allKind\").textContent=t(\"All titles\",\"Все наименования\");$(\"movieKind\").textContent=t(\"Movies\",\"Фильмы\");$(\"tvKind\").textContent=t(\"TV Shows\",\"Сериалы\");\n$(\"more\").textContent=t(\"Show more\",\"Показать ещё\");$(\"more\").onclick=()=>{visible+=100;render();};\n$(\"refresh\").textContent=t(\"Refresh\",\"Обновить\");$(\"refresh\").onclick=()=>void load();\n$(\"filter\").oninput=()=>{query=$(\"filter\").value;visible=100;render();};\n$(\"saved\").onchange=()=>{savedOnly=$(\"saved\").checked;visible=100;render();};\n$(\"kind\").onchange=()=>{visible=100;render();};\nvoid load();\n").digest("base64")+"'; style-src 'unsafe-inline'; connect-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
 const viewerMime=file=>({".mp4":"video/mp4",".m4v":"video/mp4",".webm":"video/webm",".ogv":"video/ogg",".mkv":"video/x-matroska",".avi":"video/x-msvideo",".mov":"video/quicktime",".ts":"video/mp2t",".mts":"video/mp2t",".m2ts":"video/mp2t",".mpeg":"video/mpeg",".mpg":"video/mpeg",".wmv":"video/x-ms-wmv",".flv":"video/x-flv",".3gp":"video/3gpp"}[path.extname(file).toLowerCase()]||"application/octet-stream");
 function viewerByteRange(raw,size){
 if(!Number.isSafeInteger(size)||size<=0)return null;
 if(raw===undefined)return {start:0,end:size-1,partial:false};
 const m=typeof raw==="string"&&/^bytes=(\d*)-(\d*)$/.exec(raw);
 if(!m||(!m[1]&&!m[2]))return null;
 let start,end;
 if(!m[1]){const suffix=Number(m[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return null;start=Math.max(0,size-suffix);end=size-1;}
 else{start=Number(m[1]);end=m[2]?Math.min(size-1,Number(m[2])):size-1;}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return null;
 return {start,end,partial:true};
}


 const viewerIPv4=value=>{
 if(typeof value!=="string")return null;
 const a=value.split(".");if(a.length!==4||a.some(x=>!/^(0|[1-9]\d{0,2})$/.test(x)||Number(x)>255))return null;
 return a.reduce((n,x)=>(n*256+Number(x))>>>0,0);
};
const viewerPrivate=value=>{const n=viewerIPv4(value);return n!==null&&((n>>>24)===10||(n>>>20)===0xac1||(n>>>16)===0xc0a8);};

 const localAddresses=()=>Object.values(os.networkInterfaces()).flat().filter(r=>r?.family==="IPv4"&&viewerPrivate(r.address)).map(r=>r.address);
 const allowed=req=>{
  const remote=String(req.socket.remoteAddress||"").replace(/^::ffff:/,"");
  const local=String(req.socket.localAddress||"").replace(/^::ffff:/,"");
  const host=req.headers.host;
  return enabled()&&(remote==="127.0.0.1"||viewerPrivate(remote))&&(local==="127.0.0.1"||localAddresses().includes(local))&&(host===local+":"+PORT||local==="127.0.0.1"&&host==="localhost:"+PORT);
 };
 let cached=null,cachedStamp=null,stopping=false;
 const catalog=()=>{
  const selected=roots();setSelectedRoots(selected);
  let stat;try{stat=fs.lstatSync(catalogFile);}catch(error){if(error.code==="ENOENT")return new Map();throw error;}
  const stamp=[stat.ino,stat.size,stat.mtimeMs].join(":");
  if(stamp!==cachedStamp){
   const data=readJSON(catalogFile,64*1024*1024);if(!Array.isArray(data))throw Error("Invalid catalog");
   cached=data;cachedStamp=stamp;
  }
  const result=new Map();for(const r of cached||[])if(validRow(r,selected))result.set(r.id.slice(7),r);
  return result;
 };
 const json=(res,status,value)=>{const body=JSON.stringify(value);res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Content-Length":Buffer.byteLength(body),"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});res.end(body);};
 const streams=new Set();
 async function stream(req,res,row){
  let handle=null;
  try{
   const grant=await checkVideo(row.id,row.nativePath);
   handle=await fsp.open(grant.target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
   const stat=await handle.stat(),real=await fsp.realpath("/proc/self/fd/"+handle.fd);
   if(!stat.isFile()||stat.dev!==grant.stat.dev||stat.ino!==grant.stat.ino||!allowed(req)||!validRow(row,roots())||!roots().some(root=>containment(root,real))||!catalog().has(row.id.slice(7)))throw Error("Media unavailable");
   const range=viewerByteRange(req.headers.range,stat.size);
   if(!range){res.writeHead(416,{"Content-Range":"bytes */"+stat.size,"Cache-Control":"no-store"});res.end();return;}
   const headers={"Content-Type":viewerMime(row.nativePath),"Content-Length":range.end-range.start+1,"Accept-Ranges":"bytes","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
   if(range.partial)headers["Content-Range"]="bytes "+range.start+"-"+range.end+"/"+stat.size;
   res.writeHead(range.partial?206:200,headers);
   if(req.method==="HEAD"){res.end();return;}
   const body=handle.createReadStream({start:range.start,end:range.end,autoClose:true});handle=null;
   let timer;const record={close:()=>{body.destroy();res.destroy();}};streams.add(record);
   const release=()=>{clearInterval(timer);streams.delete(record);body.destroy();};
   res.once("close",release);body.once("close",release);body.once("error",()=>res.destroy());
   timer=setInterval(()=>{try{if(!allowed(req)||!roots().some(root=>containment(root,real))||!catalog().has(row.id.slice(7)))record.close();}catch(_){record.close();}},3000);timer.unref();
   body.pipe(res);
  }catch(_){if(!res.headersSent)json(res,404,{error:"Media unavailable"});else res.destroy();}
  finally{if(handle)await handle.close().catch(()=>{});}
 }
 const server=netHTTP.createServer({maxHeaderSize:8192,requestTimeout:10000,headersTimeout:5000},async(req,res)=>{
  try{
   if(!allowed(req)||typeof req.url!=="string"||req.url.length>250||!["GET","HEAD"].includes(req.method))return json(res,404,{error:"Not found"});
   if(req.method==="GET"&&req.url==="/"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":viewerCSP,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"});return res.end(viewerPreviewPage);}
   if(req.method==="GET"&&req.url==="/api/catalog"){
    const rows=[...catalog().values()].map(r=>({id:r.id.slice(7),title:r.kind==="tv"?[r.series,r.episodeTitle||r.title].filter(Boolean).join(" · "):r.title,kind:r.kind,year:r.year,episode:r.kind==="tv"?"S"+String(r.season??0).padStart(2,"0")+"E"+String(r.episode??0).padStart(2,"0"):null,format:path.extname(r.nativePath).slice(1).toUpperCase()}));
    rows.sort((a,b)=>a.title.localeCompare(b.title,undefined,{numeric:true}));return json(res,200,{items:rows});
   }
   const match=/^\/media\/([a-f0-9]{64})$/.exec(req.url);
   if(match){const row=catalog().get(match[1]);if(row)return await stream(req,res,row);}
   return json(res,404,{error:"Not found"});
  }catch(_){if(!res.headersSent)json(res,503,{error:"Viewer unavailable"});else res.destroy();}
 });
 let heartbeat;
 function stop(){
  if(stopping)return;stopping=true;clearInterval(heartbeat);
  for(const item of streams)item.close();streams.clear();server.closeAllConnections?.();server.close();
  try{if(readJSON(stateFile,4096).identity===stateIdentity)fs.unlinkSync(stateFile);}catch(_){}
  process.exit(0);
 }
 function tick(){
  if(!enabled())return stop();
  try{atomic(stateFile,{pid:process.pid,started,identity:stateIdentity,port:PORT,heartbeat:Date.now()});}catch(_){stop();}
 }
 process.once("SIGTERM",stop);process.once("SIGINT",stop);
 server.on("error",()=>stop());server.keepAliveTimeout=3000;
 if(!enabled())return;
 server.listen(PORT,"0.0.0.0",()=>{tick();if(!stopping)heartbeat=setInterval(tick,2000);});
}
if(require.main===module&&process.argv[2]==="--dk-kinehall-viewer")runKinehallViewer(process.argv[3]);
