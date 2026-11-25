(async()=>{
"use strict";
const b64=__DK_MP4_B64__;
if(!window.DKMkvMP4)throw Error("Missing DK Kinehall MP4 module");
const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
const file=new File([bytes],"Synthetic.H264.AAC.mkv",{type:"video/x-matroska"});
const meta=await window.DKMatroska.inspectFile(file);
const prepared=await window.DKMkvMP4.remux(file,meta);
if(!prepared.mime.includes("avc1"))throw Error("Wrong codec configuration");
const video=document.createElement("video");
video.preload="auto";video.playsInline=true;video.muted=true;video.width=240;
document.body.append(video);
const url=URL.createObjectURL(prepared.blob);
video.src=url;
try{
 await Promise.race([video.play(),new Promise((_,reject)=>
   setTimeout(()=>reject(Error("H264/AAC playback startup timeout")),12000))]);
 const until=Date.now()+9000;
 while(Date.now()<until&&video.currentTime<0.55&&!video.error)
   await new Promise(resolve=>setTimeout(resolve,50));
 if(video.error)throw Error("H264 MP4 media failure: "+video.error.message);
 if(video.currentTime<0.55||video.videoWidth!==240||video.videoHeight!==144)
   throw Error("Converted MKV did not display moving H264 video");
 return {passed:true,width:video.videoWidth,height:video.videoHeight,
   seconds:video.currentTime,frames:prepared.frames,
   audioSamples:prepared.audioPackets,mime:prepared.mime};
}finally{
 video.pause();video.removeAttribute("src");video.load();
 URL.revokeObjectURL(url);video.remove();
}
})()