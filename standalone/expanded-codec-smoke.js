(async()=>{
"use strict";
// Generated test media is created only by the CI build machine and never
// included in a public release. Each encoded chunk is decoded in Chromium,
// proving the track is more than metadata.
const fixtures=__DK_CODEC_FIXTURES__;
const result={passed:false,codecs:{}};
for(const [name,base64] of Object.entries(fixtures)){
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  const file=new File([bytes],"test-"+name+".mkv",{type:"video/x-matroska"});
  const descriptor=await window.DKMatroska.inspectFile(file);
  const track=descriptor.audioTracks?.[0];
  if(!track||!window.DKMkvAudio.canAttempt(track))
    throw new Error(name+" track not made selectable");
  const sample=await window.DKMkvAudio.inspectAudioPackets(file,track.number,24);
  if(!sample.frames.length)
    throw new Error(name+" has zero demuxed frames");
  const available=await AudioDecoder.isConfigSupported(sample.config);
  const state={fileBytes:file.size,track:track.codec,
    packets:sample.frames.length,webCodecsSupported:available.supported,
    decodedFrames:0};
  if(available.supported){
    const errors=[];
    const decoder=new AudioDecoder({
      output:frame=>{state.decodedFrames++;frame.close();},
      error:error=>errors.push(String(error))
    });
    try{
      decoder.configure(sample.config);
      for(const f of sample.frames)
        decoder.decode(new EncodedAudioChunk({
          type:"key",timestamp:f.timestamp,duration:f.duration,data:f.data
        }));
      await decoder.flush();
      if(errors.length)throw new Error(name+" WebCodecs: "+errors.join("; "));
      if(!state.decodedFrames)throw new Error(name+" produced no decoded audio");
    }finally{
      decoder.close();
    }
  }
  result.codecs[name]=state;
}
if(!result.codecs.mp3.webCodecsSupported ||
    !result.codecs.mp3.decodedFrames)
  throw new Error("Bundled Chromium did not decode real MP3 frames");
result.passed=true;
return result;
})()