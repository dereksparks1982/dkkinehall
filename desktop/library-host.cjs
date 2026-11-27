"use strict";
/* One native window, persistent Library and Player views. */
const {ipcMain,WebContentsView,app,dialog,shell}=require("electron");
const native=require("./library-indexer.cjs");
const path=require("node:path");
const fs=require("node:fs");
const {fileURLToPath,pathToFileURL}=require("node:url");
const {randomBytes}=require("node:crypto");
const VERSION="0.9.3";
// Native folder chooser is the only discovery configuration. Empty means
// no scanning, never a fallback to home or attached drives.
const sourceFile=()=>path.join(app.getPath("userData"),"library-sources-v1.json");
let librarySources=null;
function getLibrarySources(){
 if(librarySources)return librarySources;
 let rows=[];try{rows=JSON.parse(fs.readFileSync(sourceFile(),"utf8"));}catch(_){}
 librarySources=Array.isArray(rows)?rows.filter(r=>r&&["movie","tv"].includes(r.kind)&&typeof r.path==="string"&&path.isAbsolute(r.path)&&r.path!==path.parse(r.path).root&&r.path.length<=4096&&/^[a-f0-9]{32}$/.test(r.id||"")).slice(0,128):[];
 native.setSelectedRoots(librarySources.map(r=>r.path));return librarySources;
}
function inSource(root,target){
 const rel=path.relative(root,target);return rel===""||(!path.isAbsolute(rel)&&rel!==".."&&!rel.startsWith(".."+path.sep));
}
function saveLibrarySources(rows){
 const dest=sourceFile(),temp=dest+".tmp";fs.mkdirSync(path.dirname(dest),{recursive:true});
 fs.writeFileSync(temp,JSON.stringify(rows),{mode:0o600});fs.renameSync(temp,dest);
 librarySources=rows;native.setSelectedRoots(rows.map(r=>r.path));jfSync(false);return rows;
}

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
// Adapted from the HDHomeRun lineup workflow in DK Media Plus.
// Keep the actual channel URLs in the main process; no arbitrary renderer URLs.
let liveLineup=new Map(),liveLineupBusy=false;
// HDHomeRun discovery wire protocol: https://sources.debian.org/src/libhdhomerun/20220303-3/hdhomerun_pkt.h
// Independently implemented UDP discovery, without an external utility.
function hdhrCRC(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function hdhrDiscoveryPacket(){
  const packet=Buffer.from([0,2,0,12,1,4,0,0,0,1,2,4,255,255,255,255,0,0,0,0]);
  packet.writeUInt32LE(hdhrCRC(packet.subarray(0,16)),16);
  return packet;
}
function hdhrReply(packet){
  if(packet.length<8||packet.length>1460||packet.readUInt16BE(0)!==3)return null;
  const end=4+packet.readUInt16BE(2);
  if(end+4!==packet.length||packet.readUInt32LE(end)!==hdhrCRC(packet.subarray(0,end)))return null;
  let type=null,id=null,count=null;
  for(let i=4;i<end;){
    if(i+2>end)return null;
    const tag=packet[i++];let len=packet[i++];
    if(len&128){if(i>=end)return null;len=(len&127)|(packet[i++]<<7);}
    if(i+len>end)return null;
    if(tag===1&&len===4)type=packet.readUInt32BE(i);
    if(tag===2&&len===4)id=packet.readUInt32BE(i);
    if(tag===16&&len===1)count=packet[i];
    i+=len;
  }
  if(type!==1||!id||id===0xffffffff)return null;
  return {id:id.toString(16).toUpperCase().padStart(8,"0"),count};
}
let liveDiscovery=null;
function discoverLiveTuners(){
  if(liveDiscovery)return liveDiscovery;
  liveDiscovery=new Promise((resolve,reject)=>{
    const socket=netUDP.createSocket("udp4"),found=new Map();
    let done=false,repeat=null;
    const finish=error=>{
      if(done)return;done=true;clearTimeout(timer);clearTimeout(repeat);
      try{socket.close();}catch(_){}
      if(error&&!found.size)reject(error);else resolve(Array.from(found.values()));
    };
    const timer=setTimeout(()=>finish(),2500);
    socket.on("error",finish);
    socket.on("message",(packet,remote)=>{
      if(done||!privateIPv4(remote.address)||remote.port!==65001||found.size>=64)return;
      const device=hdhrReply(packet);if(device)found.set(remote.address,{...device,host:remote.address});
    });
    socket.bind(0,"0.0.0.0",()=>{
      if(done)return;
      try{
        socket.setBroadcast(true);
        const packet=hdhrDiscoveryPacket(),targets=new Set(["255.255.255.255"]);
        for(const entries of Object.values(require("node:os").networkInterfaces())){
          for(const iface of entries||[]){
            if(iface.family!=="IPv4"||iface.internal||!privateIPv4(iface.address))continue;
            const ip=iface.address.split(".").map(Number),mask=iface.netmask.split(".").map(Number);
            if(mask.length===4)targets.add(ip.map((v,i)=>(v|(~mask[i]&255))).join("."));
          }
        }
        const send=()=>{if(!done)for(const target of Array.from(targets).slice(0,16))socket.send(packet,65001,target,()=>{});};
        send();repeat=setTimeout(send,750);
      }catch(error){finish(error);}
    });
  }).finally(()=>{liveDiscovery=null;});
  return liveDiscovery;
}
// Read-only Linux DVB frontend inventory. No tuner is opened or retuned.
async function listLocalTVTuners(){
  if(process.platform!=="linux")return [];
  const fsp=fs.promises,root="/dev/dvb",out=[];
  let adapters;try{adapters=await fsp.readdir(root);}catch(error){if(error.code==="ENOENT")return [];throw error;}
  for(const adapter of adapters.filter(v=>/^adapter\d{1,4}$/.test(v)).slice(0,64)){
    let nodes;try{nodes=await fsp.readdir(path.join(root,adapter));}catch(_){continue;}
    for(const frontend of nodes.filter(v=>/^frontend\d{1,4}$/.test(v)).slice(0,16)){
      if(out.length>=128)return out;
      const dev=path.join(root,adapter,frontend);
      try{if(!(await fsp.lstat(dev)).isCharacterDevice())continue;}catch(_){continue;}
      let accessible=true;try{await fsp.access(dev,fs.constants.R_OK|fs.constants.W_OK);}catch(_){accessible=false;}
      let name="";
      try{
        const sys="/sys/class/dvb/dvb"+adapter.slice(7)+"."+frontend;
        const text=await fsp.readFile(path.join(sys,"name"),"utf8");
        name=text.trim().slice(0,200);
      }catch(_){}
      out.push({adapter:Number(adapter.slice(7)),frontend:Number(frontend.slice(8)),name,accessible});
    }
  }
  return out;
}
let atscJob=null;
const atscBinary=()=>path.join(app.getAppPath(),"bin","dk-atsc");
function atscReady(){try{fs.accessSync(atscBinary(),fs.constants.X_OK);return true;}catch(_){return false;}}
function cancelAtsc(){
  if(!atscJob)return false;
  atscJob.cancelled=true;atscJob.child.kill("SIGTERM");return true;
}
async function runAtsc(action,device,web){
  if(!atscReady()||!["scan","guide","cached"].includes(action)||typeof device!=="string"||!/^adapter\d{1,4}\/frontend\d{1,4}$/.test(device))throw Error("ATSC helper or device unavailable");
  if(atscJob)throw Error("ATSC operation already running");
  const cache=path.join(app.getPath("userData"),"atsc-v1",device.replace("/","-"));
  fs.mkdirSync(cache,{recursive:true,mode:0o700});
  return new Promise((resolve,reject)=>{
    const child=spawn(atscBinary(),[action,device,cache],{stdio:["ignore","pipe","pipe"],shell:false});
    const job={child,cancelled:false};atscJob=job;
    let stdout="",stderr="",done=false,tooLarge=false;
    const timer=setTimeout(()=>{job.cancelled=true;child.kill("SIGKILL");},15*60*1000);
    const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);if(atscJob===job)atscJob=null;err?reject(err):resolve(value);};
    child.stdout.on("data",chunk=>{stdout+=chunk.toString("utf8");if(stdout.length>8*1024*1024){tooLarge=true;child.kill("SIGKILL");}});
    child.stderr.on("data",chunk=>{
      stderr+=chunk.toString("utf8");
      const lines=stderr.split("\n");stderr=lines.pop().slice(-1024);
      for(const line of lines){const m=/^PROGRESS (\d+) (\d+) (\d+)$/.exec(line);if(m&&!web.isDestroyed())web.send("dk-live-tv:atsc-progress",{action,completed:+m[1],total:+m[2],found:+m[3]});}
    });
    child.on("error",error=>finish(error));
    child.on("close",code=>{
      if(job.cancelled)return finish(Error("ATSC operation cancelled"));
      if(code!==0||tooLarge)return finish(Error("ATSC operation failed"));
      try{const data=JSON.parse(stdout);if(!Array.isArray(data.channels)||!Array.isArray(data.programs)||data.channels.length>5000||data.programs.length>50000)throw Error("Invalid ATSC response");finish(null,data);}
      catch(error){finish(error);}
    });
  });
}
async function loadLiveLineup(host){
  if(typeof host!=="string"||!privateIPv4(host))throw Error("Private IPv4 tuner address required");
  if(liveLineupBusy)throw Error("Tuner request busy");
  liveLineupBusy=true;
  try{
    const raw=JSON.parse(await networkRequest(networkURL("http://"+host+"/lineup.json",host)));
    if(!Array.isArray(raw)||raw.length>5000)throw Error("Invalid tuner lineup");
    const next=new Map(),seen=new Set();
    for(const row of raw){
      if(!row||row.DRM===1||row.DRM===true)continue;
      const number=String(row.GuideNumber??"");
      if(!/^\d{1,6}(?:\.\d{1,6})?$/.test(number)||seen.has(number))continue;
      let url;try{url=networkURL(row.URL,host);}catch(_){continue;}
      if(url.protocol!=="http:"||!/^\/auto\/v\d+(?:\.\d+)?$/.test(url.pathname)||url.search)continue;
      const id=randomBytes(16).toString("hex");
      const name=typeof row.GuideName==="string"?row.GuideName.slice(0,200):number;
      seen.add(number);next.set(id,{id,number,name,url:url.href});
    }
    liveLineup=next;
    return Array.from(next.values(),({id,number,name})=>({id,number,name})).sort((a,b)=>a.number.localeCompare(b.number,undefined,{numeric:true}));
  }finally{liveLineupBusy=false;}
}
async function grantLiveChannel(id){
  const row=liveLineup.get(id);if(!row)throw Error("Channel selection expired");
  return grantNetwork(null,row.url);
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
async function registerNetworkServer(value){
  const url=networkURL(value);
  if(networkBrowseBusy>=4)throw Error("Network requests busy");
  networkBrowseBusy++;
  try{
    const xml=await networkRequest(url);
    if(!/ContentDirectory:[1-4]/i.test(xml)||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error("Not a supported media server description");
    const id=randomBytes(18).toString("hex");
    networkServers.set(id,{location:url.href,host:url.hostname});
    if(networkServers.size>128)networkServers.delete(networkServers.keys().next().value);
    return {id,location:url.href,xml};
  }finally{networkBrowseBusy--;}
}
async function networkDescription(id){
  const server=networkServers.get(id);if(!server)throw Error("Network server selection expired");
  if(networkBrowseBusy>=4)throw Error("Network requests busy");
  networkBrowseBusy++;
  try{return {location:server.location,xml:await networkRequest(networkURL(server.location,server.host))};}
  finally{networkBrowseBusy--;}
}
function escapeNetworkXML(value){return value.replace(/[<>&"']/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&apos;"}[c]));}
async function browseNetwork(id,control,type,objectId,start,query=null){
  const server=networkServers.get(id);
  if(!server||typeof type!=="string"||!/^urn:schemas-upnp-org:service:ContentDirectory:[1-4]$/.test(type)||
    typeof objectId!=="string"||objectId.length>1024||!Number.isInteger(start)||start<0||start>100000)
    throw Error("Invalid media browse request");
  if(query!==null&&(typeof query!=="string"||!query.trim()||query.length>150||/[\x00-\x1f"\\]/.test(query)))throw Error("Invalid search text");
  const target=networkURL(control,server.host);
  if(networkBrowseBusy>=4)throw Error("Network requests busy");
  const action=query===null?"Browse":"Search";
  const fields=query===null?'<ObjectID>'+escapeNetworkXML(objectId)+'</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag>':'<ContainerID>'+escapeNetworkXML(objectId)+'</ContainerID><SearchCriteria>'+escapeNetworkXML('dc:title contains "'+query.trim()+'"')+'</SearchCriteria>';
  const body='<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:'+action+' xmlns:u="'+type+'">'+fields+'<Filter>*</Filter><StartingIndex>'+start+'</StartingIndex><RequestedCount>100</RequestedCount><SortCriteria></SortCriteria></u:'+action+'></s:Body></s:Envelope>';
  networkBrowseBusy++;
  try{return await networkRequest(target,{method:"POST",headers:{"Content-Type":"text/xml; charset=utf-8","SOAPACTION":'"'+type+'#'+action+'"',"Content-Length":Buffer.byteLength(body)}},body);}
  finally{networkBrowseBusy--;}
}
// Explicit public destinations are resolved and pinned separately at every hop.
// LAN grants never cross their original host; no user credentials or special networks.
const public4=ip=>{
  if(require("node:net").isIP(ip)!==4)return false;
  const [a,b,c]=ip.split(".").map(Number);
  return a>0&&a<224&&a!==10&&a!==127&&!(a===100&&b>=64&&b<=127)&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||b===0||b===88&&c===99))&&!(a===198&&(b===18||b===19||b===51&&c===100))&&!(a===203&&b===0&&c===113);
};
async function streamTarget(value,lan=null){
  const url=new URL(value);
  if(url.href.length>4096||!["http:","https:"].includes(url.protocol)||url.username||url.password||url.hash)throw Error("Invalid stream address");
  if(lan){if(url.hostname!==lan||!privateIPv4(url.hostname))throw Error("LAN host changed");return {url};}
  const ips=await require("node:dns").promises.lookup(url.hostname,{family:4,all:true});
  if(!ips.length||ips.some(x=>!public4(x.address)))throw Error("Invalid public destination");
  const ip=ips[0].address;
  return {url,lookup:(_host,opts,cb)=>{if(typeof opts==="function"){cb=opts;opts={};}if(opts?.all)cb(null,[{address:ip,family:4}]);else cb(null,ip,4);}};
}
function openStream(target,{method="GET",range,timeout=20000,track=()=>{},signal}={}){
  return new Promise((resolve,reject)=>{
    const lib=target.url.protocol==="https:"?netHTTPS:netHTTP;
    const req=lib.request(target.url,{method,agent:false,signal,headers:{"User-Agent":"DK Kinehall","Accept":"*/*","Accept-Encoding":"identity",...(range?{Range:range}:{})},...(target.lookup?{lookup:target.lookup,family:4}:{})},resolve);
    track(req);req.setTimeout(timeout,()=>req.destroy(Error("Stream timed out")));req.on("error",reject);req.end();
  });
}
async function followStream(value,lan,opts={}){
  let url=new URL(value);
  for(let i=0;i<6;i++){
    const target=await streamTarget(url.href,lan);
    const reply=await openStream(target,opts);
    if(![301,302,303,307,308].includes(reply.statusCode))return {reply,url:target.url};
    const location=reply.headers.location;reply.destroy();
    if(typeof location!=="string"||i===5)throw Error("Redirect limit");
    url=new URL(location,url);
  }
  throw Error("Redirect limit");
}
async function boundedBody(reply,limit){
  const chunks=[];let size=0;
  for await(const chunk of reply){size+=chunk.length;if(size>limit){reply.destroy();throw Error("Response too large");}chunks.push(chunk);}
  return Buffer.concat(chunks);
}
const hlsMime=m=>/^(?:application\/(?:vnd\.apple\.mpegurl|x-mpegurl|mpegurl)|audio\/(?:mpegurl|x-mpegurl))$/i.test(m);
// Reuse completed, small HLS segments between probe and decoder. No
// manifests, keys, range replies or incomplete segments enter this cache.
const tvSegments=new Map();let tvSegmentBytes=0;
function clearTVSegments(token){for(const [k,v] of tvSegments)if(k.startsWith(token+":")){tvSegmentBytes-=v.data.length;tvSegments.delete(k);}}
function saveTVSegment(key,data,headers){
 if(data.length>2*1024**2||!data.length)return;
 const prior=tvSegments.get(key);if(prior){tvSegmentBytes-=prior.data.length;tvSegments.delete(key);}
 tvSegments.set(key,{data,headers,at:Date.now()});tvSegmentBytes+=data.length;
 while(tvSegmentBytes>16*1024**2||tvSegments.size>32){const first=tvSegments.keys().next().value;tvSegmentBytes-=tvSegments.get(first).data.length;tvSegments.delete(first);}
}
// Conservative in-session HLS adaptation. Only independent, unencrypted,
 // muxed MPEG-TS renditions with matching codecs and a verifiable timeline.
 // Preserve the already advertised segment URLs and switch only at a new
 // sequence boundary. Unsupported manifests continue with the fixed rendition.
function parseAlignedLive(text,base){
 const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 if(lines[0]!=="#EXTM3U"||lines.length>400||lines.some(s=>/^#EXT-X-(?!VERSION:|TARGETDURATION:|MEDIA-SEQUENCE:|PROGRAM-DATE-TIME:|INDEPENDENT-SEGMENTS$)/.test(s)))return null;
 let seq=null,target=0,version=3,date=null,duration=null,rows=[];
 for(const line of lines.slice(1)){
  if(line.startsWith("#EXT-X-MEDIA-SEQUENCE:")){seq=Number(line.slice(22));continue;}
  if(line.startsWith("#EXT-X-TARGETDURATION:")){target=Number(line.slice(22));continue;}
  if(line.startsWith("#EXT-X-VERSION:")){version=Number(line.slice(15));continue;}
  if(line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")){date=Date.parse(line.slice(25));if(!Number.isFinite(date))return null;continue;}
  if(line.startsWith("#EXTINF:")){duration=Number(line.slice(8).split(",")[0]);continue;}
  if(line.startsWith("#"))continue;
  if(!Number.isSafeInteger(seq)||seq<0||!Number.isFinite(date)||!Number.isFinite(duration)||duration<=0||duration>30)return null;
  let url;try{url=new URL(line,base);}catch(_){return null;}
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.hash||url.href.length>4096||!/\.ts$/i.test(url.pathname))return null;
  rows.push({seq:seq+rows.length,url:url.href,date,duration});date+=duration*1000;duration=null;
 }
 if(rows.length<3||rows.length>40||!Number.isInteger(target)||target<1||target>30||!Number.isInteger(version)||version<1||version>7)return null;
 return {rows,target,version};
}
function alignedRows(a,b){
 const index=new Map(a.rows.map(r=>[r.seq,r])),overlap=b.rows.filter(r=>index.has(r.seq));
 return overlap.length>=2&&overlap.every(r=>{const other=index.get(r.seq);return Math.abs(r.date-other.date)<=150&&Math.abs(r.duration-other.duration)<=.15;});
}
function adaptiveManifest(state,parsed){
 const old=state.history;
 const latest=parsed.rows.at(-1).seq;
 if(state.first!==undefined&&parsed.rows[0].seq<state.first)return null;
 if(old.size&&latest<state.highest)return null;
 if(old.size&&parsed.rows[0].seq>state.highest+1)return null;
 for(const r of parsed.rows){const prior=old.get(r.seq);if(prior&&(Math.abs(prior.date-r.date)>150||Math.abs(prior.duration-r.duration)>.15))return null;}
 const rows=parsed.rows.map(r=>old.get(r.seq)||r);
 for(const r of rows)old.set(r.seq,r);
 state.highest=Math.max(state.highest,latest);
 while(old.size>80)old.delete(old.keys().next().value);
 const first=rows[0].seq;state.first=first;
 // Every actual switch is represented as a discontinuity at the first
 // newly advertised segment. Keep the sequence count when it ages out.
 const disc=state.boundaries.filter(n=>n<first).length+state.retired;
 const lines=["#EXTM3U","#EXT-X-VERSION:"+Math.max(3,parsed.version),"#EXT-X-TARGETDURATION:"+parsed.target,"#EXT-X-MEDIA-SEQUENCE:"+first,"#EXT-X-DISCONTINUITY-SEQUENCE:"+disc,"#EXT-X-INDEPENDENT-SEGMENTS"];
 for(const r of rows){if(state.boundaries.includes(r.seq))lines.push("#EXT-X-DISCONTINUITY");lines.push("#EXT-X-PROGRAM-DATE-TIME:"+new Date(r.date).toISOString(),"#EXTINF:"+r.duration.toFixed(6)+",",r.url);}
 const expired=state.boundaries.filter(n=>n<first).length;state.retired+=expired;state.boundaries=state.boundaries.filter(n=>n>=first);
 return lines.join("\n")+"\n";
}
function chooseTVVariant(text,entry,base){
 if(!entry.streamPolicy||entry.streamPolicy.quality==="source")return text;
 const lines=text.split(/\r?\n/),variants=[];
 for(let i=0;i<lines.length;i++){
  if(!/^#EXT-X-STREAM-INF:/i.test(lines[i].trim()))continue;
  let end=i+1;while(end<lines.length&&!lines[end].trim())end++;
  if(end>=lines.length||lines[end].trim().startsWith("#"))return text;
  const tag=lines[i],bandwidth=Number(/(?:^|[:,])BANDWIDTH=(\d+)/i.exec(tag)?.[1]),height=Number(/(?:^|[:,])RESOLUTION=\d+x(\d+)/i.exec(tag)?.[1])||0;
  if(!bandwidth)return text;
  let absolute;try{absolute=new URL(lines[end].trim(),base);}catch(_){return text;}
  const codecs=/CODECS="([^"]+)"/i.exec(tag)?.[1]||"";
  variants.push({i,end,url:lines[end].trim(),absolute:absolute.href,bandwidth,height,codecs,external:/[, :]AUDIO=|[, :]VIDEO=|[, :]SUBTITLES=/i.test(tag),avc:/CODECS="[^"]*avc[13]/i.test(tag)});
 }
 if(variants.length<2)return text;
 const policy=entry.streamPolicy,cap=policy.quality==="auto"?(entry.measuredBps?Math.max(350000,Math.min(5000000,entry.measuredBps*.65)):3500000)/(1.6**policy.level):Infinity;
 const maxHeight=policy.quality==="auto"?Infinity:Number(policy.quality);
 let pool=variants.filter(v=>(!v.height||v.height<=maxHeight)&&v.bandwidth<=cap);
 if(!pool.length)pool=[...variants].sort((a,b)=>a.bandwidth-b.bandwidth).slice(0,1);
 const avc=pool.filter(v=>v.avc);if(avc.length)pool=avc;
 const chosen=variants.find(v=>v.url===entry.variantLock)||pool.sort((a,b)=>b.bandwidth-a.bandwidth)[0];
 entry.variantLock=chosen.url;
 if(!entry.adaptive&&policy.quality==="auto"&&/^#EXT-X-INDEPENDENT-SEGMENTS\s*$/mi.test(text)&&chosen.avc&&!chosen.external&&chosen.codecs&&/mp4a\./i.test(chosen.codecs)){
  const eligible=variants.filter(v=>!v.external&&v.codecs===chosen.codecs&&v.height>0&&v.bandwidth>0&&v.bandwidth<30000000).slice(0,12);
  if(eligible.length>1&&eligible.includes(chosen)){
   entry.adaptive={id:randomBytes(12).toString("hex"),masterURL:chosen.absolute,current:chosen,variants:eligible,history:new Map(),highest:-1,boundaries:[],retired:0,checkedAt:0,switchedAt:Date.now(),switches:0,enabled:true,pending:null,last:null,highSamples:0,sampleRevision:-1};
  }
 }
 if(!entry.adaptive||entry.adaptive.switches===0){entry.selectedBitrate=chosen.bandwidth;entry.selectedHeight=chosen.height;}
 const remove=new Set();for(const v of variants)if(v!==chosen)for(let i=v.i;i<=v.end;i++)remove.add(i);
 return lines.filter((_,i)=>!remove.has(i)).join("\n");
}
function rewriteHLS(text,base,entry,token,port){
  if(!/^\uFEFF?#EXTM3U(?:\r?\n|$)/.test(text)||!/#EXT-X-/i.test(text)||/#EXT-X-DEFINE:|\{\$|#EXT-X-CONTENT-STEERING:/i.test(text))throw Error("Unsupported HLS manifest");
  text=chooseTVVariant(text,entry,base);
  entry.parts??=new Map();entry.partKeys??=new Map();
  const sequenceTag=/^#EXT-X-MEDIA-SEQUENCE:(\d+)\s*$/m.exec(text);let mediaSequence=sequenceTag?Number(sequenceTag[1]):null;
  if(!Number.isSafeInteger(mediaSequence))mediaSequence=null;
  function ref(raw,kind,sequence=null){
    const url=new URL(raw,base);
    if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.hash||url.href.length>4096)throw Error("Unsafe HLS URL");
    const ext=/\.(m3u8|m3u|ts|m4s|mp4|aac|ac3|mp3|vtt|webvtt|key|m4a|cmfv|cmfa)$/i.exec(url.pathname)?.[1]?.toLowerCase();
    const suffix=kind==="playlist"?"m3u8":kind==="key"?"key":kind==="init"?(ext||"mp4"):(ext||"ts");
    const adaptive=kind==="playlist"&&entry.adaptive?.masterURL===url.href?entry.adaptive:null;
    const key=adaptive?"adaptive "+adaptive.id:kind+" "+url.href+(sequence!==null?" seq="+sequence:"");
    let id=entry.partKeys.get(key);
    if(!id){
      while(entry.parts.size>=4096){const first=entry.parts.keys().next().value;const old=entry.parts.get(first);entry.parts.delete(first);entry.partKeys.delete(old.key);}
      id=randomBytes(12).toString("hex");entry.parts.set(id,{url,kind,key,suffix,...(adaptive?{adaptiveId:adaptive.id}:{})});entry.partKeys.set(key,id);
    }
    return "http://127.0.0.1:"+port+"/hls/"+token+"/"+id+"."+suffix;
  }
  let variant=false;
  return text.split(/\r?\n/).map(line=>{
    const trimmed=line.trim();if(!trimmed)return line;
    if(!trimmed.startsWith("#")){const kind=variant?"playlist":"segment";variant=false;const sequence=kind==="segment"&&mediaSequence!==null?mediaSequence++:null;return ref(trimmed,kind,sequence);}
    if(/^#EXT-X-STREAM-INF:/i.test(trimmed))variant=true;
    if(!/^#EXT-X-/i.test(trimmed))return line;
    if(/(?:^|[:,])\s*(?:[A-Z0-9-]*URI)\s*=/i.test(trimmed)){
      const kind=/^#EXT-X-(?:KEY|SESSION-KEY):/i.test(trimmed)?"key":/^#EXT-X-MAP:/i.test(trimmed)?"init":/^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/i.test(trimmed)?"playlist":"segment";
      const rewritten=trimmed.replace(/([:,]\s*(?:[A-Z0-9-]*URI)\s*=\s*)"([^"]+)"/gi,(_,prefix,value)=>prefix+'"'+ref(value,kind)+'"');
      if([...rewritten.matchAll(/(?:^|[:,])\s*(?:[A-Z0-9-]*URI)\s*=([^,]*)/gi)].some(m=>!m[1].trimStart().startsWith('"')))throw Error("Unquoted HLS URI");
      return rewritten;
    }
    return line;
  }).join("\n");
}
// Retry an idempotent segment/playlist request only before sending bytes
// downstream. Do not retry denied, missing or rate-limited sources, or
// attempt to replay an already partially delivered response.
async function openTVResource(entry,resource,options){
 const url=(resource?.url||entry.url).href,deadline=Date.now()+16000;
 const retryable=options.method==="GET"&&["playlist","segment","init"].includes(resource?.kind);
 for(let attempt=0;attempt<2;attempt++){
  if(options.signal?.aborted)throw Error("Stream aborted");
  let result;
  try{
   result=await followStream(url,entry.lan||null,{...options,timeout:retryable?Math.min(7000,Math.max(1000,deadline-Date.now())):25000});
  }catch(error){
   if(!retryable||attempt||options.signal?.aborted||Date.now()+1000>=deadline||!/timed out|ECONNRESET|EPIPE|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(String(error?.message||"")+" "+String(error?.code||"")))throw error;
  }
  if(result&&(!retryable||attempt||Date.now()+1000>=deadline||![408,500,502,503,504].includes(result.reply.statusCode)))return result;
  result?.reply.destroy();entry.segmentRetries=(entry.segmentRetries||0)+1;
  await new Promise(resolve=>setTimeout(resolve,350));
 }
 throw Error("Stream connection failed");
}
async function fetchAdaptivePlaylist(entry,variant,opts){
 const {reply,url}=await followStream(variant.absolute,entry.lan||null,{...opts,method:"GET",timeout:6000});
 if(reply.statusCode!==200){reply.destroy();throw Error("HLS variant unavailable");}
 const raw=(await boundedBody(reply,256*1024)).toString("utf8");
 return {raw,base:url,parsed:parseAlignedLive(raw,url)};
}
async function adaptivePlaylist(entry,state,opts){
 if(state.last&&Date.now()-state.last.at<900)return state.last;
 if(state.pending)return state.pending;
 const task=(async()=>{
  const current=await fetchAdaptivePlaylist(entry,state.current,opts);
  const output=(raw,base)=>({raw,base,at:Date.now()});
  if(!state.enabled||!current.parsed){
   state.enabled=false;
   if(state.switches)throw Error("Adaptive timeline changed");
   return output(current.raw,current.base);
  }
  let parsed=current.parsed;
  const now=Date.now(),rate=entry.measuredBps||0,level=entry.streamPolicy?.level||0;
  // Do not switch on a single sample, and never upshift immediately after
  // a stall. Downshift sooner; upshift only after sustained headroom.
  if(state.sampleRevision!==(entry.sampleRevision||0)){state.sampleRevision=entry.sampleRevision||0;if(rate>state.current.bandwidth*2.1)state.highSamples++;else state.highSamples=0;}
  if((entry.sampleRevision||0)>=3&&rate>0&&now-state.checkedAt>6000&&now-state.switchedAt>15000&&state.highest>=0){
   const down=rate<state.current.bandwidth*1.3,up=state.highSamples>=5&&now-state.switchedAt>45000;
   const cap=rate*(down?0.70:0.55)/(1.25**level),ordered=[...state.variants].sort((a,b)=>a.bandwidth-b.bandwidth);
   const next=ordered.filter(v=>v.bandwidth<=cap).at(-1)||ordered[0];
   if((down&&next.bandwidth<state.current.bandwidth||up&&next.bandwidth>state.current.bandwidth)&&next!==state.current){
    state.checkedAt=now;
    try{
     const candidate=await fetchAdaptivePlaylist(entry,next,opts);
     const firstNew=state.highest+1;
     if(candidate.parsed&&candidate.parsed.target===parsed.target&&alignedRows(parsed,candidate.parsed)&&candidate.parsed.rows.some(r=>r.seq===firstNew)&&candidate.parsed.rows[0].seq<=firstNew&&candidate.parsed.rows.every(r=>{const old=state.history.get(r.seq);return !old||Math.abs(old.date-r.date)<=150&&Math.abs(old.duration-r.duration)<=.15;})){
      state.boundaries.push(firstNew);state.current=next;state.switches++;state.switchedAt=now;state.highSamples=0;parsed=candidate.parsed;
      entry.selectedBitrate=next.bandwidth;entry.selectedHeight=next.height;
     }
    }catch(_){/* Retain current rendition. The main request stays valid. */}
   }
  }
  const raw=adaptiveManifest(state,parsed);
  if(!raw){state.enabled=false;if(state.switches)throw Error("Adaptive timeline changed");return output(current.raw,current.base);}
  return output(raw,current.base);
 })();
 state.pending=task;
 try{const result=await task;state.last=result;return result;}finally{if(state.pending===task)state.pending=null;}
}
// Explicit receive-only IPv4 UDP/RTP MPEG-TS input. No arbitrary native
// FFmpeg networking or remote session description is permitted. The browser
// and FFmpeg see only the existing private tokenized HTTP proxy.
function datagramAddress(value){
 if(typeof value!=="string"||value.length>100)throw Error("Invalid datagram stream");
 const m=/^(udp|rtp):\/\/@?(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})\/?$/i.exec(value.trim());
 if(!m)throw Error("Use a numeric IPv4 receiver address and port");
 const octets=m[2].split(".").map(Number),host=octets.join("."),port=Number(m[3]);
 if(octets.some(n=>n>255)||port<1024||port>65535)throw Error("Invalid datagram receiver");
 const multicast=octets[0]>=224&&octets[0]<=239;
 if(multicast&&octets[0]===224&&octets[1]===0&&octets[2]===0)throw Error("Reserved multicast group");
 const interfaces=Object.values(require("node:os").networkInterfaces()).flat().filter(x=>x&&x.family==="IPv4"&&!x.internal);
 if(!multicast&&host!=="0.0.0.0"&&!interfaces.some(x=>x.address===host))throw Error("Use a local interface or multicast group");
 return {protocol:m[1].toLowerCase(),host,port,multicast};
}
function datagramPayload(packet,rtp){
 let data=packet;
 if(rtp){
  if(packet.length<12||(packet[0]>>6)!==2||(packet[1]&127)!==33)return null;
  let start=12+4*(packet[0]&15),end=packet.length;
  if(start>end)return null;
  if(packet[0]&16){if(start+4>end)return null;start+=4+4*packet.readUInt16BE(start+2);}
  if(packet[0]&32){const padding=packet[end-1];if(!padding)return null;end-=padding;}
  if(start>=end)return null;data=packet.subarray(start,end);
 }
 if(!data.length||data.length%188!==0)return null;
 for(let i=0;i<data.length;i+=188)if(data[i]!==0x47)return null;
 return data;
}
function serveDatagram(req,res,entry){
 if(req.method==="HEAD"){res.writeHead(200,{"Content-Type":"video/mp2t","Cache-Control":"no-store","Access-Control-Allow-Origin":"null"});res.end();return;}
 if(req.headers.range&&!/^bytes=0-$/.test(req.headers.range)){res.writeHead(416);res.end();return;}
 if(networkClients.size>=12||entry.clients.size>=2){res.writeHead(503);res.end();return;}
 const spec=entry.datagram;let receiver=entry.receiver;
 if(!receiver){
  const socket=netUDP.createSocket({type:"udp4",reuseAddr:true});
  receiver={socket,subscribers:new Set(),closed:false};entry.receiver=receiver;
  const stop=()=>{if(receiver.closed)return;receiver.closed=true;if(entry.receiver===receiver)entry.receiver=null;try{socket.close();}catch(_){};};
  receiver.stop=stop;
  socket.on("error",()=>{entry.failure="connection";for(const client of [...receiver.subscribers])client.destroy();stop();});
  socket.on("message",packet=>{
   const data=datagramPayload(packet,spec.protocol==="rtp");if(!data)return;
   entry.failure=null;
   const now=Date.now();
   entry.datagramBytes=(entry.datagramBytes||0)+data.length;
   if(!entry.datagramSampleAt)entry.datagramSampleAt=now;
   if(now-entry.datagramSampleAt>=2000){entry.measuredBps=Math.round(entry.datagramBytes*8000/(now-entry.datagramSampleAt));entry.datagramSampleAt=now;entry.datagramBytes=0;}
   for(const client of receiver.subscribers)client.packet(data,now);
  });
  try{socket.bind(spec.port,spec.multicast?"0.0.0.0":spec.host,()=>{
   if(receiver.closed)return;
   try{if(spec.multicast)socket.addMembership(spec.host);socket.setRecvBufferSize(512*1024);}
   catch(_){entry.failure="connection";for(const client of [...receiver.subscribers])client.destroy();stop();}
  });}catch(_){entry.failure="connection";stop();res.writeHead(502);res.end();return;}
 }
 let last=Date.now(),closed=false,blocked=false;
 const client={
  packet(data,now){
   if(closed||res.destroyed)return;
   last=now;
   if(blocked){entry.datagramDrops=(entry.datagramDrops||0)+1;return;}
   if(!res.headersSent)res.writeHead(200,{"Content-Type":"video/mp2t","Cache-Control":"no-store","Access-Control-Allow-Origin":"null","X-Content-Type-Options":"nosniff"});
   blocked=!res.write(data);
  },
  destroy(){
   if(closed)return;closed=true;clearInterval(timer);receiver.subscribers.delete(client);entry.clients.delete(client);networkClients.delete(client);
   if(!receiver.subscribers.size)receiver.stop();
   if(!res.destroyed&&!res.writableEnded){if(!res.headersSent)res.writeHead(502,{"Cache-Control":"no-store"});res.end();}
  }
 };
 const timer=setInterval(()=>{if(Date.now()-last>15000){entry.failure="timeout";client.destroy();}},1000);
 receiver.subscribers.add(client);entry.clients.add(client);networkClients.add(client);
 res.on("drain",()=>{blocked=false;});res.once("close",()=>client.destroy());res.once("error",()=>client.destroy());
}
// RFC 2974 SAPv1, IPv4, plain SDP only. Accept a single static PT33
// multicast MPEG-TS stream; never pass arbitrary SDP to FFmpeg.
function sapAnnouncement(packet){
 if(!Buffer.isBuffer(packet)||packet.length<8||packet.length>8192||packet[0]!==0x20)return null;
 const start=8+packet[1]*4;if(start>=packet.length)return null;
 let payload=packet.subarray(start);
 if(!payload.subarray(0,2).equals(Buffer.from("v="))){
  const zero=payload.indexOf(0);
  if(zero<0||payload.subarray(0,zero).toString("ascii")!=="application/sdp")return null;
  payload=payload.subarray(zero+1);
 }
 const sdp=payload.toString("utf8").replace(/\0$/,"");
 if(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/.test(sdp))return null;
 const lines=sdp.split(/\r?\n/).filter(Boolean);
 if(lines.length>128||lines.some(l=>l.length>1024)||lines[0]!=="v=0")return null;
 const media=lines.map((l,i)=>l.startsWith("m=")?i:-1).filter(i=>i>=0);
 if(media.length!==1)return null;
 const index=media[0],m=/^m=(?:video|audio) ([0-9]{1,5}) RTP\/AVP 33$/.exec(lines[index]);
 if(!m)return null;
 if(lines.some(l=>/^a=(?:source-filter:|crypto:|key-mgmt:|rtcp:|rtcp-mux|inactive|recvonly)|^k=|^a=rtpmap:33 (?!MP2T\/90000$)/i.test(l)))return null;
 const session=lines.slice(0,index),section=lines.slice(index+1);
 const connections=section.filter(l=>l.startsWith("c=")),defaults=session.filter(l=>l.startsWith("c="));
 if(connections.length>1||defaults.length>1)return null;
 const c=/^c=IN IP4 ([0-9]{1,3}(?:\.[0-9]{1,3}){3})(?:\/[0-9]{1,3}(?:\/1)?)?$/.exec(connections[0]||defaults[0]||"");
 if(!c)return null;
 let spec;try{spec=datagramAddress("rtp://"+c[1]+":"+m[1]);}catch(_){return null;}
 if(!spec.multicast)return null;
 const name=(session.find(l=>l.startsWith("s="))||"s=").slice(2).trim().slice(0,160);
 const address="rtp://"+spec.host+":"+spec.port;
 return {name:name||address,address};
}
let sapScan=null;
function discoverSAP(){
 if(sapScan)return sapScan;
 const task=new Promise((resolve,reject)=>{
  const socket=netUDP.createSocket({type:"udp4",reuseAddr:true}),rows=new Map();
  let finished=false,packets=0;
  const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);try{socket.close();}catch(_){};if(error)reject(error);else resolve([...rows.values()]);};
  const timer=setTimeout(()=>finish(),12000);
  socket.on("error",finish);
  socket.on("message",packet=>{
   if(finished||++packets>4096){if(!finished)finish();return;}
   const row=sapAnnouncement(packet);if(!row)return;
   if(!rows.has(row.address))rows.set(row.address,row);
   if(rows.size>=128)finish();
  });
  try{socket.bind(9875,"0.0.0.0",()=>{
   if(finished){try{socket.close();}catch(_){};return;}
   try{socket.addMembership("224.2.127.254");}catch(error){finish(error);}
  });}catch(error){finish(error);}
 });
 sapScan=task;task.then(()=>{if(sapScan===task)sapScan=null;},()=>{if(sapScan===task)sapScan=null;});
 return task;
}
async function grantDatagram(value){
 const datagram=datagramAddress(value);
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 const port=await startNetworkProxy(),token=randomBytes(24).toString("hex");
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 networkGrants.set(token,{datagram,clients:new Set()});
 return {token,src:"http://127.0.0.1:"+port+"/media/"+token,transport:datagram.protocol};
}
async function serveNetwork(req,res){
  if((req.url||"").startsWith("/voiceover/"))return serveVoiceover(req,res);
  if(serveBuffer(req,res))return;
  const root=/^\/media\/([a-f0-9]{48})$/.exec(req.url||"");
  const part=/^\/hls\/([a-f0-9]{48})\/([a-f0-9]{24})\.([a-z0-9]+)$/.exec(req.url||"");
  const token=(root||part)?.[1],entry=token&&networkGrants.get(token);
  const resource=part&&entry?.parts?.get(part[2]);
  const fail=(status=404)=>{if(!res.headersSent)res.writeHead(status,{"Cache-Control":"no-store"});res.end();};
  if(!entry||(part&&(!resource||resource.suffix!==part[3]))||!["GET","HEAD"].includes(req.method)||networkClients.size>=12)return fail();
  if(entry.rtsp||entry.rtmp||entry.dash||entry.mms||entry.transfer)return fail();
  if(entry.srt||entry.rist){if(!root)return fail();return serveSRT(req,res,entry);}
  if(entry.datagram){if(!root)return fail();return serveDatagram(req,res,entry);}
  if(entry.snapshot){const data=entry.snapshot.manifest;res.writeHead(200,{"Content-Type":"application/vnd.apple.mpegurl","Content-Length":Buffer.byteLength(data),"Access-Control-Allow-Origin":"null","Cache-Control":"no-store"});return res.end(req.method==="HEAD"?undefined:data);}
  const range=req.headers.range;
  if(range&&!/^bytes=(?:\d{1,16}-\d{0,16}|-\d{1,16})$/.test(range))return fail(416);
  const cacheKey=req.method==="GET"&&!range&&resource?.kind==="segment"?token+":"+part[2]:null;
  const cached=cacheKey&&tvSegments.get(cacheKey);
  if(cached&&Date.now()-cached.at<45000){res.writeHead(200,cached.headers);return res.end(cached.data);}
  const controller=new AbortController();res.on("close",()=>controller.abort());
  const track=upstream=>{
    networkClients.add(upstream);entry.clients.add(upstream);
    upstream.on("close",()=>{networkClients.delete(upstream);entry.clients.delete(upstream);});
  };
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const openedAt=Date.now();
    if(resource?.adaptiveId&&resource.adaptiveId===entry.adaptive?.id&&!range&&req.method==="GET"){
      const result=await adaptivePlaylist(entry,entry.adaptive,{track,signal:controller.signal});
      if(!networkGrants.has(token)||res.destroyed)return;
      const rewritten=rewriteHLS(result.raw,result.base,entry,token,networkProxy.address().port);
      res.writeHead(200,{"Content-Type":"application/vnd.apple.mpegurl","Content-Length":Buffer.byteLength(rewritten),"Cache-Control":"no-store","Access-Control-Allow-Origin":"null","X-Content-Type-Options":"nosniff"});
      return res.end(rewritten);
    }
    const {reply,url}=await openTVResource(entry,resource,{method:req.method,range,track,signal:controller.signal});
    clearTimeout(timer);
    if(!networkGrants.has(token)||res.destroyed){reply.destroy();return;}
    if(![200,206,416].includes(reply.statusCode)){entry.failure=[401,403,451].includes(reply.statusCode)?"denied":reply.statusCode===404||reply.statusCode===410?"offline":"upstream";reply.destroy();return fail(502);}
    if(root)entry.failure=null;
    if(resource)entry.lastResourceAt=Date.now();
    const suppliedMime=String(reply.headers["content-type"]||"").split(";")[0].trim().toLowerCase();
    const mime=suppliedMime||(/\.m3u8?$/i.test(url.pathname)?"application/vnd.apple.mpegurl":/\.ts$/i.test(url.pathname)?"video/mp2t":resource?"application/octet-stream":"");
    const manifest=hlsMime(mime)||resource?.kind==="playlist"||/\.m3u8?$/i.test(url.pathname)||(!resource&&mime==="text/plain");
    const headers={"Content-Type":mime||"application/octet-stream","Access-Control-Allow-Origin":"null","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
    if(manifest){
      if(req.method==="HEAD"){reply.destroy();res.writeHead(200,{...headers,"Content-Type":"application/vnd.apple.mpegurl"});return res.end();}
      const manifestTimer=setTimeout(()=>controller.abort(),15000);
      let body;try{body=await boundedBody(reply,2*1024*1024);}finally{clearTimeout(manifestTimer);}
      const rewritten=rewriteHLS(body.toString("utf8"),url,entry,token,networkProxy.address().port);
      res.writeHead(200,{...headers,"Content-Type":"application/vnd.apple.mpegurl","Content-Length":Buffer.byteLength(rewritten)});return res.end(rewritten);
    }
    if(reply.statusCode!==416&&!/^(video\/|audio\/|application\/(?:octet-stream|mp4|mpegts|x-mpegts)$|binary\/octet-stream$)/.test(mime)&&!(resource?.kind==="key"||resource?.kind==="init"||resource?.kind==="segment"&&/^text\/vtt$/.test(mime))){
      entry.failure="format";reply.destroy();return fail(415);
    }
    for(const k of ["content-length","content-range","accept-ranges"]){if(typeof reply.headers[k]==="string")headers[k]=reply.headers[k];}
    res.writeHead(reply.statusCode,headers);
    reply.on("error",()=>res.destroy());reply.on("aborted",()=>res.destroy());
    if(req.method==="HEAD"){reply.resume();res.end();}else{
      if(cacheKey&&reply.statusCode===200){
        let chunks=[],bytes=0;
        const expected=Number(reply.headers["content-length"]);
        if(expected>2*1024**2)chunks=null;
        reply.on("data",chunk=>{bytes+=chunk.length;if(chunks){if(bytes<=2*1024**2)chunks.push(chunk);else chunks=null;}});
        reply.once("end",()=>{
          if(!reply.complete||!networkGrants.has(token))return;
          const ms=Math.max(250,Date.now()-openedAt),bps=bytes*8000/ms;
          if(bytes>32768&&Number.isFinite(bps)){entry.measuredBps=entry.measuredBps?entry.measuredBps*.75+bps*.25:bps;entry.sampleRevision=(entry.sampleRevision||0)+1;}
          if(chunks&&(!expected||expected===bytes))saveTVSegment(cacheKey,Buffer.concat(chunks,bytes),headers);
        });
      }
      reply.pipe(res);
    }
  }catch(error){if(!res.destroyed){const msg=String(error?.message||"");entry.failure=/manifest|HLS URI/i.test(msg)?"manifest":/destination|LAN host|address/i.test(msg)?"address":/timed out|abort/i.test(msg)?"timeout":"connection";fail(502);}}finally{clearTimeout(timer);}
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
  if(networkGrants.size>=256)throw Error("Network media queue is full");
  networkGrants.set(token,{url,lan:url.hostname,clients:new Set()});
  return {token,src:"http://127.0.0.1:"+port+"/media/"+token};
}
// Public stream grants are session-scoped; redirects and HLS resources are validated individually.
async function grantExplicitLiveStream(value){
 const u=new URL(value);
 if(privateIPv4(u.hostname))return grantNetwork(null,u.href);
 await streamTarget(u.href);
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 const port=await startNetworkProxy(),token=randomBytes(24).toString("hex");
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 networkGrants.set(token,{url:u,clients:new Set()});
 return {token,src:"http://127.0.0.1:"+port+"/media/"+token};
}
let liveResourceBusy=0;
const tvData=()=>path.join(app.getPath("userData"),"live-tv-v2");
const tvHash=v=>require("node:crypto").createHash("sha256").update(String(v)).digest("hex");
function tvRead(name,fallback){try{const file=path.join(tvData(),name);if(fs.statSync(file).size>12*1024*1024)return fallback;return JSON.parse(fs.readFileSync(file,"utf8"));}catch(_){return fallback;}}
function tvWrite(name,value){
 const root=tvData();fs.mkdirSync(root,{recursive:true,mode:0o700});const text=JSON.stringify(value);if(Buffer.byteLength(text)>12*1024*1024)throw Error("TV cache too large");
 const file=path.join(root,name),tmp=file+".tmp";fs.writeFileSync(tmp,text,{mode:0o600});fs.renameSync(tmp,file);
}
function logoDiskGet(url){const row=tvRead("logo-"+tvHash(url)+".json",null);return row&&Date.now()-row.at<30*86400000&&typeof row.base64==="string"?row:null;}
function logoDiskPut(url,row){try{
 if(row.base64.length>400000)return;tvWrite("logo-"+tvHash(url)+".json",{...row,at:Date.now()});
 const root=tvData(),files=fs.readdirSync(root).filter(x=>/^logo-[a-f0-9]{64}\.json$/.test(x)).map(name=>{const s=fs.statSync(path.join(root,name));return {name,size:s.size,mtime:s.mtimeMs};}).sort((a,b)=>b.mtime-a.mtime);
 let total=0;for(const file of files){total+=file.size;if(total>64*1024*1024)fs.unlinkSync(path.join(root,file.name));}
 }catch(_){}}
