/* Source-only Matroska subtitle/audio metadata fixtures (not run automatically). */
"use strict";
const assert = require("node:assert/strict");
const {parseHeader,parseTracksHeader,inspectFile} = require("../mkv-tracks.js");
const ascii = text => [...Buffer.from(text,"ascii")];
const element = (id, body) => {
  assert.ok(body.length < 16384);
  const len=body.length;
  return [...id,...(len<127?[0x80|len]:[0x40|(len>>8),len&255]),...body];
};
const subtitles = element([0xAE], [
  ...element([0xD7], [2]),
  ...element([0x83], [17]),
  ...element([0x86], ascii("S_TEXT/ASS")),
  ...element([0x22,0xB5,0x9C], ascii("eng")),
  ...element([0x53,0x6E], ascii("English subtitles"))
]);
const audio = element([0xAE], [
  ...element([0xD7], [1]),
  ...element([0x83], [2]),
  ...element([0x86], ascii("A_AC3")),
  ...element([0x53,0x6E], ascii("English surround")),
  ...element([0x22,0xB5,0x9C], ascii("eng")),
  ...element([0x88], [1]),
  ...element([0xE1], [
    ...element([0x9F], [6]),
    ...element([0xB5], [0x47,0x3B,0x80,0]), // 48000 Hz, big-endian float32
    ...element([0x62,0x64], [16])
  ])
]);
const header = Uint8Array.from([0x1A,0x45,0xDF,0xA3,0x80,
  ...element([0x16,0x54,0xAE,0x6B], [...audio,...subtitles])]);
const parsed = parseHeader(header);
assert.equal(parsed.length,1);
assert.deepEqual(parsed[0], {number:2,codec:"S_TEXT/ASS",
  name:"English subtitles",language:"eng"});
const found = parseTracksHeader(header);
assert.deepEqual(found.subtitles,parsed);
assert.deepEqual(found.videoTracks,[]);
assert.deepEqual(found.audioTracks,[{number:1,codec:"A_AC3",
  name:"English surround",language:"eng",channels:6,sampleRate:48000,
  bitDepth:16,default:true,forced:false}]);
const codecPrivate="size: 720x480\npalette: "+
  ["000000","ffffff",...Array(14).fill("888888")].join(", ");
const vob=element([0xae],[
  ...element([0xd7],[3]),
  ...element([0x83],[17]),
  ...element([0x86],ascii("S_VOBSUB")),
  ...element([0x63,0xA2],ascii(codecPrivate))
]);
const vobHeader=Uint8Array.from([...element([0x16,0x54,0xAE,0x6B],vob)]);
const vobTracks=parseTracksHeader(vobHeader).subtitles;
assert.equal(vobTracks.length,1);
assert.equal(vobTracks[0].codec,"S_VOBSUB");
assert.equal(new TextDecoder().decode(vobTracks[0].privateData),codecPrivate);
const video=element([0xae],[
  ...element([0xd7],[4]),
  ...element([0x83],[1]),
  ...element([0x86],ascii("V_MPEGH/ISO/HEVC")),
  ...element([0xe0],[
    ...element([0xb0],[0x07,0x80]),
    ...element([0xba],[0x04,0x38])
  ])
]);
const videoHeader=Uint8Array.from([...element([0x16,0x54,0xAE,0x6B],video)]);
assert.deepEqual(parseTracksHeader(videoHeader).videoTracks,[{
 number:4,codec:"V_MPEGH/ISO/HEVC",name:"",language:"und",
 width:1920,height:1080
}]);
const flacPrivate=Uint8Array.from([0x66,0x4c,0x61,0x43,0x80,0,0,34,
  ...Array(34).fill(0)]);
const flacEntry=element([0xae],[
  ...element([0xd7],[5]),
  ...element([0x83],[2]),
  ...element([0x86],ascii("A_FLAC")),
  ...element([0x63,0xa2],[...flacPrivate])
]);
const flacHeader=Uint8Array.from([...element([0x16,0x54,0xAE,0x6B],flacEntry)]);
const flacTrack=parseTracksHeader(flacHeader).audioTracks[0];
assert.equal(flacTrack.codec,"A_FLAC");
assert.deepEqual(flacTrack.privateData,flacPrivate);
assert.deepEqual(parseTracksHeader(new Uint8Array([0,1,2,3])),
  {subtitles:[],audioTracks:[],videoTracks:[]});
assert.deepEqual(parseHeader(new Uint8Array([0,1,2,3])),[]);
const fake = {name:"episode.mkv",size:header.length,
  slice:()=>({arrayBuffer: async () => header.buffer})};
inspectFile(fake).then(result=>{
  assert.equal(result.truncated,false);
  assert.deepEqual(result.tracks,parsed);
  assert.deepEqual(result.audioTracks,found.audioTracks);
  assert.deepEqual(result.videoTracks,[]);
  console.log("PASS: MKV subtitle, audio, FLAC CodecPrivate and HEVC video descriptor fixtures");
}).catch(error=>{console.error(error);process.exitCode=1});
