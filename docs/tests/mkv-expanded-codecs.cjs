"use strict";
const assert=require("node:assert/strict");
const codec=require("../mkv-audio.js");
const shared={channels:2,rate:48000,defaultDuration:0};
const mp3=codec.configFor({...shared,codec:"A_MPEG/L3"});
assert.equal(mp3.codec,"mp3");
assert.equal(mp3.sampleRate,48000);
assert.equal(mp3.numberOfChannels,2);
assert.equal(codec.mp3Samples(Uint8Array.from([0xff,0xfb,0x90,0x00])),1152);
assert.equal(codec.mp3Samples(Uint8Array.from([0xff,0xf3,0x90,0x00])),576);
assert.equal(codec.frameDuration(Uint8Array.from([0xff,0xfb,0x90,0]),
  {...shared,codec:"A_MPEG/L3"}),24000);
assert.equal(codec.flacSamples(Uint8Array.from([0xff,0xf8,0xa0,0])),1024);
assert.equal(codec.flacSamples(Uint8Array.from([0xff,0xf8,0x20,0])),576);
const info=new Uint8Array(42);
info.set([0x66,0x4c,0x61,0x43,0x80,0,0,34,0x10,0,0x10,0],0);
// STREAMINFO: 48 kHz stereo, 16 bit, no total-sample count.
const bits=(48000n<<44n)|(1n<<41n)|(15n<<36n);
for(let i=0;i<8;i++)info[18+i]=Number((bits>>BigInt((7-i)*8))&255n);
assert.equal(codec.flacDescription(info),info);
const flac=codec.configFor({...shared,codec:"A_FLAC",privateData:info});
assert.equal(flac.codec,"flac");
assert.equal(flac.description[0],0x66);
assert.throws(()=>codec.flacDescription(Uint8Array.of(1,2)),/FLAC/);
assert.throws(()=>codec.flacDescription(new Uint8Array(42)),/FLAC/);
const packet=(kind,size=24)=>Uint8Array.from([kind,118,111,114,98,105,115,
  ...Array(size-7).fill(kind)]);
const packets=[packet(1,30),packet(3,28),packet(5,60)];
const priv=Uint8Array.from([2,packets[0].length,packets[1].length,
  ...packets[0],...packets[1],...packets[2]]);
const vorbis=codec.configFor({...shared,codec:"A_VORBIS",privateData:priv});
assert.equal(vorbis.codec,"vorbis");
assert.deepEqual([...vorbis.description.slice(0,4)],[3,30,28,60]);
assert.equal(vorbis.description[4],1);
assert.equal(vorbis.description[4+30],3);
assert.equal(vorbis.description[4+30+28],5);
assert.throws(()=>codec.vorbisDescription(Uint8Array.of(0)),/Vorbis/);
assert.throws(()=>codec.vorbisDescription(Uint8Array.from([2,7,7,...Array(25).fill(0)])),/Vorbis/);
assert.throws(()=>codec.configFor({...shared,codec:"A_AC3"}),/no supported/);
assert.throws(()=>codec.configFor({...shared,codec:"A_DTS"}),/no supported/);
// Codec names only count as selectable when WebCodecs + WebAudio exist.
const original=[globalThis.AudioDecoder,globalThis.EncodedAudioChunk,globalThis.AudioContext];
try{
 globalThis.AudioDecoder=function(){};
 globalThis.EncodedAudioChunk=function(){};
 globalThis.AudioContext=function(){};
 for(const track of ["A_OPUS","A_AAC","A_MPEG/L3","A_FLAC","A_VORBIS"]){
   const valid={codec:track,privateData:track==="A_FLAC"?info:
     track==="A_VORBIS"?priv:null};
   assert.equal(codec.canAttempt(valid),true,track);
 }
 assert.equal(codec.canAttempt({codec:"A_FLAC"}),false);
 assert.equal(codec.canAttempt({codec:"A_VORBIS"}),false);
 assert.equal(codec.canAttempt({codec:"A_AC3"}),false);
 assert.equal(codec.canAttempt({codec:"A_DTS"}),false);
}finally{
 [globalThis.AudioDecoder,globalThis.EncodedAudioChunk,globalThis.AudioContext]
   .forEach(()=>{});
 if(original[0]===undefined)delete globalThis.AudioDecoder;
 else globalThis.AudioDecoder=original[0];
 if(original[1]===undefined)delete globalThis.EncodedAudioChunk;
 else globalThis.EncodedAudioChunk=original[1];
 if(original[2]===undefined)delete globalThis.AudioContext;
 else globalThis.AudioContext=original[2];
}
console.log("PASS: expanded MKV MP3, FLAC, Vorbis WebCodecs configuration and frame lengths");
console.log("PASS: missing codec headers and unsupported AC3/DTS never exposed as playable");
