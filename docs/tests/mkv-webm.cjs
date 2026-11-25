"use strict";
const assert=require("node:assert/strict");
const compat=require("../mkv-webm.js");
const v=require("../mkv-tracks.js");
const fs=require("node:fs"),path=require("node:path");
const f=process.env.DK_KINEHALL_WEBM_FIXTURE;
if(!f)throw new Error("Set DK_KINEHALL_WEBM_FIXTURE");
const data=fs.readFileSync(f);
const file=new Blob([data],{type:"video/x-matroska"});file.name="Movie.mkv";
const info={videoTracks:[{codec:"V_VP9"}],audioTracks:[{codec:"A_OPUS"}],tracks:[]};
assert.equal(compat.eligible(info,file).mime,'video/webm; codecs="vp9, opus"');
assert.equal(compat.eligible({...info,videoTracks:[{codec:"V_MPEGH/ISO/HEVC"}]},file),null);
assert.equal(compat.eligible({...info,audioTracks:[{codec:"A_AC3"}]},file),null);
assert.equal(compat.eligible({...info,tracks:[{codec:"S_HDMV/PGS"}]},file),null);
assert.throws(()=>compat.rewriteHeader(Uint8Array.from([0,1,2,3])),/Not an EBML/);
(async()=>{
 const parsed=await v.inspectFile(file);
 assert.equal(parsed.videoTracks[0].codec,"V_VP9");
 assert.equal(parsed.audioTracks[0].codec,"A_OPUS");
 const {blob,mime}=await compat.wrap(file,parsed);
 assert.equal(blob.size,file.size,"No bytes may be lost during conversion");
 assert.equal(mime,'video/webm; codecs="vp9, opus"');
 const prefix=new Uint8Array(await blob.slice(0,64).arrayBuffer());
 assert.ok(new TextDecoder().decode(prefix).includes("webm"),"DocType was not rewritten");
 assert.ok(new TextDecoder().decode(data.subarray(0,64)).includes("matroska"),
   "Original MKV cannot be modified in place");
 assert.equal(Buffer.compare(Buffer.from(await blob.slice(16384).arrayBuffer()),
   data.subarray(16384)),0,"Entire media payload must remain byte-identical");
 console.log("PASS: local lossless WebM-compatible Matroska fallback and safe codec gating");
})().catch(err=>{console.error(err);process.exitCode=1});