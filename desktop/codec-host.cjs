"use strict";
/* DK Kinehall standalone-only codec bridge.
 * A bundled FFmpeg/FFprobe pair decodes source video/audio on demand and
 * streams H.264/AAC fragmented MP4 into the ORIGINAL Chromium video element.
 * No file bytes go to the Internet; stream port is loopback-only and tokenized.
 * Requires the packaged executables and their native linked libraries.
 *
 * This module is deliberately independent from the web player and its icons.
 */
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const http=require("node:http");
const crypto=require("node:crypto");
const {spawn}=require("node:child_process");
const {app,ipcMain,dialog,BrowserWindow}=require("electron");
const {capabilityFromEncoders,chooseOutput}=require("./codec-policy.cjs");
const {resolveSource}=require("./codec-source.cjs");
const checkVideo=(id,filePath)=>require("./library-host.cjs").checkPlayableSource(id,filePath);

const BIND_ADDRESS="127.0.0.1";
const MAX_PROBE_OUTPUT=512*1024;
let installed=false,windowRef=null,playerContents=null,server=null,session=null,availability=null;
const probeCache=new Map();
const MAX_CACHED_PROBES=64;
let frameCache=null,frameProbeBusy=false;
let deinterlaceCapability=null,smoothingCapability=null,dvdCapability=null,dvdPicking=false;
const dvdGrants=new Map();
const isDVD=source=>Boolean(source&&typeof source==="object"&&source.kind==="dvd");
function dvdArgs(source){
  return ["-f","dvdvideo","-title",String(source.title),"-chapter_start",String(source.chapter),
    "-angle",String(source.angle),"-preindex",source.drive?"0":"1"];
}
async function dvdAvailable(){
  if(!dvdCapability)dvdCapability=(async()=>{
    if(!(await status()).ready)return false;
    const lists=await Promise.all(["ffmpeg","ffprobe"].map(name=>
      processOutput(binary(name),["-hide_banner","-demuxers"],8000)));
    return lists.every(list=>/^\s*D\s+dvdvideo\s/m.test(list));
  })().catch(()=>false);
  return dvdCapability;
}
function opticalDrives(){
  if(process.platform!=="linux")return [];
  try{return fs.readdirSync("/sys/class/block").filter(name=>/^sr\d+$/.test(name))
    .filter(name=>{try{return fs.readFileSync("/sys/class/block/"+name+"/device/type","utf8").trim()==="5"&&fs.statSync("/dev/"+name).isBlockDevice();}catch(_){return false;}})
    .slice(0,8).map(name=>"/dev/"+name);}
  catch(_){return [];}
}
function verifyDVD(source){
  const stat=fs.statSync(source.path);
  if(source.drive){
    if(!stat.isBlockDevice()||!opticalDrives().includes(source.path))throw Error("DVD drive unavailable");
  }else if(source.folder){
    if(!stat.isDirectory()||!fs.statSync(path.join(source.path,"VIDEO_TS.IFO")).isFile())throw Error("DVD folder unavailable");
  }else if(!stat.isFile()||!(/\.iso$/i.test(source.path))||stat.size!==source.size||stat.mtimeMs!==source.modified)
    throw Error("DVD image unavailable or changed");
  return stat;
}
async function resolvePlaybackSource(value){
  if(value?.kind!=="dvd")return resolveSource(value,checkVideo);
  if(typeof value.id!=="string"||!/^dvd:[a-f0-9]{48}$/.test(value.id))throw Error("Invalid DVD selection");
  const source=dvdGrants.get(value.id);
  if(!source)throw Error("DVD selection expired");
  verifyDVD(source);
  return source;
}
async function selectDVD(win,kind,title,chapter,angle,language){
  if(dvdPicking)throw Error("DVD selection already open");
  if(!["drive","iso","folder"].includes(kind)||!Number.isInteger(title)||title<1||title>99||
     !Number.isInteger(chapter)||chapter<1||chapter>999||!Number.isInteger(angle)||angle<1||angle>9)
    throw Error("Invalid DVD title selection");
  if(!await dvdAvailable())return {unavailable:true};
  if(dvdPicking)throw Error("DVD selection already open");
  dvdPicking=true;
  const t=(en,ru)=>language==="ru"?ru:en;
  try{
    let target;
    if(kind==="drive"){
      const drives=opticalDrives();
      if(!drives.length)return {noDrive:true};
      const chosen=await dialog.showMessageBox(win,{type:"question",message:t("Choose DVD drive","Выберите привод DVD"),
        buttons:[...drives,t("Cancel","Отмена")],cancelId:drives.length,defaultId:0,noLink:true});
      if(chosen.response>=drives.length)return null;
      target=drives[chosen.response];
    }else{
      const pick=await dialog.showOpenDialog(win,{title:kind==="iso"?t("Open DVD image","Открыть образ DVD"):t("Open DVD folder","Открыть папку DVD"),
        properties:[kind==="iso"?"openFile":"openDirectory"],
        ...(kind==="iso"?{filters:[{name:t("DVD image","Образ DVD"),extensions:["iso"]}]}:{})});
      if(pick.canceled||!pick.filePaths[0])return null;
      target=fs.realpathSync(pick.filePaths[0]);
      if(kind==="folder"&&!fs.existsSync(path.join(target,"VIDEO_TS.IFO")))target=fs.realpathSync(path.join(target,"VIDEO_TS"));
    }
    const stat=fs.statSync(target);
    const id="dvd:"+crypto.randomBytes(24).toString("hex");
    const source={kind:"dvd",id,path:target,title,chapter,angle,drive:kind==="drive",folder:kind==="folder",size:stat.size,modified:stat.mtimeMs};
    verifyDVD(source);
    const info=await probe(source);
    if(!info.hasVideo)throw Error("DVD title has no video");
    if(win.isDestroyed())return null;
    dvdGrants.set(id,source);
    if(dvdGrants.size>64)dvdGrants.delete(dvdGrants.keys().next().value);
    return {id,name:kind==="folder"?path.basename(path.dirname(target)):path.basename(target),title,chapter,angle};
  }finally{dvdPicking=false;}
}
// Change titles on the already-authorized disc without a second file picker.
async function changeDVD(win,id,title,chapter,angle){
  if(dvdPicking)throw Error("DVD selection already open");
  if(!Number.isInteger(title)||title<1||title>99||!Number.isInteger(chapter)||chapter<1||chapter>999||
     !Number.isInteger(angle)||angle<1||angle>9)throw Error("Invalid DVD title selection");
  const previous=await resolvePlaybackSource({kind:"dvd",id});
  if(dvdPicking)throw Error("DVD selection already open");
  dvdPicking=true;
  try{
    const source={...previous,id:"dvd:"+crypto.randomBytes(24).toString("hex"),title,chapter,angle};
    verifyDVD(source);
    const info=await probe(source);
    if(!info.hasVideo)throw Error("DVD title has no video");
    verifyDVD(source);
    if(!win||win.isDestroyed())return null;
    dvdGrants.set(source.id,source);
    if(dvdGrants.size>64)dvdGrants.delete(dvdGrants.keys().next().value);
    return {id:source.id,name:source.folder?path.basename(path.dirname(source.path)):path.basename(source.path),title,chapter,angle};
  }finally{dvdPicking=false;}
}
function frameRate(value){
  const [n,d=1]=String(value||"").split("/").map(Number);
  const fps=n/d;return Number.isFinite(fps)&&fps>0?fps:null;
}

