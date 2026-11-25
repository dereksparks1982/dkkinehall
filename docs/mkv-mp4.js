/* DK Kinehall: bounded, lossless AVC/AAC Matroska -> MP4 fallback.
 * Supports one H.264 AVC track without B-frame reordering and one AAC track.
 * No transcoding, server, codec downloads or original-file mutation.
 * Uses File slices for encoded samples; only MP4 tables are allocated.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.DKMkvMP4=api;
})(typeof globalThis!=="undefined"?globalThis:window,function(){
"use strict";
const MAX_SIZE=1024*1024*1024,MAX_SAMPLES=130000;
const VIDEO="V_MPEG4/ISO/AVC",AUDIO="A_AAC";
const encoder=new TextEncoder();
const u8=(...v)=>Uint8Array.from(v.map(x=>x&255));
const u16=n=>u8(n>>>8,n);
const u32=n=>u8(n>>>24,n>>>16,n>>>8,n);
const cat=(...parts)=>{
 const n=parts.reduce((v,p)=>v+p.length,0),out=new Uint8Array(n);let at=0;
 for(const p of parts){out.set(p,at);at+=p.length;}
 return out;
};
const ascii=s=>encoder.encode(s);
const box=(name,...parts)=>{
 const data=cat(...parts),len=8+data.length;
 if(len>0xffffffff)throw Error("MP4 box exceeds 4 GiB");
 return cat(u32(len),ascii(name),data);
};
const full=(name,version,flags,...parts)=>box(name,u8(version,(flags>>16)&255,(flags>>8)&255,flags&255),...parts);
const u64=n=>cat(u32(Math.floor(n/4294967296)),u32(n>>>0));
const fixed=n=>u32(Math.round(n*65536));
const matrix=cat(u32(65536),u32(0),u32(0),u32(0),u32(65536),u32(0),u32(0),u32(0),u32(0x40000000));
const vst=(bytes,pos=0,strip=false)=>{
 if(pos>=bytes.length||!bytes[pos])throw Error("Invalid EBML varint");
 let bit=128,width=1;
 while(!(bytes[pos]&bit)&&width<8){bit>>=1;width++;}
 if(pos+width>bytes.length)throw Error("Truncated EBML varint");
 let value=strip?bytes[pos]&(bit-1):bytes[pos];
 for(let i=1;i<width;i++)value=value*256+bytes[pos+i];
 const unknown=strip&&((bytes[pos]&(bit-1))===(bit-1))&&
   bytes.subarray(pos+1,pos+width).every(b=>b===255);
 if(!unknown&&!Number.isSafeInteger(value))throw Error("Unsafe EBML element size");
 return {value:unknown?0:value,width,unknown};
};
const uint=bytes=>{let n=0;for(const b of bytes)n=n*256+b;return n};
const float=bytes=>{
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 return bytes.length===4?d.getFloat32(0):bytes.length===8?d.getFloat64(0):0;
};
const reader=file=>({
 read:async(start,size)=>{
  if(size<0||size>65536||start<0||start+size>file.size)
   throw Error("Invalid EBML read");
  return new Uint8Array(await file.slice(start,start+size).arrayBuffer());
 },
 async *children(start,end){
  let at=start,iter=0;
  while(at<end){
   if(++iter>MAX_SAMPLES*5)throw Error("Too many EBML elements");
   const head=await this.read(at,Math.min(12,end-at));
   const id=vst(head,0),size=vst(head,id.width,true);
   const begin=at+id.width+size.width;
   const finish=size.unknown?end:begin+size.value;
   if(finish>end||finish<=at)throw Error("Malformed EBML bounds");
   yield {id:id.value,start:begin,end:finish,size:finish-begin};
   at=finish;
  }
 }
});
async function small(r,e,limit=65536){
 if(!e||e.size>limit)throw Error("Oversized or missing Matroska field");
 return r.read(e.start,e.size);
}
function eligible(info,file){
 if(!file||!/\.mkv$/i.test(String(file.name||""))||
    file.size>MAX_SIZE||typeof file.slice!=="function")return null;
 const videos=info?.videoTracks||[],audios=info?.audioTracks||[],
  subtitles=info?.tracks||info?.subtitles||[];
 if(videos.length!==1||videos[0].codec!==VIDEO||audios.length!==1||
    !audios[0].codec.startsWith(AUDIO)||subtitles.length)return null;
 return {video:videos[0],audio:audios[0]};
}
async function descriptors(r,segment){
 let scale=1000000,tracks=[],infoSeen=false;
 for await(const child of r.children(segment.start,segment.end)){
  if(child.id===0x1549a966){
   for await(const element of r.children(child.start,child.end))
    if(element.id===0x2ad7b1)scale=uint(await small(r,element,8));
   infoSeen=true;
  }else if(child.id===0x1654ae6b){
   for await(const entry of r.children(child.start,child.end)){
    if(entry.id!==0xae)continue;
    const t={type:0,number:0,codec:"",privateData:null,
      width:0,height:0,rate:48000,channels:2,defaultDuration:0};
    for await(const field of r.children(entry.start,entry.end)){
     if(field.id===0xd7)t.number=uint(await small(r,field,8));
     if(field.id===0x83)t.type=uint(await small(r,field,8));
     if(field.id===0x86)t.codec=new TextDecoder().decode(await small(r,field,128));
     if(field.id===0x63a2)t.privateData=await small(r,field,65536);
     if(field.id===0x23e383)t.defaultDuration=uint(await small(r,field,8));
     if(field.id===0xe0)for await(const v of r.children(field.start,field.end)){
      if(v.id===0xb0)t.width=uint(await small(r,v,8));
      if(v.id===0xba)t.height=uint(await small(r,v,8));
     }
     if(field.id===0xe1)for await(const a of r.children(field.start,field.end)){
      if(a.id===0xb5)t.rate=float(await small(r,a,8));
      if(a.id===0x9f)t.channels=uint(await small(r,a,8));
     }
    }
    if(t.number)tracks.push(t);
   }
  }
  if(infoSeen&&tracks.length)break;
 }
 return {scale,tracks};
}
function readBlock(bytes,absolute,clusterTime,scale,key){
 const track=vst(bytes,0,true),offset=track.width;
 if(bytes.length<offset+3)throw Error("Truncated Matroska block");
 const rel=(bytes[offset]<<8)|bytes[offset+1];
 const timestamp=clusterTime+(rel&0x8000?rel-65536:rel);
 const flags=bytes[offset+2],lace=(flags>>1)&3;
 let at=offset+3,sizes=[];
 if(lace){
  if(at>=bytes.length)throw Error("Missing Matroska lacing");
  const count=bytes[at++]+1;
  if(count>128)throw Error("Too many laced packets");
  if(lace===1){
   for(let n=0;n<count-1;n++){
    let length=0,part=255;
    while(part===255){if(at>=bytes.length)throw Error("Xiph lace truncated");
      part=bytes[at++];length+=part;}
    sizes.push(length);
   }
  }else if(lace===2){
   const first=vst(bytes,at,true);at+=first.width;sizes.push(first.value);
   for(let n=1;n<count-1;n++){
    const next=vst(bytes,at,true);at+=next.width;
    const bias=Math.pow(2,7*next.width-1)-1;
    sizes.push(sizes[sizes.length-1]+next.value-bias);
   }
  }else{const size=(bytes.length-at)/count;
   if(!Number.isInteger(size))throw Error("Uneven fixed Matroska lace");
   sizes=Array(count-1).fill(size);
  }
  sizes.push(bytes.length-at-sizes.reduce((a,b)=>a+b,0));
 }else sizes=[bytes.length-at];
 if(sizes.some(n=>n<1)||sizes.reduce((a,b)=>a+b,0)!==bytes.length-at)
  throw Error("Invalid Matroska sample size");
 const samples=[];
 for(let i=0;i<sizes.length;i++){
  samples.push({position:absolute+at,size:sizes[i],pts:timestamp*scale/1e6,
    sync:key&&Boolean(flags&128),data:null});
  at+=sizes[i];
 }
 return {track:track.value,samples};
}
async function collect(file,r,segment,tracks,scale){
 const found=new Map(tracks.map(t=>[t.number,{...t,samples:[]}]));
 let clusterCount=0;
 for await(const cluster of r.children(segment.start,segment.end)){
  if(cluster.id!==0x1f43b675)continue;
  if(++clusterCount>200000)throw Error("Too many clusters");
  let base=0;
  for await(const element of r.children(cluster.start,cluster.end)){
   if(element.id===0xe7){base=uint(await small(r,element,8));continue;}
   const blocks=[];
   if(element.id===0xa3)blocks.push({element,key:true});
   if(element.id===0xa0){
    let block=null,key=true;
    for await(const child of r.children(element.start,element.end)){
     if(child.id===0xa1)block=child;
     if(child.id===0xfb)key=false;
    }
    if(block)blocks.push({element:block,key});
   }
   for(const {element:block,key} of blocks){
    if(block.size>8*1024*1024)throw Error("Oversized Matroska block");
    // For stream copy, read block header + lacing only; do not load full
    // frame payloads. Block-relative size calculation uses the sample tail.
    const prefix=await r.read(block.start,Math.min(block.size,2048));
    const parsed=readBlockHeader(prefix,block.size,block.start,base,scale,key);
    const entry=found.get(parsed.track);
    if(!entry)continue;
    for(const sample of parsed.samples){
     if(entry.samples.length>=MAX_SAMPLES)throw Error("Too many samples");
     entry.samples.push(sample);
    }
   }
  }
 }
 return [...found.values()];
}
function readBlockHeader(prefix,length,absolute,base,scale,key){
 const number=vst(prefix,0,true),offset=number.width;
 if(prefix.length<offset+3)throw Error("Truncated block header");
 const rel=(prefix[offset]<<8)|prefix[offset+1];
 const flags=prefix[offset+2],lace=(flags>>1)&3;
 const pts=(base+(rel&0x8000?rel-65536:rel))*scale/1e6;
 let at=offset+3,sizes=[];
 if(lace){
  const count=prefix[at++]+1;
  if(count>128)throw Error("Too many laced packets");
  if(lace===1){
   for(let n=0;n<count-1;n++){
    let size=0,part=255;
    while(part===255){if(at>=prefix.length)throw Error("Excessive Xiph lace");
     part=prefix[at++];size+=part;}
    sizes.push(size);
   }
  }else if(lace===2){
   const first=vst(prefix,at,true);at+=first.width;sizes.push(first.value);
   for(let n=1;n<count-1;n++){
    const next=vst(prefix,at,true);at+=next.width;
    sizes.push(sizes[n-1]+next.value-(Math.pow(2,7*next.width-1)-1));
   }
  }else{const each=(length-at)/count;
   if(!Number.isInteger(each))throw Error("Uneven fixed lace");
   sizes=Array(count-1).fill(each);
  }
  sizes.push(length-at-sizes.reduce((a,b)=>a+b,0));
 }else sizes=[length-at];
 if(sizes.some(n=>n<=0)||sizes.reduce((a,b)=>a+b,0)!==length-at)
  throw Error("Invalid laced packet sizes");
 const samples=sizes.map(size=>{
  const result={position:absolute+at,size,pts,sync:key&&Boolean(flags&128)};
  at+=size;return result;
 });
 return {track:number.value,samples};
}
function mp4Tables(track,index,offset,movieDuration){
 const video=track.type===1,scale=video?1000:Math.round(track.rate);
 const samples=track.samples;
 if(!samples.length)throw Error("Missing encoded "+(video?"video":"audio")+" packets");
 const durations=samples.map((s,i)=>{
  if(!video)return 1024;
  const following=samples[i+1];
  const ms=following?following.pts-s.pts:
   track.defaultDuration?track.defaultDuration/1e6:
   i?Math.max(1,s.pts-samples[i-1].pts):40;
  if(ms<=0||ms>1000)throw Error("AVC B-frame reordering requires a newer remuxer");
  return Math.round(ms);
 });
 const total=durations.reduce((a,b)=>a+b,0);
 const sttsGroups=[];
 for(const d of durations){
  const last=sttsGroups[sttsGroups.length-1];
  if(last&&last[1]===d)last[0]++;
  else sttsGroups.push([1,d]);
 }
 const stts=full("stts",0,0,u32(sttsGroups.length),
  ...sttsGroups.map(x=>cat(u32(x[0]),u32(x[1]))));
 const stsc=full("stsc",0,0,u32(1),u32(1),u32(samples.length),u32(1));
 const sampleSizes=new Uint8Array(samples.length*4),dataView=new DataView(sampleSizes.buffer);
 samples.forEach((sample,i)=>dataView.setUint32(i*4,sample.size));
 const stsz=full("stsz",0,0,u32(0),u32(samples.length),sampleSizes);
 const co=full("stco",0,0,u32(1),u32(offset));
 const syncIndexes=video?samples.flatMap((sample,i)=>sample.sync?[i+1]:[]):[];
 const syncBytes=new Uint8Array(syncIndexes.length*4),syncView=new DataView(syncBytes.buffer);
 syncIndexes.forEach((number,i)=>syncView.setUint32(i*4,number));
 const stss=video?full("stss",0,0,u32(syncIndexes.length),syncBytes):null;
 const stsd=full("stsd",0,0,u32(1),video?videoEntry(track):audioEntry(track));
 const stbl=box("stbl",stsd,stts,stsc,stsz,co,...(stss?[stss]:[]));
 const dref=full("dref",0,0,u32(1),full("url ",0,1));
 const dinf=box("dinf",dref);
 const mediaHeader=video?full("vmhd",0,1,u16(0),u16(0),u16(0),u16(0)):
  full("smhd",0,0,u16(0),u16(0));
 const minf=box("minf",mediaHeader,dinf,stbl);
 const mdhd=full("mdhd",0,0,u32(0),u32(0),u32(scale),u32(total),u16(0x55c4),u16(0));
 const handler=full("hdlr",0,0,u32(0),ascii(video?"vide":"soun"),
  new Uint8Array(12),ascii(video?"Video\0":"Sound\0"));
 const mdia=box("mdia",mdhd,handler,minf);
 const tkhd=full("tkhd",0,7,u32(0),u32(0),u32(index),u32(0),
  u32(movieDuration),new Uint8Array(8),u16(0),u16(0),
  u16(video?0:256),u16(0),matrix,fixed(video?track.width:0),
  fixed(video?track.height:0));
 return box("trak",tkhd,mdia);
}
function videoEntry(t){
 const cfg=t.privateData;
 if(!cfg||cfg.length<7||cfg[0]!==1)throw Error("Missing AVCDecoderConfigurationRecord");
 if(t.width<1||t.height<1||t.width>8192||t.height>8192)throw Error("Invalid AVC frame size");
 const base=cat(new Uint8Array(6),u16(1),new Uint8Array(16),
  u16(t.width),u16(t.height),u32(0x00480000),u32(0x00480000),
  u32(0),u16(1),new Uint8Array(32),u16(24),u16(0xffff));
 return box("avc1",base,box("avcC",cfg));
}
function descriptor(tag,data){
 let n=data.length;const bytes=[];
 do{bytes.unshift(n&127);n=Math.floor(n/128);}while(n);
 for(let i=0;i<bytes.length-1;i++)bytes[i]|=128;
 return cat(u8(tag,...bytes),data);
}
function audioEntry(t){
 const privateData=t.privateData;
 if(!privateData?.length||privateData.length>128)
  throw Error("Missing AAC AudioSpecificConfig");
 const desc=descriptor(3,cat(u16(1),u8(0),
  descriptor(4,cat(u8(0x40,0x15,0,0,0),u32(0),u32(0),
   descriptor(5,privateData))),
  descriptor(6,u8(2))));
 const base=cat(new Uint8Array(6),u16(1),new Uint8Array(8),
  u16(t.channels),u16(16),u16(0),u16(0),fixed(t.rate));
 return box("mp4a",base,full("esds",0,0,desc));
}
function movie(tracks,offsets){
 const video=tracks[0],audio=tracks[1];
 const last=Math.max(video.samples[video.samples.length-1].pts,
  audio.samples[audio.samples.length-1].pts)+1500;
 const duration=Math.ceil(last);
 const mvhd=full("mvhd",0,0,u32(0),u32(0),u32(1000),
  u32(duration),u32(65536),u16(256),u16(0),
  new Uint8Array(8),matrix,new Uint8Array(24),u32(3));
 return box("moov",mvhd,mp4Tables(video,1,offsets[0],duration),
  mp4Tables(audio,2,offsets[1],duration));
}
async function remux(file,info,options={}){
 if(!eligible(info,file))throw Error("Only H.264 + AAC MKV is eligible");
 const r=reader(file);
 let segment=null;
 for await(const e of r.children(0,file.size))
  if(e.id===0x18538067){segment=e;break;}
 if(!segment)throw Error("Missing Matroska Segment");
 const {tracks,scale}=await descriptors(r,segment);
 const video=tracks.find(t=>t.type===1),audio=tracks.find(t=>t.type===2);
 if(tracks.length!==2||video?.codec!==VIDEO||!audio?.codec.startsWith(AUDIO))
  throw Error("Unsupported Matroska tracks");
 const samples=await collect(file,r,segment,[video,audio],scale);
 const [v,a]=samples;
 if(v.samples.length<2||a.samples.length<2)throw Error("Insufficient video or audio samples");
 if(!v.samples[0].sync)throw Error("First H.264 frame must be keyframe");
 const ftyp=box("ftyp",ascii("isom"),u32(0x200),ascii("iso2"),ascii("avc1"),ascii("mp41"));
 const totalV=v.samples.reduce((x,s)=>x+s.size,0);
 const totalA=a.samples.reduce((x,s)=>x+s.size,0);
 if(totalV+totalA>MAX_SIZE)throw Error("Media exceeds MP4 fallback cap");
 let moov=movie([v,a],[0,0]);
 const offsets=[ftyp.length+moov.length+8,ftyp.length+moov.length+8+totalV];
 moov=movie([v,a],offsets);
 const mdatHeader=u32(totalV+totalA+8);
 const encoded=[...v.samples,...a.samples].map(s=>file.slice(s.position,s.position+s.size));
 const blob=new Blob([ftyp,moov,mdatHeader,ascii("mdat"),...encoded],
  {type:"video/mp4"});
 return {blob,mime:'video/mp4; codecs="'+
  ["avc1."+Array.from(video.privateData.slice(1,4)).map(
    v=>v.toString(16).padStart(2,"0")).join(""),"mp4a.40.2"].join(", ")+'"',
  frames:v.samples.length,audioPackets:a.samples.length};
}
return {eligible,remux};
});