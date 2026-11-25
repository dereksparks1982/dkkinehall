/* DK Kinehall: local Electron transcode stream -> MediaSource playback.
 * Pure browser mode has no native FFmpeg bridge, and never claims one.
 * A bundled FFmpeg executable is required for native conversion.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.DKNativeTranscode=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  "use strict";
  const CHUNK_SIZE=256*1024;
  const bridge=()=>typeof window!=="undefined"?window.DKStandalone:null;
  function mime(format,hasAudio=true){
    if(format==="mp4")return hasAudio?
      'video/mp4; codecs="avc1.42E01E, mp4a.40.2"':
      'video/mp4; codecs="avc1.42E01E"';
    if(format==="webm")return hasAudio?
      'video/webm; codecs="vp9, opus"':
      'video/webm; codecs="vp9"';
    return null;
  }
  async function capabilities(){
    const b=bridge();
    if(!b || typeof b.transcodeCapabilities!=="function" ||
       typeof MediaSource==="undefined")return {available:false,formats:[]};
    try{
      const state=await b.transcodeCapabilities();
      return {available:state?.available===true,
        formats:Array.isArray(state?.formats)?state.formats:[]};
    }catch(_){return {available:false,formats:[]};}
  }
  function supported(format,hasAudio=true){
    const type=mime(format,hasAudio);
    return !!type && typeof MediaSource!=="undefined" &&
      typeof MediaSource.isTypeSupported==="function" &&
      MediaSource.isTypeSupported(type);
  }
  async function start(file,{format="mp4",hardware=true,hasAudio=true,onStatus=null}={}){
    const b=bridge();
    if(!file||typeof file.slice!=="function"||!Number.isFinite(file.size)||
       file.size<1)throw Error("Choose a readable local media file");
    if(!b||typeof b.startTranscode!=="function")
      throw Error("Native transcoding is unavailable in the web player");
    const available=await capabilities();
    if(!available.available || !available.formats.includes(format))
      throw Error("Bundled FFmpeg transcoder is not installed");
    if(!supported(format,hasAudio))
      throw Error("Chromium MediaSource does not support the chosen output codecs");

    const mediaSource=new MediaSource();
    const url=URL.createObjectURL(mediaSource);
    let id=null,sourceBuffer=null,inflight=null,ended=false,stopped=false;
    let detach=()=>{},resolveFinished,rejectFinished,settled=false;
    let inputCancelled=false;
    const finished=new Promise((resolve,reject)=>{
      resolveFinished=resolve;rejectFinished=reject;
    });
    // The caller attaches its own catch handler; avoid a second unhandled
    // rejection if a decoder error and an abort arrive close together.
    finished.catch(()=>{});
    const report=message=>{
      if(typeof onStatus==="function")try{onStatus(message)}catch(_){}
    };
    const settle=(error=null)=>{
      if(settled)return;
      settled=true;
      detach();
      if(error)rejectFinished(error);
      else resolveFinished(true);
    };
    const stop=()=>{
      if(stopped)return;
      stopped=true;
      inputCancelled=true;
      detach();
      if(id)void b.cancelTranscode(id).catch(()=>{});
      try {if(mediaSource.readyState==="open"&&sourceBuffer&&!sourceBuffer.updating)
        mediaSource.endOfStream();}catch(_){}
      URL.revokeObjectURL(url);
      settle(new Error("Conversion cancelled"));
    };
    const completeIfReady=()=>{
      if(stopped||!ended||inflight||!sourceBuffer||sourceBuffer.updating)return;
      try{
        if(mediaSource.readyState==="open")mediaSource.endOfStream();
        settle();
      }catch(error){fail(error);}
    };
    const fail=error=>{
      if(stopped)return;
      report("Live conversion failed: "+String(error?.message||error));
      stopped=true;
      inputCancelled=true;
      detach();
      if(id)void b.cancelTranscode(id).catch(()=>{});
      settle(error instanceof Error?error:new Error(String(error)));
    };
    const append=()=>{
      if(stopped||!sourceBuffer||sourceBuffer.updating||!inflight)return;
      try{sourceBuffer.appendBuffer(inflight)}
      catch(error){fail(error);}
    };
    const onEvent=event=>{
      if(stopped||!id||event?.id!==id)return;
      if(event.type==="data"){
        if(inflight){fail(Error("Unacknowledged output chunk"));return;}
        // Sender pauses FFmpeg stdout while this single chunk is buffered.
        inflight=event.bytes instanceof Uint8Array ? event.bytes :
          new Uint8Array(event.bytes||[]);
        append();
      }else if(event.type==="complete"){
        ended=true;
        completeIfReady();
      }else if(event.type==="error"){
        fail(Error(event.message||"FFmpeg exited with an error"));
      }else if(event.type==="cancelled"){
        fail(Error("Conversion cancelled"));
      }
    };
    detach=b.onTranscodeEvent(onEvent);
    mediaSource.addEventListener("sourceopen",()=>{
      if(stopped)return;
      try{
        sourceBuffer=mediaSource.addSourceBuffer(mime(format,hasAudio));
        sourceBuffer.mode="segments";
        sourceBuffer.addEventListener("updateend",()=>{
          if(stopped)return;
          inflight=null;
          if(id)void b.ackTranscode(id).catch(fail);
          completeIfReady();
        });
        sourceBuffer.addEventListener("error",()=>fail(Error("SourceBuffer decode failure")));
        append();
        completeIfReady();
      }catch(error){fail(error);}
    },{once:true});
    try{
      const session=await b.startTranscode({format,hardware:hardware===true});
      id=session?.id;
      if(typeof id!=="string")throw Error("Native conversion did not open a session");
      // Each slice is read independently and acknowledged by the host,
      // preventing the entire original MKV from entering JavaScript memory.
      void (async()=>{
        try{
          for(let offset=0;offset<file.size;offset+=CHUNK_SIZE){
            if(inputCancelled)return;
            const bytes=new Uint8Array(await file.slice(offset,
              Math.min(file.size,offset+CHUNK_SIZE)).arrayBuffer());
            if(inputCancelled)return;
            await b.writeTranscode(id,bytes);
          }
          if(!inputCancelled)await b.finishTranscode(id);
        }catch(error){
          if(!inputCancelled)fail(error);
        }
      })();
      report("Converting locally while the movie plays…");
      return {url,stop,finished,format};
    }catch(error){
      fail(error);
      URL.revokeObjectURL(url);
      throw error;
    }
  }
  return Object.freeze({mime,supported,capabilities,start});
});