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
  const mp4=Boolean(h264Encoder&&has(text,"A","aac"));
  const webm=has(text,"V","libvpx-vp9")&&has(text,"A","libopus");
  return {
    ready:mp4||webm,engine:"bundled FFmpeg",
    output:mp4?"fragmented MP4":"WebM",
    mp4,webm,h264Encoder,
    ...(!mp4&&!webm?{reason:"Bundled decoder has no usable video/audio streaming output"}:{})
  };
}
function chooseOutput(caps,requested="auto") {
  if(!["auto","mp4","webm"].includes(requested))
    throw new Error("Unsupported streaming output format");
  if(!caps?.ready)
    throw new Error(caps?.reason||"Bundled decoder is unavailable");
  const selected=requested==="auto"?(caps.mp4?"mp4":"webm"):requested;
  if(selected==="mp4"&&!caps.mp4)
    throw new Error("Bundled decoder cannot create the selected MP4 output");
  if(selected==="webm"&&!caps.webm)
    throw new Error("Bundled decoder cannot create the selected WebM output");
  return selected;
}
module.exports={capabilityFromEncoders,chooseOutput};
