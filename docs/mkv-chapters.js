/* DK Kinehall: read real Matroska chapter titles and timestamps.
 * Bounded, random-access EBML parsing. No decoding, uploads, or full-file reads.
 */
(function(root){
"use strict";
const SEGMENT=0x18538067, SEEKHEAD=0x114D9B74, SEEK=0x4DBB,
  SEEKID=0x53AB, SEEKPOSITION=0x53AC, CHAPTERS=0x1043A770,
  EDITION=0x45B9, ATOM=0xB6, START=0x91, DISPLAY=0x80, NAME=0x85;
const MAX_CHAPTER_BYTES=2*1024*1024, MAX_SEEK_BYTES=256*1024;
function header(bytes,at){
  if(at>=bytes.length||!bytes[at])return null;
  let mask=128,idWidth=1;
  while(!(bytes[at]&mask)&&idWidth<=4){idWidth++;mask>>=1;}
  if(idWidth>4||at+idWidth>=bytes.length)return null;
  let id=0;
  for(let i=0;i<idWidth;i++)id=id*256+bytes[at+i];
  const sizeAt=at+idWidth;
  if(!bytes[sizeAt])return null;
  let width=1,flag=128;
  while(!(bytes[sizeAt]&flag)&&width<=8){width++;flag>>=1;}
  if(width>8||sizeAt+width>bytes.length)return null;
  let size=bytes[sizeAt]&(flag-1),unknown=size===flag-1;
  for(let i=1;i<width;i++){
    size=size*256+bytes[sizeAt+i];
    unknown=unknown&&bytes[sizeAt+i]===255;
  }
  if(!unknown&&!Number.isSafeInteger(size))return null;
  return {id,size:unknown?null:size,start:sizeAt+width};
}
function elements(bytes,fn){
  let at=0,count=0;
  while(at<bytes.length&&count++<20000){
    const h=header(bytes,at);
    if(!h||h.size===null||h.start+h.size>bytes.length)break;
    fn(h.id,bytes.subarray(h.start,h.start+h.size));
    at=h.start+h.size;
  }
}
function number(bytes){
  if(bytes.length>7)return null;
  let v=0;
  for(const b of bytes)v=v*256+b;
  return Number.isSafeInteger(v)?v:null;
}
function decode(bytes){
  try{return new TextDecoder("utf-8",{fatal:false}).decode(bytes).replace(/\0/g,"").trim().slice(0,140);}
  catch(_){return "";}
}
function parseAtom(bytes,out){
  let start=null,name="";
  elements(bytes,(id,data)=>{
    if(id===START)start=number(data);
    else if(id===DISPLAY&&!name)elements(data,(key,value)=>{
      if(key===NAME&&!name)name=decode(value);
    });
    else if(id===ATOM)parseAtom(data,out);
  });
  if(start!==null&&start>=0){
    const time=start/1e9;
    if(Number.isFinite(time)&&time>=0&&time<7*86400)
      out.push({startTime:time,text:name||"Chapter "+(out.length+1)});
  }
}
function parseChapters(bytes){
  const out=[];
  elements(bytes,(id,data)=>{
    if(id===EDITION)elements(data,(key,value)=>{
      if(key===ATOM)parseAtom(value,out);
    });
  });
  out.sort((a,b)=>a.startTime-b.startTime);
  return out.filter((v,i)=>i===0||v.startTime-out[i-1].startTime>0.01).slice(0,500);
}
async function fileHeader(file,offset){
  if(offset<0||offset+8>file.size)return null;
  const b=new Uint8Array(await file.slice(offset,Math.min(file.size,offset+20)).arrayBuffer());
  const h=header(b,0);
  return h?{id:h.id,size:h.size,start:offset+h.start}:null;
}
async function atChapter(file,offset){
  const h=await fileHeader(file,offset);
  if(h?.id!==CHAPTERS||h.size===null||h.size>MAX_CHAPTER_BYTES||
     h.start+h.size>file.size)return [];
  return parseChapters(new Uint8Array(await file.slice(h.start,h.start+h.size).arrayBuffer()));
}
async function seekTarget(file,head,segmentStart){
  if(head.size===null||head.size>MAX_SEEK_BYTES||head.start+head.size>file.size)return [];
  const bytes=new Uint8Array(await file.slice(head.start,head.start+head.size).arrayBuffer());
  const candidates=[];
  elements(bytes,(id,entry)=>{
    if(id!==SEEK)return;
    let match=false,position=null;
    elements(entry,(key,value)=>{
      if(key===SEEKID)match=number(value)===CHAPTERS;
      else if(key===SEEKPOSITION)position=number(value);
    });
    if(match&&position!==null)candidates.push(segmentStart+position);
  });
  for(const offset of candidates){
    if(offset>=segmentStart&&offset<file.size){
      const chapters=await atChapter(file,offset);
      if(chapters.length)return chapters;
    }
  }
  return [];
}
async function inspectFile(file){
  if(!file||!/\.mkv$/i.test(file.name||"")||!file.slice)return [];
  try{
    let offset=0,segment=null;
    for(let n=0;n<64&&offset<Math.min(file.size,65536);n++){
      const h=await fileHeader(file,offset);
      if(!h)break;
      if(h.id===SEGMENT){segment=h;break;}
      if(h.size===null)break;
      offset=h.start+h.size;
    }
    if(!segment)return [];
    const start=segment.start,end=segment.size===null?file.size:
      Math.min(file.size,start+segment.size);
    offset=start;
    // Skip large media clusters without reading them. SeekHead references
    // also permit chapters stored after the final cluster.
    for(let n=0;n<2500&&offset<end;n++){
      const h=await fileHeader(file,offset);
      if(!h)break;
      if(h.id===CHAPTERS){
        const found=await atChapter(file,offset);
        if(found.length)return found;
      }
      if(h.id===SEEKHEAD){
        const found=await seekTarget(file,h,start);
        if(found.length)return found;
      }
      if(h.size===null||h.start+h.size<=offset)break;
      offset=h.start+h.size;
    }
    // Bounded fallback for Matroska files with an incomplete SeekHead.
    const tailStart=Math.max(start,end-4*1024*1024);
    const tail=new Uint8Array(await file.slice(tailStart,end).arrayBuffer());
    for(let i=0;i+9<tail.length;i++){
      if(tail[i]!==0x10||tail[i+1]!==0x43||tail[i+2]!==0xA7||tail[i+3]!==0x70)continue;
      const h=header(tail,i);
      if(!h||h.id!==CHAPTERS||h.size===null||h.size>MAX_CHAPTER_BYTES||
         h.start+h.size>tail.length)continue;
      const found=parseChapters(tail.subarray(h.start,h.start+h.size));
      if(found.length)return found;
    }
  }catch(_){/* No chapter data should ever block playback. */}
  return [];
}
root.DKMkvChapters={inspectFile,parseChapters};
})(typeof window!=="undefined"?window:globalThis);
