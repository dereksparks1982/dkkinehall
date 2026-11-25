(async()=>{
  "use strict";
  if(!window.DKMkvWebM||!window.DKMatroska)
    throw new Error("Matroska WebM compatibility modules missing");
  const bytes=Uint8Array.from(atob(__DK_WEBM_B64__),c=>c.charCodeAt(0));
  const file=new File([bytes],"Synthetic.2026.mkv",{type:"video/x-matroska"});
  const info=await window.DKMatroska.inspectFile(file);
  const compatible=window.DKMkvWebM.eligible(info,file);
  if(!compatible||!compatible.mime.includes("vp9")||!compatible.mime.includes("opus"))
    throw new Error("Video/audio tracks were not identified as WebM compatible");
  const wrapped=await window.DKMkvWebM.wrap(file,info);
  if(wrapped.blob.size!==file.size)
    throw new Error("Lossless WebM compatibility changed byte count");
  const video=document.createElement("video");
  video.muted=true;
  video.playsInline=true;
  video.preload="auto";
  video.style.width="160px";
  document.body.append(video);
  const objectUrl=URL.createObjectURL(wrapped.blob);
  video.src=objectUrl;
  try{
    await Promise.race([
      video.play(),
      new Promise((_,reject)=>setTimeout(()=>reject(
        Error("WebM video could not start within 9 seconds")),9000))
    ]);
    const limit=Date.now()+9000;
    while(Date.now()<limit &&
      (!video.videoWidth||video.currentTime<0.4)&&!video.error)
      await new Promise(resolve=>setTimeout(resolve,65));
    if(video.error)throw Error("Decoded video failed: "+
      (video.error.message||"error "+video.error.code));
    if(video.videoWidth!==240||video.videoHeight!==144||
       video.currentTime<0.4)
      throw Error("WebM conversion did not produce advancing decoded video");
    const result={passed:true,originalBytes:file.size,
      outputBytes:wrapped.blob.size,videoCodec:info.videoTracks[0].codec,
      audioCodec:info.audioTracks[0].codec,decodedWidth:video.videoWidth,
      decodedHeight:video.videoHeight,playedSeconds:video.currentTime};
    return result;
  }finally{
    video.pause();video.removeAttribute("src");video.load();
    URL.revokeObjectURL(objectUrl);video.remove();
  }
})()