const tvBackground=new Set();
function stopTVBackground(){for(const c of tvBackground)c.abort();tvBackground.clear();}
const tvChecks=new Map(),tvCheckPending=new Map();let checksLoaded=false,checksTimer=null;
function loadChecks(){if(checksLoaded)return;checksLoaded=true;const rows=tvRead("availability.json",[]);if(Array.isArray(rows))for(const [key,v] of rows){if(typeof key==="string"&&v&&Number.isFinite(v.at)&&Date.now()-v.at<7*86400000)tvChecks.set(key,v);}}
function rememberCheck(url,state){
 loadChecks();const k=tvHash(url);tvChecks.delete(k);tvChecks.set(k,{state,at:Date.now()});while(tvChecks.size>12000)tvChecks.delete(tvChecks.keys().next().value);
 clearTimeout(checksTimer);checksTimer=setTimeout(()=>{try{tvWrite("availability.json",[...tvChecks]);}catch(_){}},1500);return tvChecks.get(k);
}
async function checkTV(value,force=false){
 const url=tvURL(value);if(!url)return {state:"unknown",at:Date.now()};
 loadChecks();const k=tvHash(url),previous=tvChecks.get(k);
 if(previous&&!force&&Date.now()-previous.at<(previous.state==="working"?12:3)*3600000)return previous;
 if(tvCheckPending.has(k))return tvCheckPending.get(k);
 if(tvCheckPending.size>=3)return previous||{state:"unknown",at:Date.now()};
 const work=(async()=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);tvBackground.add(controller);
  try{
   const {reply,url:final}=await followStream(url,null,{signal:controller.signal,timeout:7000});
   const code=reply.statusCode,mime=String(reply.headers["content-type"]||"").split(";")[0].toLowerCase();
   if(code!==200&&code!==206){reply.destroy();return rememberCheck(url,[401,403,451].includes(code)?"denied":[404,410].includes(code)?"offline":"unknown");}
   if(hlsMime(mime)||/\.m3u8?$/i.test(final.pathname)||mime==="text/plain"){
    const text=(await boundedBody(reply,512*1024)).toString("utf8");return rememberCheck(url,/#EXTM3U/i.test(text)&&/#EXT-X-/i.test(text)?"reachable":"unknown");
   }
   reply.destroy();return rememberCheck(url,/^(video\/|audio\/|application\/(?:octet-stream|mp4|mpegts|x-mpegts)$)/.test(mime)?"reachable":"unknown");
  }catch(_){return controller.signal.aborted?previous||{state:"unknown",at:Date.now()}:rememberCheck(url,"unknown");}finally{clearTimeout(timer);tvBackground.delete(controller);}
 })().finally(()=>tvCheckPending.delete(k));tvCheckPending.set(k,work);return work;
}
async function liveResource(value,kind){
 if(typeof value!=="string"||value.length>4096||!["playlist","guide","logo","catalog"].includes(kind)||liveResourceBusy>=6)throw Error("TV resource unavailable");
 if(kind==="logo"){const hit=logoDiskGet(value);if(hit)return hit;}
 const limit=kind==="logo"?2*1024*1024:kind==="guide"?32*1024*1024:kind==="catalog"?32*1024*1024:8*1024*1024;
 liveResourceBusy++;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);if(kind==="logo")tvBackground.add(controller);
 try{
  const {reply,url}=await followStream(value,null,{signal:controller.signal,timeout:15000});
  if(reply.statusCode!==200){reply.destroy();throw Error("TV resource unavailable");}
  const mime=String(reply.headers["content-type"]||"").split(";")[0].toLowerCase();
  if(kind==="logo"&&!/^image\/(?:png|jpeg|webp|gif|svg\+xml|avif)$/.test(mime)){reply.destroy();throw Error("Unsupported logo");}
  let data=await boundedBody(reply,limit);
  if(kind==="logo"){
   if(mime==="image/svg+xml"){
    const svg=data.toString("utf8");
    if(data.length>256*1024||/<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|\bon[a-z]+\s*=|<iframe\b|<object\b/i.test(svg)||!/<svg[\s>]/i.test(svg))throw Error("Unsupported SVG logo");
   }
   const result={mime,base64:data.toString("base64")};logoDiskPut(value,result);return result;
  }
  if(data[0]===31&&data[1]===139)data=require("node:zlib").gunzipSync(data,{maxOutputLength:kind==="guide"?64*1024*1024:limit});
  return {text:data.toString("utf8"),url:url.href};
 }finally{clearTimeout(timer);tvBackground.delete(controller);liveResourceBusy--;}
}
// Join the current public catalog schemas in main, and return only compact
// matches for the channels actually requested by the Library.
let tvCatalog=null,tvCatalogAt=0,tvCatalogPending=null;
const tvString=(v,max=250)=>typeof v==="string"?v.slice(0,max):"";
const tvURL=v=>{try{const x=new URL(v);return ["http:","https:"].includes(x.protocol)&&!x.username&&!x.password&&!x.hash&&x.href.length<=4096?x.href:"";}catch(_){return "";}};
async function getTvCatalog(){
 if(tvCatalog&&Date.now()-tvCatalogAt<12*3600000)return tvCatalog;
 if(tvCatalogPending)return tvCatalogPending;
 tvCatalogPending=(async()=>{
  const get=async name=>{
   const data=await liveResource("https://iptv-org.github.io/api/"+name+".json","catalog");
   const rows=JSON.parse(data.text);if(!Array.isArray(rows)||rows.length>250000)throw Error("Invalid catalog");return rows;
  };
  const sets=await Promise.allSettled(["channels","feeds","logos","streams"].map(get));
  if(sets[0].status!=="fulfilled")throw Error("Channel catalog unavailable");
  const [channels,feeds,logos,streams]=sets.map(x=>x.status==="fulfilled"?x.value:[]);
  const byId=new Map(),byURL=new Map(),byFeed=new Map(),art=new Map();
  for(const row of channels)if(row&&typeof row.id==="string")byId.set(row.id,row);
  for(const row of feeds)if(row&&byId.has(row.channel)&&typeof row.id==="string")byFeed.set(row.channel+"@"+row.id,row);
  for(const row of streams){if(!row||!byId.has(row.channel))continue;const url=tvURL(row.url);if(url)byURL.set(url,{id:row.channel,feed:tvString(row.feed)});}
  for(const row of logos){
   if(!row||!byId.has(row.channel))continue;const url=tvURL(row.url);if(!url)continue;
   const format=tvString(row.format).toUpperCase(),score=(row.in_use===true?20:0)+(["PNG","JPEG","WEBP","AVIF","GIF"].includes(format)?10:0)+(row.tags?.includes?.("horizontal")?2:0);
   const k=row.channel+(row.feed?"@"+row.feed:""),old=art.get(k);if(!old||score>old.score)art.set(k,{url,score});
  }
  const result={byId,byURL,byFeed,art};tvCatalog=result;tvCatalogAt=Date.now();return result;
 })().catch(error=>{if(tvCatalog)return tvCatalog;throw error;}).finally(()=>tvCatalogPending=null);
 return tvCatalogPending;
}
async function matchTvCatalog(rows){
 if(!Array.isArray(rows)||rows.length>12000)throw Error("Invalid channel list");
 const c=await getTvCatalog();
 return rows.map(row=>{
  const raw=tvString(row?.id),url=tvURL(row?.url),fromURL=c.byURL.get(url);
  const [idPart,feedPart]=raw.split("@"),id=c.byId.has(idPart)?idPart:fromURL?.id;
  if(!id)return null;
  const channel=c.byId.get(id),feed=feedPart||fromURL?.feed||"",feedRow=c.byFeed.get(id+"@"+feed);
  const logo=c.art.get(id+"@"+feed)?.url||c.art.get(id)?.url||"";
  return {id,feed,name:tvString(channel.name),country:/^[A-Z]{2}$/.test(channel.country)?channel.country:"",categories:Array.isArray(channel.categories)?channel.categories.filter(x=>typeof x==="string").slice(0,12):[],languages:Array.isArray(feedRow?.languages)?feedRow.languages.filter(x=>typeof x==="string").slice(0,12):[],logo};
 });
}
 // Only the native decoder receives a validated, session-scoped loopback URL.
