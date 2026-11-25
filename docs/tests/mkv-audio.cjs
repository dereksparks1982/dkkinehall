/* DK Kinehall MKV AAC/Opus header, lacing, and WebCodecs checks. */
"use strict";
const assert=require("node:assert/strict");
const audio=require("../mkv-audio.js");
const aac=audio.configFor({codec:"A_AAC",channels:2,rate:48000,
  privateData:new Uint8Array([0x11,0x90])});
assert.equal(aac.codec,"mp4a.40.2");
assert.equal(aac.numberOfChannels,2);
assert.equal(aac.sampleRate,48000);
assert.deepEqual([...aac.description],[0x11,0x90]);
const opus=audio.configFor({codec:"A_OPUS",channels:2,rate:48000,
  privateData:new Uint8Array([79,112,117,115,72,101,97,100,1,2,0,0,0,0,0,0,0,0,0])});
assert.equal(opus.codec,"opus");
assert.equal(opus.sampleRate,48000);
assert.equal(audio.opusDuration(new Uint8Array([0])),10000);
assert.throws(()=>audio.configFor({codec:"A_AC3",channels:6,rate:48000}),/no supported/);
assert.throws(()=>audio.configFor({codec:"A_AAC",channels:0,rate:48000}),/Invalid/);
const unpack=async bytes=>{
  const reader={read:async(start,len)=>bytes.subarray(start,start+len)};
  return audio.splitBlock(reader,{start:0,end:bytes.length},2);
};
(async()=>{
  let result=await unpack(Uint8Array.from([0x82,0,0,0,1,2]));
  assert.deepEqual(result.map(f=>[...f.data]),[[1,2]]);
  result=await unpack(Uint8Array.from([0x82,0,0,0x02,1,2,1,2,3]));
  assert.deepEqual(result.map(f=>[...f.data]),[[1,2],[3]]);
  result=await unpack(Uint8Array.from([0x82,0,0,0x04,1,1,2,3,4]));
  assert.deepEqual(result.map(f=>[...f.data]),[[1,2],[3,4]]);
  result=await unpack(Uint8Array.from([0x82,0,0,0x06,2,0x82,0xc0,1,2,3,4,5,6]));
  assert.deepEqual(result.map(f=>[...f.data]),[[1,2],[3,4,5],[6]]);
  assert.deepEqual(await unpack(Uint8Array.from([0x81,0,0,0,1,2])),[]);
  console.log("PASS: AAC/Opus decoder configs and all Matroska audio lacing forms");
})().catch(err=>{console.error(err);process.exitCode=1});