function binary(name) {
  const base=app.getAppPath();
  return path.join(base,"bin",name);
}
function codecEnvironment() {
  const libs=path.join(app.getAppPath(),"lib");
  return {...process.env,
    LD_LIBRARY_PATH:libs+path.delimiter+(process.env.LD_LIBRARY_PATH||""),
    PATH:path.join(app.getAppPath(),"bin")+path.delimiter+(process.env.PATH||"")};
}
function executable(file) {
  try {fs.accessSync(file,fs.constants.X_OK);return true;}
  catch(_){return false;}
}
function processOutput(command,args,timeout=15000,maxOutput=MAX_PROBE_OUTPUT) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:["ignore","pipe","pipe"],windowsHide:true,
      env:codecEnvironment()});
    const stdoutChunks=[];
    let stdoutBytes=0,stderr="",settled=false;
    const settle=(err,result)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);
      if(err)reject(err);else resolve(result);
    };
    const timer=setTimeout(()=>{
      child.kill("SIGKILL");settle(new Error("Native decoder timed out"));
    },timeout);
    child.on("error",error=>settle(error));
    child.stdout.on("data",buffer=>{
      stdoutBytes+=buffer.length;
      if(stdoutBytes>maxOutput) {
        child.kill("SIGKILL");settle(new Error("Codec output exceeds safety limit"));
      }else stdoutChunks.push(buffer);
    });
    child.stderr.on("data",buffer=>{
      if(stderr.length<4096)stderr+=buffer.toString("utf8").slice(0,4096);
    });
    child.on("close",code=>{
      if(code===0) {
        // Decode Unicode once, after receiving complete bytes. Splitting a
        // multibyte subtitle character over chunks must not corrupt text.
        settle(null,Buffer.concat(stdoutChunks,stdoutBytes).toString("utf8"));
      } else {
        let reason=(stderr.trim()||"Native codec process exited with an error")
          .slice(-500);
        for(const arg of args) {
          if(typeof arg==="string" && path.isAbsolute(arg))
            reason=reason.split(arg).join("selected media");
        }
        settle(new Error(reason));
      }
    });
  });
}
async function status() {
  if(availability)return availability;
  const ffmpeg=binary("ffmpeg"),ffprobe=binary("ffprobe");
  if(!executable(ffmpeg)||!executable(ffprobe))
    return {ready:false,reason:"Bundled FFmpeg/FFprobe are missing"};
  try {
    const encoders=await processOutput(ffmpeg,["-hide_banner","-encoders"]);
    await processOutput(ffprobe,["-version"],8000);
    availability=capabilityFromEncoders(encoders);
    return availability;
  }catch(error){
    return {ready:false,reason:String(error.message||error).slice(0,200)};
  }
}
function selectedFile(localPath) {
  if(typeof localPath!=="string"||localPath.length>4096||
     !path.isAbsolute(localPath)||localPath.includes("\0"))
    throw new Error("A local selected file is required");
  const stat=fs.statSync(localPath);
  if(!stat.isFile())throw new Error("Selected path is not a file");
  return localPath;
}
async function probe(localPath) {
  // Probing chapters and streams does not require a usable output encoder.
  if(!executable(binary("ffprobe")))throw new Error("Bundled FFprobe is missing");
  const dvd=isDVD(localPath)?localPath:null;
  const file=dvd?dvd.path:selectedFile(localPath);
  const stat=dvd?verifyDVD(dvd):fs.statSync(file);
  const key=JSON.stringify([file,stat.size,stat.mtimeMs,dvd?.id||null]);
  const cacheable=!dvd?.drive;
  if(cacheable&&probeCache.has(key))return probeCache.get(key);
  const work=(async()=>{
  const stdout=await processOutput(binary("ffprobe"),[
    "-v","error","-show_entries",
    "format=duration,format_name,start_time:stream=index,codec_type,codec_name,pix_fmt,width,height,field_order,avg_frame_rate,r_frame_rate,channels,sample_rate:stream_disposition=attached_pic:stream_tags=language,title:chapter=start_time:chapter_tags=title",
    "-show_chapters","-of","json",...(dvd?dvdArgs(dvd):[]),"-i",file
  ],dvd&&!dvd.drive?90000:30000);
  const json=JSON.parse(stdout);
  const streams=Array.isArray(json.streams)?json.streams:[];
  const video=streams.find(s=>s.codec_type==="video"&&!Number(s.disposition?.attached_pic));
  const hasVideo=Boolean(video);
  const hasAudio=streams.some(s=>s.codec_type==="audio");
  if(!hasVideo&&!hasAudio)throw new Error("The selected file has no playable media streams");
  const seconds=Number(json.format?.duration);
  const fps=frameRate(video?.avg_frame_rate)||frameRate(video?.r_frame_rate);
  const cores=typeof os.availableParallelism==="function"?os.availableParallelism():os.cpus().length;
  const autoSmoothing=Boolean(fps&&fps<59.5&&video?.width<=1280&&video?.height<=720&&
    video?.width>0&&video?.height>0&&cores>=8&&os.totalmem()>=7*1024**3);
  return {ready:true,duration:Number.isFinite(seconds)&&seconds>0?seconds:null,
    hasVideo,hasAudio,format:String(json.format?.format_name||"").slice(0,120),
    startTime:Number.isFinite(Number(json.format?.start_time))?Number(json.format.start_time):0,
    videoCodec:String(video?.codec_name||""),
    videoPixelFormat:String(video?.pix_fmt||""),
    fieldOrder:["progressive","tt","bb","tb","bt"].includes(video?.field_order)?video.field_order:"unknown",
    videoStreamIndex:hasVideo?video.index:null,sourceFps:fps,autoSmoothing,
    width:Number(video?.width)||null,height:Number(video?.height)||null,
    audioCodec:String(streams.find(s=>s.codec_type==="audio")?.codec_name||""),
    audioTracks:streams.filter(s=>s.codec_type==="audio").map((s,index)=>({
      index,codec:String(s.codec_name||""),
      channels:Number(s.channels)||null,sampleRate:Number(s.sample_rate)||null,
      language:String(s.tags?.language||"").slice(0,20),
      title:String(s.tags?.title||"").slice(0,100)
    })),
    subtitleTracks:streams.filter(s=>s.codec_type==="subtitle"&&!dvd)
      .map((s,index)=>({
        index,codec:String(s.codec_name||"").slice(0,60),
        language:String(s.tags?.language||"").slice(0,20),
        title:String(s.tags?.title||"").slice(0,100)
      })),
    chapters:(Array.isArray(json.chapters)?json.chapters:[]).slice(0,500)
      .map((chapter,index)=>({
        startTime:Number(chapter.start_time),
        text:String(chapter.tags?.title||"Chapter "+(index+1)).slice(0,180)
      }))
      .filter(chapter=>Number.isFinite(chapter.startTime)&&chapter.startTime>=0)
      .sort((a,b)=>a.startTime-b.startTime)};
  })();
  if(cacheable)probeCache.set(key,work);
  if(probeCache.size>MAX_CACHED_PROBES)
    probeCache.delete(probeCache.keys().next().value);
  try{return await work;}
  catch(error){probeCache.delete(key);throw error;}
}
// Read presentation timestamps from the selected video stream. Bounded
// windows and one in-flight probe avoid indexing an entire film in RAM.
async function adjacentFrame(localPath,position,direction){
  if(![-1,1].includes(direction)||!Number.isFinite(position)||position<0||position>7*86400)
    throw Error("Invalid frame step");
  if(frameProbeBusy)throw Error("Frame lookup is already running");
  frameProbeBusy=true;
  try{
    const file=selectedFile(localPath),info=await probe(file);
    if(!info.hasVideo)throw Error("No video stream");
    const stat=fs.statSync(file),key=JSON.stringify([file,stat.size,stat.mtimeMs,info.videoStreamIndex]);
    const select=times=>{
      // The current frame is the final timestamp at or before the playhead.
      // Do not estimate a fixed FPS, including on variable-frame-rate files.
      const epsilon=0.00025;
      let index=-1;
      for(let i=0;i<times.length&&times[i]<=position+epsilon;i++)index=i;
      if(index<0&&position>0.001)return null;
      const targetIndex=index+direction;
      if(targetIndex<0||targetIndex>=times.length)return null;
      const target=times[targetIndex],next=times[targetIndex+1];
      return {target,sample:Number.isFinite(next)&&next>target?
        target+Math.min(0.005,(next-target)/2):target};
    };
    if(frameCache?.key===key&&frameCache.times[0]<=position+0.00025&&
       frameCache.times.at(-1)>position){
      const result=select(frameCache.times);
      if(result)return result;
    }
    for(const lookback of [3,15,45]){
      const begin=Math.max(0,position-lookback),end=position+3;
      const interval=(begin===0?"":(begin+info.startTime).toFixed(6))+"%"+(end+info.startTime).toFixed(6);
      const data=await processOutput(binary("ffprobe"),[
        "-v","error","-select_streams",String(info.videoStreamIndex),
        "-read_intervals",interval,"-show_frames","-show_entries",
        "frame=best_effort_timestamp_time","-of","json","-i",file
      ],18000,1024*1024);
      const json=JSON.parse(data);
      const times=[...new Set((Array.isArray(json.frames)?json.frames:[])
        .map(frame=>Number(frame.best_effort_timestamp_time)-info.startTime)
        .filter(value=>Number.isFinite(value)&&value>=-0.00025)
        .map(value=>Math.max(0,value)))].sort((a,b)=>a-b);
      frameCache={key,times};
      // If a bounded probe did not reach the playhead, do not mistake
      // its final decoded frame for the current one.
      const reachesPlayhead=times.at(-1)>=position-0.00025||
        (info.duration!==null&&end>=info.duration&&position<=info.duration&&times.length>0);
      const result=reachesPlayhead?select(times):null;
      if(result)return result;
      if(begin===0)break;
    }
    return null;
  }finally{frameProbeBusy=false;}
}
async function subtitleVtt(localPath,index) {
  const info=await probe(localPath);
  const ordinal=Number(index);
  if(!Number.isInteger(ordinal)||ordinal<0 ||
     ordinal>=info.subtitleTracks.length)
    throw new Error("Subtitle track is not available");
  const codec=info.subtitleTracks[ordinal].codec.toLowerCase();
  // FFmpeg's WebVTT encoder converts text captions. Bitmap subtitles such
  // as PGS or DVD VobSub require the separate graphics path.
  if(!/^(subrip|ass|ssa|webvtt|mov_text|text|ttml|microdvd|sami|realtext)$/.test(codec))
    throw new Error("This subtitle track is graphical or unsupported");
  const data=await processOutput(binary("ffmpeg"),[
    "-hide_banner","-v","error","-nostdin",
    "-i",selectedFile(localPath),"-map","0:s:"+ordinal,
    "-c:s","webvtt","-f","webvtt","pipe:1"
  ],90000,4*1024*1024);
  if(!/^WEBVTT\s/m.test(data)||data.length>4*1024*1024)
    throw new Error("This subtitle track cannot be converted to text captions");
  return data;
}
function clearConversionProgress() {
  if(windowRef&&!windowRef.isDestroyed())windowRef.setProgressBar(-1);
}
function cancelStream() {
  clearConversionProgress();
  if(!session)return;
  const old=session;session=null;
  try {old.process?.kill("SIGTERM");} catch(_){}
  try {old.response?.end();} catch(_){}
}
function serve(req,res) {
  const active=session;
  const requestPath=(req.url||"").split("?")[0];
  if(req.method!=="GET"||!active||requestPath!=="/media/"+active.token){
    res.writeHead(404,{"Cache-Control":"no-store"});
    res.end();return;
  }
  if(active.process||active.response) {
    res.writeHead(409);res.end();return;
  }
  const args=["-hide_banner","-loglevel","error","-nostdin",
    "-progress","pipe:2","-nostats",
    ...(active.dvd?[...dvdArgs({...active.dvd,drive:true}),"-i",active.path,"-ss",String(active.position)]:["-ss",String(active.position),"-i",active.path]),
    ...(active.hasVideo?["-map","0:"+active.videoStreamIndex]:[]),
    ...(active.hasAudio?["-map","0:a:"+active.audioOrdinal]:[]),"-sn","-dn"];
  const filters=[];
  if(active.deinterlace)filters.push("bwdif=mode=send_frame:parity=auto:deint="+(active.deinterlace==="on"?"all":"interlaced"));
  // Motion-compensated interpolation generates intermediate frames; no
  // fps-only duplication. Deinterlace before interpolation when enabled.
  if(active.smoothing)filters.push("minterpolate=fps="+active.smoothing+":mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1");
  if(filters.length)args.push("-vf",filters.join(","),"-fps_mode","passthrough");
  if(active.format==="webm") {
    if(active.hasVideo)args.push("-c:v","libvpx-vp9","-deadline","realtime","-cpu-used","5","-b:v","0","-crf","33","-pix_fmt","yuv420p");
    if(active.hasAudio)args.push("-c:a","libopus","-b:a","160k","-ac","2");
    args.push("-f","webm","pipe:1");
  }else{
    // Prefer an LGPL-compatible OpenH264 build when supplied. libx264
    // carries GPL obligations and must never be silently mandatory.
    if(active.hasVideo){
    if(active.copyVideo)
      args.push("-c:v","copy");
    else if(active.encoder==="libopenh264")
      args.push("-c:v","libopenh264","-b:v","2400k");
    else
      args.push("-c:v","libx264","-preset","veryfast","-crf","23");
    if(!active.copyVideo)args.push("-pix_fmt","yuv420p","-g","48");
    }
    if(active.hasAudio)args.push("-c:a","aac","-ac","2","-b:a","160k");
    args.push(
      "-movflags","+frag_keyframe+empty_moov+default_base_moof",
      "-frag_duration","1000000","-f","mp4","pipe:1");
  }
  let child;
  try {child=spawn(binary("ffmpeg"),args,{
    stdio:["ignore","pipe","pipe"],windowsHide:true,
    env:codecEnvironment()
  });}
  catch(_){res.writeHead(500);res.end();return;}
  active.process=child;active.response=res;
  res.writeHead(200,{"Content-Type":(active.hasVideo?"video/":"audio/")+(active.format==="webm"?"webm":"mp4"),
    "Cache-Control":"no-store","Access-Control-Allow-Origin":"null",
    "X-Content-Type-Options":"nosniff"});
  child.stdout.pipe(res);
  // Progress is encoded media time, not downloaded bytes.
  let pending="";
  const remaining=active.duration===null?null:active.duration-active.position;
  if(windowRef&&!windowRef.isDestroyed())
    windowRef.setProgressBar(remaining>0?0:2);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data",chunk=>{
    if(session!==active)return;
    pending+=chunk;
    const lines=pending.split(/\r?\n/);pending=lines.pop().slice(-4096);
    for(const line of lines){
      const match=/^out_time_us=(\d+)$/.exec(line);
      if(match&&remaining>0&&windowRef&&!windowRef.isDestroyed())
        windowRef.setProgressBar(Math.min(0.99,Number(match[1])/1e6/remaining));
    }
  });
  child.once("close",()=>{if(session===active)clearConversionProgress();});
  child.on("error",()=>{try{res.end();}catch(_){}});
  child.on("close",()=>{try{res.end();}catch(_){}});
  res.on("close",()=>{
    if(session===active){try{child.kill("SIGTERM");}catch(_){}}
  });
}
async function loopback() {
  if(server)return server.address().port;
  server=http.createServer(serve);
  try {
    await new Promise((resolve,reject)=>{
      server.once("error",reject);
      server.listen(0,BIND_ADDRESS,()=>{
        server.removeListener("error",reject);
        resolve();
      });
    });
  }catch(error){server.close();server=null;throw error;}
  return server.address().port;
}
async function start(localPath,offset=0,format="auto",audioIndex=0,frameStep=false,deinterlace="off",smoothing="off") {
  const info=await probe(localPath);
  const available=await status();
  const dvd=isDVD(localPath)?localPath:null;
  const target=dvd?(verifyDVD(dvd),dvd.path):selectedFile(localPath);
  const chosen=Number(audioIndex);
  const audioOrdinal=Number.isInteger(chosen)&&chosen>=0 &&
    chosen<info.audioTracks.length ? chosen:0;
  const position=Math.max(0,Math.min(
    Number.isFinite(Number(offset))?Number(offset):0,
    info.duration===null?24*60*60:Math.max(0,info.duration-(frameStep===true?0.001:0.5))));
  const filterMode=info.hasVideo&&(deinterlace==="on"||deinterlace==="auto"&&["tt","bb","tb","bt"].includes(info.fieldOrder))?deinterlace:null;
  if(filterMode){
    if(!deinterlaceCapability)deinterlaceCapability=processOutput(binary("ffmpeg"),["-hide_banner","-filters"],8000)
      .then(filters=>/\bbwdif\s+V->V\b/.test(filters)).catch(error=>{deinterlaceCapability=null;throw error;});
    if(!await deinterlaceCapability)throw Error("Bundled decoder does not include the deinterlacing filter");
  }
  const targetFps=smoothing==="auto"?(info.autoSmoothing?60:0):smoothing==="60"?60:smoothing==="120"?120:0;
  const smoothFps=info.hasVideo&&!frameStep&&targetFps&&info.sourceFps&&info.sourceFps<targetFps-0.5?targetFps:0;
  if(smoothFps){
    if(!smoothingCapability)smoothingCapability=processOutput(binary("ffmpeg"),["-hide_banner","-filters"],8000)
      .then(filters=>/\bminterpolate\s+V->V\b/.test(filters)).catch(error=>{smoothingCapability=null;throw error;});
    if(!await smoothingCapability)throw Error("Bundled decoder does not include the motion interpolation filter");
  }
  const copyVideo=!dvd&&!filterMode&&!smoothFps&&info.videoCodec==="h264"&&/^(yuv420p|yuvj420p)$/.test(info.videoPixelFormat)&&position===0;
  const selectedFormat=chooseOutput(available,format,copyVideo,!info.hasVideo);
  const port=await loopback();
  cancelStream();
  const token=crypto.randomBytes(24).toString("hex");
  session={token,path:target,dvd,position,duration:info.duration,format:selectedFormat,
    encoder:available.h264Encoder,audioOrdinal,hasVideo:info.hasVideo,hasAudio:info.hasAudio,videoStreamIndex:info.videoStreamIndex,
    copyVideo:selectedFormat==="mp4"&&copyVideo,deinterlace:filterMode,smoothing:smoothFps,
    process:null,response:null};
  return {...info,position,format:selectedFormat,deinterlace:filterMode||"off",smoothing:smoothFps,
    url:"http://"+BIND_ADDRESS+":"+port+"/media/"+token};
}
function onlyWindow(event) {
  return windowRef && !windowRef.isDestroyed() &&
    event.sender===playerContents &&
    event.senderFrame?.url?.startsWith("file://");
}