function rtspAddress(value){
 if(typeof value!=="string"||value.length>2048||/[\x00-\x20\x7f\\]/.test(value))throw Error("Invalid RTSP address");
 const url=new URL(value);
 if(!["rtsp:","rtsps:"].includes(url.protocol)||!url.hostname||url.hash||
    (url.port&&(Number(url.port)<1||Number(url.port)>65535)))throw Error("Invalid RTSP address");
 const normalized=new URL("https://"+url.host);
 url.hostname=normalized.hostname;
 if(!url.hostname||url.hostname.includes("%"))throw Error("Invalid RTSP host");
 return url;
}
async function grantRTSP(value,language,mode){
 const url=rtspAddress(value),secure=url.protocol==="rtsps:";
 const transport=secure?"tcp":(["auto","tcp","udp"].includes(mode)?mode:"auto");
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 const ru=language==="ru",safeAddress=url.protocol+"//"+url.host;
 const answer=await dialog.showMessageBox(home,{type:"question",title:ru?"Сетевое видео":"Network video",
  message:ru?"Подключиться к серверу RTSP?":"Connect to this RTSP server?",
  detail:safeAddress+"\n"+(ru?"Подключайтесь только к источникам, которым доверяете. Сервер может перенаправить подключение.":"Use a source you trust. The server may redirect the connection."),
  buttons:ru?["Отмена","Подключиться"]:["Cancel","Connect"],defaultId:0,cancelId:0,noLink:true});
 if(answer.response!==1)throw Error("Connection cancelled");
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 const token=randomBytes(24).toString("hex");
 networkGrants.set(token,{rtsp:url.href,rtspMode:transport,rtspSecure:secure,rtspHost:url.hostname.replace(/^\[|\]$/g,""),clients:new Set()});
 return {token,src:"",transport:"rtsp"};
}
function rtspOptions(token){
 const entry=networkGrants.get(token);
 if(!entry?.rtsp)throw Error("RTSP selection expired");
 return {mode:entry.rtspMode,secure:entry.rtspSecure,host:entry.rtspHost};
}
// Explicit user-selected RTMP input. Keep stream keys and credentials
// inside the main-process grant; the renderer receives only a token.
function rtmpAddress(value){
 if(typeof value!=="string"||value.length>4096||/[\x00-\x20\x7f\\]/.test(value))throw Error("Invalid RTMP address");
 const url=new URL(value);
 if(!["rtmp:","rtmps:"].includes(url.protocol)||!url.hostname||url.hash||!url.pathname||url.pathname==="/"||
    (url.port&&(Number(url.port)<1||Number(url.port)>65535)))throw Error("Invalid RTMP address");
 const normalized=new URL("https://"+url.host);
 url.hostname=normalized.hostname;
 if(!url.hostname||url.hostname.includes("%"))throw Error("Invalid RTMP host");
 return url;
}
async function grantRTMP(value,language){
 const url=rtmpAddress(value),secure=url.protocol==="rtmps:";
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 const ru=language==="ru";
 const answer=await dialog.showMessageBox(home,{type:"question",title:ru?"Сетевое видео":"Network video",
  message:secure?(ru?"Подключиться к серверу RTMPS?":"Connect to this RTMPS server?"):(ru?"Подключиться к серверу RTMP?":"Connect to this RTMP server?"),
  detail:url.protocol+"//"+url.host+"\n"+(secure?(ru?"Требуется проверка сертификата и имени сервера.":"Certificate and server-name verification are required."):(ru?"Обычный RTMP не шифрует соединение. Используйте доверенный источник.":"Plain RTMP does not encrypt the connection. Use a source you trust.")),
  buttons:ru?["Отмена","Подключиться"]:["Cancel","Connect"],defaultId:0,cancelId:0,noLink:true});
 if(answer.response!==1)throw Error("Connection cancelled");
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 const token=randomBytes(24).toString("hex");
 networkGrants.set(token,{rtmp:url.href,rtmpSecure:secure,clients:new Set()});
 return {token,src:"",transport:secure?"rtmps":"rtmp"};
}
// SRT input stays alive between FFprobe and the playback decoder. Only
// bounded MPEG-TS bytes cross the private HTTP proxy; no public HTTP server.
function srtAddress(value){
 if(typeof value!=="string"||value.length>4096||/[\x00-\x20\x7f\\]/.test(value))throw Error("Invalid SRT address");
 const url=new URL(value);
 if(url.protocol!=="srt:"||!url.hostname||!url.port||url.username||url.password||url.hash||!["","/"].includes(url.pathname))throw Error("Invalid SRT address");
 const normalized=new URL("https://"+url.host);url.hostname=normalized.hostname;
 const options=new Map();
 for(const [key,val] of url.searchParams){
  if(options.has(key)||!["mode","latency","rcvlatency","peerlatency","passphrase","pbkeylen","streamid","srt_streamid","connect_timeout","timeout","listen_timeout","localip","localport","transtype"].includes(key))throw Error("Unsupported SRT option");
  if(/[\x00-\x1f\x7f]/.test(val))throw Error("Invalid SRT option");
  options.set(key,val);
 }
 const mode=options.get("mode")||"caller";
 if(!["caller","listener","rendezvous"].includes(mode))throw Error("Invalid SRT mode");
 const bounded=(key,min,max)=>{if(options.has(key)&&(!/^\d+$/.test(options.get(key))||Number(options.get(key))<min||Number(options.get(key))>max))throw Error("Invalid SRT option");};
 for(const k of ["latency","rcvlatency","peerlatency"])bounded(k,0,60000000);
 bounded("connect_timeout",100,30000);bounded("timeout",100000,30000000);bounded("listen_timeout",100000,30000000);bounded("localport",1,65535);
 if(options.has("localip")&&!require("node:net").isIP(options.get("localip")))throw Error("Invalid SRT local IP");
 if(options.has("transtype")&&options.get("transtype")!=="live")throw Error("Only SRT live mode is supported");
 if(options.has("passphrase")&&(Buffer.byteLength(options.get("passphrase"))<10||Buffer.byteLength(options.get("passphrase"))>79))throw Error("Invalid SRT passphrase");
 if(options.has("pbkeylen")&&!["0","16","24","32"].includes(options.get("pbkeylen")))throw Error("Invalid SRT key length");
 if(options.has("passphrase")&&options.get("pbkeylen")==="0")throw Error("Invalid SRT encryption settings");
 if(options.has("streamid")&&options.has("srt_streamid"))throw Error("Duplicate SRT stream ID");
 for(const k of ["streamid","srt_streamid"])if(options.has(k)&&Buffer.byteLength(options.get(k))>512)throw Error("Invalid SRT stream ID");
 url.searchParams.set("mode",mode);url.searchParams.set("enforced_encryption","1");url.searchParams.set("transtype","live");
 // FFmpeg reads SRT query values itself. Preserve percent escapes; reject
 // ambiguous encoded delimiters in non-secret option names above.
 return {address:url.href,mode,display:url.host,encrypted:options.has("passphrase")};
}
async function grantSRT(value,language){
 const spec=srtAddress(value),ru=language==="ru";
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 const answer=await dialog.showMessageBox(home,{type:"question",title:ru?"Сетевое видео":"Network video",
  message:ru?"Открыть поток SRT?":"Open SRT stream?",
  detail:spec.display+" · "+spec.mode+"\n"+(spec.mode==="listener"?(ru?"Приложение откроет порт для входящего подключения.":"The player will bind a port for an incoming connection."):(ru?"Подключайтесь только к доверенному источнику.":"Connect only to a source you trust.")),
  buttons:ru?["Отмена","Подключиться"]:["Cancel","Connect"],defaultId:0,cancelId:0,noLink:true});
 if(answer.response!==1)throw Error("Connection cancelled");
 const port=await startNetworkProxy();
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 const token=randomBytes(24).toString("hex");
 networkGrants.set(token,{srt:spec.address,clients:new Set()});
 return {token,src:"http://127.0.0.1:"+port+"/media/"+token,transport:"srt"};
}
// RIST uses the same bounded receiver relay, but has independent grants
// and native protocol options. The @ prefix is librist's listener syntax.
function ristAddress(value){
 if(typeof value!=="string"||value.length>4096||/[\x00-\x20\x7f\\]/.test(value))throw Error("Invalid RIST address");
 const listen=/^rist:\/\/@/i.test(value),url=new URL(value.replace(/^rist:\/\/@/i,"rist://"));
 if(url.protocol!=="rist:"||!url.hostname||!url.port||url.username||url.password||url.hash||!["","/"].includes(url.pathname))throw Error("Invalid RIST address");
 const normalized=new URL("https://"+url.host);url.hostname=normalized.hostname;
 if(Number(url.port)<1||Number(url.port)>65535)throw Error("Invalid RIST port");
 const args=[],seen=new Set();
 for(const [key,val] of url.searchParams){
  if(seen.has(key)||/[\x00-\x1f\x7f]/.test(val))throw Error("Invalid RIST option");seen.add(key);
  if(key==="rist_profile"&&!["simple","main","advanced"].includes(val))throw Error("Invalid RIST profile");
  else if(key==="buffer_size"&&(!/^\d+$/.test(val)||Number(val)>30000))throw Error("Invalid RIST buffer");
  else if(key==="fifo_size"&&(!/^\d+$/.test(val)||Number(val)<32||Number(val)>262144||(Number(val)&(Number(val)-1))))throw Error("Invalid RIST FIFO");
  else if(key==="overrun_nonfatal"&&!["0","1"].includes(val))throw Error("Invalid RIST overrun policy");
  else if(key==="encryption"&&!["128","256"].includes(val))throw Error("Invalid RIST encryption");
  else if(key==="secret"&&(!val||Buffer.byteLength(val)>127))throw Error("Invalid RIST secret");
  else if(!["rist_profile","buffer_size","fifo_size","overrun_nonfatal","encryption","secret"].includes(key))throw Error("Unsupported RIST option");
  args.push("-"+key,val);
 }
 if(seen.has("encryption")!==seen.has("secret"))throw Error("RIST encryption requires a secret and key size");
 if(seen.has("encryption")&&url.searchParams.get("rist_profile")==="simple")throw Error("RIST encryption requires main or advanced profile");
 return {address:"rist://"+(listen?"@":"")+url.host,display:url.host,listen,args};
}
async function grantRIST(value,language){
 const spec=ristAddress(value),ru=language==="ru";
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 const answer=await dialog.showMessageBox(home,{type:"question",title:ru?"Сетевое видео":"Network video",
  message:ru?"Открыть поток RIST?":"Open RIST stream?",
  detail:spec.display+"\n"+(spec.listen?(ru?"Приложение откроет порт для входящего подключения.":"The player will bind a port for incoming connections."):(ru?"Подключайтесь только к доверенному источнику.":"Connect only to a source you trust.")),
  buttons:ru?["Отмена","Подключиться"]:["Cancel","Connect"],defaultId:0,cancelId:0,noLink:true});
 if(answer.response!==1)throw Error("Connection cancelled");
 const port=await startNetworkProxy();
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 const token=randomBytes(24).toString("hex");
 networkGrants.set(token,{rist:spec.address,ristArgs:spec.args,clients:new Set()});
 return {token,src:"http://127.0.0.1:"+port+"/media/"+token,transport:"rist"};
}
const SRT_BUFFER=8*1024*1024;
function serveSRT(req,res,entry){
 if(req.method==="HEAD"){res.writeHead(200,{"Content-Type":"video/mp2t","Cache-Control":"no-store"});return res.end();}
 if(req.headers.range&&!/^bytes=0-$/.test(req.headers.range)){res.writeHead(416);return res.end();}
 if(entry.clients.size>=2||networkClients.size>=12){res.writeHead(503);return res.end();}
 let receiver=entry.srtReceiver;
 if(!receiver){
  let child;
  try{child=spawn(tvDecoder(),["-hide_banner","-loglevel","error","-nostdin","-protocol_whitelist",entry.rist?"rist,udp":"srt,udp","-format_whitelist","mpegts","-rw_timeout","25000000","-probesize","2097152","-analyzeduration","2000000","-f","mpegts",...(entry.ristArgs||[]),"-i",entry.rist||entry.srt,"-map","0:v:0?","-map","0:a:0?","-c","copy","-mpegts_flags","+resend_headers","-f","mpegts","pipe:1"],{env:tvCodecEnv(),stdio:["ignore","pipe","ignore"],shell:false});}
  catch(_){entry.failure=entry.rist?"rist":"srt";res.writeHead(502);return res.end();}
  receiver={child,chunks:[],bytes:0,next:0,subscribers:new Set(),last:Date.now(),idle:Date.now(),closed:false};entry.srtReceiver=receiver;
  receiver.stop=()=>{
   if(receiver.closed)return;receiver.closed=true;clearInterval(receiver.timer);
   if(entry.srtReceiver===receiver)entry.srtReceiver=null;
   try{child.kill("SIGKILL");}catch(_){}
   for(const client of [...receiver.subscribers])client.destroy();
   receiver.chunks.length=0;receiver.bytes=0;
  };
  child.stdout.on("data",data=>{
   if(receiver.closed)return;receiver.last=Date.now();entry.failure=null;
   receiver.chunks.push({seq:receiver.next++,data});receiver.bytes+=data.length;
   while(receiver.bytes>SRT_BUFFER&&receiver.chunks.length){receiver.bytes-=receiver.chunks.shift().data.length;}
   for(const client of [...receiver.subscribers])client.pump();
  });
  child.once("error",()=>{entry.failure=entry.rist?"rist":"srt";receiver.stop();});
  child.once("close",()=>{if(!receiver.closed){entry.failure=entry.rist?"rist":"srt";receiver.stop();}});
  receiver.timer=setInterval(()=>{
   const now=Date.now();
   if(now-receiver.last>45000||(!receiver.subscribers.size&&now-receiver.idle>45000))receiver.stop();
  },1000);
 }
 let cursor=receiver.chunks[0]?.seq??receiver.next,blocked=false,closed=false;
 const client={
  pump(){
   if(closed||blocked||res.destroyed)return;
   const first=receiver.chunks[0]?.seq??receiver.next;
   if(cursor<first){client.destroy();return;}
   while(cursor<receiver.next&&!blocked){
    const chunk=receiver.chunks[cursor-first];if(!chunk){client.destroy();return;}
    if(!res.headersSent)res.writeHead(200,{"Content-Type":"video/mp2t","Cache-Control":"no-store","Access-Control-Allow-Origin":"null","X-Content-Type-Options":"nosniff"});
    cursor++;blocked=!res.write(chunk.data);
   }
  },
  destroy(){
   if(closed)return;closed=true;receiver.subscribers.delete(client);entry.clients.delete(client);networkClients.delete(client);
   receiver.idle=Date.now();
   if(!res.destroyed&&!res.writableEnded){if(!res.headersSent)res.writeHead(502);res.end();}
  }
 };
 receiver.subscribers.add(client);entry.clients.add(client);networkClients.add(client);
 res.on("drain",()=>{blocked=false;client.pump();});res.once("close",()=>client.destroy());res.once("error",()=>client.destroy());client.pump();
}
// Explicit DASH grants use the native demuxer; manifest and segment URLs
// are network-only, with no filesystem or arbitrary protocol access.
async function grantDASH(value,language){
 if(typeof value!=="string"||value.length>4096||/[\x00-\x20\x7f\\]/.test(value))throw Error("Invalid DASH URL");
 const url=new URL(value);
 if(!["http:","https:"].includes(url.protocol)||!url.hostname||url.hash)throw Error("Invalid DASH URL");
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 const ru=language==="ru";
 const answer=await dialog.showMessageBox(home,{type:"question",title:ru?"Сетевое видео":"Network video",
  message:ru?"Открыть манифест MPEG-DASH?":"Open this MPEG-DASH manifest?",
  detail:url.origin+"\n"+(ru?"Манифест может содержать ссылки на другие сетевые серверы. Используйте доверенный источник.":"A manifest can reference other network servers. Use a source you trust."),
  buttons:ru?["Отмена","Подключиться"]:["Cancel","Connect"],defaultId:0,cancelId:0,noLink:true});
 if(answer.response!==1)throw Error("Connection cancelled");
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 const token=randomBytes(24).toString("hex");
 networkGrants.set(token,{dash:url.href,clients:new Set()});
 return {token,src:"",transport:"dash"};
}
// Legacy Microsoft Media Server addresses. Generic MMS tries both
// native FFmpeg transports during probe and remembers the successful one.
async function grantMMS(value,language){
 if(typeof value!=="string"||value.length>4096||/[\x00-\x20\x7f\\]/.test(value))throw Error("Invalid MMS URL");
 const url=new URL(value);
 if(!["mms:","mmst:","mmsh:"].includes(url.protocol)||!url.hostname||url.hash)throw Error("Invalid MMS URL");
 const normalized=new URL("http://"+url.host);url.hostname=normalized.hostname;
 if(!url.hostname||url.hostname.includes("%")||(url.port&&(Number(url.port)<1||Number(url.port)>65535)))throw Error("Invalid MMS host");
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 const ru=language==="ru";
 const answer=await dialog.showMessageBox(home,{type:"question",title:ru?"Сетевое видео":"Network video",
  message:ru?"Открыть поток MMS?":"Open this MMS stream?",
  detail:url.host+"\n"+(ru?"Соединение MMS не шифруется. Используйте доверенный источник.":"MMS is unencrypted. Use a source you trust."),
  buttons:ru?["Отмена","Подключиться"]:["Cancel","Connect"],defaultId:0,cancelId:0,noLink:true});
 if(answer.response!==1)throw Error("Connection cancelled");
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 const token=randomBytes(24).toString("hex"),auto=url.protocol==="mms:";
 const candidates=auto?["mmst","mmsh"].map(s=>url.href.replace(/^mms:/,s+":")):[url.href];
 networkGrants.set(token,{mms:candidates[0],mmsCandidates:candidates,clients:new Set()});
 return {token,src:"",transport:"mms"};
}
function mmsCandidates(token){
 const entry=networkGrants.get(token);if(!entry?.mms)throw Error("MMS selection expired");
 return [entry.mms,...entry.mmsCandidates.filter(v=>v!==entry.mms)];
}
function selectMMS(token,address){
 const entry=networkGrants.get(token);
 if(!entry?.mmsCandidates?.includes(address))throw Error("MMS selection expired");
 entry.mms=address;
}
// Direct remote files, not directory listings or renderer-controlled paths.
async function grantTransfer(value,language){
 if(typeof value!=="string"||value.length>4096||/[\x00-\x20\x7f\\]/.test(value))throw Error("Invalid remote file URL");
 const url=new URL(value);
 if(!["ftp:","sftp:","smb:"].includes(url.protocol)||!url.hostname||url.hash||url.search||!url.pathname||url.pathname==="/"||url.pathname.endsWith("/"))throw Error("A remote file URL is required");
 const normalized=new URL("http://"+url.host);url.hostname=normalized.hostname;
 if(url.protocol==="smb:"&&url.pathname.split("/").filter(Boolean).length<2)throw Error("An SMB share and filename are required");
 for(const part of [url.username,url.password,url.pathname]){
  if(/[\x00-\x1f\x7f\\]/.test(decodeURIComponent(part)))throw Error("Invalid remote file URL");
 }
 if(url.hostname.includes("%")||(url.port&&(Number(url.port)<1||Number(url.port)>65535)))throw Error("Invalid remote host");
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 const ru=language==="ru",secure=url.protocol==="sftp:",transport=url.protocol.slice(0,-1);
 const answer=await dialog.showMessageBox(home,{type:"question",title:ru?"Сетевое видео":"Network video",
  message:ru?"Открыть удалённый файл?":"Open remote media file?",
  detail:url.host+"\n"+(secure?(ru?"Ключ сервера должен быть проверен по списку известных узлов SSH.":"The SSH server key must match your trusted known_hosts file."):transport==="smb"?(ru?"Подключайтесь только к доверенному общему ресурсу SMB. Защита зависит от настроек сервера и клиента.":"Connect only to a trusted SMB share. Security depends on server and client settings."):(ru?"FTP не шифрует данные и пароль.":"FTP sends data and credentials without encryption.")),
  buttons:ru?["Отмена","Подключиться"]:["Cancel","Connect"],defaultId:0,cancelId:0,noLink:true});
 if(answer.response!==1)throw Error("Connection cancelled");
 if(networkGrants.size>=256)throw Error("Network media queue is full");
 const token=randomBytes(24).toString("hex");
 networkGrants.set(token,{transfer:url.href,transferProtocol:transport,clients:new Set()});
 return {token,src:"",transport};
}
async function resolveNetworkMedia(token){
  if(typeof token!=="string"||!/^[a-f0-9]{48}$/.test(token)||!networkGrants.has(token))throw Error("Network media selection expired");
  const entry=networkGrants.get(token);
  if(entry.rtsp)return entry.rtsp;
  if(entry.rtmp)return entry.rtmp;
  if(entry.mms)return entry.mms;
  if(entry.transfer)return entry.transfer;
  if(entry.dash)return entry.dash;
  const port=await startNetworkProxy();
  if(!networkGrants.has(token))throw Error("Network media selection expired");
  return "http://127.0.0.1:"+port+"/media/"+token;
}
function closeNetwork(){
  stopTVJobs();
  for(const entry of networkGrants.values())entry.srtReceiver?.stop();
  for(const req of networkClients)req.destroy();
  networkClients.clear();networkGrants.clear();networkServers.clear();tvSegments.clear();tvSegmentBytes=0;
  networkProxy?.close();networkProxy=null;
}

