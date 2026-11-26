/* DK Kinehall standalone-only native decoding adapter.
 * The shared player keeps its existing <video>, controls and playlist.
 * This is only enabled when Electron exposes the guarded DKCodecBridge and
 * actual packaged native FFmpeg executables are available.
 */
(function(root){
"use strict";
function attach({media,bridge,current,onStatus=()=>{},onClockChanged=()=>{},
                 onChaptersChanged=()=>{},onOffsetChanged=()=>{},
                 onTracksChanged=()=>{}}) {
  if(!bridge||typeof bridge.start!=="function"||!media)return null;
  let generation=0,active=null,chain=Promise.resolve();
  // Only the browser's real playing event proves the native output is
  // decoding and rendering. A returned stream URL is not playback success.
  media.addEventListener("playing",()=>{
    if(active?.item && current()===active.item)
      onStatus("Playing with included codecs.",true);
  });
  const enqueue=work=>{
    const task=chain.catch(()=>{}).then(work);
    chain=task.catch(()=>{});
    return task;
  };
  const isActive=item=>!!active&&active.item===item;
  const offset=item=>isActive(item)?active.offset:0;
  const position=item=>isActive(item)?
    Math.max(0,active.offset+(Number(media.currentTime)||0)):
    Number(media.currentTime)||0;
  const duration=item=>isActive(item)&&Number.isFinite(active.duration)?
    active.duration:media.duration;
  const stop=()=>{
    generation++;
    if(active?.item)active.item.codecActive=false;
    active=null;
    return enqueue(async()=>{
      try{await bridge.stop();}catch(_){}
    });
  };
  async function start(item,offset=0,autoplay=true,format="auto",
                       audioIndex=item?.codecAudioIndex||0,frameStep=false){
    const source=item?.file||item?.networkSource;
    if(!source||current()!==item)return false;
    const token=++generation;
    return enqueue(async()=>{
      if(token!==generation||current()!==item)return false;
      try {
        const capability=await bridge.status();
        if(!capability?.ready)
          throw Error(capability?.reason||"Bundled decoder is unavailable");
        if(token!==generation||current()!==item)return false;
        onStatus("Preparing video with included codecs…");
        const result=await bridge.start(source,Math.max(0,Number(offset)||0),
          format,audioIndex,frameStep,item.deinterlaceMode||"off",item.smoothingMode||"off",item.file?.dvdToken&&Number.isInteger(item.dvdSubtitleIndex)?item.dvdSubtitleIndex:-1);
        if(token!==generation||current()!==item||!result?.url)return false;
        item.historyReady=false;
        active={item,url:result.url,offset:Number(result.position)||0,
          duration:result.duration===null||result.duration===undefined?
            null:(Number.isFinite(Number(result.duration))?Number(result.duration):null)};
        item.playbackMethod=result.deinterlace&&result.deinterlace!=="off"?"Bundled native decoder (deinterlaced)":"Bundled native decoder";
        item.activeDeinterlace=result.deinterlace||"off";
        item.activeSmoothing=Number(result.smoothing)||0;
        if(item.activeSmoothing)item.playbackMethod="Bundled native decoder (motion interpolation)";
        item.nativeOutputFormat=result.format||format;
        item.nativeMediaInfo={hasVideo:result.hasVideo,hasAudio:result.hasAudio,videoCodec:result.videoCodec,audioCodec:result.audioCodec,format:result.format};
        if(result.hasVideo){item.audio=false;media.closest(".screen")?.classList.remove("audio");}
        else if(result.hasVideo===false&&result.hasAudio){item.audio=true;media.closest(".screen")?.classList.add("audio");}
        item.nativeAudioTracks=Array.isArray(result.audioTracks)?
          result.audioTracks:[];
        item.nativeSubtitleTracks=Array.isArray(result.subtitleTracks)?
          result.subtitleTracks:[];
        onTracksChanged();
        const nativeChapters=Array.isArray(result.chapters)?result.chapters:[];
        if(nativeChapters.length){
          // FFprobe reads real source chapters, including MP4/MOV, AVI and
          // supported containers beyond the Matroska-only chapter parser.
          const merged=[...(item.chapters||[]),...nativeChapters];
          item.chapters=merged.sort((a,b)=>a.startTime-b.startTime)
            .filter((entry,index,list)=>index===0||
              Math.abs(entry.startTime-list[index-1].startTime)>0.01)
            .slice(0,500);
          onChaptersChanged();
        }
        item.codecActive=true;
        onOffsetChanged(item,active.offset);
        media.pause();
        // The private loopback endpoint permits the local file origin. CORS
        // mode is required for amplified Web Audio playback of this stream.
        media.crossOrigin="anonymous";
        media.src=result.url;
        media.load();
        onClockChanged();
        // This is still a startup attempt. Only "playing" confirms success.
        onStatus(autoplay?"Decoding with included codecs…":
          "Included codec stream ready.",false);
        if(autoplay) {
          try {
            const request=media.play();
            if(request?.catch)request.catch(error=>{
              if(error?.name!=="AbortError"&&error?.name!=="NotAllowedError")
                onStatus("Playback could not start: "+String(error?.message||error));
            });
          }catch(error){onStatus("Playback could not start.");}
        }
        return true;
      } catch(error) {
        if(token===generation&&current()===item) {
          active=null;
          item.codecActive=false;
          onStatus("Included codec playback failed: "+String(error?.message||error));
        }
        return false;
      }
    });
  }
  const seek=(item,seconds,{frameStep=false}={})=>{
    if(!isActive(item)) {
      if(Number.isFinite(Number(seconds)))media.currentTime=Math.max(0,Number(seconds));
      return Promise.resolve(true);
    }
    const limit=duration(item);
    const position=Math.max(0,Number.isFinite(limit)?
      Math.min(limit-(frameStep?0.001:0.25),Number(seconds)||0):Number(seconds)||0);
    const playing=!media.paused;
    return start(item,position,playing,
      ["mp4","webm"].includes(item.requestedFormat)?
        item.requestedFormat:"auto",
      item.codecAudioIndex||0,frameStep);
  };
  async function retryAlternate(item){
    if(!isActive(item)||item.requestedFormat!=="auto"||item.nativeAlternateAttempted)return false;
    item.nativeAlternateAttempted=true;
    const at=position(item);
    const old=active;
    const caps=await bridge.status().catch(()=>null);
    if(active!==old||current()!==item)return false;
    const alternate=item.nativeOutputFormat==="mp4"?"webm":"mp4";
    const audioOnly=item.nativeMediaInfo?.hasVideo===false;
    if(!(audioOnly?(alternate==="webm"?caps?.audioWebm:caps?.audioMp4):caps?.[alternate]))return false;
    return start(item,at,Boolean(item.autoplayRequested),alternate,item.codecAudioIndex||0);
  }
  return {start,seek,stop,isActive,position,duration,offset,retryAlternate};
}
root.DKCodecPlayback={attach};
})(typeof window!=="undefined"?window:globalThis);
