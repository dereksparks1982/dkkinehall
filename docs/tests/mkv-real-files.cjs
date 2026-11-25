"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const scanner=require("../mkv-tracks.js");
const codec=require("../mkv-audio.js");
const dir=process.env.DK_KINEHALL_FIXTURE_DIR;
if(!dir)throw new Error("Set DK_KINEHALL_FIXTURE_DIR to CI fixture folder");
const targets={mp3:["A_MPEG/L3","mp3"],flac:["A_FLAC","flac"],
  vorbis:["A_VORBIS","vorbis"]};
const readFile=which=>{
  const data=fs.readFileSync(path.join(dir,which+".mka"));
  return {name:which+".mkv",size:data.length,
    slice:(start,end)=>({arrayBuffer:async()=>Uint8Array.from(
      data.subarray(start,end)).buffer})};
};
(async()=>{
 for(const [name,[trackCodec,webCodec]] of Object.entries(targets)){
  const file=readFile(name);
  assert.ok(file.size>200,"Fixture must contain actual encoded packets");
  const inspect=await scanner.inspectFile(file);
  assert.ok(inspect.audioTracks.length,"Actual "+name+" track was not inspected");
  assert.equal(inspect.audioTracks[0].codec,trackCodec);
  assert.equal(inspect.videoTracks.length,0);
  if(name!=="mp3")assert.ok(inspect.audioTracks[0].privateData?.length>20,
    "The real codec initialization header must be inspected");
  const result=await codec.inspectAudioPackets(file,
    inspect.audioTracks[0].number,20);
  assert.equal(result.config.codec,webCodec,name+" decoder configuration");
  assert.ok(result.frames.length>=2,name+" must include real encoded packets");
  assert.ok(result.frames.every(frame=>frame.data?.length>0 &&
    Number.isFinite(frame.timestamp) && frame.duration>0),
    "All captured frames must have timestamps, durations and nonempty payloads");
  console.log("PASS: real MKV "+name+" header and "+
    result.frames.length+" encoded audio packets");
 }
})().catch(error=>{console.error(error);process.exitCode=1});