// Local-only CTranslate2/SentencePiece worker. No model fetcher, shell or
// caller-controlled executable/path. Only a trusted separately provisioned
// runtime and direct bilingual models in the application's data directory.
const {spawn}=require("node:child_process");
// Recording scheduler runs only during the lifetime of Kinehall.
let dvrState=null,dvrTimer=null,dvrBusy=false,dvrChild=null,dvrStopping=false;
function getDVR(){
 if(!dvrState){const saved=tvRead("dvr.json",{});dvrState={folder:typeof saved.folder==="string"?saved.folder:"",jobs:Array.isArray(saved.jobs)?saved.jobs.slice(-500):[],series:Array.isArray(saved.series)?saved.series.slice(0,100):[]};for(const j of dvrState.jobs)if(j.state==="recording")j.state="interrupted";}
 return dvrState;
}
function saveDVR(){tvWrite("dvr.json",getDVR());}
function cleanTVTitle(v){return String(v||"TV").replace(/[\\/:*?"<>|\x00-\x1f]/g," ").trim().slice(0,60)||"TV";}
function tvCodecEnv(){const base=app.getAppPath();return {...process.env,LD_LIBRARY_PATH:path.join(base,"lib")+path.delimiter+(process.env.LD_LIBRARY_PATH||"")};}
function tvDecoder(){return path.join(app.getAppPath(),"bin","ffmpeg");}
function tvInput(source){return ["-hide_banner","-loglevel","error","-nostdin","-protocol_whitelist","http,tcp,crypto","-format_whitelist","hls,mpegts,mov,matroska,webm,flv,asf,aac,mp3","-rw_timeout","12000000","-http_proxy","","-i",source,"-map","0:v:0?","-map","0:a:0?","-c","copy"];}
function dropTVGrant(token){clearTVSegments(token);const e=networkGrants.get(token);networkGrants.delete(token);for(const client of e?.clients||[])client.destroy();}
function stopTVJobs(){dvrStopping=true;clearInterval(dvrTimer);dvrTimer=null;if(dvrChild)try{dvrChild.kill("SIGINT");}catch(_){}stopBuffer();}
function newDVRJob(row){
 const s=getDVR(),url=tvURL(row?.url),start=Number(row?.start),end=Number(row?.end),now=Date.now()/1000;
 if(!s.folder||!url||!Number.isFinite(start)||!Number.isFinite(end)||end<=Math.max(now,start)||end-start>8*3600||start>now+30*86400)throw Error("Invalid recording schedule or no destination");
 if(s.jobs.some(j=>j.url===url&&Math.abs(j.start-start)<2&&["scheduled","recording","complete"].includes(j.state)))return false;
 if(s.jobs.filter(j=>["scheduled","recording"].includes(j.state)).length>=100)throw Error("Too many recordings");
 if(s.jobs.length>=500){const i=s.jobs.findIndex(j=>!["scheduled","recording"].includes(j.state));if(i<0)throw Error("Too many recordings");s.jobs.splice(i,1);}
 s.jobs.push({id:randomBytes(12).toString("hex"),url,start,end,name:cleanTVTitle(row.name),title:cleanTVTitle(row.title||row.name),state:"scheduled",file:""});saveDVR();void runDVR();return true;
}
function updateSeries(rows){const s=getDVR();if(!Array.isArray(rows)||rows.length>3000)throw Error("Invalid programme list");for(const row of rows)if(s.series.some(x=>x.url===row.url&&x.title===row.title)){try{newDVRJob(row);}catch(_){}}}
async function runDVR(){
 if(dvrStopping||dvrBusy||dvrChild)return;dvrBusy=true;let grant=null,job=null;
 try{
  const s=getDVR(),now=Date.now()/1000;let changed=false;
  for(const j of s.jobs)if(j.state==="scheduled"&&j.end<=now){j.state="missed";changed=true;}
  job=s.jobs.filter(j=>j.state==="scheduled"&&j.start<=now&&j.end>now).sort((a,b)=>a.start-b.start)[0];if(!job){if(changed)saveDVR();return;}
  const folder=fs.realpathSync(s.folder),stat=fs.statSync(folder);if(!stat.isDirectory())throw Error("Recording folder unavailable");
  const space=fs.statfsSync(folder);if(Number(space.bavail)*Number(space.bsize)<1024**3)throw Error("Insufficient disk space");
  const filename=cleanTVTitle(job.name)+" - "+cleanTVTitle(job.title)+" - "+new Date(job.start*1000).toISOString().replace(/[:.]/g,"-")+" - "+job.id.slice(0,8)+".mkv";
  const output=path.join(folder,filename);
  grant=await grantExplicitLiveStream(job.url);const source=await resolveNetworkMedia(grant.token);
  if(dvrStopping||job.state!=="scheduled"){dropTVGrant(grant.token);return;}
  const child=spawn(tvDecoder(),[...tvInput(source),"-n","-t",String(Math.max(1,job.end-Date.now()/1000)),"-f","matroska",output],{env:tvCodecEnv(),stdio:["ignore","ignore","ignore"],shell:false});
  dvrChild=child;job.state="recording";job.file=output;saveDVR();let cancelled=false;
  const monitor=setInterval(()=>{try{const free=fs.statfsSync(folder);if(Number(free.bavail)*Number(free.bsize)<512*1024**2||Date.now()/1000>job.end+20){cancelled=true;child.kill("SIGINT");}}catch(_){cancelled=true;child.kill("SIGINT");}},5000);
  const finish=code=>{if(dvrChild!==child)return;dvrChild=null;clearInterval(monitor);
   if(job.state!=="cancelled")job.state=code===0&&!cancelled&&Date.now()/1000>=job.end-20?"complete":"interrupted";
   try{saveDVR();}catch(_){}dropTVGrant(grant.token);void runDVR();};
  child.once("error",()=>finish(-1));child.once("close",finish);
 }catch(_){if(job&&job.state!=="cancelled"){job.state="failed";try{saveDVR();}catch(_){}}if(grant)dropTVGrant(grant.token);}
 finally{dvrBusy=false;}
}
function ensureDVR(){if(!dvrTimer){dvrStopping=false;dvrTimer=setInterval(()=>void runDVR(),15000);void runDVR();}}
// Opt-in disk timeshift: a capped rolling HLS buffer and a stable replay
// snapshot. The user can seek within completed segments, then return live.
let bufferJob=null,bufferStarting=false;
function stopBuffer(){
 const b=bufferJob;if(!b)return false;bufferJob=null;clearInterval(b.timer);try{b.child?.kill("SIGINT");}catch(_){}
 dropTVGrant(b.input);for(const token of b.snapshots||[])dropTVGrant(token);
 const remove=()=>{try{fs.rmSync(b.dir,{recursive:true,force:true});}catch(_){}};
 if(b.child&&b.child.exitCode===null&&b.child.signalCode===null)b.child.once("close",remove);else remove();return true;
}
async function startBuffer(token){
 const entry=networkGrants.get(token);if(!entry?.url||entry.snapshot||bufferStarting)throw Error("Live stream unavailable");
 if(bufferJob?.source===token)return true;
 bufferStarting=true;stopBuffer();let grant=null,dir=null;
 try{
  const root=path.join(tvData(),"timeshift");fs.mkdirSync(root,{recursive:true,mode:0o700});
  const space=fs.statfsSync(root);if(Number(space.bavail)*Number(space.bsize)<2*1024**3)throw Error("Insufficient buffer space");
  dir=fs.mkdtempSync(path.join(root,"session-"));grant=await grantExplicitLiveStream(entry.url.href);const source=await resolveNetworkMedia(grant.token);
  if(dvrStopping||!networkGrants.has(token))throw Error("Live stream ended");
  const args=[...tvInput(source),"-f","hls","-hls_time","6","-hls_list_size","60","-hls_flags","delete_segments+temp_file+omit_endlist","-hls_segment_filename",path.join(dir,"seg-%08d.ts"),path.join(dir,"live.m3u8")];
  const child=spawn(tvDecoder(),args,{env:tvCodecEnv(),stdio:["ignore","ignore","ignore"],shell:false});
  const b={source:token,input:grant.token,dir,child,snapshots:[],timer:null};bufferJob=b;
  child.once("error",()=>{if(bufferJob===b)stopBuffer();});child.once("close",()=>{if(bufferJob===b)stopBuffer();try{fs.rmSync(b.dir,{recursive:true,force:true});}catch(_){}});
  b.timer=setInterval(()=>{try{let size=0;for(const n of fs.readdirSync(dir)){const st=fs.statSync(path.join(dir,n));if(st.isFile())size+=st.size;}const free=fs.statfsSync(dir);if(size>1024**3||Number(free.bavail)*Number(free.bsize)<512*1024**2)stopBuffer();}catch(_){stopBuffer();}},5000);return true;
 }catch(error){if(grant)dropTVGrant(grant.token);if(dir)fs.rmSync(dir,{recursive:true,force:true});throw error;}finally{bufferStarting=false;}
}
async function snapshotBuffer(sourceToken){
 const b=bufferJob;if(!b||b.source!==sourceToken)throw Error("Live buffer unavailable");
 const raw=fs.readFileSync(path.join(b.dir,"live.m3u8"),"utf8"),lines=raw.split(/\r?\n/),segments=lines.filter(x=>/^seg-\d{8}\.ts$/.test(x));
 if(!segments.length)throw Error("Live buffer is not ready");
 const id=randomBytes(24).toString("hex"),files=new Map(),snap=path.join(b.dir,"snap-"+id);fs.mkdirSync(snap,{mode:0o700});
 try{
  let bytes=0;for(const name of segments){const file=path.join(b.dir,name);bytes+=fs.statSync(file).size;if(bytes>512*1024**2)throw Error("Replay buffer too large");const target=path.join(snap,name);fs.linkSync(file,target);files.set(name,target);}
  const port=await startNetworkProxy();if(bufferJob!==b)throw Error("Buffer stopped");
  const manifest=lines.filter(x=>!/^#EXT-X-ENDLIST/.test(x)).map(x=>files.has(x)?"http://127.0.0.1:"+port+"/buffer/"+id+"/"+x:x).join("\n")+"\n#EXT-X-ENDLIST\n";
  while(b.snapshots.length>=1){const old=b.snapshots.shift(),e=networkGrants.get(old);dropTVGrant(old);if(e?.snapshot?.dir)fs.rmSync(e.snapshot.dir,{recursive:true,force:true});}
  networkGrants.set(id,{clients:new Set(),snapshot:{manifest,files,dir:snap}});b.snapshots.push(id);return {token:id,src:"http://127.0.0.1:"+port+"/media/"+id};
 }catch(error){fs.rmSync(snap,{recursive:true,force:true});throw error;}
}
function serveBuffer(req,res){
 const m=/^\/buffer\/([a-f0-9]{48})\/(seg-\d{8}\.ts)$/.exec(req.url||"");if(!m)return false;
 const file=networkGrants.get(m[1])?.snapshot?.files.get(m[2]);
 if(!file||!["GET","HEAD"].includes(req.method)){res.writeHead(404);res.end();return true;}
 try{const st=fs.statSync(file);let start=0,end=st.size-1;const r=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||"");if(r){start=+r[1];end=r[2]?Math.min(+r[2],end):end;if(start>end){res.writeHead(416);res.end();return true;}}
 const headers={"Content-Type":"video/mp2t","Content-Length":end-start+1,"Accept-Ranges":"bytes","Cache-Control":"no-store","Access-Control-Allow-Origin":"null"};if(r)headers["Content-Range"]="bytes "+start+"-"+end+"/"+st.size;
 res.writeHead(r?206:200,headers);if(req.method==="HEAD")res.end();else{const stream=fs.createReadStream(file,{start,end});stream.on("error",()=>res.destroy());res.on("close",()=>stream.destroy());stream.pipe(res);}
 }catch(_){res.destroy();}return true;
}

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
  if(!["en-ru","ru-en","en-ar","ar-en","ru-ar","ar-ru"].includes(pair))throw Error("Unsupported translation direction");
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
  if(translationJob||voiceoverJob||asrJob)throw Error("Offline speech or translation job already running");
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
function serveVoiceover(req,res){
  const fail=(code=404,headers={})=>{res.writeHead(code,{"Cache-Control":"no-store",...headers});res.end();};
  const match=/^\/voiceover\/([a-f0-9]{48})(?:\/(\d{1,3}))?$/.exec(req.url||"");
  const entry=match&&[voiceoverResult,voiceoverJob?.preview].find(value=>value&&!value.discarded&&value.token===match[1]);
  if(!entry||!["GET","HEAD"].includes(req.method)||entry.streams.size>=4)return fail();
  const part=match[2]===undefined?(entry.complete?{output:entry.output,size:entry.size}:null):entry.chunks?.get(Number(match[2]));
  if(!part)return fail();
  const size=part.size;
  let start=0,end=size-1,status=200;
  const range=req.headers.range;
  if(range){
    const match=/^bytes=(\d{0,15})-(\d{0,15})$/.exec(range);
    if(!match||(!match[1]&&!match[2]))return fail(416,{"Content-Range":"bytes */"+size});
    if(!match[1])start=Math.max(0,size-Number(match[2]));
    else {start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
    if(start<0||start>end||start>=size)return fail(416,{"Content-Range":"bytes */"+size});
    status=206;
  }
  const headers={"Content-Type":"audio/wav","Content-Length":String(end-start+1),
    "Accept-Ranges":"bytes","Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
    "Access-Control-Allow-Origin":"null"};
  if(status===206)headers["Content-Range"]="bytes "+start+"-"+end+"/"+size;
  res.writeHead(status,headers);
  if(req.method==="HEAD"){res.end();return;}
  const stream=fs.createReadStream(part.output,{start,end});
  entry.streams.add(stream);
  stream.on("error",()=>res.destroy());stream.on("close",()=>entry.streams.delete(stream));
  res.on("close",()=>stream.destroy());stream.pipe(res);
}
function removeVoiceoverResult(entry){
  if(!entry)return;
  entry.discarded=true;
  for(const stream of entry.streams)stream.destroy();
  if(!entry.exporting)fs.rmSync(entry.dir,{recursive:true,force:true});
}
const voiceoverWorker=String.raw`
import json, sys, wave, os, struct
from pathlib import Path
import numpy as np
import ctranslate2
import sentencepiece as spm
import sherpa_onnx
translation=Path(sys.argv[1])
voice_paths={key:Path(value) for key,value in json.loads(sys.argv[2]).items()}
output=sys.argv[3]
progressive=sys.argv[4]=="1"
rows=json.load(sys.stdin)
source=spm.SentencePieceProcessor(model_file=str(translation/"source.model"))
target=spm.SentencePieceProcessor(model_file=str(translation/"target.model"))
engine=ctranslate2.Translator(str(translation/"model"),device="cpu",inter_threads=1,intra_threads=2)
engines={}
def engine_for(profile):
    if profile not in voice_paths:
        raise ValueError("Unsupported voice assignment")
    if profile not in engines:
        voice=voice_paths[profile]
        config=sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=str(voice/"model.onnx"),tokens=str(voice/"tokens.txt"),data_dir=str(voice/"espeak-ng-data")),
                num_threads=2,provider="cpu"))
        if not config.validate():
            raise ValueError("Invalid voice model")
        engines[profile]=sherpa_onnx.OfflineTts(config)
    return engines[profile]
default_profile=next(iter(voice_paths))
rate=int(engine_for(default_profile).sample_rate)
if not 8000<=rate<=32000:
    raise ValueError("Unsupported sample rate")
def synthesize(tts,text,speed):
    audio=tts.generate(text=text,sid=0,speed=speed)
    samples=np.asarray(audio.samples,dtype=np.float32)
    native=int(audio.sample_rate)
    if not 8000<=native<=32000 or not len(samples) or not np.isfinite(samples).all():
        return np.empty(0,dtype=np.float32)
    if native!=rate:
        # Convert each generated clip to the common output sample rate.
        length=round(len(samples)*rate/native)
        if length<=0:
            return np.empty(0,dtype=np.float32)
        samples=np.interp(np.arange(length,dtype=np.float64)*native/rate,
                          np.arange(len(samples),dtype=np.float64),samples).astype(np.float32)
    return samples
# A sparse, fixed-duration PCM file lets us synthesize any segment first.
# Every cue is synthesized once, including cues spanning segment boundaries.
# A segment is immutable and published only after all its dependencies finish.
last=round(max(r["end"] for r in rows)*rate)
if last<=0 or last*2>=2**32-36:
    raise ValueError("Unsupported output duration")
block=rate*30
count=(last+block-1)//block
bounds=[]
dependencies=[[] for _ in range(count)]
for i,row in enumerate(rows):
    start=max(0,round(row["start"]*rate))
    end=min(last,round(row["end"]*rate))
    if i+1<len(rows):
        end=min(end,round(rows[i+1]["start"]*rate))
    bounds.append((start,end))
    if end>start:
        for segment in range(start//block,(end-1)//block+1):
            dependencies[segment].append(i)
def header(frames):
    size=frames*2
    return struct.pack("<4sI4s4sIHHIIHH4sI",b"RIFF",36+size,b"WAVE",b"fmt ",16,1,1,rate,rate*2,2,16,b"data",size)
priority_path=Path(output).parent/"priority.json"
def priority():
    if not progressive:
        return 0
    try:
        seconds=float(json.loads(priority_path.read_text(encoding="utf-8"))["seconds"])
        if not np.isfinite(seconds): return 0
        return min(count-1,max(0,int(seconds//30)))
    except (OSError,ValueError,KeyError,TypeError,OverflowError):
        return 0
done=set()
pending=set(range(count))
skipped=0
def process_cues(full,indices):
    global skipped
    for batch_start in range(0,len(indices),32):
        batch=indices[batch_start:batch_start+32]
        tokens=[source.encode(rows[i]["text"],out_type=str) for i in batch]
        if any(len(t)>512 for t in tokens):
            raise ValueError("Input exceeds model token limit")
        decoded=engine.translate_batch(tokens,beam_size=2,max_input_length=512,max_decoding_length=512)
        for i,translation in zip(batch,decoded):
            row=rows[i]
            text=target.decode(translation.hypotheses[0])
            start,end=bounds[i]
            room=end-start
            if room>rate/10 and text.strip():
                tts=engine_for(row.get("voice",default_profile))
                samples=synthesize(tts,text,1.0)
                if len(samples)>room:
                    speed=min(1.45,max(1.05,len(samples)/room*1.03))
                    samples=synthesize(tts,text,speed)
                if 0<len(samples)<=room and np.isfinite(samples).all():
                    full.seek(44+start*2)
                    full.write((np.clip(samples,-1,1)*32767).astype("<i2").tobytes())
                else:
                    skipped+=1
            else:
                skipped+=1
            done.add(i)
            print(json.dumps({"stage":"speech","done":len(done),"total":len(rows),"skipped":skipped}),flush=True)
with open(output,"w+b") as full:
    full.write(header(last))
    full.truncate(44+last*2)
    # Invalid/overlapping zero-length cues never belong to a segment.
    for i,(start,end) in enumerate(bounds):
        if end<=start:
            done.add(i)
            skipped+=1
    while pending:
        playhead=priority()
        # Prefer the active segment and a short forward lookahead, then
        # fill earlier gaps. A new seek is honored at the next segment.
        index=min(pending,key=lambda n:(0 if playhead<=n<playhead+3 else 1,abs(n-playhead),n<playhead,n))
        process_cues(full,[i for i in dependencies[index] if i not in done])
        if progressive:
            start=index*block
            frames=min(block,last-start)
            full.flush()
            full.seek(44+start*2)
            pcm=full.read(frames*2)
            if len(pcm)!=frames*2:
                raise ValueError("Incomplete PCM segment")
            target_path=Path(output).parent/("chunk-%03d.wav"%index)
            with open(str(target_path)+".tmp","wb") as part:
                part.write(header(frames))
                part.write(pcm)
            os.replace(str(target_path)+".tmp",target_path)
            print(json.dumps({"stage":"chunk","index":index,"frames":frames,"rate":rate,"total":len(rows)}),flush=True)
        pending.remove(index)
if len(done)!=len(rows) or skipped==len(rows):
    raise ValueError("No complete voiceover could be generated")
print(json.dumps({"stage":"complete","done":len(rows),"total":len(rows),"skipped":skipped}),flush=True)
`;
function voiceoverPaths(pair,profile="default"){
  if(!["default","male","female","speakers"].includes(profile))throw Error("Unsupported voice profile");
  const runtime=translationPaths(pair);
  const root=path.dirname(path.dirname(runtime.model));
  const baseVoice=path.join(root,"voices",pair.split("-")[1]);
  const profiles=profile==="speakers"?["default","male","female"]:[profile];
  const voices=Object.fromEntries(profiles.map(name=>[name,name==="default"?baseVoice:path.join(baseVoice,name)]));
  const ready=runtime.ready&&Object.values(voices).every(voice=>
    [path.join(voice,"READY.json"),path.join(voice,"model.onnx"),path.join(voice,"tokens.txt"),path.join(voice,"espeak-ng-data")].every(p=>fs.existsSync(p)));
  return {...runtime,voices,ready};
}
function discardVoiceover(){
  if(voiceoverJob){voiceoverJob.cancelled=true;voiceoverJob.child?.kill("SIGKILL");
    const preview=voiceoverJob.preview;if(preview){preview.discarded=true;for(const stream of preview.streams)stream.destroy();}}
  const previous=voiceoverResult;voiceoverResult=null;removeVoiceoverResult(previous);
}
// Content-addressed local voiceover cache. Explicit generation is the only
// producer. A per-session hard link keeps playback/export independent of
// eviction; failure to cache must never prevent normal generation.
const VOICE_CACHE_LIMIT=1024*1024*1024,VOICE_CACHE_COUNT=8,VOICE_MAX_BYTES=700*1024*1024;
function voiceCacheRoot(){
  return path.join(app.getPath("userData"),"generated-voiceover-v1");
}
function voiceCacheKey(runtime,pair,rows){
  try{
    const inventory=[];
    const visit=(file,depth=0)=>{
      if(depth>12||inventory.length>=8192)throw Error("Runtime inventory exceeds limit");
      const stat=fs.statSync(file);
      if(stat.isDirectory()){
        for(const name of fs.readdirSync(file).sort())visit(path.join(file,name),depth+1);
      }else if(stat.isFile()){
        inventory.push([file,stat.size,stat.mtimeMs,stat.ctimeMs,stat.ino]);
      }else throw Error("Unsupported runtime file");
    };
    visit(runtime.python);visit(runtime.model);for(const voice of Object.values(runtime.voices))visit(voice);
    visit(path.join(path.dirname(path.dirname(runtime.model)),"READY.json"));
    // The identical timed source text produces identical output regardless of
    // which media file supplied it. A changed track/cue or model invalidates it.
    return require("node:crypto").createHash("sha256")
      .update(JSON.stringify(["voice-cache-v1",voiceoverWorker,pair,rows,inventory])).digest("hex");
  }catch(_){return null;}
}
function voiceCacheWav(file,rows){
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.size<44||stat.size>VOICE_MAX_BYTES)throw Error("Invalid cached WAV");
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const header=Buffer.alloc(44);
    if(fs.readSync(fd,header,0,44,0)!==44||
       header.toString("ascii",0,4)!=="RIFF"||header.toString("ascii",8,16)!=="WAVEfmt "||
       header.readUInt32LE(16)!==16||header.readUInt16LE(20)!==1||
       header.readUInt16LE(22)!==1||header.readUInt16LE(34)!==16||
       header.toString("ascii",36,40)!=="data")throw Error("Invalid WAV header");
    const rate=header.readUInt32LE(24),bytes=header.readUInt32LE(40);
    if(rate<8000||rate>32000||header.readUInt32LE(28)!==rate*2||
       header.readUInt16LE(32)!==2||bytes!==stat.size-44||
       header.readUInt32LE(4)!==stat.size-8||
       Math.abs(bytes/2-Math.round(rows.reduce((end,r)=>Math.max(end,r.end),0)*rate))>1)
      throw Error("Invalid cached WAV duration");
    return stat.size;
  }finally{fs.closeSync(fd);}
}
// Enumerate only files owned by the completed generated-audio cache.
// Do not follow symlinks or accept arbitrary paths from a renderer.
function voiceCacheEntries(){
  const root=voiceCacheRoot();
  try{
    if(!fs.lstatSync(root).isDirectory())return [];
    return fs.readdirSync(root).filter(n=>/^[a-f0-9]{64}$/.test(n)).flatMap(n=>{
      const dir=path.join(root,n);
      try{
        if(!fs.lstatSync(dir).isDirectory())return [];
        const wav=fs.lstatSync(path.join(dir,"voiceover.wav"));
        if(!wav.isFile())return [];
        return [{dir,size:wav.size}];
      }catch(_){return [];}
    });
  }catch(error){if(error.code==="ENOENT")return [];throw error;}
}
function voiceCacheStats(){
  const entries=voiceCacheEntries();
  return {count:entries.length,bytes:entries.reduce((sum,item)=>sum+item.size,0)};
}
function removeVoiceCacheDirectory(dir){
  // Only delete known cache-owned names. Unexpected files are left intact.
  if(!fs.lstatSync(dir).isDirectory())throw Error("Invalid cache directory");
  const names=["voiceover.wav","result.json","priority.json","priority.json.tmp",...fs.readdirSync(dir).filter(name=>/^chunk-\d{3}\.wav(?:\.tmp)?$/.test(name))];
  for(const name of names){
    try{
      const file=path.join(dir,name),stat=fs.lstatSync(file);
      if(!stat.isFile())throw Error("Unexpected cache entry");
      fs.unlinkSync(file);
    }catch(error){if(error.code!=="ENOENT")throw error;}
  }
  try{fs.rmdirSync(dir);}catch(error){if(error.code!=="ENOTEMPTY"&&error.code!=="ENOENT")throw error;}
}
function cleanVoiceCacheTemporary(){
  // Called only after obtaining the application single-instance lock.
  try{
    const root=voiceCacheRoot();
    if(!fs.lstatSync(root).isDirectory())return;
    for(const name of fs.readdirSync(root)){
      if(!/^\.(?:session|stage)-[A-Za-z0-9]{6}$/.test(name))continue;
      try{removeVoiceCacheDirectory(path.join(root,name));}catch(_){}
    }
    voiceCachePrune();
  }catch(_){}
}
let voiceCacheConfirming=false;
async function clearVoiceCache(language){
  if(voiceoverJob||asrJob||translationJob||voiceoverExporting||voiceCacheConfirming)
    throw Error("Offline speech operation in progress");
  voiceCacheConfirming=true;
  try{
    if(!voiceCacheStats().count)return {cancelled:false,removed:0,...voiceCacheStats()};
    const ru=language==="ru";
    const answer=await dialog.showMessageBox(home,{
      type:"warning",title:ru?"Очистка кэша озвучивания":"Clear voiceover cache",
      message:ru?"Удалить сохранённые звуковые дорожки озвучивания?":"Remove saved generated voiceover audio?",
      detail:ru?"Фильмы, субтитры, экспортированные файлы и история просмотра сохранятся. Текущее озвучивание не прервётся.":"Movies, subtitles, exported files and playback history are retained. Active voiceover playback is not interrupted.",
      buttons:ru?["Отмена","Очистить кэш"]:["Cancel","Clear cache"],defaultId:0,cancelId:0,noLink:true
    });
    if(answer.response!==1)return {cancelled:true,removed:0,...voiceCacheStats()};
    if(voiceoverJob||asrJob||translationJob||voiceoverExporting)
      throw Error("Offline speech operation in progress");
    let removed=0,failed=0;
    for(const entry of voiceCacheEntries()){
      try{removeVoiceCacheDirectory(entry.dir);removed++;}
      catch(_){failed++;}
    }
    return {cancelled:false,removed,failed,...voiceCacheStats()};
  }finally{voiceCacheConfirming=false;}
}
function voiceCachePrune(){
  try{
    const root=voiceCacheRoot(),entries=[];
    for(const key of fs.readdirSync(root)){
      if(!/^[a-f0-9]{64}$/.test(key))continue;
      const dir=path.join(root,key);
      try{
        const d=fs.lstatSync(dir),wav=fs.lstatSync(path.join(dir,"voiceover.wav"));
        if(d.isDirectory()&&wav.isFile())entries.push({dir,bytes:wav.size,mtime:d.mtimeMs});
      }catch(_){}
    }
    entries.sort((a,b)=>b.mtime-a.mtime);
    let bytes=0,kept=0;
    for(const entry of entries){
      if(kept>=VOICE_CACHE_COUNT||bytes+entry.bytes>VOICE_CACHE_LIMIT)
        fs.rmSync(entry.dir,{recursive:true,force:true});
      else{bytes+=entry.bytes;kept++;}
    }
  }catch(_){}
}
function voiceCacheLoad(key,rows,output){
  if(!key)return null;
  try{
    const dir=path.join(voiceCacheRoot(),key);
    if(!fs.lstatSync(dir).isDirectory())return null;
    const manifest=path.join(dir,"result.json"),info=fs.lstatSync(manifest);
    if(!info.isFile()||info.size>4096)return null;
    const data=JSON.parse(fs.readFileSync(manifest,"utf8"));
    if(data.schema!==1||data.key!==key||data.total!==rows.length||
       !Number.isInteger(data.skipped)||data.skipped<0||data.skipped>=rows.length)return null;
    const wav=path.join(dir,"voiceover.wav"),size=voiceCacheWav(wav,rows);
    if(data.size!==size)return null;
    fs.linkSync(wav,output);
    try{const now=new Date();fs.utimesSync(dir,now,now);}catch(_){}
    return {size,skipped:data.skipped};
  }catch(_){return null;}
}
function voiceCacheSave(key,rows,output,skipped){
  if(!key)return;
  let temp=null;
  try{
    const size=voiceCacheWav(output,rows),root=voiceCacheRoot(),dest=path.join(root,key);
    temp=fs.mkdtempSync(path.join(root,".stage-"));
    fs.linkSync(output,path.join(temp,"voiceover.wav"));
    fs.writeFileSync(path.join(temp,"result.json"),JSON.stringify({schema:1,key,total:rows.length,skipped,size}),{mode:0o600,flag:"wx"});
    // A stale/corrupt entry is replaced only after a valid result is ready.
    if(fs.existsSync(dest))fs.rmSync(dest,{recursive:true,force:true});
    fs.renameSync(temp,dest);temp=null;
    voiceCachePrune();
  }catch(_){}finally{if(temp)try{fs.rmSync(temp,{recursive:true,force:true});}catch(_){}}
}
function generateVoiceover(event,pair,rows,ticket,profile="default",progressive=false,position=0){
  const runtime=voiceoverPaths(pair,profile);
  if(!runtime.ready)throw Error("Voiceover runtime is not installed");
  if(voiceoverJob||translationJob||asrJob||voiceoverExporting||voiceCacheConfirming)throw Error("Offline speech or translation job already running");
  if(typeof progressive!=="boolean"||!Number.isFinite(position)||position<0||position>10800)throw Error("Invalid progressive mode or playhead");
  if(!Number.isSafeInteger(ticket)||ticket<1||!Array.isArray(rows)||!rows.length||rows.length>6000||
    Buffer.byteLength(JSON.stringify(rows),"utf8")>2*1024*1024||
    rows.some((r,i)=>!r||!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end<=r.start||r.end>10800||
      (i>0&&r.start<rows[i-1].start)||typeof r.text!=="string"||!r.text.trim()||r.text.length>1000||
      (profile==="speakers"?!["default","male","female"].includes(r.voice):r.voice!==undefined)))
    throw Error("Invalid voiceover cues");
  discardVoiceover();
  const key=voiceCacheKey(runtime,pair,rows);
  let dir;
  try{
    const root=voiceCacheRoot();
    fs.mkdirSync(root,{recursive:true,mode:0o700});
    if(!fs.lstatSync(root).isDirectory())throw Error("Invalid cache directory");
    dir=fs.mkdtempSync(path.join(root,".session-"));
  }catch(_){dir=fs.mkdtempSync(path.join(app.getPath("temp"),"dk-voiceover-"));}
  const output=path.join(dir,"voiceover.wav");
  if(progressive)try{fs.writeFileSync(path.join(dir,"priority.json"),JSON.stringify({seconds:position}),{mode:0o600});}catch(error){fs.rmSync(dir,{recursive:true,force:true});throw error;}
  const cached=voiceCacheLoad(key,rows,output);
  if(cached){
    voiceoverResult={dir,output,ticket,size:cached.size,token:randomBytes(24).toString("hex"),streams:new Set(),exporting:false,discarded:false,complete:true,chunks:new Map()};
    return Promise.resolve({skipped:cached.skipped,total:rows.length,cached:true});
  }
  return new Promise((resolve,reject)=>{
    let child;
    try{child=spawn(runtime.python,["-I","-c",voiceoverWorker,runtime.model,JSON.stringify(runtime.voices),output,progressive?"1":"0"],{
      shell:false,stdio:["pipe","pipe","pipe"],env:{...process.env,LD_LIBRARY_PATH:"",PYTHONNOUSERSITE:"1",OMP_NUM_THREADS:"2",HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1"}
    });}catch(error){fs.rmSync(dir,{recursive:true,force:true});reject(error);return;}
    const preview={dir,output,ticket,size:0,token:randomBytes(24).toString("hex"),streams:new Set(),exporting:false,discarded:false,complete:false,chunks:new Map()};
    const job={child,cancelled:false,preview,progressive,priorityIndex:Math.floor(position/30)};voiceoverJob=job;
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
          if(value.stage==="chunk"){
            const {index,frames,rate}=value;
            if(!progressive||!Number.isInteger(index)||preview.chunks.has(index)||index<0||index>=360||
              !Number.isInteger(rate)||rate<8000||rate>32000||!Number.isInteger(frames)||frames<=0||frames>rate*30)
              throw Error("Invalid generated audio segment");
            const part=path.join(dir,"chunk-"+String(index).padStart(3,"0")+".wav");
            const size=voiceCacheWav(part,[{end:frames/rate}]);
            if(size!==44+frames*2)throw Error("Invalid generated audio segment size");
            preview.chunks.set(index,{output:part,size,duration:frames/rate});
            if(!job.cancelled&&!event.sender.isDestroyed())event.sender.send("dk-library:voiceover-progress",{ticket,stage:"chunk",index,duration:frames/rate});
            continue;
          }
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
        removeVoiceoverResult(preview);reject(Error("Voiceover generation failed or was cancelled"));return;
      }
      if(key&&key===voiceCacheKey(runtime,pair,rows))voiceCacheSave(key,rows,output,complete.skipped);
      preview.size=stat.size;preview.complete=true;voiceoverResult=preview;
      resolve({skipped:complete.skipped,total:rows.length,cached:false});
    });
    child.stdin.end(JSON.stringify(rows));
  });
}


