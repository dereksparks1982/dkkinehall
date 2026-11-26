"use strict";
/* One native window, persistent Library and Player views. */
const {ipcMain,WebContentsView,app,dialog,shell}=require("electron");
const native=require("./library-indexer.cjs");
const path=require("node:path");
const fs=require("node:fs");
const {fileURLToPath,pathToFileURL}=require("node:url");
const {randomBytes}=require("node:crypto");
const VERSION="0.9.3";

/* Explicit, bounded IPv4 LAN discovery and read-only network playback.
 * No background discovery, UPnP port mapping, redirects, DNS resolution,
 * credentials, filesystem writes or externally reachable HTTP listener. */
const netHTTP=require("node:http"),netHTTPS=require("node:https"),netUDP=require("node:dgram");
const networkServers=new Map(),networkGrants=new Map(),networkClients=new Set();
let networkScan=null,networkProxy=null,networkProxyOpening=null,networkBrowseBusy=0;
function privateIPv4(host){
  const parts=String(host).split(".");
  if(parts.length!==4||parts.some(p=>!/^(0|[1-9]\d{0,2})$/.test(p)||Number(p)>255))return false;
  const [a,b]=parts.map(Number);
  return a===10||a===192&&b===168||a===172&&b>=16&&b<=31||a===169&&b===254;
}
function networkURL(value,host=null){
  if(typeof value!=="string"||value.length>4096)throw Error("Invalid network URL");
  const url=new URL(value);
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.hash||
    !privateIPv4(url.hostname)||(host&&url.hostname!==host))throw Error("Only private IPv4 media addresses are supported");
  return url;
}
function networkRequest(url,options={},body=null,limit=2*1024*1024){
  return new Promise((resolve,reject)=>{
    const lib=url.protocol==="https:"?netHTTPS:netHTTP;
    const req=lib.request(url,{...options,agent:false},res=>{
      if(res.statusCode!==200){res.destroy();req.destroy();reject(Error("Network server returned an error"));return;}
      const chunks=[];let bytes=0;
      res.on("data",chunk=>{
        bytes+=chunk.length;
        if(bytes>limit){res.destroy();req.destroy();reject(Error("Network response too large"));}
        else chunks.push(chunk);
      });
      res.on("end",()=>resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error",reject);
      res.on("aborted",()=>reject(Error("Network response interrupted")));
    });
    const timer=setTimeout(()=>req.destroy(Error("Network request timed out")),8000);
    req.on("close",()=>clearTimeout(timer));req.on("error",reject);
    req.end(body||undefined);
  });
}
function discoverNetwork(){
  if(networkScan)return networkScan;
  networkScan=new Promise(resolve=>{
    const socket=netUDP.createSocket("udp4"),seen=new Map();let done=false;
    const finish=()=>{
      if(done)return;done=true;clearTimeout(timer);
      try{socket.close();}catch(_){}
      resolve([...seen.values()]);
    };
    const timer=setTimeout(finish,3200);
    socket.on("error",finish);
    socket.on("message",(data,remote)=>{
      if(data.length>16384||seen.size>=32||!privateIPv4(remote.address))return;
      const lines=data.toString("utf8").split(/\r?\n/);
      if(!/^HTTP\/1\.[01] 200\b/i.test(lines.shift()||""))return;
      const headers=Object.create(null);
      for(const line of lines){
        const split=line.indexOf(":");if(split>0)headers[line.slice(0,split).trim().toLowerCase()]=line.slice(split+1).trim();
      }
      if(!/^urn:schemas-upnp-org:device:MediaServer:\d+$/i.test(headers.st||""))return;
      try{
        const location=networkURL(headers.location,remote.address).href;
        if(seen.has(location))return;
        const id=randomBytes(18).toString("hex");
        seen.set(location,{id,location});
        networkServers.set(id,{location,host:remote.address});
        if(networkServers.size>128)networkServers.delete(networkServers.keys().next().value);
      }catch(_){}
    });
    socket.bind(0,()=>{
      if(done)return;
      const msg=Buffer.from("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:MediaServer:1\r\n\r\n");
      socket.send(msg,1900,"239.255.255.250",error=>{if(error)finish();});
    });
  }).finally(()=>{networkScan=null;});
  return networkScan;
}
async function networkDescription(id){
  const server=networkServers.get(id);if(!server)throw Error("Network server selection expired");
  if(networkBrowseBusy>=4)throw Error("Network requests busy");
  networkBrowseBusy++;
  try{return {location:server.location,xml:await networkRequest(networkURL(server.location,server.host))};}
  finally{networkBrowseBusy--;}
}
function escapeNetworkXML(value){return value.replace(/[<>&"']/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&apos;"}[c]));}
async function browseNetwork(id,control,type,objectId,start){
  const server=networkServers.get(id);
  if(!server||typeof type!=="string"||!/^urn:schemas-upnp-org:service:ContentDirectory:[1-4]$/.test(type)||
    typeof objectId!=="string"||objectId.length>1024||!Number.isInteger(start)||start<0||start>100000)
    throw Error("Invalid media browse request");
  const target=networkURL(control,server.host);
  if(networkBrowseBusy>=4)throw Error("Network requests busy");
  const body='<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:Browse xmlns:u="'+type+'"><ObjectID>'+escapeNetworkXML(objectId)+'</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag><Filter>*</Filter><StartingIndex>'+start+'</StartingIndex><RequestedCount>100</RequestedCount><SortCriteria></SortCriteria></u:Browse></s:Body></s:Envelope>';
  networkBrowseBusy++;
  try{return await networkRequest(target,{method:"POST",headers:{"Content-Type":"text/xml; charset=utf-8","SOAPACTION":'"'+type+'#Browse"',"Content-Length":Buffer.byteLength(body)}},body);}
  finally{networkBrowseBusy--;}
}
function serveNetwork(req,res){
  const match=/^\/media\/([a-f0-9]{48})$/.exec(req.url||"");
  const entry=match&&networkGrants.get(match[1]);
  const fail=(status=404)=>{if(!res.headersSent)res.writeHead(status,{"Cache-Control":"no-store"});res.end();};
  if(!entry||!["GET","HEAD"].includes(req.method)||networkClients.size>=8)return fail();
  const range=req.headers.range;
  if(range&&!/^bytes=(?:\d{1,16}-\d{0,16}|-\d{1,16})$/.test(range))return fail(416);
  const url=entry.url,lib=url.protocol==="https:"?netHTTPS:netHTTP;
  const upstream=lib.request(url,{method:req.method,agent:false,headers:range?{Range:range}:{}},reply=>{
    if(![200,206,416].includes(reply.statusCode)){reply.destroy();return fail(502);}
    const mime=String(reply.headers["content-type"]||"").split(";")[0].trim().toLowerCase();
    if(reply.statusCode!==416&&!/^(video\/|audio\/|application\/octet-stream$)/.test(mime)){
      reply.destroy();return fail(415);
    }
    const headers={"Content-Type":mime||"application/octet-stream","Access-Control-Allow-Origin":"null",
      "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
    for(const key of ["content-length","content-range","accept-ranges"]){
      const value=reply.headers[key];if(typeof value==="string")headers[key]=value;
    }
    res.writeHead(reply.statusCode,headers);
    reply.on("error",()=>res.destroy());reply.on("aborted",()=>res.destroy());
    if(req.method==="HEAD"){reply.resume();res.end();}else reply.pipe(res);
  });
  networkClients.add(upstream);
  upstream.setTimeout(20000,()=>upstream.destroy(Error("Network media timed out")));
  upstream.on("close",()=>networkClients.delete(upstream));
  upstream.on("error",()=>{if(res.headersSent)res.destroy();else fail(502);});
  res.on("close",()=>upstream.destroy());
  upstream.end();
}
async function startNetworkProxy(){
  if(networkProxy?.listening)return networkProxy.address().port;
  if(networkProxyOpening)return networkProxyOpening;
  networkProxyOpening=new Promise((resolve,reject)=>{
    const server=netHTTP.createServer(serveNetwork);
    networkProxy=server;
    server.once("error",error=>{networkProxy=null;reject(error);});
    server.listen(0,"127.0.0.1",()=>resolve(server.address().port));
  }).finally(()=>{networkProxyOpening=null;});
  return networkProxyOpening;
}
async function grantNetwork(id,value){
  const server=id===null?null:networkServers.get(id);
  if(id!==null&&!server)throw Error("Network server selection expired");
  const url=networkURL(value,server?.host);
  if(networkGrants.size>=256)throw Error("Network media queue is full");
  const port=await startNetworkProxy(),token=randomBytes(24).toString("hex");
  networkGrants.set(token,{url});
  return {token,src:"http://127.0.0.1:"+port+"/media/"+token};
}
function closeNetwork(){
  for(const req of networkClients)req.destroy();
  networkClients.clear();networkGrants.clear();networkServers.clear();
  networkProxy?.close();networkProxy=null;
}

// Local-only CTranslate2/SentencePiece worker. No model fetcher, shell or
// caller-controlled executable/path. Only a trusted separately provisioned
// runtime and direct bilingual models in the application's data directory.
const {spawn}=require("node:child_process");
let translationJob=null;
const translationWorker=String.raw`
import json, sys
from pathlib import Path
import ctranslate2
import sentencepiece as spm
root=Path(sys.argv[1])
source=spm.SentencePieceProcessor(model_file=str(root/"source.model"))
target=spm.SentencePieceProcessor(model_file=str(root/"target.model"))
engine=ctranslate2.Translator(str(root/"model"),device="cpu",inter_threads=1,intra_threads=2)
lines=json.load(sys.stdin)
output=[]
for start in range(0,len(lines),32):
    batch=lines[start:start+32]
    tokens=[source.encode(line,out_type=str) for line in batch]
    if any(len(row)>512 for row in tokens):
        raise ValueError("Subtitle line exceeds model input limit")
    results=engine.translate_batch(tokens,beam_size=2,max_input_length=512,max_decoding_length=512)
    translated=[target.decode(row.hypotheses[0]) for row in results]
    output.extend(translated)
    print(json.dumps({"start":start,"batch":translated},ensure_ascii=False),flush=True)
`;
function translationPaths(pair){
  if(!["en-ru","ru-en"].includes(pair))throw Error("Unsupported translation direction");
  const root=path.join(process.env.XDG_DATA_HOME||path.join(app.getPath("home"),".local","share"),"dk-kinehall","translation-runtime");
  const python=path.join(root,"bin","python3");
  const model=path.join(root,"models",pair);
  const ready=[path.join(root,"READY.json"),python,path.join(model,"model","model.bin"),path.join(model,"source.model"),path.join(model,"target.model")].every(p=>fs.existsSync(p));
  return {python,model,ready};
}
function cancelTranslation(){
  if(translationJob){translationJob.child.kill("SIGKILL");}
}
function translateLocal(event,pair,lines,ticket){
  if(!Number.isSafeInteger(ticket)||ticket<1)throw Error("Invalid translation job");
  const runtime=translationPaths(pair);
  if(!runtime.ready)throw Error("Offline translation runtime or language model is missing");
  if(translationJob||voiceoverJob)throw Error("Offline speech or translation job already running");
  if(!Array.isArray(lines)||!lines.length||lines.length>12000||
    lines.some(line=>typeof line!=="string"||!line.trim()||line.length>1000)||
    Buffer.byteLength(JSON.stringify(lines),"utf8")>2*1024*1024)
      throw Error("Invalid subtitle translation input");
  return new Promise((resolve,reject)=>{
    const child=spawn(runtime.python,["-I","-c",translationWorker,runtime.model],{
      shell:false,stdio:["pipe","pipe","pipe"],env:{...process.env,LD_LIBRARY_PATH:"",PYTHONNOUSERSITE:"1",OMP_NUM_THREADS:"2",HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1"}
    });
    const job={child};translationJob=job;
    let pending="",result=[],failed=false,totalBytes=0;
    const timer=setTimeout(()=>child.kill("SIGKILL"),30*60*1000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data",chunk=>{
      pending+=chunk;
      if(pending.length>8*1024*1024){failed=true;child.kill("SIGKILL");return;}
      let end;
      while((end=pending.indexOf("\n"))>=0){
        const line=pending.slice(0,end);pending=pending.slice(end+1);
        try{
          const value=JSON.parse(line);
          const batch=value.batch;
          if(value.start!==result.length||!Array.isArray(batch)||batch.length<1||batch.length>32||
            result.length+batch.length>lines.length||batch.some(line=>typeof line!=="string"||!line.trim()||line.length>4000))
            throw Error("Invalid translation batch");
          totalBytes+=Buffer.byteLength(JSON.stringify(batch),"utf8");
          if(totalBytes>8*1024*1024)throw Error("Translation output too large");
          result.push(...batch);
          if(!event.sender.isDestroyed())
            event.sender.send("dk-library:translation-progress",{ticket,start:value.start,batch,done:result.length,total:lines.length});
        }catch(_){failed=true;child.kill("SIGKILL");}
      }
    });
    child.stderr.resume();
    child.stdin.on("error",()=>{});
    child.on("error",()=>{failed=true;});
    child.on("close",code=>{
      clearTimeout(timer);
      if(translationJob===job)translationJob=null;
      if(code!==0||failed||!Array.isArray(result)||result.length!==lines.length||
        result.some(line=>typeof line!=="string"||!line.trim()||line.length>4000))
        reject(Error("Local translation failed or was cancelled"));
      else resolve(result);
    });
    child.stdin.end(JSON.stringify(lines));
  });
}


// DK Voiceover stage 1: timed text -> local bilingual translation -> timed
// mono WAV. No source file access, network API, downloads or arbitrary commands.
// The separately provisioned TTS package/model must be explicitly installed.
let voiceoverJob=null,voiceoverResult=null,voiceoverExporting=false;
const voiceoverWorker=String.raw`
import json, sys, wave
from pathlib import Path
import numpy as np
import ctranslate2
import sentencepiece as spm
import sherpa_onnx
translation=Path(sys.argv[1])
voice=Path(sys.argv[2])
output=sys.argv[3]
rows=json.load(sys.stdin)
source=spm.SentencePieceProcessor(model_file=str(translation/"source.model"))
target=spm.SentencePieceProcessor(model_file=str(translation/"target.model"))
engine=ctranslate2.Translator(str(translation/"model"),device="cpu",inter_threads=1,intra_threads=2)
texts=[]
for i in range(0,len(rows),32):
    tokens=[source.encode(r["text"],out_type=str) for r in rows[i:i+32]]
    if any(len(t)>512 for t in tokens):
        raise ValueError("Input exceeds model token limit")
    decoded=engine.translate_batch(tokens,beam_size=2,max_input_length=512,max_decoding_length=512)
    texts.extend(target.decode(r.hypotheses[0]) for r in decoded)
    print(json.dumps({"stage":"translation","done":len(texts),"total":len(rows)}),flush=True)
del engine
config=sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(
        vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=str(voice/"model.onnx"),tokens=str(voice/"tokens.txt"),data_dir=str(voice/"espeak-ng-data")),
        num_threads=2,provider="cpu"))
if not config.validate():
    raise ValueError("Invalid voice model")
tts=sherpa_onnx.OfflineTts(config)
rate=int(tts.sample_rate)
if not 8000<=rate<=32000:
    raise ValueError("Unsupported sample rate")
cursor=0
skipped=0
silence=b"\0"*(rate*2)
def pad(wav,n):
    while n>0:
        chunk=min(n,rate)
        wav.writeframesraw(silence[:chunk*2])
        n-=chunk
with wave.open(output,"wb") as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(rate)
    for i,(row,text) in enumerate(zip(rows,texts)):
        start=max(cursor,round(row["start"]*rate))
        end=round(row["end"]*rate)
        if i+1<len(rows):
            end=min(end,round(rows[i+1]["start"]*rate))
        room=end-start
        if room>rate/10 and text.strip():
            audio=tts.generate(text=text,sid=0,speed=1.0)
            if len(audio.samples)>room:
                speed=min(1.45,max(1.05,len(audio.samples)/room*1.03))
                audio=tts.generate(text=text,sid=0,speed=speed)
            samples=np.asarray(audio.samples,dtype=np.float32)
            if int(audio.sample_rate)==rate and 0<len(samples)<=room and np.isfinite(samples).all():
                pad(wav,start-cursor)
                wav.writeframesraw((np.clip(samples,-1,1)*32767).astype("<i2").tobytes())
                cursor=start+len(samples)
            else:
                skipped+=1
        else:
            skipped+=1
        print(json.dumps({"stage":"speech","done":i+1,"total":len(rows),"skipped":skipped}),flush=True)
    last=round(max(r["end"] for r in rows)*rate)
    pad(wav,max(0,last-cursor))
if skipped==len(rows):
    raise ValueError("No speech could fit the cue timing")
print(json.dumps({"stage":"complete","done":len(rows),"total":len(rows),"skipped":skipped}),flush=True)
`;
function voiceoverPaths(pair){
  const runtime=translationPaths(pair);
  const root=path.dirname(path.dirname(runtime.model));
  const voice=path.join(root,"voices",pair.split("-")[1]);
  const ready=runtime.ready&&[path.join(voice,"READY.json"),path.join(voice,"model.onnx"),path.join(voice,"tokens.txt"),path.join(voice,"espeak-ng-data")].every(p=>fs.existsSync(p));
  return {...runtime,voice,ready};
}
function discardVoiceover(){
  if(voiceoverJob){voiceoverJob.cancelled=true;voiceoverJob.child?.kill("SIGKILL");}
  if(voiceoverResult&&!voiceoverExporting){
    fs.rmSync(voiceoverResult.dir,{recursive:true,force:true});voiceoverResult=null;
  }
}
function generateVoiceover(event,pair,rows,ticket){
  const runtime=voiceoverPaths(pair);
  if(!runtime.ready)throw Error("Voiceover runtime is not installed");
  if(voiceoverJob||translationJob||voiceoverExporting)throw Error("Offline speech or translation job already running");
  if(!Number.isSafeInteger(ticket)||ticket<1||!Array.isArray(rows)||!rows.length||rows.length>6000||
    Buffer.byteLength(JSON.stringify(rows),"utf8")>2*1024*1024||
    rows.some((r,i)=>!r||!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end<=r.start||r.end>10800||
      (i>0&&r.start<rows[i-1].start)||typeof r.text!=="string"||!r.text.trim()||r.text.length>1000))
    throw Error("Invalid voiceover cues");
  discardVoiceover();
  const dir=fs.mkdtempSync(path.join(app.getPath("temp"),"dk-voiceover-"));
  const output=path.join(dir,"voiceover.wav");
  return new Promise((resolve,reject)=>{
    let child;
    try{child=spawn(runtime.python,["-I","-c",voiceoverWorker,runtime.model,runtime.voice,output],{
      shell:false,stdio:["pipe","pipe","pipe"],env:{...process.env,LD_LIBRARY_PATH:"",PYTHONNOUSERSITE:"1",OMP_NUM_THREADS:"2",HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1"}
    });}catch(error){fs.rmSync(dir,{recursive:true,force:true});reject(error);return;}
    const job={child,cancelled:false};voiceoverJob=job;
    let pending="",complete=null,failed=false;
    const timer=setTimeout(()=>child.kill("SIGKILL"),90*60*1000);
    child.stdout.setEncoding("utf8");child.stderr.resume();
    child.stdout.on("data",chunk=>{
      pending+=chunk;if(pending.length>65536){failed=true;child.kill("SIGKILL");return;}
      let end;
      while((end=pending.indexOf("\n"))>=0){
        const line=pending.slice(0,end);pending=pending.slice(end+1);
        try{
          const value=JSON.parse(line);
          if(!["translation","speech","complete"].includes(value.stage)||!Number.isInteger(value.done)||value.done<0||
             value.done>rows.length||value.total!==rows.length)throw Error("Invalid worker progress");
          const skipped=Number.isInteger(value.skipped)?Math.max(0,Math.min(rows.length,value.skipped)):0;
          if(value.stage==="complete")complete={skipped};
          if(!event.sender.isDestroyed())event.sender.send("dk-library:voiceover-progress",{ticket,stage:value.stage,done:value.done,total:rows.length,skipped});
        }catch(_){failed=true;child.kill("SIGKILL");}
      }
    });
    child.stdin.on("error",()=>{});child.on("error",()=>{failed=true;});
    child.on("close",code=>{
      clearTimeout(timer);if(voiceoverJob===job)voiceoverJob=null;
      let stat;try{stat=fs.statSync(output);}catch(_){}
      if(code!==0||failed||job.cancelled||!complete||!stat?.isFile()||stat.size<44||stat.size>700*1024*1024){
        fs.rmSync(dir,{recursive:true,force:true});reject(Error("Voiceover generation failed or was cancelled"));return;
      }
      voiceoverResult={dir,output,ticket};
      resolve({skipped:complete.skipped,total:rows.length});
    });
    child.stdin.end(JSON.stringify(rows));
  });
}

let externalSelections=[],externalWork=Promise.resolve();
let installed=false,home=null,player=null,playerFile=null,playerLoading=null,activePage="library",scanActive=false;
let scanController=null,scanPromise=null;
let metadataBusy=0;
let libraryView={mode:"movie",series:null,season:null};
let navHistory=[],navIndex=-1,lastNavigationInput=null;
function recordNavigation(page){
  const entry={page,view:{...libraryView}};
  if(JSON.stringify(navHistory[navIndex])===JSON.stringify(entry))return;
  navHistory=navHistory.slice(0,navIndex+1);
  navHistory.push(entry);
  if(navHistory.length>150)navHistory.shift();
  navIndex=navHistory.length-1;
}
function recordLibraryView(value){
  if(!value||!["movie","tv"].includes(value.mode))return false;
  libraryView={mode:value.mode,series:value.mode==="tv"&&typeof value.series==="string"?value.series.slice(0,300):null,
    season:Number.isInteger(value.season)&&value.season>=0?value.season:null};
  if(activePage==="library")recordNavigation("library");
  return true;
}
async function navigateHistory(direction,origin="renderer"){
  // Some desktop window managers also deliver app-command for the same
  // physical mouse event. Suppress only the cross-channel duplicate.
  const now=Date.now();
  if(lastNavigationInput?.direction===direction&&lastNavigationInput.origin!==origin&&now-lastNavigationInput.time<220)return false;
  lastNavigationInput={direction,origin,time:now};
  if(![-1,1].includes(direction)||navIndex+direction<0||navIndex+direction>=navHistory.length)return false;
  const next=navHistory[navIndex+direction];
  if(next.page==="player"&&!installedWindow())return false;
  navIndex+=direction;
  libraryView={...next.view};
  if(next.page==="library"){
    if(home.isFullScreen())home.setFullScreen(false);
    home.webContents.send("dk-library:restore-navigation",libraryView);
  }
  return showPage(next.page,false);
}
let maintenanceBusy=false;
let metadataRefreshing=false;
function maintenanceStatus(value){
  if(installedWindow())player.webContents.send("dk-library:maintenance-status",value);
}

// Only explicitly selected files receive a restore grant. Keep live grants
// for the session, but persist only the most recently selected file.
// These grants never authorize Library deletion or directory enumeration.
const restoreGrants=new Map();
const rememberedPath=()=>path.join(app.getPath("userData"),"last-selected-media.json");
function verifiedRecord(record){
  if(!record||typeof record.path!=="string"||record.path.length>4096||
    !path.isAbsolute(record.path)||record.path.includes("\0")||
    !/^restore:[a-f0-9]{64}$/.test(record.id||"")||
    !Number.isSafeInteger(record.size)||record.size<0||!Number.isFinite(record.modified)||
    typeof record.key!=="string"||record.key.length>8192)
    throw Error("Invalid saved file");
  const stat=fs.statSync(record.path);
  if(!stat.isFile()||stat.size!==record.size||Math.abs(stat.mtimeMs-record.modified)>1||
     path.basename(record.path)!==record.name||
     record.key!=="file:"+record.name+":"+record.size+":"+record.modified)
    throw Error("Saved file is missing or has changed");
  return {target:record.path,stat};
}
async function checkPlayableSource(id,filePath){
  if(!String(id).startsWith("restore:"))return native.checkVideo(id,filePath);
  const record=restoreGrants.get(id);
  if(!record||record.path!==filePath)throw Error("File restore grant rejected");
  return verifiedRecord(record);
}
async function rememberMedia(source,key){
  if(!source||typeof source!=="object"||typeof source.path!=="string"||
    !path.isAbsolute(source.path)||source.path.length>4096||source.path.includes("\0"))
    return false;
  if(source.kind==="native")await checkPlayableSource(source.id,source.path);
  else if(source.kind!=="picked")return false;
  const record={id:"restore:"+randomBytes(32).toString("hex"),path:source.path,
    name:source.name,size:source.size,modified:source.modified,key};
  verifiedRecord(record);
  const dest=rememberedPath(),temp=dest+".tmp";
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.writeFileSync(temp,JSON.stringify(record),{mode:0o600});
  fs.renameSync(temp,dest);
  return true;
}
function restoreMedia(key){
  let record;
  try{record=JSON.parse(fs.readFileSync(rememberedPath(),"utf8"));}
  catch(_){return null;}
  if(record.key!==key)return null;
  verifiedRecord(record);
  restoreGrants.set(record.id,record);
  return {row:{id:record.id,nativePath:record.path,filename:record.name,
    size:record.size,modified:record.modified},opened:{
    url:pathToFileURL(record.path).href,name:record.name,nativePath:record.path,
    size:record.size,modified:record.modified}};
}
async function readPlayableRange(id,filePath,start,end){
  if(!String(id).startsWith("restore:"))return native.readRange(id,filePath,start,end);
  const {target,stat}=await checkPlayableSource(id,filePath);
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||
     end<start||end>stat.size||end-start>8*1024*1024)throw Error("Invalid media byte range");
  const handle=await fs.promises.open(target,"r");
  try{
    const bytes=Buffer.alloc(end-start);
    let used=0;
    while(used<bytes.length){
      const {bytesRead}=await handle.read(bytes,used,bytes.length-used,start+used);
      if(!bytesRead)break;
      used+=bytesRead;
    }
    return new Uint8Array(bytes.subarray(0,used));
  }finally{await handle.close();}
}

async function metadataRequest(raw,kind){
  if(typeof raw!=="string"||raw.length>1500||!["json","image"].includes(kind))throw Error("Invalid metadata request");
  const url=new URL(raw);
  const h=url.hostname;
  const json=kind==="json"&&(
    (h==="v3-cinemeta.strem.io"&&(url.pathname.startsWith("/catalog/movie/top/search=")||/^\/meta\/movie\/tt\d{6,11}\.json$/.test(url.pathname)))||
    (h==="itunes.apple.com"&&url.pathname==="/search")||
    (h==="api.tvmaze.com"&&(/^\/search\/shows$/.test(url.pathname)||/^\/shows\/\d+\/episodes$/.test(url.pathname))));
  const image=kind==="image"&&(["images.metahub.space","static.tvmaze.com","images.tvmaze.com","image.tmdb.org"].includes(h)||/^(?:is\d+-ssl|a\d+|is\d+)\.mzstatic\.com$/.test(h));
  if(url.protocol!=="https:"||url.username||url.password||url.port||(!json&&!image))throw Error("Metadata provider rejected");
  if(metadataBusy>=4)return {ok:false,status:429};
  metadataBusy++;
  try{
    let target=url,response;
    for(let hop=0;hop<4;hop++){
      response=await fetch(target,{redirect:"manual",credentials:"omit",signal:AbortSignal.timeout(15000)});
      if(![301,302,303,307,308].includes(response.status))break;
      const next=new URL(response.headers.get("location")||"",target);
      await response.body?.cancel();
      const permitted=kind==="image"&&(["images.metahub.space","static.tvmaze.com","images.tvmaze.com","image.tmdb.org"].includes(next.hostname)||/^(?:is\d+-ssl|a\d+|is\d+)\.mzstatic\.com$/.test(next.hostname));
      if(!permitted||next.protocol!=="https:"||next.username||next.password||next.port)return {ok:false,status:502};
      target=next;
    }
    if(!response.ok)return {ok:false,status:response.status};
    const limit=3*1024*1024;
    const mime=(response.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
    if(kind==="image"&&!/^image\/(jpeg|png|webp)$/.test(mime))return {ok:false,status:415};
    if(Number(response.headers.get("content-length"))>limit)return {ok:false,status:413};
    const reader=response.body?.getReader();
    if(!reader)return {ok:false,status:502};
    const chunks=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
      if(size>limit){await reader.cancel();return {ok:false,status:413};}chunks.push(Buffer.from(value));}
    const data=Buffer.concat(chunks);
    return kind==="json"?{ok:true,status:200,text:data.toString("utf8")}:{ok:true,status:200,mime,bytes:new Uint8Array(data)};
  }catch(_){return {ok:false,status:502};}
  finally{metadataBusy--;}
}
function onlyPlayer(event){
  return player&&!player.webContents.isDestroyed()&&
    event.sender===player.webContents&&
    event.senderFrame?.url?.startsWith("file://")&&
    event.senderFrame.url.includes("/index.html");
}
function allowed(event){
  if(!home||home.isDestroyed()||event.sender!==home.webContents)return false;
  const frame=event.senderFrame?.url||"";
  return frame.startsWith("file://")&&frame.includes("/library.html");
}
function installedWindow(){
  return player&&!player.webContents.isDestroyed();
}
function resizePlayer(){
  if(!home||home.isDestroyed()||!installedWindow())return;
  const [width,height]=home.getContentSize();
  player.setBounds({x:0,y:0,width,height});
}
function focusWindow(win){
  if(win.isMinimized())win.restore();
  win.show();win.focus();
}
function showPage(page,remember=true){
  if(!home||home.isDestroyed())return false;
  if(page==="player"&&!installedWindow())return false;
  activePage=page;
  if(remember)recordNavigation(page);
  if(installedWindow()){
    resizePlayer();
    player.setVisible(page==="player");
  }
  focusWindow(home);
  if(page==="player")player.webContents.focus();
  else home.webContents.focus();
  return true;
}
async function openPlayer(id,external=false,settingsOnly=false){
  if(!home||home.isDestroyed())throw Error("Library window was closed");
  const nav=id===null&&!external;
  if(!nav&&(typeof id!=="string"||id.length<1||id.length>500||id.includes("\0")))
    throw Error("Invalid library selection");
  if(installedWindow()){
    if(playerLoading)await playerLoading;
    if(settingsOnly)return true;
    showPage("player");
    if(nav)player.webContents.send("dk-library:activate-player");
    if(external)player.webContents.send("dk-library:external-ready");
    else if(!nav)player.webContents.send("dk-library:selection",id);
    return true;
  }
  if(typeof WebContentsView!=="function")throw Error("Installed Electron does not support internal player views");
  const originalPrefs=home.webContents.getLastWebPreferences?.()||{};
  const appRoot=app.getAppPath();
  const preload=[originalPrefs.preload,path.join(appRoot,"preload.cjs"),path.join(appRoot,"preload.js")]
    .filter(Boolean).find(candidate=>{
      try{return fs.statSync(candidate).isFile()&&fs.readFileSync(candidate,"utf8").includes("DKStandalone");}
      catch(_){return false;}
    });
  if(!preload)throw Error("Original DKStandalone preload missing");
  const view=new WebContentsView({webPreferences:{
    preload,contextIsolation:true,nodeIntegration:false,
    sandbox:originalPrefs.sandbox===true,session:home.webContents.session,
    backgroundThrottling:false
  }});
  player=view;
  home.contentView.addChildView(view);
  resizePlayer();
  view.setVisible(false);
  view.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  view.webContents.on("will-navigate",(event,url)=>{
    try{if(fileURLToPath(url)!==playerFile)event.preventDefault();}
    catch(_){event.preventDefault();}
  });
  if(fs.existsSync(path.join(appRoot,"desktop","codec-host.cjs")))
    require("./codec-host.cjs").install(home,view.webContents);
  const options=settingsOnly?{query:{settingsOnly:"1"}}:nav?{}:{query:external?{externalItem:id}:{libraryItem:id}};
  playerLoading=view.webContents.loadFile(playerFile,options);
  try{
    await playerLoading;
    if(home.isDestroyed())return false;
    if(!settingsOnly)showPage("player");
    view.webContents.send("dk-library:scan-state",scanActive);
    view.webContents.send("dk-library:maintenance-status",{action:metadataRefreshing?"refresh":"trash",busy:maintenanceBusy,done:0,total:0});
    return true;
  }finally{playerLoading=null;}
}
async function openExternal(argv,cwd){
  const entries=[],seen=new Set();
  for(const arg of argv.slice(1)){
    if(typeof arg!=="string"||arg.startsWith("-"))continue;
    try{
      const target=arg.startsWith("file://")?fileURLToPath(arg):path.resolve(cwd,arg);
      const id=native.fileIdentity(target);
      if(seen.has(id))continue;
      const opened=await native.openVideo(id,target);
      seen.add(id);
      entries.push({row:{id,nativePath:target,filename:opened.name,
        size:opened.size,modified:opened.modified},opened});
      if(entries.length>=256)break;
    }catch(_){/* Ignore non-media arguments and out-of-scope paths. */}
  }
  if(!entries.length||!home||home.isDestroyed())return false;
  externalSelections.push(...entries);
  if(installedWindow()){
    await openPlayer("pending",true);
  }else{
    await openPlayer("pending",true);
  }
  return true;
}
function enqueueExternal(argv,cwd){
  externalWork=externalWork.catch(()=>{}).then(()=>openExternal(argv,cwd));
  void externalWork.catch(()=>{});
}
function install(originalWindow,originalPlayer){
  if(installed)return;
  if(!originalWindow?.webContents||typeof originalPlayer!=="string")
    throw new Error("Existing DK Kinehall window was not provided");
  installed=true;home=originalWindow;playerFile=originalPlayer;
  home.setTitle("DK Kinehall v"+VERSION);
  home.on("page-title-updated",event=>{event.preventDefault();home?.setTitle("DK Kinehall v"+VERSION);});
  home.on("resize",resizePlayer);
  home.on("app-command",(event,command)=>{
    if(command!=="browser-backward"&&command!=="browser-forward")return;
    event.preventDefault?.();void navigateHistory(command==="browser-backward"?-1:1,"window");
  });
  for(const event of ["enter-full-screen","leave-full-screen"])home.on(event,()=>{
    resizePlayer();
    if(installedWindow())player.webContents.send("dk-library:fullscreen-state",home.isFullScreen());
  });
  if(!app.requestSingleInstanceLock()){app.quit();return;}
  app.on("second-instance",(_event,argv,cwd)=>enqueueExternal(argv,cwd));
  ipcMain.handle("dk-network:discover",event=>{
    if(!onlyPlayer(event))throw Error("Network request rejected");return discoverNetwork();
  });
  ipcMain.handle("dk-network:description",(event,id)=>{
    if(!onlyPlayer(event))throw Error("Network request rejected");return networkDescription(id);
  });
  ipcMain.handle("dk-network:browse",(event,id,control,type,objectId,start)=>{
    if(!onlyPlayer(event))throw Error("Network request rejected");return browseNetwork(id,control,type,objectId,start);
  });
  ipcMain.handle("dk-network:grant",(event,id,url)=>{
    if(!onlyPlayer(event))throw Error("Network request rejected");return grantNetwork(id,url);
  });
  ipcMain.handle("dk-network:release",(event,token)=>{
    if(!onlyPlayer(event))return false;return networkGrants.delete(token);
  });
  ipcMain.handle("dk-library:open-acp",async event=>{
    if(!allowed(event)&&!onlyPlayer(event))throw Error("External link rejected");
    await shell.openExternal("https://acp.us/");
    return true;
  });
  ipcMain.handle("dk-library:record-navigation",(event,value)=>{
    if(!allowed(event))throw Error("Navigation rejected");
    return recordLibraryView(value);
  });
  ipcMain.handle("dk-library:navigate-history",(event,direction)=>{
    if(!onlyPlayer(event)&&!allowed(event))throw Error("Navigation rejected");
    return navigateHistory(direction);
  });
  ipcMain.handle("dk-library:maintenance-request",async(event,action,language)=>{
    if(!onlyPlayer(event)&&!allowed(event))throw Error("Library maintenance rejected");
    if(!["trash","refresh"].includes(action))throw Error("Invalid library maintenance command");
    if(action==="refresh"&&metadataRefreshing){
      home.webContents.send("dk-library:maintenance-request","refresh");return true;
    }
    if(scanActive||maintenanceBusy)return false;
    if(action==="trash"){
      maintenanceBusy=true;
      try{
        const ru=language==="ru";
        const result=await dialog.showMessageBox(home,{type:"warning",
          title:ru?"Очистить корзину":"Empty Trash",
          message:ru?"Удалить недоступные записи из медиатеки?":"Remove unavailable library records?",
          detail:ru?"Видеофайлы не удаляются. История просмотра недоступных файлов может быть потеряна. Подключите отключённые накопители и сначала выполните проверку.":"No video files are deleted. Viewing history for removed records may be lost. Reconnect any disconnected drives and scan first.",
          buttons:ru?["Отмена","Очистить корзину"]:["Cancel","Empty Trash"],
          defaultId:0,cancelId:0,noLink:true});
        if(result.response!==1){maintenanceBusy=false;return false;}
      }catch(error){maintenanceBusy=false;throw error;}
    }else{maintenanceBusy=true;metadataRefreshing=true;}
    maintenanceStatus({action,busy:true});
    home.webContents.send("dk-library:maintenance-request",action);
    return true;
  });
  ipcMain.handle("dk-library:maintenance-status",(event,value)=>{
    if(!allowed(event))throw Error("Library maintenance status rejected");
    if(!value||!["trash","refresh"].includes(value.action))return false;
    maintenanceBusy=Boolean(value.busy);
    if(value.action==="refresh")metadataRefreshing=maintenanceBusy;
    maintenanceStatus({action:value.action,busy:maintenanceBusy,
      done:Number(value.done)||0,total:Number(value.total)||0,
      removed:Number(value.removed)||0,merged:Number(value.merged)||0,
      failed:Boolean(value.failed),cancelled:Boolean(value.cancelled)});
    return true;
  });
  ipcMain.handle("dk-library:translation-status",(event,pair)=>{
    if(!onlyPlayer(event))throw Error("Translation command rejected");
    return translationPaths(pair).ready;
  });
  ipcMain.handle("dk-library:translate",(event,pair,lines,ticket)=>{
    if(!onlyPlayer(event))throw Error("Translation command rejected");
    return translateLocal(event,pair,lines,ticket);
  });
  let exportingSubtitles=false;
  ipcMain.handle("dk-library:export-translated-srt",async(event,content,language)=>{
    if(!onlyPlayer(event)||exportingSubtitles||typeof content!=="string"||!content.trim()||
       Buffer.byteLength(content,"utf8")>8*1024*1024)throw Error("Subtitle export rejected");
    exportingSubtitles=true;
    try{
      const ru=language==="ru";
      const chosen=await dialog.showSaveDialog(home,{title:ru?"Сохранить переведённые субтитры":"Save translated subtitles",
        defaultPath:"translated-subtitles.srt",filters:[{name:ru?"Субтитры СРТ":"SRT subtitles",extensions:["srt"]}]});
      if(chosen.canceled||!chosen.filePath)return false;
      if(!/\.srt$/i.test(chosen.filePath))throw Error("SRT extension required");
      // Never overwrite an existing original subtitle, even after dialog confirmation.
      await fs.promises.writeFile(chosen.filePath,content,{encoding:"utf8",flag:"wx",mode:0o600});
      return true;
    }finally{exportingSubtitles=false;}
  });
  ipcMain.handle("dk-library:cancel-translation",event=>{
    if(!onlyPlayer(event))throw Error("Translation command rejected");
    cancelTranslation();return true;
  });
  ipcMain.handle("dk-library:voiceover-status",(event,pair)=>{
    if(!onlyPlayer(event))throw Error("Voiceover request rejected");
    return voiceoverPaths(pair).ready;
  });
  ipcMain.handle("dk-library:voiceover-generate",(event,pair,rows,ticket)=>{
    if(!onlyPlayer(event))throw Error("Voiceover request rejected");
    return generateVoiceover(event,pair,rows,ticket);
  });
  ipcMain.handle("dk-library:voiceover-discard",event=>{
    if(!onlyPlayer(event))throw Error("Voiceover request rejected");
    discardVoiceover();return true;
  });
  ipcMain.handle("dk-library:voiceover-export",async(event,ticket,language)=>{
    if(!onlyPlayer(event)||voiceoverExporting||voiceoverJob||!voiceoverResult||voiceoverResult.ticket!==ticket)throw Error("Voiceover export rejected");
    const result=voiceoverResult;voiceoverExporting=true;
    try{
      const ru=language==="ru";
      const chosen=await dialog.showSaveDialog(home,{title:ru?"Сохранить озвучивание":"Save voiceover",defaultPath:"voiceover.wav",filters:[{name:ru?"Звуковой файл ВАВ":"WAV audio",extensions:["wav"]}]});
      if(chosen.canceled||!chosen.filePath)return false;
      if(!/\.wav$/i.test(chosen.filePath))throw Error("WAV extension required");
      await fs.promises.copyFile(result.output,chosen.filePath,fs.constants.COPYFILE_EXCL);
      return true;
    }finally{voiceoverExporting=false;}
  });
  home.on("closed",()=>{cancelTranslation();discardVoiceover();});
  ipcMain.handle("dk-library:remember-media",async(event,source,key)=>{
    if(!onlyPlayer(event))throw Error("Media restore request rejected");
    return rememberMedia(source,key);
  });
  ipcMain.handle("dk-library:restore-media",(event,key)=>{
    if(!onlyPlayer(event))throw Error("Media restore request rejected");
    return restoreMedia(key);
  });
  ipcMain.handle("dk-library:forget-media",event=>{
    if(!onlyPlayer(event))throw Error("Media restore request rejected");
    try{fs.unlinkSync(rememberedPath());}catch(error){if(error.code!=="ENOENT")throw error;}
    return true;
  });
  ipcMain.handle("dk-library:external-selection",event=>{
    if(!onlyPlayer(event))throw Error("External selection rejected");
    return externalSelections.splice(0);
  });
  enqueueExternal(process.argv,process.cwd());
  ipcMain.handle("dk-library:open-player",(event,id)=>{
    if(!allowed(event))throw new Error("Library command rejected");
    return openPlayer(id);
  });
  ipcMain.handle("dk-library:metadata-request",(event,url,kind)=>{
    if(!allowed(event))throw Error("Metadata request rejected");
    return metadataRequest(url,kind);
  });
  // Use the existing persistent Player renderer as the sole settings owner.
  // Library requests are limited to its explicit shared settings API, never
  // renderer-provided JavaScript, selectors or localStorage keys.
  ipcMain.handle("dk-library:open-media-tool",async(event,kind)=>{
    if(!allowed(event)||activePage!=="library"||!["network","disc"].includes(kind))throw Error("Media tool request rejected");
    await openPlayer(null,false,true);
    if(!installedWindow()||activePage!=="library")throw Error("Player unavailable");
    showPage("player");
    player.webContents.send("dk-library:open-media-tool",kind);
    return true;
  });
  ipcMain.handle("dk-library:settings-open",async(event,language)=>{
    if(!allowed(event)||activePage!=="library")throw Error("Settings request rejected");
    await openPlayer(null,false,true);
    if(!installedWindow()||activePage!=="library")throw Error("Settings unavailable");
    return player.webContents.executeJavaScript("window.DKSharedSettings.snapshot("+JSON.stringify(language==="ru"?"ru":"en")+")");
  });
  ipcMain.handle("dk-library:settings-change",async(event,id,action,value)=>{
    if(!allowed(event)||activePage!=="library"||!installedWindow()||
       typeof id!=="string"||!/^shared-\d+$/.test(id)||!["change","click"].includes(action)||
       !(typeof value==="boolean"||typeof value==="string"&&value.length<=200||value===null))
      throw Error("Settings request rejected");
    return player.webContents.executeJavaScript("window.DKSharedSettings.change("+[id,action,value].map(v=>JSON.stringify(v)).join(",")+")");
  });
  ipcMain.handle("dk-library:show-player",event=>{
    if(!allowed(event))throw new Error("Library navigation rejected");
    return openPlayer(null);
  });
  ipcMain.handle("dk-library:player-fullscreen",(event,value)=>{
    if(!onlyPlayer(event)||activePage!=="player")throw Error("Fullscreen rejected");
    home.setFullScreen(Boolean(value));return Boolean(value);
  });
  ipcMain.handle("dk-library:request-scan",event=>{
    if(!onlyPlayer(event))throw Error("Scan request rejected");
    home.webContents.send("dk-library:scan-request");return true;
  });
  ipcMain.handle("dk-library:scan-state",(event,value)=>{
    if(!allowed(event))throw Error("Scan state rejected");
    scanActive=Boolean(value);
    if(installedWindow())player.webContents.send("dk-library:scan-state",scanActive);
    return true;
  });
  // The native app discovers the local filesystem directly. The renderer
  // receives small metadata records, never video bytes or root access.
  // Optional packaged FFprobe. No system installation or binary download.
  const probeBin=path.join(app.getAppPath(),"bin","ffprobe");
  let probeAvailable=false;
  try{fs.accessSync(probeBin,fs.constants.X_OK);probeAvailable=true;}catch(_){}
  const probeLibraryVideo=(file,signal)=>new Promise(resolve=>{
    let child;try{child=spawn(probeBin,["-v","error","-select_streams","v","-show_entries","stream=codec_type:stream_disposition=attached_pic:format=duration","-of","json","-i",file],{
      shell:false,stdio:["ignore","pipe","ignore"],env:{...process.env,LD_LIBRARY_PATH:path.join(app.getAppPath(),"lib")+path.delimiter+(process.env.LD_LIBRARY_PATH||"")}
    });}catch(_){resolve(null);return;}
    let done=false,output="";
    const finish=result=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener("abort",abort);resolve(result);};
    const abort=()=>{child.kill("SIGKILL");finish(null);};
    const timer=setTimeout(abort,2500);
    signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();
    child.stdout.on("data",chunk=>{output+=chunk;if(output.length>65536)abort();});
    child.on("error",()=>finish(null));
    child.on("close",code=>{
      if(code!==0){finish(null);return;}
      try{const info=JSON.parse(output);finish(Array.isArray(info.streams)&&info.streams.some(stream=>stream.codec_type==="video"&&!Number(stream.disposition?.attached_pic)));}
      catch(_){finish(null);}
    });
  });
  ipcMain.handle("dk-library:discover",async(event,manual=false)=>{
    if(!allowed(event))throw Error("Native discovery rejected");
    if(scanPromise)return scanPromise;
    scanController=new AbortController();
    scanPromise=native.discover({
      manual:Boolean(manual),signal:scanController.signal,probe:probeAvailable?probeLibraryVideo:null,
      onProgress:p=>{
        if(home&&!home.isDestroyed())
          home.webContents.send("dk-library:scan-progress",p);
      }
    });
    try{return await scanPromise;}
    finally{scanPromise=null;scanController=null;}
  });
  ipcMain.handle("dk-library:cancel-scan",event=>{
    if(!allowed(event))throw Error("Scan cancellation rejected");
    if(scanController)scanController.abort();
    return true;
  });
  ipcMain.handle("dk-library:native-open",(event,id,filePath)=>{
    if(!onlyPlayer(event))throw Error("Native media launch rejected");
    return native.openVideo(id,filePath);
  });
  ipcMain.handle("dk-library:read-range",(event,id,filePath,start,end)=>{
    if(!onlyPlayer(event))throw Error("Native media access rejected");
    return readPlayableRange(id,filePath,start,end);
  });
  ipcMain.handle("dk-library:local-cover",(event,id,filePath,series,kind)=>{
    if(!allowed(event))throw Error("Local artwork request rejected");
    return native.localArtwork(id,filePath,{
      series:Boolean(series),kind:kind==="tv"?"tv":"movie"});
  });
  ipcMain.handle("dk-library:delete-video",(event,id,filePath)=>{
    if(!allowed(event))throw Error("Native deletion rejected");
    return native.deleteVideo(id,filePath,{dialog,shell,window:home});
  });
  ipcMain.handle("dk-library:show-home",event=>{
    if(!home||home.isDestroyed())return false;
    // A request from the video player may focus the existing library.
    if(!onlyPlayer(event)&&!allowed(event))return false;
    if(home.isFullScreen())home.setFullScreen(false);
    return showPage("library");
  });
  home.on("closed",()=>{
    closeNetwork();scanController?.abort();
    if(installedWindow())player.webContents.close();
    player=null;home=null;
  });
}
module.exports={install,checkPlayableSource};
