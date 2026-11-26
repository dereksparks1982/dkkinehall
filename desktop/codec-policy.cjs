"use strict";
/* Standalone native codec output policy. Pure and unit-testable.
 * Do not require GPL-linked libx264 to enable broad-format playback.
 */
function has(text,type,name){
  // All names here are fixed maintainer-defined codec identifiers.
  return new RegExp("(?:^|\\n)\\s*"+type+"\\S*\\s+"+name+"\\s","m")
    .test(String(text||""));
}
function capabilityFromEncoders(encoders) {
  const text=String(encoders||"");
  const h264Encoder=has(text,"V","libopenh264")?"libopenh264":
    has(text,"V","libx264")?"libx264":null;
  const mp4Copy=has(text,"A","aac");
  const mp4=Boolean(h264Encoder&&mp4Copy);
  const audioWebm=has(text,"A","libopus");
  const webm=has(text,"V","libvpx-vp9")&&audioWebm;
  return {
    ready:mp4||webm||mp4Copy||audioWebm,engine:"bundled FFmpeg",
    output:mp4?"fragmented MP4":"WebM",
    mp4,mp4Copy,webm,h264Encoder,audioMp4:mp4Copy,audioWebm,
    ...(!mp4&&!webm&&!mp4Copy&&!audioWebm?{reason:"Bundled decoder has no usable video/audio streaming output"}:{})
  };
}
function chooseOutput(caps,requested="auto",copyVideo=false,audioOnly=false) {
  if(!["auto","mp4","webm"].includes(requested))
    throw new Error("Unsupported streaming output format");
  if(!caps?.ready)
    throw new Error(caps?.reason||"Bundled decoder is unavailable");
  const canMP4=audioOnly?caps.audioMp4:(caps.mp4||(copyVideo&&caps.mp4Copy));
  const canWebM=audioOnly?caps.audioWebm:caps.webm;
  const selected=requested==="auto"?(canMP4?"mp4":"webm"):requested;
  if(selected==="mp4"&&!canMP4)
    throw new Error("Bundled decoder cannot create the selected MP4 output");
  if(selected==="webm"&&!canWebM)
    throw new Error("Bundled decoder cannot create the selected WebM output");
  return selected;
}
module.exports={capabilityFromEncoders,chooseOutput};