/* Offline ASR: separately provisioned Whisper.cpp CLI and multilingual
 * base model. No download, shell, remote audio, or renderer-provided binary. */
let asrJob=null;
const ASR_LIMIT=10800,ASR_BYTES=8*1024*1024;
function asrPaths(){
  const root=path.join(process.env.XDG_DATA_HOME||path.join(app.getPath("home"),".local","share"),"dk-kinehall","speech-runtime");
  const cli=path.join(root,"bin","whisper-cli"),model=path.join(root,"models","ggml-base.bin");
  const ffmpeg=path.join(app.getAppPath(),"bin","ffmpeg"),ffprobe=path.join(app.getAppPath(),"bin","ffprobe");
  let ready=false;
  try{
    for(const file of [cli,ffmpeg,ffprobe])fs.accessSync(file,fs.constants.X_OK);
    const stat=fs.statSync(model);ready=stat.isFile()&&stat.size>1024*1024&&stat.size<512*1024*1024&&fs.existsSync(path.join(root,"READY.json"));
  }catch(_){}
  return {cli,model,ffmpeg,ffprobe,ready};
}
function cancelASR(){
  if(asrJob){asrJob.cancelled=true;asrJob.child?.kill("SIGKILL");}
}
function asrProgress(event,job,stage,percent){
  if(!job.cancelled&&!event.sender.isDestroyed())event.sender.send("dk-library:asr-progress",{ticket:job.ticket,stage,percent:Math.max(0,Math.min(100,Math.floor(percent)))});
}
function asrProcess(job,command,args,timeout,onLine=()=>{},capture=false,extraEnv={}){
  if(job.cancelled)throw Error("Speech recognition cancelled");
  return new Promise((resolve,reject)=>{
    let child;
    try{child=spawn(command,args,{shell:false,stdio:["ignore","pipe","pipe"],env:{...process.env,
      LD_LIBRARY_PATH:path.join(app.getAppPath(),"lib")+path.delimiter+(process.env.LD_LIBRARY_PATH||""),
      OMP_NUM_THREADS:"2",HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1",...extraEnv}});}
    catch(error){reject(error);return;}
    job.child=child;
    let output="",pending="",failed=false;
    const timer=setTimeout(()=>{failed=true;child.kill("SIGKILL");},timeout);
    child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
    child.stdout.on("data",chunk=>{
      if(capture){output+=chunk;if(output.length>512*1024){failed=true;child.kill("SIGKILL");}}
      else onLine(chunk);
    });
    child.stderr.on("data",chunk=>{
      pending+=chunk;
      if(pending.length>65536)pending=pending.slice(-32768);
      const lines=pending.split(/[\r\n]+/);pending=lines.pop()||"";
      for(const line of lines)onLine(line);
    });
    child.on("error",()=>{failed=true;});
    child.on("close",code=>{
      clearTimeout(timer);job.child=null;
      if(failed||job.cancelled||code!==0)reject(Error(job.cancelled?"Speech recognition cancelled":"Offline speech worker failed"));
      else resolve(output);
    });
  });
}
function parseASRSrt(text,duration){
  if(typeof text!=="string"||Buffer.byteLength(text,"utf8")>ASR_BYTES)throw Error("Subtitle output exceeds limit");
  const rows=[];
  const stamp=value=>{
    const m=/^(\d{2}):([0-5]\d):([0-5]\d)[,.](\d{3})$/.exec(value);
    return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(m[4])/1000:NaN;
  };
  for(const block of text.replace(/^\uFEFF/,"").replace(/\r\n/g,"\n").trim().split(/\n\s*\n/)){
    const lines=block.split("\n"),index=lines.findIndex(line=>line.includes("-->"));
    if(index<0)continue;
    const [a,b]=lines[index].split("-->").map(v=>v.trim());
    const start=stamp(a),end=stamp(b);
    const line=lines.slice(index+1).join(" ").replace(/[\u0000-\u001f]+/g," ").trim();
    if(!line)continue;
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>duration+2||line.length>1000||rows.length>=6000)
      throw Error("Invalid or excessive generated subtitles");
    rows.push({start,end:Math.min(duration,end),text:line});
  }
  const valid=rows.filter(r=>r.end>r.start).sort((a,b)=>a.start-b.start);
  if(!valid.length)throw Error("No speech recognized");
  return valid;
}
function asrCacheRoot(){return path.join(app.getPath("userData"),"generated-subtitles-v1");}
function readASRCache(file,duration){
  try{
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.size>ASR_BYTES)return null;
    const srt=fs.readFileSync(file,"utf8"),rows=parseASRSrt(srt,duration);
    return {rows,srt,cached:true};
  }catch(_){return null;}
}
function saveASRCache(file,srt){
  const root=asrCacheRoot();
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const tmp=file+"."+randomBytes(8).toString("hex")+".tmp";
  try{
    fs.writeFileSync(tmp,srt,{mode:0o600,flag:"wx"});
    fs.renameSync(tmp,file);
  }finally{try{fs.unlinkSync(tmp);}catch(_){}}
  // Keep at most 128 transcripts or 64 MiB, oldest first. No media copies.
  const files=fs.readdirSync(root).filter(n=>/^[a-f0-9]{64}(?:\.[a-z]{2,3})?\.srt$/.test(n)).flatMap(n=>{
    try{const name=path.join(root,n),stat=fs.lstatSync(name);return stat.isFile()?[{name,stat}]:[];}catch(_){return [];}
  }).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);
  let bytes=0;
  files.forEach((entry,i)=>{bytes+=entry.stat.size;if((i>=128||bytes>64*1024*1024)&&entry.name!==file)try{fs.unlinkSync(entry.name);}catch(_){}});
}
async function generateASR(event,source,language,audioIndex,ticket){
  if(asrJob||translationJob||voiceoverJob)throw Error("Another offline speech job is running");
  if(!["en","ru","ar","auto"].includes(language)||!Number.isInteger(audioIndex)||audioIndex<0||audioIndex>31||
     !Number.isSafeInteger(ticket)||ticket<1)throw Error("Invalid speech recognition request");
  const runtime=asrPaths();if(!runtime.ready)throw Error("Offline speech runtime is not installed");
  const job={ticket,child:null,cancelled:false};asrJob=job;
  let dir=null;
  try{
    // Same selected-file path boundary as the existing codec bridge.
    const target=await require("./codec-source.cjs").resolveSource(source,checkPlayableSource);
    const stat=await fs.promises.stat(target);
    if(!stat.isFile())throw Error("A local media file is required");
    const probe=JSON.parse(await asrProcess(job,runtime.ffprobe,["-v","error","-protocol_whitelist","file,pipe","-show_entries","format=duration,start_time:stream=codec_type","-of","json",target],30000,()=>{},true));
    const duration=Number(probe.format?.duration),tracks=(probe.streams||[]).filter(s=>s.codec_type==="audio");
    if(!Number.isFinite(duration)||duration<=0||duration>ASR_LIMIT||audioIndex>=tracks.length)throw Error("Unsupported duration or audio track");
    const modelStat=fs.statSync(runtime.model),cliStat=fs.statSync(runtime.cli);
    const key=require("node:crypto").createHash("sha256").update(JSON.stringify(["asr-v1",target,stat.size,stat.mtimeMs,stat.ino,audioIndex,language,modelStat.size,modelStat.mtimeMs,cliStat.size,cliStat.mtimeMs])).digest("hex");
    const cacheRoot=asrCacheRoot();
    // A detected-language suffix preserves the actual language across restarts.
    // Do not treat manually forced transcripts as automatically detected.
    const cacheFiles=language==="auto"?["en","ru","ar"].map(code=>({code,file:path.join(cacheRoot,key+"."+code+".srt")})):
      [{code:language,file:path.join(cacheRoot,key+".srt")}];
    for(const entry of cacheFiles){
      const cached=readASRCache(entry.file,duration);
      if(cached){asrProgress(event,job,"cached",100);return {...cached,language:entry.code};}
    }
    dir=fs.mkdtempSync(path.join(app.getPath("temp"),"dk-asr-"));
    const wav=path.join(dir,"audio.wav"),output=path.join(dir,"transcript");
    asrProgress(event,job,"extract",0);
    // Rebase container start to source time zero; fill initial audio gaps
    // instead of shifting the dialogue to the first audio sample.
    await asrProcess(job,runtime.ffmpeg,["-nostdin","-hide_banner","-loglevel","error","-progress","pipe:1","-protocol_whitelist","file,pipe","-threads","2","-copyts","-start_at_zero","-i",target,
      "-map","0:a:"+audioIndex,"-vn","-sn","-dn","-af","aresample=16000:async=1:first_pts=0","-ac","1","-ar","16000","-c:a","pcm_s16le","-t",String(duration),"-y",wav],
      30*60*1000,chunk=>{
        for(const match of String(chunk).matchAll(/out_time_us=(\d+)/g))asrProgress(event,job,"extract",Math.min(15,Number(match[1])/1000000/duration*15));
      });
    const wavStat=fs.statSync(wav);
    if(wavStat.size<44||wavStat.size>ASR_LIMIT*32000+1024*1024)throw Error("Audio extraction exceeds limit");
    let detected=language==="auto"?null:language;
    asrProgress(event,job,language==="auto"?"detect":"recognize",15);
    await asrProcess(job,runtime.cli,["-m",runtime.model,"-f",wav,"-l",language,"-t","2","-ng","-osrt","-of",output,"-pp"],
      4*60*60*1000,line=>{
        if(language==="auto"){
          const found=/auto-detected language:\s*([a-z]{2,3})\s*\(p\s*=\s*([0-9.]+)\)/i.exec(line);
          if(found){
            const confidence=Number(found[2]);
            if(Number.isFinite(confidence)&&confidence>=0.5&&confidence<=1)
              detected=found[1].toLowerCase();
          }
        }
        const match=/progress\s*=\s*(\d+)%/i.exec(line);
        if(match)asrProgress(event,job,"recognize",15+Number(match[1])*.84);
      });
    if(language==="auto"&&!["en","ru","ar"].includes(detected))
      throw Error("Speech language uncertain or unsupported; choose the original language manually");
    const file=path.join(cacheRoot,key+(language==="auto"?"."+detected:"")+".srt");
    const srtFile=output+".srt";
    if(fs.statSync(srtFile).size>ASR_BYTES)throw Error("Subtitle output exceeds limit");
    const srt=fs.readFileSync(srtFile,"utf8"),rows=parseASRSrt(srt,duration);
    const after=await fs.promises.stat(target);
    if(job.cancelled||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ino!==stat.ino)throw Error("Media changed during recognition");
    saveASRCache(file,srt);asrProgress(event,job,"complete",100);
    return {rows,srt,cached:false,language:detected};
  }finally{
    if(dir)fs.rmSync(dir,{recursive:true,force:true});
    if(asrJob===job)asrJob=null;
  }
}


// Optional local speaker clustering. The diarization engine returns anonymous
// speaker numbers only; no identity, gender or biometric matching is inferred.
const DIARIZATION_LIMIT=10800;
const diarizationWorker=String.raw`
import json, sys, wave
from pathlib import Path
import numpy as np
import sherpa_onnx
root=Path(sys.argv[1])
rate=16000
core=300*rate
margin=15*rate
embedding_config=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
    model=str(root/"embedding.onnx"),num_threads=2,provider="cpu")
config=sherpa_onnx.OfflineSpeakerDiarizationConfig(
    segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
        pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
            model=str(root/"segmentation.onnx"),window_shift_ratio=0.1),
        num_threads=2,provider="cpu"),
    embedding=embedding_config,
    clustering=sherpa_onnx.FastClusteringConfig(num_clusters=-1,threshold=0.5),
    min_duration_on=0.3,min_duration_off=0.5)
if not config.validate():
    raise ValueError("Invalid speaker models")
engine=sherpa_onnx.OfflineSpeakerDiarization(config)
extractor=sherpa_onnx.SpeakerEmbeddingExtractor(embedding_config)
if engine.sample_rate!=rate:
    raise ValueError("Unexpected speaker sample rate")
def unit(vector):
    v=np.asarray(vector,dtype=np.float32)
    norm=np.linalg.norm(v)
    return v/norm if v.ndim==1 and np.isfinite(norm) and norm>1e-8 else None
def fingerprint(pcm,segments,local_id):
    # Prefer clean solo speech, not simultaneous voices. Limit each
    # representative sample to 12 seconds.
    candidates=[]
    for start,end,speaker in segments:
        if speaker!=local_id: continue
        if any(other!=speaker and min(end,b)>max(start,a) for a,b,other in segments):
            continue
        if end-start>=1.25:
            candidates.append((start,end))
    samples=[]
    remaining=12*rate
    for start,end in sorted(candidates,key=lambda x:x[1]-x[0],reverse=True):
        a=max(0,round(start*rate))
        b=min(len(pcm),round(end*rate),a+remaining)
        if b>a:
            samples.append(pcm[a:b])
            remaining-=b-a
        if remaining<=0: break
    if sum(len(x) for x in samples)<2*rate:
        return None
    stream=extractor.create_stream()
    stream.accept_waveform(sample_rate=rate,waveform=np.ascontiguousarray(np.concatenate(samples)))
    stream.input_finished()
    if not extractor.is_ready(stream):
        return None
    return unit(extractor.compute(stream))
centroids=[]
weights=[]
rows=[]
unassigned=0
with wave.open(sys.argv[2],"rb") as wav:
    if wav.getnchannels()!=1 or wav.getsampwidth()!=2 or wav.getframerate()!=rate:
        raise ValueError("Unsupported speaker audio")
    n=wav.getnframes()
    if not 0<n<=10800*rate:
        raise ValueError("Speaker audio exceeds duration limit")
    for base in range(0,n,core):
        end_core=min(n,base+core)
        lo=max(0,base-margin)
        hi=min(n,end_core+margin)
        wav.setpos(lo)
        pcm=np.frombuffer(wav.readframes(hi-lo),dtype="<i2").astype(np.float32)/32768.0
        def progress(done,total):
            if total>0:
                p=100*(base+(end_core-base)*min(1,done/total)*0.9)/n
                print("dk_speakers_progress="+str(int(p)),file=sys.stderr,flush=True)
            return 0
        result=engine.process(pcm,callback=progress).sort_by_start_time()
        local=[]
        for seg in result:
            start=max(0,float(seg.start))
            end=min(len(pcm)/rate,float(seg.end))
            if np.isfinite(start) and np.isfinite(end) and end>start:
                local.append((start,end,int(seg.speaker)))
        # Match anonymous local clusters against earlier windows. Do not
        # infer identity or gender; ambiguous matches use the default voice.
        ids={}
        used=set()
        labels=sorted({speaker for a,b,speaker in local},
                      key=lambda speaker:-sum(b-a for a,b,s in local if s==speaker))
        for speaker in labels:
            vector=fingerprint(pcm,local,speaker)
            if vector is None:
                ids[speaker]=-1
                continue
            ranked=sorted(((float(np.dot(vector,c)),i) for i,c in enumerate(centroids)),reverse=True)
            best=ranked[0] if ranked else None
            if best and best[1] not in used and best[0]>=0.72 and (len(ranked)==1 or best[0]-ranked[1][0]>=0.08):
                idx=best[1]
                updated=unit(centroids[idx]*min(weights[idx],4)+vector)
                if updated is not None: centroids[idx]=updated
                weights[idx]+=1
            elif (best and best[0]>=0.55) or len(centroids)>=32:
                ids[speaker]=-1
                continue
            else:
                idx=len(centroids)
                centroids.append(vector)
                weights.append(1)
            ids[speaker]=idx
            used.add(idx)
        for start,end,speaker in local:
            a=max(base/rate,lo/rate+start)
            b=min(end_core/rate,lo/rate+end)
            if b<=a: continue
            idx=ids.get(speaker,-1)
            if idx<0:
                unassigned+=1
                continue
            rows.append([round(a,3),round(b,3),idx])
            if len(rows)>12000:
                raise ValueError("Too many speaker segments")
        print("dk_speakers_progress="+str(int(100*end_core/n)),file=sys.stderr,flush=True)
if not rows:
    raise ValueError("No confident speaker clusters")
rows.sort(key=lambda r:r[0])
print(json.dumps({"rows":rows,"unassigned":unassigned},separators=(",",":")),flush=True)
`;
function diarizationPaths(){
  const base=path.join(process.env.XDG_DATA_HOME||path.join(app.getPath("home"),".local","share"),"dk-kinehall","translation-runtime");
  const python=path.join(base,"bin","python3"),root=path.join(base,"diarization");
  const ffmpeg=path.join(app.getAppPath(),"bin","ffmpeg"),ffprobe=path.join(app.getAppPath(),"bin","ffprobe");
  let ready=false;
  try{
    for(const file of [python,ffmpeg,ffprobe])fs.accessSync(file,fs.constants.X_OK);
    ready=["READY.json","segmentation.onnx","embedding.onnx"].every(name=>fs.statSync(path.join(root,name)).isFile());
  }catch(_){}
  return {python,root,ffmpeg,ffprobe,ready};
}
async function identifySpeakers(event,source,audioIndex,ticket){
  if(asrJob||translationJob||voiceoverJob||voiceoverExporting||voiceCacheConfirming)throw Error("Another offline job is running");
  if(!Number.isInteger(audioIndex)||audioIndex<0||audioIndex>31||!Number.isSafeInteger(ticket)||ticket<1)throw Error("Invalid speaker request");
  const runtime=diarizationPaths();if(!runtime.ready)throw Error("Offline speaker models not installed");
  const job={ticket,child:null,cancelled:false};asrJob=job;
  let dir=null;
  try{
    const target=await require("./codec-source.cjs").resolveSource(source,checkPlayableSource);
    const stat=await fs.promises.stat(target);
    if(!stat.isFile())throw Error("A local media file is required");
    const probe=JSON.parse(await asrProcess(job,runtime.ffprobe,["-v","error","-protocol_whitelist","file,pipe","-show_entries","format=duration:stream=codec_type","-of","json",target],30000,()=>{},true));
    const duration=Number(probe.format?.duration),tracks=(probe.streams||[]).filter(s=>s.codec_type==="audio");
    if(!Number.isFinite(duration)||duration<=0||duration>DIARIZATION_LIMIT||audioIndex>=tracks.length)
      throw Error("Speaker analysis currently supports media up to 180 minutes");
    dir=fs.mkdtempSync(path.join(app.getPath("temp"),"dk-speakers-"));
    const wav=path.join(dir,"audio.wav");
    asrProgress(event,job,"speaker-extract",0);
    await asrProcess(job,runtime.ffmpeg,["-nostdin","-hide_banner","-loglevel","error","-progress","pipe:1","-protocol_whitelist","file,pipe","-threads","2","-copyts","-start_at_zero","-i",target,
      "-map","0:a:"+audioIndex,"-vn","-sn","-dn","-af","aresample=16000:async=1:first_pts=0","-ac","1","-ar","16000","-c:a","pcm_s16le","-t",String(duration),"-y",wav],
      30*60*1000,chunk=>{
        for(const match of String(chunk).matchAll(/out_time_us=(\d+)/g))asrProgress(event,job,"speaker-extract",Math.min(15,Number(match[1])/1000000/duration*15));
      });
    if(fs.statSync(wav).size>DIARIZATION_LIMIT*32000+1024*1024)throw Error("Speaker audio exceeds limit");
    asrProgress(event,job,"speakers",15);
    const raw=await asrProcess(job,runtime.python,["-I","-c",diarizationWorker,runtime.root,wav],180*60*1000,line=>{
      const match=/dk_speakers_progress=(\d+)/.exec(line);
      if(match)asrProgress(event,job,"speakers",15+Number(match[1])*.84);
    },true,{LD_LIBRARY_PATH:"",PYTHONNOUSERSITE:"1"});
    const payload=JSON.parse(raw),rows=payload.rows;
    if(!Number.isSafeInteger(payload.unassigned)||payload.unassigned<0||!Array.isArray(rows)||!rows.length||rows.length>12000||rows.some(r=>!Array.isArray(r)||r.length!==3||
      !Number.isFinite(r[0])||!Number.isFinite(r[1])||r[0]<0||r[1]<=r[0]||r[1]>duration+2||
      !Number.isSafeInteger(r[2])||r[2]<0||r[2]>10000))throw Error("Invalid speaker timeline");
    const sorted=rows.sort((a,b)=>a[0]-b[0]),ids=new Map(),segments=[];
    for(const [start,end,rawId] of sorted){
      if(!ids.has(rawId)){
        if(ids.size>=32)throw Error("Too many detected speakers");
        ids.set(rawId,ids.size);
      }
      if(Math.min(end,duration)>start)segments.push({start,end:Math.min(end,duration),speaker:ids.get(rawId)});
    }
    if(!segments.length)throw Error("No speakers detected");
    const after=await fs.promises.stat(target);
    if(job.cancelled||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ino!==stat.ino)throw Error("Media changed during speaker analysis");
    asrProgress(event,job,"complete",100);
    return {segments,count:ids.size,unassigned:payload.unassigned};
  }finally{
    if(dir)fs.rmSync(dir,{recursive:true,force:true});
    if(asrJob===job)asrJob=null;
  }
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
  if(home&&!home.isDestroyed())home.webContents.send("dk-library:maintenance-status",value);
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

/* Jellyfin catalog bridge: separate authenticated local HTTP process, as in
 * DK Media Plus. Never forwards arbitrary renderer URLs, credentials, writes,
 * playback commands, or paths outside the selected Kinehall library folders.
 * Only exact file-path and item-kind matches can supply metadata.
 */
// Private, separately licensed Jellyfin runtime. Never adopt an external
// process or modify the explicitly configured read-only Jellyfin server.
let jfState=null,jfConfig=null,jfStarting=false,jfStopping=false,jfClosing=false,jfQueue=Promise.resolve();
const jfPowerFile=()=>path.join(app.getPath("userData"),"jellyfin-power.json");
function jfEnabled(){try{return JSON.parse(fs.readFileSync(jfPowerFile(),"utf8")).enabled!==false;}catch(_){return true;}}
function jfWrite(file,data){
  const tmp=file+"."+randomBytes(8).toString("hex");
  fs.writeFileSync(tmp,data,{mode:0o600,flag:"wx"});
  try{fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch(_){}}
}
function jfDirectory(dir){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const st=fs.lstatSync(dir);
  if(!st.isDirectory()||st.uid!==process.getuid()||(st.mode&0o077))throw Error("Unsafe private Jellyfin directory");
  return dir;
}
function jfFreePort(){
  return new Promise((resolve,reject)=>{
    const server=require("node:net").createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});
  });
}
function jfOwnListener(state){
  if(!state?.child||state.child.exitCode!==null||state.child.signalCode!==null)return false;
  const fd="/proc/"+state.child.pid+"/fd",sockets=new Set();
  try{
    for(const name of fs.readdirSync(fd)){
      try{const m=/^socket:\[(\d+)\]$/.exec(fs.readlinkSync(path.join(fd,name)));if(m)sockets.add(m[1]);}catch(_){}
    }
    let ready=false;
    for(const table of ["/proc/net/tcp","/proc/net/tcp6"]){
      if(!fs.existsSync(table))continue;
      for(const line of fs.readFileSync(table,"utf8").trim().split("\n").slice(1)){
        const cols=line.trim().split(/\s+/),[addr,port]=cols[1].split(":");
        if(cols[3]!=="0A"||!sockets.has(cols[9]))continue;
        if(table.endsWith("tcp6")||addr!=="0100007F")throw Error("Non-loopback Jellyfin listener");
        if(parseInt(port,16)===state.port)ready=true;
      }
    }
    return ready;
  }catch(error){if(error.message==="Non-loopback Jellyfin listener")throw error;return false;}
}
async function jfAdmin(state,method,route,body,query={},timeout=10000){
  if(jfState!==state||!jfOwnListener(state))throw Error("Private Jellyfin not ready");
  const u=new URL("http://127.0.0.1:"+state.port+route);
  for(const [k,v] of Object.entries(query))u.searchParams.set(k,String(v));
  const headers={Authorization:'MediaBrowser Client="DK Kinehall", Device="Local", DeviceId="'+state.device+'", Version="0.9.3"'+(state.token?', Token="'+state.token+'"':"")};
  if(body!==undefined)headers["Content-Type"]="application/json";
  const response=await fetch(u,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(timeout)});
  if(!response.ok){await response.body?.cancel();throw Error("Jellyfin request failed");}
  if(response.status===204)return null;
  const reader=response.body?.getReader();if(!reader)return null;
  let size=0;const chunks=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw Error("Jellyfin response too large");}chunks.push(Buffer.from(value));}
  return size?JSON.parse(Buffer.concat(chunks).toString("utf8")):null;
}
function jfStop(closing=true){
  if(closing!==false)jfClosing=true;
  jfStopping=true;jfConfig=null;jellyfinCatalog=null;
  const state=jfState;
  if(state?.child&&state.child.exitCode===null&&state.child.signalCode===null){
    try{state.child.kill("SIGTERM");}catch(_){}
  }
  if(!jfState&&!jfStarting&&!jfClosing)jfStopping=false;
}
function jfSetPower(enabled){
  if(typeof enabled!=="boolean"||jellyfinConfig()||jfClosing||jfStopping)throw Error("Private Jellyfin control unavailable");
  jfWrite(jfPowerFile(),JSON.stringify({enabled}));
  if(enabled){void jfStart();}else jfStop(false);
  return true;
}
async function jfReconcile(state,refresh=false){
  if(jfState!==state||!state.token)return;
  const wanted=new Map(getLibrarySources().map(root=>["DK-"+root.kind+"-"+root.id,root]));
  const folders=await jfAdmin(state,"GET","/Library/VirtualFolders");
  if(!Array.isArray(folders))throw Error("Private Jellyfin folder query failed");
  if(folders.some(folder=>!/^DK-(movie|tv)-[a-f0-9]{32}$/.test(folder?.Name||"")))throw Error("Unexpected private library");
  let changed=false;
  for(const folder of folders){
    const root=wanted.get(folder.Name),locations=folder.Locations||[];
    if(!root||locations.length!==1||locations[0]!==root.path){
      await jfAdmin(state,"DELETE","/Library/VirtualFolders",undefined,{name:folder.Name,refreshLibrary:false});
      changed=true;
    }else wanted.delete(folder.Name);
  }
  for(const [name,root] of wanted){
    try{if(!fs.statSync(root.path).isDirectory())continue;}catch(_){continue;}
    await jfAdmin(state,"POST","/Library/VirtualFolders",{LibraryOptions:{PathInfos:[{Path:root.path}],EnableRealtimeMonitor:false,SaveLocalMetadata:false,MetadataSavers:[],EnableChapterImageExtraction:false,ExtractChapterImagesDuringLibraryScan:false,EnableTrickplayImageExtraction:false,ExtractTrickplayImagesDuringLibraryScan:false}},{name,collectionType:root.kind==="movie"?"movies":"tvshows",refreshLibrary:false});
    changed=true;
  }
  if(changed||refresh){jellyfinCatalog=null;await jfAdmin(state,"POST","/Library/Refresh");}
}
function jfSync(refresh=false){
  const state=jfState;
  if(!jfConfig||!state)return;
  jfQueue=jfQueue.catch(()=>{}).then(()=>jfReconcile(state,refresh)).catch(()=>console.warn("Private Jellyfin sync unavailable; Kinehall library retained."));
}
async function jfStart(){
  if(jfStarting||jfStopping||jfClosing||jfState||!jfEnabled()||jellyfinConfig()||process.platform!=="linux")return;
  const executable=path.join(app.getPath("home"),".local","share","dk-kinehall","jellyfin","runtime","jellyfin");
  try{fs.accessSync(executable,fs.constants.X_OK);}catch(_){return;}
  jfStarting=true;let state=null,unlock=null;
  try{
    const base=jfDirectory(path.join(app.getPath("userData"),"jellyfin-private"));
    const lock=path.join(base,"running.lock");
    fs.closeSync(fs.openSync(lock,"wx",0o600));
    unlock=()=>{try{fs.unlinkSync(lock);}catch(_){}};
    const dirs=Object.fromEntries(["data","config","cache","logs"].map(n=>[n,jfDirectory(path.join(base,n))]));
    const secret=path.join(base,"credentials.json");
    let saved;
    if(fs.existsSync(secret)){
      const st=fs.lstatSync(secret);if(!st.isFile()||st.uid!==process.getuid()||(st.mode&0o077)||st.size>4096)throw Error("Unsafe credentials");
      saved=JSON.parse(fs.readFileSync(secret,"utf8"));
    }else{saved={password:randomBytes(32).toString("hex"),device:randomBytes(16).toString("hex")};jfWrite(secret,JSON.stringify(saved));}
    if(!/^[a-f0-9]{64}$/.test(saved.password)||!/^[a-f0-9]{32}$/.test(saved.device))throw Error("Invalid credentials");
    const port=await jfFreePort();
    if(jfStopping){unlock();return;}
    jfWrite(path.join(dirs.config,"network.xml"),'<?xml version="1.0" encoding="utf-8"?><NetworkConfiguration><InternalHttpPort>'+port+'</InternalHttpPort><PublicHttpPort>'+port+'</PublicHttpPort><EnableHttps>false</EnableHttps><RequireHttps>false</RequireHttps><EnableIPv4>true</EnableIPv4><EnableIPv6>false</EnableIPv6><EnableRemoteAccess>false</EnableRemoteAccess><AutoDiscovery>false</AutoDiscovery><EnableUPnP>false</EnableUPnP><LocalNetworkAddresses><string>127.0.0.1</string></LocalNetworkAddresses><LocalNetworkSubnets><string>127.0.0.0/8</string></LocalNetworkSubnets></NetworkConfiguration>');
    const args=["--nowebclient","--nonetchange","--datadir",dirs.data,"--configdir",dirs.config,"--cachedir",dirs.cache,"--logdir",dirs.logs];
    const ffmpeg=path.join(app.getAppPath(),"bin","ffmpeg");
    if(fs.existsSync(ffmpeg))args.push("--ffmpeg",ffmpeg);
    const child=require("node:child_process").spawn(executable,args,{cwd:path.dirname(executable),stdio:"ignore",env:{...process.env,ASPNETCORE_URLS:"http://127.0.0.1:"+port}});
    state={child,port,device:saved.device,token:null};jfState=state;
    let finalized=false;
    const finished=()=>{if(finalized)return;finalized=true;if(jfState===state){jfState=null;jfConfig=null;jellyfinCatalog=null;}unlock();if(!jfStarting&&!jfClosing)jfStopping=false;};
    child.once("error",finished);child.once("exit",finished);
    let info=null;
    const deadline=Date.now()+90000;
    while(Date.now()<deadline&&!jfStopping&&jfState===state){
      if(jfOwnListener(state)){try{info=await jfAdmin(state,"GET","/System/Info/Public");if(info?.Version)break;}catch(_){}}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!info||!String(info.Version).startsWith("10.11.11")||jfStopping)throw Error("Private Jellyfin startup failed");
    if(info.StartupWizardCompleted===false){
      await jfAdmin(state,"POST","/Startup/Configuration",{ServerName:"DK Kinehall Private Metadata",UICulture:"en-US",MetadataCountryCode:"US",PreferredMetadataLanguage:"en"});
      await jfAdmin(state,"GET","/Startup/User");
      await jfAdmin(state,"POST","/Startup/User",{Name:"DKKinehall",Password:saved.password});
      await jfAdmin(state,"POST","/Startup/RemoteAccess",{EnableRemoteAccess:false,EnableAutomaticPortMapping:false});
      await jfAdmin(state,"POST","/Startup/Complete");
    }
    const auth=await jfAdmin(state,"POST","/Users/AuthenticateByName",{Username:"DKKinehall",Pw:saved.password});
    if(!/^[A-Za-z0-9_-]{16,256}$/.test(auth?.AccessToken||"")||!jellyfinId(auth?.User?.Id))throw Error("Private Jellyfin authentication failed");
    state.token=auth.AccessToken;
    await jfReconcile(state,false);
    if(jfStopping||jfState!==state)return;
    jfConfig={port,token:state.token,userId:auth.User.Id,managed:true};jellyfinCatalog=null;
  }catch(_){
    if(state&&jfState===state){try{state.child.kill("SIGTERM");}catch(_){}jfConfig=null;}
    else if(!state&&unlock)unlock();
    console.warn("Private Jellyfin unavailable; using existing metadata providers.");
  }finally{jfStarting=false;if(!jfState&&!jfClosing)jfStopping=false;}
}

