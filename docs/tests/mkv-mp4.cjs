"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const mp4=require("../mkv-mp4.js");
const matroska=require("../mkv-tracks.js");
const fixture=process.env.DK_KINEHALL_MP4_FIXTURE;
if(!fixture)throw Error("DK_KINEHALL_MP4_FIXTURE not set");
const bytes=fs.readFileSync(fixture);
const mkv=new Blob([bytes],{type:"video/x-matroska"});
mkv.name="Synthetic.H264.AAC.mkv";
(async()=>{
 const tracks=await matroska.inspectFile(mkv);
 assert.equal(tracks.videoTracks.length,1);
 assert.equal(tracks.videoTracks[0].codec,"V_MPEG4/ISO/AVC");
 assert.equal(tracks.audioTracks.length,1);
 assert.equal(tracks.audioTracks[0].codec,"A_AAC");
 assert.ok(mp4.eligible(tracks,mkv));
 assert.equal(mp4.eligible({...tracks,audioTracks:[{codec:"A_AC3"}]},mkv),null);
 assert.equal(mp4.eligible({...tracks,tracks:[{codec:"S_HDMV/PGS"}]},mkv),null);
 const output=await mp4.remux(mkv,tracks);
 assert.match(output.mime,/avc1\.[0-9a-f]+, mp4a\.40\.2/);
 assert.ok(output.frames>12&&output.audioPackets>15);
 assert.ok(output.blob.size>mkv.size*0.7);
 const head=Buffer.from(await output.blob.slice(0,220).arrayBuffer());
 assert.ok(head.includes(Buffer.from("ftyp")));
 assert.ok(head.includes(Buffer.from("moov")));
 assert.ok(head.includes(Buffer.from("avc1")));
 assert.ok(head.includes(Buffer.from("mp4a")));
 assert.equal(Buffer.compare(bytes,fs.readFileSync(fixture)),0,
   "Local Matroska file bytes must remain intact");
 console.log("PASS: remux actual H264/AAC Matroska into MP4 "+
   output.frames+" video frames and "+output.audioPackets+" audio samples");
})().catch(e=>{console.error(e);process.exitCode=1});