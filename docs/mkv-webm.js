/* DK Kinehall: zero-reencode Matroska -> WebM-compatible header fallback.
 * Intended ONLY for Matroska files with WebM-permitted codecs. Other MKVs
 * require a real demuxer/decoder and must not be mislabeled as playable.
 * The original File remains unchanged; Blob slices share its contents.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.DKMkvWebM=api;
})(typeof globalThis!=="undefined"?globalThis:window,function(){
  "use strict";
  const VIDEO=new Map([["V_VP8","vp8"],["V_VP9","vp9"],["V_AV1","av01"]]);
  const AUDIO=new Map([["A_OPUS","opus"],["A_VORBIS","vorbis"]]);
  const vint=(bytes,i,strip=false)=>{
    if(i>=bytes.length||!bytes[i])return null;
    let bit=128,width=1;
    while(!(bytes[i]&bit)&&width<8){bit>>=1;width++;}
    if(i+width>bytes.length||width>4)return null;
    let value=strip?bytes[i]&(bit-1):bytes[i];
    for(let k=1;k<width;k++)value=value*256+bytes[i+k];
    return {value,width};
  };
  const eligible=(info,file)=>{
    if(!file||!/\.mkv$/i.test(String(file.name||""))||
       typeof file.slice!=="function"||!info)return null;
    const video=info.videoTracks||[],audio=info.audioTracks||[];
    const subs=info.tracks||info.subtitles||[];
    if(video.length!==1||!VIDEO.has(video[0].codec)||
       !audio.every(track=>AUDIO.has(track.codec))||
       subs.some(track=>!["S_TEXT/WEBVTT","D_WEBVTT/SUBTITLES"].includes(track.codec)))
      return null;
    const codecs=[VIDEO.get(video[0].codec),...audio.map(track=>AUDIO.get(track.codec))];
    return {mime:'video/webm; codecs="'+codecs.join(", ")+'"',codecs};
  };
  const rewriteHeader=bytes=>{
    if(!(bytes instanceof Uint8Array)||bytes.length<24||
       bytes[0]!==0x1a||bytes[1]!==0x45||bytes[2]!==0xdf||bytes[3]!==0xa3)
      throw new Error("Not an EBML Matroska header");
    const rootSize=vint(bytes,4,true);
    if(!rootSize||rootSize.value>4096)
      throw new Error("Invalid Matroska EBML header");
    let i=4+rootSize.width;
    const end=i+rootSize.value;
    if(end>bytes.length)throw new Error("Incomplete Matroska EBML header");
    let found=false;
    while(i<end){
      const id=vint(bytes,i),len=id&&vint(bytes,i+id.width,true);
      if(!id||!len)throw new Error("Invalid Matroska EBML element");
      const valueAt=i+id.width+len.width;
      const next=valueAt+len.value;
      if(next>end||next<=i)throw new Error("Invalid Matroska header bounds");
      if(id.value===0x4282){
        // Shrink the eight-byte DocType string, using four spare bytes for
        // a valid EBML Void element. Never shift offsets or transcode media.
        if(len.width!==1||len.value!==8||
           new TextDecoder().decode(bytes.subarray(valueAt,next))!=="matroska")
          throw new Error("Unsupported Matroska DocType encoding");
        bytes[i+id.width]=0x84;
        bytes.set([0x77,0x65,0x62,0x6d,0xec,0x82,0x00,0x00],valueAt);
        found=true;break;
      }
      i=next;
    }
    if(!found)throw new Error("Missing Matroska DocType");
    return bytes;
  };
  const wrap=async(file,info)=>{
    const fit=eligible(info,file);
    if(!fit)throw new Error("MKV contains codecs that WebM cannot carry");
    const length=Math.min(file.size,16384);
    const bytes=new Uint8Array(await file.slice(0,length).arrayBuffer());
    const header=rewriteHeader(bytes);
    return {blob:new Blob([header,file.slice(length)],{type:"video/webm"}),
      mime:fit.mime,codecs:fit.codecs};
  };
  return {eligible,rewriteHeader,wrap};
});