let jellyfinCatalog=null;
function jellyfinConfig(){
  try{
    const file=path.join(app.getPath("home"),".config","dk-kinehall","jellyfin.json");
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.size>4096||(stat.mode&0o077)!==0||
       (typeof process.getuid==="function"&&stat.uid!==process.getuid()))return null;
    const cfg=JSON.parse(fs.readFileSync(file,"utf8"));
    if(!Number.isInteger(cfg.port)||cfg.port<1024||cfg.port>65535||
       typeof cfg.token!=="string"||!/^[A-Za-z0-9_-]{16,256}$/.test(cfg.token))return null;
    return {port:cfg.port,token:cfg.token,userId:/^[a-f0-9-]{32,36}$/i.test(cfg.userId||"")?cfg.userId:null};
  }catch(_){return null;}
}
function jellyfinId(value){return typeof value==="string"&&/^[a-f0-9]{32}$|^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);}
async function jellyfinGet(cfg,route,query={},image=false,timeout=8000){
  if(cfg.managed&&(!jfState||cfg.port!==jfState.port||!jfOwnListener(jfState)))return null;
  const address=new URL("http://127.0.0.1:"+cfg.port+route);
  for(const [key,value] of Object.entries(query))address.searchParams.set(key,String(value));
  const res=await fetch(address,{headers:{Authorization:'MediaBrowser Client="DK Kinehall", Device="Local", DeviceId="dk-kinehall-local", Version="0.9.3", Token="'+cfg.token+'"'},redirect:"error",signal:AbortSignal.timeout(timeout)});
  if(!res.ok){await res.body?.cancel();return null;}
  const mime=(res.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
  if(image?!/^image\/(jpeg|png|webp)$/.test(mime):!/^application\/(?:json|[^;]+\+json)$/.test(mime)){await res.body?.cancel();return null;}
  const limit=image?3*1024*1024:5*1024*1024;
  if(Number(res.headers.get("content-length"))>limit){await res.body?.cancel();return null;}
  const reader=res.body?.getReader();if(!reader)return null;
  let size=0;const chunks=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();return null;}chunks.push(Buffer.from(value));}
  const bytes=Buffer.concat(chunks);
  return image?{ok:true,status:200,mime,bytes:new Uint8Array(bytes)}:JSON.parse(bytes.toString("utf8"));
}
async function jellyfinIndex(cfg,force=false){
  const now=Date.now();
  const key=cfg.port+":"+cfg.token+":"+cfg.userId;
  if(jellyfinCatalog?.key===key&&(jellyfinCatalog.pending||now-jellyfinCatalog.at<(force?2000:120000)))return jellyfinCatalog.work;
  const entry={key,at:now,pending:true,work:null};
  entry.work=(async()=>{
    const result=new Map();
    for(let start=0;start<50000;start+=200){
      const page=await jellyfinGet(cfg,"/Items",{Recursive:true,IncludeItemTypes:"Movie,Episode",Fields:"Path,ProviderIds,Overview,Genres,People",EnableUserData:false,EnableImages:true,StartIndex:start,Limit:200,...(cfg.userId?{UserId:cfg.userId}:{})});
      if(!Array.isArray(page?.Items))throw Error("Jellyfin catalog unavailable");
      for(const item of page.Items){
        if(!jellyfinId(item?.Id)||typeof item.Path!=="string"||!path.isAbsolute(item.Path)||!["Movie","Episode"].includes(item.Type))continue;
        const name=path.normalize(item.Path);
        if(result.has(name))result.set(name,null);else result.set(name,item);
      }
      if(page.Items.length<200||Number.isFinite(page.TotalRecordCount)&&start+page.Items.length>=page.TotalRecordCount)break;
    }
    return result;
  })().catch(()=>new Map()).finally(()=>{entry.pending=false;entry.at=Date.now();});
  jellyfinCatalog=entry;return entry.work;
}
const jfMatches=new Map();
const jfJSON=value=>({ok:true,status:200,text:JSON.stringify(value)});
function jfProviderIds(value){
  return Object.fromEntries(Object.entries(value||{}).filter(([key,val])=>/^[A-Za-z0-9_-]{1,40}$/.test(key)&&typeof val==="string"&&/^[A-Za-z0-9_.:-]{1,100}$/.test(val)).slice(0,24));
}
async function jfStatus(){
  if(jellyfinConfig())return jfJSON({state:"external",enabled:true,controllable:false});
  if(jfStopping)return jfJSON({state:"stopping",enabled:jfEnabled(),controllable:false});
  if(jfStarting)return jfJSON({state:"starting",enabled:true,controllable:true});
  if(!jfEnabled())return jfJSON({state:"off",enabled:false,controllable:true});
  if(!jfConfig||!jfState)return jfJSON({state:"unavailable",enabled:true,controllable:true});
  try{
    const tasks=await jfAdmin(jfState,"GET","/ScheduledTasks");
    const task=Array.isArray(tasks)?tasks.find(x=>x.Key==="RefreshLibrary"):null;
    const running=task?.State==="Running"||task?.State==="Cancelling";
    const progress=typeof task?.CurrentProgressPercentage==="number"?Math.max(0,Math.min(100,task.CurrentProgressPercentage)):null;
    return jfJSON({enabled:true,controllable:true,state:running?"scanning":"ready",progress:running?progress:null,completed:task?.LastExecutionResult?.EndTimeUtc||null});
  }catch(_){return jfJSON({state:"unavailable",enabled:true,controllable:true});}
}
async function jfMatch(url,kind){
  const fail={ok:false,status:404};
  const state=jfState,cfg=jfConfig;
  if(kind!=="json"||jellyfinConfig()||!state||!cfg)return fail;
  const id=url.searchParams.get("id"),file=url.searchParams.get("path"),type=url.searchParams.get("type");
  if(!id||!file||file.length>4096||!path.isAbsolute(file)||!["Movie","Series"].includes(type))return fail;
  const grant=await checkPlayableSource(id,file);
  if(!getLibrarySources().some(root=>inSource(root.path,grant.target)))return fail;
  const catalog=await jellyfinIndex(cfg,true);
  const item=catalog.get(path.normalize(grant.target))||catalog.get(path.normalize(file));
  const target=type==="Movie"&&item?.Type==="Movie"?item.Id:type==="Series"&&item?.Type==="Episode"?item.SeriesId:null;
  if(!jellyfinId(target))return fail;
  const now=Date.now();
  for(const [k,v] of jfMatches)if(v.expires<now)jfMatches.delete(k);
  if(url.pathname==="/search"){
    const name=(url.searchParams.get("name")||"").trim(),year=Number(url.searchParams.get("year"))||null;
    if(!name||name.length>160||year&&(year<1800||year>2100||!Number.isInteger(year)))return fail;
    const results=await jfAdmin(state,"POST","/Items/RemoteSearch/"+type,{SearchInfo:{Name:name,...(year?{Year:year}:{})},ItemId:target,IncludeDisabledProviders:false},{},40000);
    if(!Array.isArray(results))return fail;
    const choices=[];
    for(const result of results.slice(0,25)){
      const ids=jfProviderIds(result?.ProviderIds);
      if(!result?.Name||!Object.keys(ids).length)continue;
      const ticket=randomBytes(24).toString("hex");
      jfMatches.set(ticket,{state,target,id,file,type,result,expires:now+300000});
      choices.push({ticket,name:String(result.Name).slice(0,180),year:Number(result.ProductionYear)||null,providerIds:ids});
    }
    while(jfMatches.size>200)jfMatches.delete(jfMatches.keys().next().value);
    return jfJSON({choices});
  }
  if(url.pathname==="/apply"){
    const ticket=url.searchParams.get("ticket"),match=jfMatches.get(ticket);
    if(!match||match.state!==state||match.target!==target||match.id!==id||match.file!==file||match.type!==type)return fail;
    jfMatches.delete(ticket);
    await jfAdmin(state,"POST","/Items/RemoteSearch/Apply/"+target,match.result,{replaceAllImages:true},120000);
    jellyfinCatalog=null;
    return jfJSON({applied:true,providerIds:jfProviderIds(match.result.ProviderIds)});
  }
  return fail;
}

// A provider gallery can return arbitrary URLs. Only approved HTTPS image
// hosts are accepted; URLs and the server token stay in the main process.
const jfImageTickets=new Map();
function jfImageURL(raw){
  if(typeof raw!=="string"||raw.length>2048)return null;
  try{
    const u=new URL(raw);
    if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash||
       !["image.tmdb.org","static.tvmaze.com","images.tvmaze.com","artworks.thetvdb.com","assets.fanart.tv"].includes(u.hostname))return null;
    return u;
  }catch(_){return null;}
}
function jfGallerySize(raw,size){
  const u=jfImageURL(raw);
  if(u?.hostname==="image.tmdb.org"&&/^\/t\/p\/(?:original|w\d+)\/[A-Za-z0-9_.-]+\.(?:jpg|jpeg|png|webp)$/i.test(u.pathname))
    u.pathname=u.pathname.replace(/^\/t\/p\/(?:original|w\d+)\//,"/t/p/"+size+"/");
  return u;
}
async function jfGalleryImage(url){
  const missing={ok:false,status:404};
  let target=url;
  if(!target)return missing;
  try{
    for(let hop=0;hop<3;hop++){
      const r=await fetch(target,{credentials:"omit",redirect:"manual",signal:AbortSignal.timeout(12000)});
      if([301,302,303,307,308].includes(r.status)){
        const location=r.headers.get("location");await r.body?.cancel();
        if(!location)return missing;
        target=jfImageURL(new URL(location,target).href);if(!target)return missing;continue;
      }
      const mime=(r.headers.get("content-type")||"").split(";")[0].trim().toLowerCase(),limit=3*1024*1024;
      if(!r.ok||!/^image\/(jpeg|png|webp)$/.test(mime)||Number(r.headers.get("content-length"))>limit){await r.body?.cancel();return missing;}
      const reader=r.body?.getReader();if(!reader)return missing;
      const chunks=[];let size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();return missing;}chunks.push(Buffer.from(value));}
      if(!size)return missing;
      return {ok:true,status:200,mime,bytes:new Uint8Array(Buffer.concat(chunks))};
    }
  }catch(_){}
  return missing;
}
async function jfGallery(cfg,target,url,kind){
  const missing={ok:false,status:404},now=Date.now();
  const binding=cfg.port+":"+cfg.token+":"+cfg.userId+":"+target;
  for(const [ticket,value] of jfImageTickets)if(value.expires<now)jfImageTickets.delete(ticket);
  if(url.pathname==="/gallery"&&kind==="json"){
    const type=url.searchParams.get("image")||"Primary";
    const start=Number(url.searchParams.get("start")||0);
    if(!["Primary","Backdrop","Thumb"].includes(type)||!Number.isSafeInteger(start)||start<0||start>1000)return missing;
    const data=await jellyfinGet(cfg,"/Items/"+target+"/RemoteImages",{type,startIndex:start,limit:12,includeAllLanguages:true},false,30000);
    if(!Array.isArray(data?.Images))return missing;
    const choices=[];
    for(const image of data.Images.slice(0,12)){
      const original=jfImageURL(image.Url),thumbnail=jfImageURL(image.ThumbnailUrl);
      if(!original||image.Type!==type)continue;
      const ticket=randomBytes(24).toString("hex");
      jfImageTickets.set(ticket,{binding,type,url:original.href,thumb:thumbnail?.href||null,expires:now+600000});
      choices.push({ticket,width:Number(image.Width)||null,height:Number(image.Height)||null,language:typeof image.Language==="string"?image.Language.slice(0,20):null});
    }
    while(jfImageTickets.size>240)jfImageTickets.delete(jfImageTickets.keys().next().value);
    return jfJSON({choices,start,next:start+data.Images.length,hasNext:data.Images.length>0&&start+data.Images.length<Number(data.TotalRecordCount)&&start+data.Images.length<=1000});
  }
  if(url.pathname==="/gallery-image"&&kind==="image"){
    const ticket=jfImageTickets.get(url.searchParams.get("ticket"));
    if(!ticket||ticket.binding!==binding)return missing;
    const preview=url.searchParams.get("preview")==="1";
    const size=preview?"w342":ticket.type==="Backdrop"?"w1280":"w780";
    const targetURL=preview&&ticket.thumb?jfImageURL(ticket.thumb):jfGallerySize(ticket.url,size);
    return jfGalleryImage(targetURL);
  }
  return missing;
}