let exportBusy=false;
// Native-only export. Dialog-selected paths never originate from renderer IPC.
async function exportVideo(win,language="en"){
  const ru=language==="ru";
  const t=(en,rus)=>ru?rus:en;
  if(exportBusy||win.isDestroyed())return;
  exportBusy=true;
  let temp=null,child=null,panel=null,cancelled=false;
  try {
    const pick=await dialog.showOpenDialog(win,{title:t("Convert video","Конвертация видео"),properties:["openFile"]});
    if(pick.canceled)return;
    const source=selectedFile(pick.filePaths[0]);
    const info=await probe(source),caps=await status();
    const copyH264=info.videoCodec==="h264"&&/^(yuv420p|yuvj420p)$/.test(info.videoPixelFormat);
    const formats=["mp4","webm","mkv"].filter(f=>f==="mkv"||caps[f]||(f==="mp4"&&copyH264&&caps.mp4Copy));
    if(!info.hasVideo||!formats.length)throw Error("No supported video export format");
    const choice=await dialog.showMessageBox(win,{type:"question",title:t("Convert video","Конвертация видео"),
      message:t("Choose output format","Выберите формат"),buttons:[...formats.map(f=>f.toUpperCase()),t("Cancel","Отмена")],
      cancelId:formats.length,defaultId:0});
    if(choice.response>=formats.length)return;
    const format=formats[choice.response];
    const save=await dialog.showSaveDialog(win,{title:t("Save converted video","Сохранить видео"),
      defaultPath:path.join(path.dirname(source),path.basename(source,path.extname(source))+"-converted."+format),
      filters:[{name:format.toUpperCase(),extensions:[format]}]});
    if(save.canceled||!save.filePath)return;
    const target=save.filePath;
    const supportedText=/^(subrip|ass|ssa|webvtt|mov_text|text|ttml|microdvd|sami|realtext)$/i;
    const textTracks=info.subtitleTracks.filter(track=>supportedText.test(track.codec));
    if(format!=="mkv"&&info.subtitleTracks.length){
      const warning=await dialog.showMessageBox(win,{type:"warning",
        message:t("Some subtitle features may not survive conversion.","Некоторые свойства субтитров могут быть потеряны."),
        detail:t("Text subtitles will be converted. Bitmap subtitles are excluded. Choose MKV to retain the original subtitle streams.","Текстовые субтитры будут преобразованы. Графические субтитры исключаются. Выберите MKV для сохранения исходных дорожек."),
        buttons:[t("Continue","Продолжить"),t("Cancel","Отмена")],defaultId:1,cancelId:1});
      if(warning.response!==0)return;
    }
    if(path.extname(target).toLowerCase()!=="."+format)
      throw Error("Output filename must end in ."+format);
    if(fs.existsSync(target))throw Error("Choose a new filename; existing files are never overwritten");
    temp=await fs.promises.mkdtemp(path.join(path.dirname(target),".dk-convert-"));
    const output=path.join(temp,"output."+format);
    if(win.isDestroyed())return;
    panel=new BrowserWindow({parent:win,modal:true,width:390,height:190,resizable:false,
      title:t("Convert video","Конвертация видео"),webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    panel.setMenu(null);
    panel.on("close",()=>{cancelled=true;child?.kill("SIGTERM");});
    await panel.loadURL("data:text/html;charset=utf-8,"+encodeURIComponent(
      '<!doctype html><meta charset=utf-8><style>body{background:#202020;color:white;font:16px sans-serif;padding:20px}progress{width:100%;accent-color:#b62525}</style><div id="label">'+t("Preparing conversion…","Подготовка…")+'</div><p><progress id="bar" max="100"></progress></p><button onclick="window.close()">'+t("Cancel","Отмена")+'</button>'));
    if(cancelled||panel.isDestroyed()||win.isDestroyed())return;
    const args=["-hide_banner","-loglevel","error","-nostdin","-n","-progress","pipe:1","-nostats",
      "-i",source,"-map","0:"+info.videoStreamIndex,"-map","0:a?","-map_metadata","0","-map_chapters","0","-dn"];
    if(format==="mkv")args.push("-map","0:s?","-map","0:t?","-c","copy");
    else {
      for(const track of textTracks)args.push("-map","0:s:"+track.index);
      if(textTracks.length)args.push("-c:s",format==="mp4"?"mov_text":"webvtt");
    }
    if(format==="webm")args.push("-c:v","libvpx-vp9","-deadline","good","-cpu-used","4","-crf","30","-b:v","0","-c:a","libopus");
    else if(format==="mp4") {
      if(copyH264)args.push("-c:v","copy");
      else if(caps.h264Encoder==="libopenh264")args.push("-c:v","libopenh264","-b:v","4000k");
      else args.push("-c:v","libx264","-preset","veryfast","-crf","23");
      if(!copyH264)args.push("-pix_fmt","yuv420p");
      args.push("-c:a","aac","-movflags","+faststart");
    }
    args.push("-f",format==="mkv"?"matroska":format,output);
    await new Promise((resolve,reject)=>{
      child=spawn(binary("ffmpeg"),args,{stdio:["ignore","pipe","pipe"],env:codecEnvironment()});
      let pending="",last=-1;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data",chunk=>{
        pending+=chunk;
        const lines=pending.split(/\r?\n/);pending=lines.pop().slice(-4096);
        for(const line of lines){
          const match=/^out_time_us=(\d+)$/.exec(line);
          if(!match||!info.duration||panel.isDestroyed())continue;
          const percent=Math.min(99,Math.max(0,Math.floor(Number(match[1])/1e4/info.duration)));
          if(percent===last)continue;
          last=percent;
          panel.webContents.executeJavaScript("document.getElementById('bar').value="+percent+
            ";document.getElementById('label').textContent="+JSON.stringify(t("Converting: ","Конвертация: ")+percent+"%")).catch(()=>{});
        }
      });
      child.stderr.resume();
      child.once("error",reject);
      child.once("close",code=>code===0&&!cancelled?resolve():reject(Error("Conversion did not complete")));
    });
    if(cancelled)return;
    // Hard-link publication is atomic and fails if the target appeared meanwhile.
    await fs.promises.link(output,target);
    if(panel&&!panel.isDestroyed())panel.destroy();
    if(!win.isDestroyed())await dialog.showMessageBox(win,{type:"info",message:t("Conversion complete (100%)","Конвертация завершена (100%)"),detail:target});
  }catch(error){
    if(!cancelled&&!win.isDestroyed())await dialog.showMessageBox(win,{type:"error",message:t("Conversion failed","Ошибка конвертации"),detail:ru?"Не удалось создать выходной файл.":String(error.message).slice(0,250)});
  }finally{
    if(panel&&!panel.isDestroyed())panel.destroy();
    if(temp)await fs.promises.rm(temp,{recursive:true,force:true}).catch(()=>{});
    exportBusy=false;
  }
}
function attachExport(win,contents){
  // Preserve existing menu and icons; Ctrl+Shift+E is desktop-only.
  contents.on("before-input-event",(event,input)=>{
    if(input.type==="keyDown"&&input.control&&input.shift&&!input.alt&&String(input.key).toLowerCase()==="e"){
      event.preventDefault();if(!input.isAutoRepeat)void exportVideo(win);
    }
  });
}

