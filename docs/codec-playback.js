/* DK Kinehall standalone-only native decoding adapter.
 * The shared player keeps its existing <video>, controls and playlist.
 * This is only enabled when Electron exposes the guarded DKCodecBridge and
 * actual packaged native FFmpeg executables are available.
 */
(function(root){
"use strict";
function attach({media,bridge,current,onStatus=()=>{},onClockChanged=()=>{}}) {
  if(!bridge||typeof bridge.start!=="function"||!media)return null;
  let generation=0,active=null,chain=Promise.resolve();
  const enqueue=work=>{
    const task=chain.catch(()=>{}).then(work);
    chain=task.catch(()=>{});
    return task;
  };
  const isActive=item=>!!active&&active.item===item;
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
  async function start(item,offset=0,autoplay=true,format="mp4"){
    if(!item?.file||current()!==item)return false;
    const token=++generation;
    return enqueue(async()=>{
      if(token!==generation||current()!==item)return false;
      try {
        const capability=await bridge.status();
        if(!capability?.ready)
          throw Error(capability?.reason||"Bundled decoder is unavailable");
        if(token!==generation||current()!==item)return false;
        onStatus("Preparing video with included codecs…");
        const result=await bridge.start(item.file,Math.max(0,Number(offset)||0),format);
        if(token!==generation||current()!==item||!result?.url)return false;
        active={item,offset:Number(result.position)||0,
          duration:result.duration===null||result.duration===undefined?
            null:(Number.isFinite(Number(result.duration))?Number(result.duration):null)};
        item.playbackMethod="Bundled native decoder";
        item.codecActive=true;
        media.pause();
        media.src=result.url;
        media.load();
        onClockChanged();
        if(autoplay) {
          try {
            const request=media.play();
            if(request?.catch)request.catch(error=>{
              if(error?.name!=="AbortError"&&error?.name!=="NotAllowedError")
                onStatus("Playback could not start: "+String(error?.message||error));
            });
          }catch(error){onStatus("Playback could not start.");}
        }
        if(token===generation&&current()===item)
          onStatus("Playing with included codecs.",true);
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
  const seek=(item,seconds)=>{
    if(!isActive(item)) {
      if(Number.isFinite(Number(seconds)))media.currentTime=Math.max(0,Number(seconds));
      return Promise.resolve(true);
    }
    const limit=duration(item);
    const position=Math.max(0,Number.isFinite(limit)?
      Math.min(limit-0.25,Number(seconds)||0):Number(seconds)||0);
    const playing=!media.paused;
    return start(item,position,playing,item.requestedFormat==="webm"?"webm":"mp4");
  };
  return {start,seek,stop,isActive,position,duration};
}
root.DKCodecPlayback={attach};
})(typeof window!=="undefined"?window:globalThis);
