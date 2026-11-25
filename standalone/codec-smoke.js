(async () => {
  "use strict";
  const fail = message => {throw new Error(message);};
  if (!window.DKMatroska || !window.DKMkvAudio || !window.DKPGS ||
      !window.DKVobSub || !window.DKMkvSubtitles) fail("Codec modules missing");
  const aac = window.DKMkvAudio.configFor({
    codec:"A_AAC",channels:2,rate:48000,
    privateData:new Uint8Array([0x11,0x90])
  });
  const opus = window.DKMkvAudio.configFor({
    codec:"A_OPUS",channels:2,rate:48000,privateData:null
  });
  if (aac.codec!=="mp4a.40.2" || opus.codec!=="opus")
    fail("AAC/Opus decoder configuration failed");
  const mp3=window.DKMkvAudio.configFor({
    codec:"A_MPEG/L3",channels:2,rate:44100
  });
  if(mp3.codec!=="mp3")fail("MKV MP3 decoder configuration failed");
  const registration={aac:false,opus:false,mp3:false};
  if(typeof AudioDecoder==="function" && typeof AudioDecoder.isConfigSupported==="function"){
    try{
      registration.aac=Boolean((await AudioDecoder.isConfigSupported(aac)).supported);
      registration.opus=Boolean((await AudioDecoder.isConfigSupported(opus)).supported);
      registration.mp3=Boolean((await AudioDecoder.isConfigSupported(mp3)).supported);
    }catch(err){console.warn("WebCodecs capability check:",String(err));}
  }
  // Decode a tiny DVD subtitle bitmap, render to a canvas, check visible
  // pixels. This verifies real bitmap output, not a metadata-only label.
  const privateData="size: 720x480\npalette: "+
    ["000000","ffffff",...Array(14).fill("888888")].join(", ");
  const packet=new Uint8Array(34);
  packet.set([0,34,0,8,0x90,0,0x90,0]);
  packet.set([0,0,0,8,0x01,0x03,0,0x10,0x04,0,0xf0,
    0x05,0,0,1,0,0,1,0x06,0,4,0,6,0xff],8);
  const event=window.DKVobSub.unpackPacket(packet,
    window.DKVobSub.parsePrivate(privateData),1,null);
  if (!event || event.pixels[3]!==255)fail("VobSub packet decoding failed");
  const canvas=document.createElement("canvas");
  window.DKVobSub.render(canvas,event);
  const rgba=canvas.getContext("2d").getImageData(0,0,1,1).data;
  if(rgba[0]!==255 || rgba[3]!==255)fail("VobSub bitmap not rendered");
  if(!window.DKPGS.canRender("S_HDMV/PGS"))fail("PGS regression");
  const subtitlesDefaultOff=
    [...document.getElementById("media").textTracks].every(x=>x.mode!=="showing");
  if(!subtitlesDefaultOff)fail("Subtitles must start off");
  if(!document.getElementById("fullscreen").getAttribute("aria-pressed"))
    fail("Fullscreen controls not initialized");
  return {passed:true,decoderAPIs:typeof AudioDecoder==="function",
    aacSupported:registration.aac,opusSupported:registration.opus,
    mp3Supported:registration.mp3,
    vobsubRaster:true,pgsAvailable:true,subtitlesDefaultOff};
})()