// Person profiles are authorized only through a verified selected media
// item and its actual credits. The renderer never supplies an arbitrary URL.
function jfCreditList(people){
  const seen=new Set(),results=[];
  for(const p of Array.isArray(people)?people:[]){
    if(!jellyfinId(p?.Id)||typeof p.Name!=="string"||!p.Name.trim())continue;
    const type=typeof p.Type==="string"?p.Type.slice(0,40):"Unknown";
    const role=typeof p.Role==="string"?p.Role.slice(0,180):"";
    const key=p.Id+":"+type+":"+role;
    if(seen.has(key))continue;seen.add(key);
    results.push({id:p.Id,name:p.Name.slice(0,180),type,role,hasImage:!!p.PrimaryImageTag});
    if(results.length>=100)break;
  }
  return results;
}
async function jfPerson(cfg,info,catalog,url,kind){
  const missing={ok:false,status:404};
  const personId=url.searchParams.get("person");
  const credit=jfCreditList(info.People).find(p=>p.id===personId);
  if(!credit)return missing;
  const user=cfg.userId?{UserId:cfg.userId}:{};
  if(url.pathname==="/person-image"&&kind==="image")
    return await jellyfinGet(cfg,"/Items/"+personId+"/Images/Primary",{maxWidth:280,maxHeight:420,quality:85},true)||missing;
  if(url.pathname!=="/person"||kind!=="json")return missing;
  const person=await jellyfinGet(cfg,"/Items/"+personId,user);
  if(!person||person.Id!==personId||person.Type!=="Person")return missing;
  const selected=getLibrarySources(),allowed=new Set();
  for(const entry of catalog.values()){
    if(!entry||typeof entry.Path!=="string"||!selected.some(root=>root.kind===(entry.Type==="Movie"?"movie":"tv")&&inSource(root.path,entry.Path)))continue;
    if(jellyfinId(entry.Id))allowed.add(entry.Id);
    if(jellyfinId(entry.SeriesId))allowed.add(entry.SeriesId);
  }
  const titles=[],seen=new Set();
  let filmographyAvailable=false,limited=false;
  try{
    for(let start=0;start<600;start+=100){
      const page=await jellyfinGet(cfg,"/Items",{...user,Recursive:true,IncludeItemTypes:"Movie,Series,Episode",PersonIds:personId,EnableUserData:false,EnableImages:false,StartIndex:start,Limit:100,Fields:"People"},false,12000);
      if(!Array.isArray(page?.Items))break;
      filmographyAvailable=true;
      for(const entry of page.Items){
        if(!allowed.has(entry?.Id)||!["Movie","Series","Episode"].includes(entry.Type)||typeof entry.Name!=="string")continue;
        const key=entry.Type==="Episode"&&jellyfinId(entry.SeriesId)&&allowed.has(entry.SeriesId)?entry.SeriesId:entry.Id;
        if(seen.has(key))continue;seen.add(key);
        const isEpisode=entry.Type==="Episode";
        const name=isEpisode&&entry.SeriesName?entry.SeriesName:entry.Name;
        const credits=jfCreditList(entry.People).filter(p=>p.id===personId);
        titles.push({id:key,title:String(name).slice(0,180),year:!isEpisode?Number(entry.ProductionYear)||null:null,type:isEpisode&&entry.SeriesName?"Series":entry.Type,roles:credits.map(p=>({type:p.type,role:p.role})).slice(0,8)});
      }
      const more=page.Items.length===100&&(!Number.isFinite(page.TotalRecordCount)||start+page.Items.length<page.TotalRecordCount);
      if(!more)break;
      if(start===500)limited=true;
    }
  }catch(_){limited=true;}
  const clip=(value,n)=>typeof value==="string"?value.slice(0,n):"";
  titles.sort((a,b)=>(b.year||0)-(a.year||0)||a.title.localeCompare(b.title));
  return jfJSON({name:clip(person.Name,180)||credit.name,biography:clip(person.Overview,18000),
    born:clip(person.PremiereDate,32),died:clip(person.EndDate,32),
    locations:Array.isArray(person.ProductionLocations)?person.ProductionLocations.filter(x=>typeof x==="string").slice(0,8).map(x=>x.slice(0,180)):[],
    credit,filmography:titles.slice(0,150),filmographyAvailable,limited:limited||titles.length>150});
}

// Read the actual indexed type independently of the assigned folder. For
// private catalogs, remote search can corroborate a movie without mutating
// a folder-derived Episode record. Never apply remote search results here.
async function jfClassification(url,kind){
 const fail={ok:false,status:404};
 if(kind!=="json")return fail;
 const external=jellyfinConfig(),cfg=external||jfConfig,state=jfState;
 if(!cfg)return fail;
 const id=url.searchParams.get("id"),file=url.searchParams.get("path"),title=(url.searchParams.get("title")||"").trim(),series=(url.searchParams.get("series")||"").trim();
 const year=Number(url.searchParams.get("year"))||null,season=url.searchParams.get("season"),episode=url.searchParams.get("episode");
 if(!id||!file||file.length>4096||!path.isAbsolute(file)||!title||title.length>180||series.length>180||year&&(!Number.isInteger(year)||year<1800||year>2100))return fail;
 const grant=await checkPlayableSource(id,file);
 if(!getLibrarySources().some(root=>inSource(root.path,grant.target)))return fail;
 const catalog=await jellyfinIndex(cfg),item=catalog.get(path.normalize(grant.target))||catalog.get(path.normalize(file));
 const norm=v=>String(v||"").normalize("NFKD").replace(/\p{M}/gu,"").replace(/&/g," and ").replace(/[^\p{L}\p{N}]+/gu," ").trim().toLowerCase();
 const named=norm(title),hint=norm(series),hasIds=x=>Object.keys(jfProviderIds(x?.ProviderIds)).length>0;
 const movieMatch=x=>x&&hasIds(x)&&norm(x.Name)===named&&(!year||Number(x.ProductionYear)===year);
 const film=x=>({kind:"movie",title:String(x.Name).slice(0,180),year:Number(x.ProductionYear)||year,series:null,season:null,episode:null,episodeTitle:"",provider:"Jellyfin"});
 const numbered=season!==null&&episode!==null&&/^\d{1,2}$/.test(season)&&/^\d{1,3}$/.test(episode)&&Number(episode)>0;
 if(numbered){
  if(item?.Type==="Episode"&&hasIds(item)&&norm(item.SeriesName)===hint&&Number.isInteger(item.ParentIndexNumber)&&Number.isInteger(item.IndexNumber)&&item.ParentIndexNumber===Number(season)&&item.IndexNumber===Number(episode)&&item.Name)
   return jfJSON({kind:"tv",title:String(item.SeriesName).slice(0,180),series:String(item.SeriesName).slice(0,180),season:Number(season),episode:Number(episode),episodeTitle:String(item.Name).slice(0,180),year:null,provider:"Jellyfin"});
  return fail;
 }
 const indexedMovie=item?.Type==="Movie"&&movieMatch(item)?item:null;
 const short=hint&&named.startsWith(hint+" ")?named.slice(hint.length+1):named;
 const indexedEpisode=item?.Type==="Episode"&&hasIds(item)&&hint&&norm(item.SeriesName)===hint&&norm(item.Name)===short&&Number.isInteger(item.ParentIndexNumber)&&item.ParentIndexNumber>=0&&item.ParentIndexNumber<=99&&Number.isInteger(item.IndexNumber)&&item.IndexNumber>=1&&item.IndexNumber<=999&&(!year||Number(item.ProductionYear)===year)?item:null;
 // An external connection remains read-only. Only corroborated exact-path
 // results are usable; private remote searches are query-only POSTs.
 if(external||!state){
  if(indexedMovie)return jfJSON(film(indexedMovie));
  if(indexedEpisode)return jfJSON({kind:"tv",title:String(item.SeriesName).slice(0,180),series:String(item.SeriesName).slice(0,180),season:item.ParentIndexNumber,episode:item.IndexNumber,episodeTitle:String(item.Name).slice(0,180),year:null,provider:"Jellyfin"});
  return fail;
 }
 const query={SearchInfo:{Name:title,...(year?{Year:year}:{})},IncludeDisabledProviders:false};
 const [movies,shows]=await Promise.all([
  jfAdmin(state,"POST","/Items/RemoteSearch/Movie",query,{},20000),
  jfAdmin(state,"POST","/Items/RemoteSearch/Series",query,{},20000)
 ]);
 if(!Array.isArray(movies)||!Array.isArray(shows))return fail;
 const exact=movies.filter(movieMatch),tv=shows.filter(movieMatch);
 const distinct=new Map(exact.map(x=>[JSON.stringify(Object.entries(jfProviderIds(x.ProviderIds)).sort()),x]));
 if(distinct.size>1||tv.length||indexedEpisode&&distinct.size)return jfJSON({ambiguous:true});
 if(distinct.size===1)return jfJSON(film([...distinct.values()][0]));
 if(indexedMovie)return jfJSON(film(indexedMovie));
 if(indexedEpisode)return jfJSON({kind:"tv",title:String(item.SeriesName).slice(0,180),series:String(item.SeriesName).slice(0,180),season:item.ParentIndexNumber,episode:item.IndexNumber,episodeTitle:String(item.Name).slice(0,180),year:null,provider:"Jellyfin"});
 return fail;
}

async function jellyfinMetadata(raw,kind){
  const missing={ok:false,status:404};
  try{
    const url=new URL(raw);
    if(url.protocol!=="dk-jellyfin:"||url.hostname!=="catalog"||url.username||url.password||url.port||url.hash)return missing;
    if(url.pathname==="/status"&&kind==="json")return await jfStatus();
    if(url.pathname==="/classification")return await jfClassification(url,kind);
    if(["/search","/apply"].includes(url.pathname))return await jfMatch(url,kind);
    const cfg=jellyfinConfig()||jfConfig;if(!cfg||!["/item","/gallery","/gallery-image","/person","/person-image"].includes(url.pathname))return missing;
    const id=url.searchParams.get("id"),file=url.searchParams.get("path"),type=url.searchParams.get("type");
    const series=url.searchParams.get("series")==="1";
    if(!id||!file||file.length>4096||!path.isAbsolute(file)||!["Movie","Episode"].includes(type)||series&&type!=="Episode")return missing;
    const grant=await checkPlayableSource(id,file);
    if(!getLibrarySources().some(root=>inSource(root.path,grant.target)))return missing;
    const catalog=await jellyfinIndex(cfg,url.searchParams.get("force")==="1");
    const item=catalog.get(path.normalize(grant.target))||catalog.get(path.normalize(file));
    if(!item||item.Type!==type||!jellyfinId(item.Id)||typeof item.Name!=="string"||!item.Name.trim())return missing;
    const scope=url.searchParams.get("scope")||(series?"series":"item");
    if(!["item","series","season"].includes(scope)||scope!=="item"&&type!=="Episode")return missing;
    const target=scope==="series"?item.SeriesId:scope==="season"?item.SeasonId:item.Id;
    if(!jellyfinId(target))return missing;
    if(["/gallery","/gallery-image"].includes(url.pathname))return await jfGallery(cfg,target,url,kind);
    if(url.pathname==="/item"&&kind==="image"){
      const imageType=url.searchParams.get("image")||"Primary";
      if(!["Primary","Backdrop","Thumb"].includes(imageType))return missing;
      return await jellyfinGet(cfg,"/Items/"+target+"/Images/"+imageType,{maxWidth:imageType==="Backdrop"?960:scope!=="item"||type==="Movie"?480:640,quality:85},true)||missing;
    }
    let info=item;
    if(scope!=="item"){
      const query={Ids:target,Fields:"Overview,Genres,People,ProviderIds",EnableUserData:false,EnableImages:true,...(cfg.userId?{UserId:cfg.userId}:{})};
      const response=await jellyfinGet(cfg,"/Items",query);
      info=Array.isArray(response?.Items)?response.Items.find(x=>x.Id===target&&x.Type===(scope==="series"?"Series":"Season")):null;
      if(!info)return missing;
      if(scope==="season"&&info.SeriesId&&info.SeriesId!==item.SeriesId)return missing;
    }
    if(["/person","/person-image"].includes(url.pathname))return await jfPerson(cfg,info,catalog,url,kind);
    const clip=(value,n)=>typeof value==="string"?value.slice(0,n):"";
    const people=Array.isArray(info.People)?info.People:[];
    const result={title:clip(info.Name,180),year:Number(info.ProductionYear)||null,scope,
      provider:"Jellyfin",identity:{itemId:info.Id,seriesId:jellyfinId(item.SeriesId)?item.SeriesId:null,seasonId:jellyfinId(item.SeasonId)?item.SeasonId:null,providerIds:jfProviderIds(info.ProviderIds)},details:{description:clip(info.Overview,6000),people:jfCreditList(people),
      genres:Array.isArray(info.Genres)?info.Genres.filter(x=>typeof x==="string").slice(0,20):[],
      directors:people.filter(x=>x?.Type==="Director").map(x=>clip(x.Name,120)).filter(Boolean).slice(0,15),
      cast:people.filter(x=>x?.Type==="Actor").map(x=>clip(x.Name,120)).filter(Boolean).slice(0,30),
      runtime:Number.isFinite(Number(info.RunTimeTicks))?Math.round(Number(info.RunTimeTicks)/600000000):null,
      rating:Number.isFinite(Number(info.CommunityRating))?String(info.CommunityRating):""}};
    return {ok:true,status:200,text:JSON.stringify(result)};
  }catch(_){return missing;}
}