function install(win,contents=win?.webContents) {
  if(!contents)throw new Error("A DK Kinehall player view is required");
  playerContents=contents;
  attachExport(win,contents);
  // Re-opened Player windows must reconnect to the same IPC service.
  if(installed){
    if(windowRef&&!windowRef.isDestroyed()&&windowRef!==win)
      throw new Error("A native decoder is already attached to another player");
    windowRef=win;
    win.once("closed",()=>{cancelStream();server?.close();server=null;windowRef=null;});
    return;
  }
  installed=true;windowRef=win;
  ipcMain.handle("dk-codec:export",async(event,language)=>{
    if(!onlyWindow(event))throw Error("Rejected export request");
    await exportVideo(windowRef,language==="ru"?"ru":"en");
    return true;
  });
  ipcMain.handle("dk-codec:status",async event=>
    onlyWindow(event)?status():{ready:false});
  ipcMain.handle("dk-codec:dvd-select",async(event,kind,title,chapter,angle,language)=>{
    if(!onlyWindow(event))throw Error("Rejected DVD request");
    return selectDVD(windowRef,kind,title,chapter,angle,language);
  });
  ipcMain.handle("dk-codec:dvd-change",async(event,id,title,chapter,angle)=>{
    if(!onlyWindow(event))throw Error("Rejected DVD request");
    return changeDVD(windowRef,id,title,chapter,angle);
  });
  ipcMain.handle("dk-codec:probe",async(event,localPath)=>{
    if(!onlyWindow(event))throw new Error("Rejected media request");
    return probe(await resolvePlaybackSource(localPath));
  });
  ipcMain.handle("dk-codec:adjacent-frame",async(event,localPath,position,direction)=>{
    if(!onlyWindow(event))throw Error("Rejected frame request");
    return adjacentFrame(await resolveSource(localPath,checkVideo),position,direction);
  });
  ipcMain.handle("dk-codec:subtitle-vtt",async(event,localPath,index)=>{
    if(!onlyWindow(event))throw new Error("Rejected subtitle request");
    return subtitleVtt(await resolveSource(localPath,checkVideo),index);
  });
  ipcMain.handle("dk-codec:start",async(event,localPath,offset,format,audioIndex,frameStep,deinterlace,smoothing)=>{
    if(!onlyWindow(event))throw new Error("Rejected media request");
    return start(await resolvePlaybackSource(localPath),
      offset,format,audioIndex,frameStep===true,["auto","on"].includes(deinterlace)?deinterlace:"off",
      ["auto","60","120"].includes(smoothing)?smoothing:"off");
  });
  ipcMain.handle("dk-codec:stop",async event=>{
    if(!onlyWindow(event))return;
    cancelStream();return true;
  });
  win.once("closed",()=>{cancelStream();server?.close();server=null;windowRef=null;});
  app.once("before-quit",()=>{dvdGrants.clear();cancelStream();server?.close();server=null;});
}
module.exports={install};