async function metadataRequest(raw,kind){
  if(typeof raw==="string"&&raw.length<=16000&&raw.startsWith("dk-jellyfin://")&&["json","image"].includes(kind)){
    if(metadataBusy>=4)return {ok:false,status:429};
    metadataBusy++;try{return await jellyfinMetadata(raw,kind);}finally{metadataBusy--;}
  }
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
// One language preference for the two persistent standalone views.
let interfaceLanguage=null,languageRevision=0;
const languageFile=()=>path.join(app.getPath("userData"),"interface-language.json");
function readInterfaceLanguage(fallback){
  if(interfaceLanguage)return interfaceLanguage;
  try{
    const saved=JSON.parse(fs.readFileSync(languageFile(),"utf8"));
    if(["en","ru"].includes(saved.language))interfaceLanguage=saved.language;
  }catch(_){}
  if(!interfaceLanguage)interfaceLanguage=fallback==="ru"?"ru":"en";
  return interfaceLanguage;
}
function writeInterfaceLanguage(value){
  const dest=languageFile(),temp=dest+".tmp";
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.writeFileSync(temp,JSON.stringify({language:value}),{mode:0o600});
  fs.renameSync(temp,dest);
  interfaceLanguage=value;languageRevision++;
  const state={language:value,revision:languageRevision};
  if(home&&!home.isDestroyed())home.webContents.send("dk-library:language-changed",state);
  if(installedWindow())player.webContents.send("dk-library:language-changed",state);
  return state;
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
  if(page==="player")stopTVBackground();
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
// Local playlist import is intentionally separate from the Live TV URL importer.
// Only a native file chooser and a second, explicit approval can grant local entries.
let localPlaylistBusy=false;
const LOCAL_PLAYLIST_LIMIT=1024*1024;
// A small bounded XML reader for local playlist containers only. It has no
// entity resolver, DTD, namespace rewriting, filesystem or network callbacks.
function playlistXMLText(value){
  if(/&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/.test(value))throw Error("Invalid XML entity");
  return value.replace(/&(amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});/g,(_,entity)=>{
    if(entity[0]!=="#")return {amp:"&",lt:"<",gt:">",quot:'"',apos:"'"}[entity];
    const n=entity[1]==="x"?parseInt(entity.slice(2),16):Number(entity.slice(1));
    if(n>0x10ffff||n===0||n>=0xd800&&n<=0xdfff||n<32&&![9,10,13].includes(n))throw Error("Invalid XML character");
    return String.fromCodePoint(n);
  });
}
function playlistXMLValues(source,ext){
  if(/<!DOCTYPE|<!ENTITY/i.test(source))throw Error("DTD not supported");
  const expected=ext===".xspf"?"playlist":ext===".wpl"?"smil":"asx";
  const tokens=/<\!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/[A-Za-z_][\w.:-]*\s*>|<[A-Za-z_][\w.:-]*(?:[^<>"']|"[^"]*"|'[^']*')*>|[^<]+/gy;
  const stack=[],values=[];
  let pos=0,rootSeen=false,rootClosed=false,trackTaken=false,entryTaken=false;
  const push=value=>{if(values.length>=256)throw Error("Too many playlist entries");values.push(value);};
  const signature=()=>stack.map(node=>node.name).join("/");
  while(pos<source.length){
    tokens.lastIndex=pos;
    const m=tokens.exec(source);
    if(!m)throw Error("Invalid playlist XML");
    const token=m[0];pos=tokens.lastIndex;
    if(token.startsWith("<!--"))continue;
    if(token.startsWith("<?")){
      if(rootSeen||!/^<\?(?:xml(?:\s|[?])|wpl(?:\s|[?]))/i.test(token))throw Error("Unsupported XML instruction");
      continue;
    }
    if(token.startsWith("<![CDATA[")){
      if(signature()==="playlist/tracklist/track/location")stack[stack.length-1].text+=token.slice(9,-3);
      else if(!stack.length)throw Error("Invalid XML text");
      continue;
    }
    if(token.startsWith("</")){
      const node=stack.pop();
      if(!node||node.raw!==token.slice(2,-1).trim())throw Error("Mismatched XML element");
      if(ext===".xspf"&&node.name==="location"&&signature()==="playlist/tracklist/track"&&!trackTaken&&node.text.trim()){
        push(node.text.trim());trackTaken=true;
      }
      if(!stack.length)rootClosed=true;
      continue;
    }
    if(token.startsWith("<")){
      const start=/^<([A-Za-z_][\w.:-]*)/.exec(token);
      if(!start)throw Error("Invalid XML element");
      const raw=start[1],name=raw.toLowerCase(),self=/\/\s*>$/.test(token);
      let attrs=token.slice(start[0].length,token.length-(self?2:1)).trim();
      const properties=new Map();
      while(attrs){
        const attr=/^([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs);
        if(!attr||properties.has(attr[1].toLowerCase()))throw Error("Invalid XML attribute");
        properties.set(attr[1].toLowerCase(),playlistXMLText(attr[2]??attr[3]));
        attrs=attrs.slice(attr[0].length);
        if(attrs&&!/^\s/.test(attrs))throw Error("Invalid XML attribute spacing");
        attrs=attrs.trimStart();
      }
      if(properties.has("xml:base")||name==="base")throw Error("Playlist base override not supported");
      if(!stack.length){
        if(rootSeen||rootClosed||name!==expected)throw Error("Invalid playlist root");
        rootSeen=true;
      }
      if(stack.length>=32)throw Error("Playlist XML too deep");
      stack.push({name,raw,text:""});
      const sig=signature();
      if(sig==="playlist/tracklist/track")trackTaken=false;
      if(sig==="asx/entry")entryTaken=false;
      if(sig==="asx/entry/ref"&&!entryTaken&&properties.get("href")){
        push(properties.get("href"));entryTaken=true;
      }
      if(sig==="smil/body/seq/media"&&properties.get("src"))push(properties.get("src"));
      if(self){stack.pop();if(!stack.length)rootClosed=true;}
      continue;
    }
    if(!stack.length&&token.trim())throw Error("Invalid XML text");
    const value=playlistXMLText(token);
    if(signature()==="playlist/tracklist/track/location"){
      const node=stack[stack.length-1];
      node.text+=value;
      if(node.text.length>4096)throw Error("Playlist address too long");
    }
  }
  if(stack.length||!rootSeen||!rootClosed)throw Error("Incomplete playlist XML");
  return values;
}

function cuePlaylistFiles(source){
  const files=[];let file=null,track=null,tracks=0;
  for(const line of source.split(/\r?\n/)){
    const value=line.trim();
    if(!value)continue;
    if(/^FILE\b/i.test(value)){
      const match=/^FILE\s+(?:"([^"]+)"|(.+?))\s+[A-Z0-9_]+\s*$/i.exec(value);
      if(!match||files.length>=256)throw Error("Invalid CUE file reference");
      file={value:match[1]||match[2],chapters:[]};files.push(file);track=null;
    }else if(/^TRACK\b/i.test(value)){
      const match=/^TRACK\s+(\d{1,3})\s+[A-Z0-9_/]+\s*$/i.exec(value);
      if(!file||!match||Number(match[1])<1||++tracks>256)throw Error("Invalid CUE track");
      track={number:Number(match[1]),text:"",indexed:false};
    }else if(/^TITLE\b/i.test(value)&&track){
      const match=/^TITLE\s+(?:"([^"]*)"|(.+))$/i.exec(value);
      if(match)track.text=(match[1]??match[2]).replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,"").slice(0,200);
    }else if(/^INDEX\s+01\b/i.test(value)){
      const match=/^INDEX\s+01\s+(\d{1,6}):(\d{2}):(\d{2})\s*$/i.exec(value);
      if(!track||track.indexed||!match||Number(match[2])>=60||Number(match[3])>=75)throw Error("Invalid CUE index");
      const startTime=Number(match[1])*60+Number(match[2])+Number(match[3])/75;
      if(file.chapters.length&&startTime<=file.chapters[file.chapters.length-1].startTime)throw Error("Unordered CUE indexes");
      file.chapters.push({number:track.number,text:track.text,startTime});track.indexed=true;
    }
  }
  if(!files.length)throw Error("Empty CUE sheet");
  return files;
}

function localPlaylistPaths(raw,filename){
  const source=raw.replace(/^\uFEFF/,"");
  if(source.includes("\0")||/#EXT-X-/i.test(source))throw Error("Not a local media playlist");
  let values=[],cueFiles=[];
  const ext=path.extname(filename).toLowerCase();
  if(ext===".cue"){
    cueFiles=cuePlaylistFiles(source);values=cueFiles.map(file=>file.value);
  }else if(ext===".pls"){
    const lines=source.split(/\r?\n/);
    if(!lines.some(line=>/^\s*\[playlist\]\s*$/i.test(line)))throw Error("Invalid PLS");
    const numbered=new Map();
    for(const line of lines){
      const match=/^\s*File(\d{1,6})\s*=(.*)$/i.exec(line);
      if(match&&Number(match[1])>0&&!numbered.has(Number(match[1])))numbered.set(Number(match[1]),match[2]);
    }
    values=[...numbered].sort((a,b)=>a[0]-b[0]).map(entry=>entry[1]);
  }else if(ext===".m3u"||ext===".m3u8"){
    values=source.split(/\r?\n/).filter(line=>line.trim()&&!line.trimStart().startsWith("#"));
  }else if([".xspf",".asx",".wax",".wvx",".wpl"].includes(ext)){
    values=playlistXMLValues(source,ext);
  }else throw Error("Unsupported playlist");
  if(values.length>256)throw Error("Too many playlist entries");
  const targets=[],seen=new Set(),cueChapters=new Map();
  let skipped=0;
  for(const [index,rawValue] of values.entries()){
    const value=rawValue.trim();
    try{
      if(!value||value.length>4096||/[\x00-\x1f\x7f]/.test(value)||value.startsWith("//")||value.startsWith("\\\\"))throw Error();
      let target;
      if(ext===".xspf"){
        // XSPF locations are URI references, not literal filesystem strings.
        const url=new URL(value,pathToFileURL(filename));
        if(url.protocol!=="file:"||url.host||url.search||url.hash||url.username||url.password)throw Error();
        target=fileURLToPath(url);
      }else if(/^file:/i.test(value)){
        const url=new URL(value);
        if(url.host||url.search||url.hash||url.username||url.password)throw Error();
        target=fileURLToPath(url);
      }else{
        if(/^[a-z][a-z0-9+.-]*:/i.test(value))throw Error();
        target=path.resolve(path.dirname(filename),value);
      }
      if(seen.has(target)){skipped++;continue;}
      seen.add(target);targets.push(target);
      if(ext===".cue")cueChapters.set(target,cueFiles[index].chapters);
    }catch(_){skipped++;}
  }
  return {targets,skipped,cueChapters};
}
async function importLocalPlaylist(language){
  if(localPlaylistBusy)return {cancelled:true};
  localPlaylistBusy=true;
  const ru=language==="ru";
  try{
    const selected=await dialog.showOpenDialog(home,{
      title:ru?"Открыть список воспроизведения":"Open local playlist",
      properties:["openFile"],
      filters:[{name:ru?"Списки воспроизведения":"Playlists",extensions:["m3u","m3u8","pls","xspf","asx","wax","wvx","wpl","cue"]}]
    });
    if(selected.canceled||!selected.filePaths[0])return {cancelled:true};
    const filename=selected.filePaths[0];
    const handle=await fs.promises.open(filename,fs.constants.O_RDONLY|fs.constants.O_NONBLOCK);
    let raw;
    try{
      const stat=await handle.stat();
      if(!stat.isFile()||stat.size>LOCAL_PLAYLIST_LIMIT)throw Error("Invalid playlist size");
      const buffer=Buffer.alloc(LOCAL_PLAYLIST_LIMIT+1);
      let offset=0;
      while(offset<buffer.length){
        const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,offset);
        if(!bytesRead)break;
        offset+=bytesRead;
      }
      if(offset>LOCAL_PLAYLIST_LIMIT)throw Error("Playlist too large");
      raw=new TextDecoder("utf-8",{fatal:true}).decode(buffer.subarray(0,offset));
    }finally{await handle.close();}
    const parsed=localPlaylistPaths(raw,filename);
    const entries=[];let skipped=parsed.skipped;
    for(const target of parsed.targets){
      try{
        const id=native.fileIdentity(target);
        const opened=await native.openVideo(id,target);
        entries.push({row:{id,nativePath:target,filename:opened.name,size:opened.size,modified:opened.modified},opened,cueChapters:parsed.cueChapters.get(target)||[]});
      }catch(_){skipped++;}
    }
    if(!entries.length)return {rows:[],skipped};
    // Show each resolved path before granting it; no network entries are fetched.
    const preview=entries.map(e=>e.row.nativePath.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,"?")).join("\n");
    const confirmation=await dialog.showMessageBox(home,{
      type:"question",title:ru?"Импорт списка":"Import playlist",
      message:ru?"Добавить выбранные видео в очередь?":"Add these local videos to the queue?",
      detail:(ru?"Файлов: ":"Files: ")+entries.length+(ru?". Пропущено: ":". Skipped: ")+skipped+"\n\n"+preview,
      buttons:ru?["Отмена","Добавить"]:["Cancel","Add"],defaultId:0,cancelId:0,noLink:true
    });
    return confirmation.response===1?{rows:entries,skipped}:{cancelled:true};
  }finally{localPlaylistBusy=false;}
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
  void jfStart();app.once("before-quit",jfStop);
  // Chromium owns the PNG transfer; only this Player view's named Blob
  // snapshots receive the localized native save prompt. No arbitrary paths
  // or filesystem API are exposed to the renderer.
  const snapshotDownloads=home.webContents.session;
  const onSnapshotDownload=(event,item,contents)=>{
    if(!installedWindow()||contents!==player.webContents||
       !/^DK-Kinehall-Snapshot-\d{1,16}-\d{1,12}s\.png$/.test(item.getFilename())||
       !item.getURL().startsWith("blob:"))return;
    const bytes=item.getTotalBytes();
    if(item.getMimeType()!=="image/png"||bytes>160*1024*1024){event.preventDefault();return;}
    const ru=readInterfaceLanguage("en")==="ru";
    item.setSaveDialogOptions({title:ru?"Сохранить кадр видео":"Save video snapshot",
      defaultPath:path.join(app.getPath("pictures"),item.getFilename()),
      filters:[{name:ru?"Изображение ПНГ":"PNG image",extensions:["png"]}]});
  };
  snapshotDownloads.on("will-download",onSnapshotDownload);
  home.once("closed",()=>snapshotDownloads.removeListener("will-download",onSnapshotDownload));
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
  cleanVoiceCacheTemporary();
  app.on("second-instance",(_event,argv,cwd)=>enqueueExternal(argv,cwd));
  ipcMain.handle("dk-library:language-get",(event,fallback)=>{
    if(!allowed(event)&&!onlyPlayer(event))throw Error("Language request rejected");
    return {language:readInterfaceLanguage(fallback),revision:languageRevision};
  });
  ipcMain.handle("dk-library:language-set",(event,value)=>{
    if((!allowed(event)&&!onlyPlayer(event))||!["en","ru"].includes(value))throw Error("Language request rejected");
    return writeInterfaceLanguage(value);
  });
  ipcMain.handle("dk-live-tv:atsc-status",event=>{
    if(!allowed(event)||activePage!=="library")throw Error("ATSC request rejected");
    return atscReady();
  });
  ipcMain.handle("dk-live-tv:atsc-run",(event,action,device)=>{
    if(!allowed(event)||activePage!=="library")throw Error("ATSC request rejected");
    return runAtsc(action,device,event.sender);
  });
  ipcMain.handle("dk-live-tv:atsc-cancel",event=>{
    if(!allowed(event)||activePage!=="library")throw Error("ATSC request rejected");
    return cancelAtsc();
  });
  ipcMain.handle("dk-live-tv:local-tuners",event=>{
    if(!onlyPlayer(event)&&!(allowed(event)&&activePage==="library"))throw Error("Tuner request rejected");
    return listLocalTVTuners();
  });
  ipcMain.handle("dk-live-tv:discover",event=>{
    if(!onlyPlayer(event)&&!(allowed(event)&&activePage==="library"))throw Error("Tuner request rejected");
    return discoverLiveTuners();
  });
  ipcMain.handle("dk-live-tv:lineup",(event,host)=>{
    if(!onlyPlayer(event)&&!(allowed(event)&&activePage==="library"))throw Error("Tuner request rejected");
    return loadLiveLineup(host);
  });
  ipcMain.handle("dk-live-tv:grant",(event,id)=>{
    if(!onlyPlayer(event)||typeof id!=="string")throw Error("Tuner request rejected");
    return grantLiveChannel(id);
  });
  ensureDVR();
  ipcMain.handle("dk-live-tv:check",(event,url,force)=>{
    if(!allowed(event)||activePage!=="library")throw Error("TV check rejected");return checkTV(url,force===true);
  });
  ipcMain.handle("dk-live-tv:played",(event,token)=>{
    if(!onlyPlayer(event))return false;const e=networkGrants.get(token);if(!e?.url||e.lan)return false;rememberCheck(e.url.href,"working");return true;
  });
  ipcMain.handle("dk-live-tv:guide-cache",(event,action,value)=>{
    if(!allowed(event)||activePage!=="library")throw Error("Guide cache rejected");
    if(action==="read")return tvRead("guide.json",null);
    if(action==="write"&&value&&Array.isArray(value.programs)&&Array.isArray(value.names)&&value.programs.length<=10000&&value.names.length<=40000){tvWrite("guide.json",value);return true;}throw Error("Invalid guide cache");
  });
  ipcMain.handle("dk-live-tv:dvr",async(event,action,row)=>{
    if(!allowed(event)||activePage!=="library")throw Error("Recording request rejected");
    const s=getDVR();
    if(action==="folder"){const picked=await dialog.showOpenDialog(home,{properties:["openDirectory","createDirectory"]});if(!picked.canceled&&picked.filePaths[0]){s.folder=fs.realpathSync(picked.filePaths[0]);saveDVR();}}
    else if(action==="add")newDVRJob(row);
    else if(action==="series"){const url=tvURL(row?.url),title=tvString(row?.title);if(!url||!title||!s.folder)throw Error("Invalid series or recording folder");if(!s.series.some(x=>x.url===url&&x.title===title)&&s.series.length<100){s.series.push({url,title});saveDVR();}newDVRJob(row);}
    else if(action==="sync")updateSeries(row);
    else if(action==="cancel"){const j=s.jobs.find(x=>x.id===row);if(j&&["scheduled","recording"].includes(j.state)){const recording=j.state==="recording";j.state="cancelled";if(recording)dvrChild?.kill("SIGINT");saveDVR();}}
    else if(action==="remove-series"){s.series=s.series.filter(x=>!(x.url===row?.url&&x.title===row?.title));saveDVR();}
    else if(action!=="status")throw Error("Unknown recording action");
    return s;
  });
  ipcMain.handle("dk-live-tv:buffer",async(event,action,token)=>{
    if(!onlyPlayer(event))throw Error("Buffer request rejected");
    if(action==="start")return startBuffer(token);
    if(action==="snapshot")return snapshotBuffer(token);
    if(action==="stop"){if(bufferJob?.source===token)return stopBuffer();return false;}
    throw Error("Invalid buffer action");
  });
  ipcMain.handle("dk-live-tv:catalog",(event,rows)=>{
    if(!allowed(event)||activePage!=="library")throw Error("TV catalog request rejected");
    return matchTvCatalog(rows);
  });
  ipcMain.handle("dk-live-tv:resource",(event,url,kind)=>{
    if(!allowed(event)||activePage!=="library")throw Error("TV resource request rejected");
    if(kind==="catalog")throw Error("Use channel catalog lookup");return liveResource(url,kind);
  });
  ipcMain.handle("dk-live-tv:play",async(event,kind,value,name,artwork,alternates=[])=>{
    if(!allowed(event)||activePage!=="library"||!["tuner","url"].includes(kind)||
       typeof value!=="string"||typeof name!=="string"||name.length>250)throw Error("Live TV request rejected");
    let grant=null;
    try{
      const candidates=kind==="url"?[value,...(Array.isArray(alternates)?alternates.slice(0,2):[])]:[value];
      let selected=-1;
      for(let i=0;i<candidates.length;i++){
        if(typeof candidates[i]!=="string"||candidates[i].length>4096)continue;
        try{
          if(i>0){const other=new URL(candidates[i]);if(privateIPv4(other.hostname))continue;}
          grant=kind==="tuner"?await grantLiveChannel(candidates[i]):await grantExplicitLiveStream(candidates[i]);selected=i;break;
        }catch(_){}
      }
      if(!grant)throw Error("No compatible stream address");
      const entry=networkGrants.get(grant.token);
      if(kind==="url"&&entry&&!entry.lan)entry.alternates=[...new Set(candidates.slice(selected+1).filter(x=>typeof x==="string"&&x.length<=4096))].slice(0,2);
      await openPlayer(null,false,true);
      if(!installedWindow()||activePage!=="library")throw Error("Player unavailable");
      showPage("player");
      const art=typeof artwork==="string"&&artwork.length<=400000&&(/^(?:data:image\/(?:png|jpeg|webp|gif|avif|svg\+xml);base64,[A-Za-z0-9+/=]+|\.\/assets\/channel_logos\/builtin\/[A-Za-z0-9_.%()-]+\.bmp)$/.test(artwork))?artwork:"";
      player.webContents.send("dk-live-tv:play-channel",{grant,name,artwork:art});
      grant=null;
      return true;
    }finally{if(grant){const entry=networkGrants.get(grant.token);networkGrants.delete(grant.token);for(const client of entry?.clients||[])client.destroy();}}
  });
  ipcMain.handle("dk-network:discover",event=>{
    if(!onlyPlayer(event)&&!(allowed(event)&&activePage==="library"))throw Error("Network request rejected");return discoverNetwork();
  });
  ipcMain.handle("dk-network:register",(event,value)=>{
    if(!onlyPlayer(event))throw Error("Network request rejected");
    return registerNetworkServer(value);
  });
  ipcMain.handle("dk-network:description",(event,id)=>{
    if(!onlyPlayer(event))throw Error("Network request rejected");return networkDescription(id);
  });
  ipcMain.handle("dk-network:browse",(event,id,control,type,objectId,start,query=null)=>{
    if(!onlyPlayer(event))throw Error("Network request rejected");return browseNetwork(id,control,type,objectId,start,query);
  });
  ipcMain.handle("dk-network:grant",(event,id,url)=>{
    if(!onlyPlayer(event))throw Error("Network request rejected");return id===null?grantExplicitLiveStream(url):grantNetwork(id,url);
  });
  ipcMain.handle("dk-network:dash-grant",(event,url,language)=>{
    if(!onlyPlayer(event))throw Error("DASH request rejected");return grantDASH(url,language);
  });
  ipcMain.handle("dk-network:transfer-grant",(event,url,language)=>{
    if(!onlyPlayer(event))throw Error("Remote file request rejected");return grantTransfer(url,language);
  });
  ipcMain.handle("dk-network:mms-grant",(event,url,language)=>{
    if(!onlyPlayer(event))throw Error("MMS request rejected");return grantMMS(url,language);
  });
  ipcMain.handle("dk-network:rist-grant",(event,url,language)=>{
    if(!onlyPlayer(event))throw Error("RIST request rejected");return grantRIST(url,language);
  });
  ipcMain.handle("dk-network:srt-grant",(event,url,language)=>{
    if(!onlyPlayer(event))throw Error("SRT request rejected");return grantSRT(url,language);
  });
  ipcMain.handle("dk-network:rtmp-grant",(event,url,language)=>{
    if(!onlyPlayer(event))throw Error("RTMP request rejected");return grantRTMP(url,language);
  });
  ipcMain.handle("dk-network:rtsp-grant",(event,url,language,mode)=>{
    if(!onlyPlayer(event))throw Error("RTSP request rejected");return grantRTSP(url,language,mode);
  });
  ipcMain.handle("dk-network:sap-discover",event=>{
    if(!onlyPlayer(event))throw Error("SAP discovery rejected");return discoverSAP();
  });
  ipcMain.handle("dk-network:datagram-grant",(event,url)=>{
    if(!onlyPlayer(event))throw Error("Datagram request rejected");return grantDatagram(url);
  });
  ipcMain.handle("dk-network:stream-policy",(event,token,policy)=>{
    if(!onlyPlayer(event))throw Error("Network policy rejected");
    const e=networkGrants.get(token);if(!e)return false;
    const quality=["auto","source","360","480","720","1080"].includes(policy?.quality)?policy.quality:"auto";
    e.streamPolicy={quality,level:Math.max(0,Math.min(4,Math.floor(Number(policy?.level)||0)))};e.variantLock=null;e.adaptive=null;
    return true;
  });
  ipcMain.handle("dk-network:stream-stats",(event,token)=>{
    if(!onlyPlayer(event))throw Error("Network statistics rejected");
    const e=networkGrants.get(token);if(!e)return null;
    return {measuredBps:Math.round(e.measuredBps||0),selectedBitrate:e.selectedBitrate||0,selectedHeight:e.selectedHeight||0,cacheBytes:tvSegmentBytes,segmentRetries:e.segmentRetries||0,adaptiveSwitches:e.adaptive?.switches||0,adaptiveActive:e.adaptive?.enabled===true&&e.adaptive.history.size>0,datagramDrops:e.datagramDrops||0};
  });
  ipcMain.handle("dk-live-tv:alternate",async(event,token)=>{
    if(!onlyPlayer(event))return false;
    const entry=networkGrants.get(token);if(!entry||entry.lan||entry.datagram||entry.rtsp||entry.rtmp||entry.srt||entry.rist||entry.dash||entry.mms||entry.transfer||entry.switching)return false;
    entry.switching=true;
    try{
      while(entry.alternates?.length){
        const next=entry.alternates.shift();
        try{
          const target=await streamTarget(next);
          if(networkGrants.get(token)!==entry)return false;
          for(const client of entry.clients)client.destroy();
          clearTVSegments(token);entry.url=target.url;entry.parts?.clear();entry.partKeys?.clear();entry.failure=null;entry.measuredBps=0;entry.sampleRevision=0;entry.selectedBitrate=0;entry.selectedHeight=0;entry.variantLock=null;entry.adaptive=null;entry.segmentRetries=0;
          return true;
        }catch(_){}
      }
      return false;
    }finally{entry.switching=false;}
  });
  ipcMain.handle("dk-network:release",(event,token)=>{
    if(!onlyPlayer(event))return false;
    const entry=networkGrants.get(token);
    if(!entry)return false;
    if(bufferJob?.source===token)stopBuffer();
    entry.srtReceiver?.stop();clearTVSegments(token);networkGrants.delete(token);
    for(const client of entry.clients)client.destroy();
    return true;
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
  ipcMain.handle("dk-library:export-translated-srt",async(event,content,language,generated)=>{
    if(!onlyPlayer(event)||exportingSubtitles||typeof content!=="string"||!content.trim()||
       Buffer.byteLength(content,"utf8")>8*1024*1024)throw Error("Subtitle export rejected");
    exportingSubtitles=true;
    try{
      const ru=language==="ru";
      const chosen=await dialog.showSaveDialog(home,{title:generated?(ru?"Сохранить созданные субтитры":"Save generated subtitles"):(ru?"Сохранить переведённые субтитры":"Save translated subtitles"),
        defaultPath:generated?"generated-subtitles.srt":"translated-subtitles.srt",filters:[{name:ru?"Субтитры СРТ":"SRT subtitles",extensions:["srt"]}]});
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
  ipcMain.handle("dk-library:speaker-status",event=>{
    if(!onlyPlayer(event))throw Error("Speaker request rejected");
    return diarizationPaths().ready;
  });
  ipcMain.handle("dk-library:speaker-identify",(event,source,audioIndex,ticket)=>{
    if(!onlyPlayer(event))throw Error("Speaker request rejected");
    return identifySpeakers(event,source,audioIndex,ticket);
  });
  ipcMain.handle("dk-library:asr-status",event=>{
    if(!onlyPlayer(event))throw Error("Speech recognition request rejected");
    return asrPaths().ready;
  });
  ipcMain.handle("dk-library:asr-generate",(event,source,language,audioIndex,ticket)=>{
    if(!onlyPlayer(event))throw Error("Speech recognition request rejected");
    return generateASR(event,source,language,audioIndex,ticket);
  });
  ipcMain.handle("dk-library:asr-cancel",event=>{
    if(!onlyPlayer(event))throw Error("Speech recognition request rejected");
    cancelASR();return true;
  });
  ipcMain.handle("dk-library:voiceover-cache-stats",event=>{
    if(!onlyPlayer(event))throw Error("Voiceover cache request rejected");
    return voiceCacheStats();
  });
  ipcMain.handle("dk-library:voiceover-cache-clear",(event,language)=>{
    if(!onlyPlayer(event)||!["en","ru"].includes(language))throw Error("Voiceover cache request rejected");
    return clearVoiceCache(language);
  });
  ipcMain.handle("dk-library:voiceover-status",(event,pair,profile="default")=>{
    if(!onlyPlayer(event))throw Error("Voiceover request rejected");
    return voiceoverPaths(pair,profile).ready;
  });
  ipcMain.handle("dk-library:voiceover-generate",(event,pair,rows,ticket,profile="default",progressive=false,position=0)=>{
    if(!onlyPlayer(event))throw Error("Voiceover request rejected");
    return generateVoiceover(event,pair,rows,ticket,profile,progressive,position);
  });
  ipcMain.handle("dk-library:voiceover-priority",(event,ticket,seconds)=>{
    if(!onlyPlayer(event)||!Number.isSafeInteger(ticket)||!Number.isFinite(seconds)||seconds<0||seconds>10800)throw Error("Voiceover priority rejected");
    const job=voiceoverJob;
    if(!job||!job.progressive||job.cancelled||job.preview.ticket!==ticket)return false;
    const index=Math.floor(seconds/30);
    if(index===job.priorityIndex)return true;
    const dest=path.join(job.preview.dir,"priority.json");
    fs.writeFileSync(dest+".tmp",JSON.stringify({seconds}),{mode:0o600});
    fs.renameSync(dest+".tmp",dest);job.priorityIndex=index;
    return true;
  });
  ipcMain.handle("dk-library:voiceover-discard",event=>{
    if(!onlyPlayer(event))throw Error("Voiceover request rejected");
    discardVoiceover();return true;
  });
  ipcMain.handle("dk-library:voiceover-source",async(event,ticket,index=null)=>{
    if(!onlyPlayer(event)||!Number.isSafeInteger(ticket)||
      (index!==null&&(!Number.isInteger(index)||index<0||index>=360)))throw Error("Voiceover source rejected");
    const entry=[voiceoverResult,voiceoverJob?.preview].find(value=>value&&value.ticket===ticket&&!value.discarded);
    if(!entry||(index===null?!entry.complete:!entry.chunks.has(index)))throw Error("Voiceover source rejected");
    const port=await startNetworkProxy();
    if((voiceoverResult!==entry&&voiceoverJob?.preview!==entry)||entry.discarded)throw Error("Voiceover source expired");
    return "http://127.0.0.1:"+port+"/voiceover/"+entry.token+(index===null?"":"/"+index);
  });
  ipcMain.handle("dk-library:voiceover-export",async(event,ticket,language)=>{
    if(!onlyPlayer(event)||voiceoverExporting||voiceoverJob||!voiceoverResult||voiceoverResult.ticket!==ticket)throw Error("Voiceover export rejected");
    const result=voiceoverResult;voiceoverExporting=true;result.exporting=true;
    try{
      const ru=language==="ru";
      const chosen=await dialog.showSaveDialog(home,{title:ru?"Сохранить озвучивание":"Save voiceover",defaultPath:"voiceover.wav",filters:[{name:ru?"Звуковой файл ВАВ":"WAV audio",extensions:["wav"]}]});
      if(chosen.canceled||!chosen.filePath)return false;
      if(!/\.wav$/i.test(chosen.filePath))throw Error("WAV extension required");
      await fs.promises.copyFile(result.output,chosen.filePath,fs.constants.COPYFILE_EXCL);
      return true;
    }finally{voiceoverExporting=false;result.exporting=false;if(result.discarded)removeVoiceoverResult(result);}
  });
  home.on("closed",()=>{cancelASR();cancelTranslation();discardVoiceover();});
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
  ipcMain.handle("dk-library:import-local-playlist",(event,language)=>{
    if(!onlyPlayer(event)||activePage!=="player")throw Error("Playlist request rejected");
    return importLocalPlaylist(language);
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
  ipcMain.handle("dk-library:jellyfin-power",(event,enabled)=>{if(!allowed(event))throw Error("Server control rejected");return jfSetPower(enabled);});
  ipcMain.handle("dk-library:metadata-request",(event,url,kind)=>{
    if(!allowed(event))throw Error("Metadata request rejected");
    return metadataRequest(url,kind);
  });
  // Use the existing persistent Player renderer as the sole settings owner.
  // Library requests are limited to its explicit shared settings API, never
  // renderer-provided JavaScript, selectors or localStorage keys.
  ipcMain.handle("dk-library:open-media-tool",async(event,kind)=>{
    if(!allowed(event)||activePage!=="library"||!["network","disc","live-tv"].includes(kind))throw Error("Media tool request rejected");
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
    return player.webContents.executeJavaScript("window.DKSharedSettings.snapshot()");
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
    const wasScanning=scanActive;scanActive=Boolean(value);
    if(wasScanning&&!scanActive)jfSync(true);
    if(home&&!home.isDestroyed())home.webContents.send("dk-library:scan-state",scanActive);
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
  getLibrarySources();
  ipcMain.handle("dk-library:sources",event=>{
    if(!allowed(event))throw Error("Library sources request rejected");return getLibrarySources();
  });
  ipcMain.handle("dk-library:add-source",async(event,kind,language)=>{
    if(!allowed(event)||!["movie","tv"].includes(kind)||scanPromise)throw Error("Library source request rejected");
    const ru=language==="ru",picked=await dialog.showOpenDialog(home,{title:kind==="movie"?(ru?"Выберите папку фильмов":"Choose Movies folder"):(ru?"Выберите папку сериалов":"Choose TV Shows folder"),properties:["openDirectory"]});
    if(picked.canceled||!picked.filePaths[0])return getLibrarySources();
    if(scanPromise)throw Error("Stop the current scan first");
    const root=await fs.promises.realpath(picked.filePaths[0]),rows=getLibrarySources();
    if(root===path.parse(root).root||!(await fs.promises.stat(root)).isDirectory()||root.length>4096)throw Error("Choose a specific media folder");
    if(rows.some(r=>r.path===root&&r.kind===kind))return rows;
    if(rows.length>=128||rows.some(r=>inSource(r.path,root)||inSource(root,r.path)))throw Error("Library folders must not overlap");
    return saveLibrarySources([...rows,{id:randomBytes(16).toString("hex"),path:root,kind}]);
  });
  ipcMain.handle("dk-library:remove-source",(event,id)=>{
    if(!allowed(event)||scanPromise)throw Error("Library source request rejected");
    return saveLibrarySources(getLibrarySources().filter(r=>r.id!==id));
  });
  ipcMain.handle("dk-library:discover",async(event,manual=false)=>{
    if(!allowed(event))throw Error("Native discovery rejected");
    if(scanPromise)return scanPromise;
    const sources=getLibrarySources().slice();
    if(!sources.length)return {items:[],sources,roots:[],rejected:[],errors:[],complete:true,partial:false,cancelled:false,found:0};
    scanController=new AbortController();
    scanPromise=(async()=>{
      const roots=[],errors=[];for(const source of sources){try{if(await fs.promises.realpath(source.path)!==source.path)throw Error("Folder changed");roots.push(source.path);}catch(_){errors.push({path:source.path,operation:"open-directory",code:"SOURCE_UNAVAILABLE"});}}
      const result=await native.discover({testRoots:roots,
      manual:Boolean(manual),signal:scanController.signal,probe:probeAvailable?probeLibraryVideo:null,
      onProgress:p=>{
        if(home&&!home.isDestroyed())
          home.webContents.send("dk-library:scan-progress",p);
      }
    });
      const byRoot=new Map(sources.map(r=>[r.path,r]));
      result.items=result.items.filter(file=>byRoot.has(file.root)).map(file=>({...file,category:byRoot.get(file.root).kind,sourceId:byRoot.get(file.root).id}));
      return {...result,sources,errors:[...errors,...result.errors],complete:result.complete&&!errors.length,partial:result.partial||!!errors.length};
    })();
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
  ipcMain.handle("dk-library:playback-availability",(event,id,filePath)=>{
    // Both trusted standalone views preflight the file before playback.
    // Keep the native file identity, path and scope checks in the indexer.
    if(!allowed(event)&&!onlyPlayer(event))throw Error("File status request rejected");
    return native.playbackAvailability(id,filePath);
  });
  ipcMain.handle("dk-library:locate-file",async(event,language)=>{
    if(!allowed(event))throw Error("File location request rejected");
    const ru=language==="ru",picked=await dialog.showOpenDialog(home,{title:ru?"Найти перемещённое видео":"Locate moved video",properties:["openFile"]});
    if(picked.canceled||!picked.filePaths[0])return null;
    const result=await native.relocationCandidate(picked.filePaths[0]);
    const source=getLibrarySources().find(r=>inSource(r.path,result.nativePath));
    if(!source)throw Error("Choose a file inside an assigned library folder");
    return {...result,root:source.path,relative:path.relative(source.path,result.nativePath).split(path.sep).join("/"),category:source.kind,sourceId:source.id};
  });
  ipcMain.handle("dk-library:check-catalog-paths",(event,rows)=>{
    if(!allowed(event))throw Error("Catalog status request rejected");
    return native.checkCatalogPaths(rows);
  });
  let fileInfoBusy=false;
  ipcMain.handle("dk-library:file-info",async(event,id,filePath)=>{
    if(!allowed(event))throw Error("File information request rejected");
    const {target,stat}=await native.checkVideo(id,filePath);
    const result={filename:path.basename(target),path:target,size:stat.size,
      extension:path.extname(target).slice(1).toUpperCase(),streams:[],probeStatus:"unavailable"};
    if(!probeAvailable||fileInfoBusy)return result;
    fileInfoBusy=true;
    try{
      const data=await new Promise(resolve=>{
        let child;
        try{child=spawn(probeBin,["-v","error","-protocol_whitelist","file,pipe",
          "-show_entries","format=format_name,duration:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,channels,channel_layout:stream_tags=language:stream_disposition=attached_pic",
          "-of","json","-i",target],{shell:false,stdio:["ignore","pipe","ignore"],
          env:{...process.env,LD_LIBRARY_PATH:path.join(app.getAppPath(),"lib")+path.delimiter+(process.env.LD_LIBRARY_PATH||"")}});}
        catch(_){resolve(null);return;}
        let output="",done=false;
        const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
        const abort=()=>{child.kill("SIGKILL");finish(null);};
        const timer=setTimeout(abort,10000);
        child.stdout.on("data",chunk=>{if(done)return;output+=chunk;if(output.length>256*1024)abort();});
        child.on("error",()=>finish(null));
        child.on("close",code=>{if(code!==0){finish(null);return;}try{finish(JSON.parse(output));}catch(_){finish(null);}});
      });
      if(data){
        result.format=String(data.format?.format_name||"");
        result.duration=Number(data.format?.duration)||null;
        result.streams=(Array.isArray(data.streams)?data.streams:[]).filter(stream=>
          ["video","audio","subtitle"].includes(stream.codec_type)&&!Number(stream.disposition?.attached_pic));
        result.probeStatus="ok";
      }else result.probeStatus="failed";
      return result;
    }finally{fileInfoBusy=false;}
  });
  ipcMain.handle("dk-library:show-in-folder",async(event,id,filePath)=>{
    if(!allowed(event))throw Error("File location request rejected");
    const {target}=await native.checkVideo(id,filePath);
    shell.showItemInFolder(target);
    return true;
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
    jfStop();cancelAtsc();closeNetwork();scanController?.abort();
    if(installedWindow())player.webContents.close();
    player=null;home=null;
  });
}
module.exports={install,checkPlayableSource,resolveNetworkMedia,rtspOptions,mmsCandidates,selectMMS,networkTransport:token=>networkGrants.get(token)?.rtsp?"rtsp":networkGrants.get(token)?.rtmp?(networkGrants.get(token).rtmpSecure?"rtmps":"rtmp"):networkGrants.get(token)?.srt?"srt":networkGrants.get(token)?.rist?"rist":networkGrants.get(token)?.dash?"dash":networkGrants.get(token)?.mms?"mms":networkGrants.get(token)?.transferProtocol||networkGrants.get(token)?.datagram?.protocol||"http",networkFailure:token=>networkGrants.get(token)?.failure||null};
