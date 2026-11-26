"use strict";
const assert=require("node:assert/strict");
const {capabilityFromEncoders,chooseOutput}=require("../codec-policy.cjs");
const webmOnly=capabilityFromEncoders(
" V..... libvpx-vp9   VP9\n A..... libopus    Opus\n S..... webvtt  captions");
assert.equal(webmOnly.ready,true);
assert.equal(webmOnly.mp4,false);
assert.equal(webmOnly.webm,true);
assert.equal(chooseOutput(webmOnly,"auto"),"webm");
assert.equal(chooseOutput(webmOnly,"webm"),"webm");
assert.throws(()=>chooseOutput(webmOnly,"mp4"),/MP4 output/);
const lgpl=capabilityFromEncoders(
" V..... libopenh264 H264\n A..... aac  AAC\n V..... libvpx-vp9 VP9\n A..... libopus Opus");
assert.equal(lgpl.h264Encoder,"libopenh264");
assert.equal(chooseOutput(lgpl,"auto"),"mp4");
const both=capabilityFromEncoders(
" V..... libx264 H264 GPL\n V..... libopenh264 H264\n A..... aac AAC\n"+
" V..... libvpx-vp9 VP9\n A..... libopus Opus");
assert.equal(both.h264Encoder,"libopenh264","Prefer LGPL-compatible encoder");
assert.equal(chooseOutput(both,"webm"),"webm");
const x264=capabilityFromEncoders(" V..... libx264 H264\n A..... aac AAC");
assert.equal(x264.mp4,true);
assert.equal(x264.webm,false);
assert.throws(()=>chooseOutput(x264,"webm"),/WebM output/);
const neither=capabilityFromEncoders(" V..... mpeg4 MPEG4\n A..... pcm_s16le PCM");
assert.equal(neither.ready,false);
assert.throws(()=>chooseOutput(neither,"auto"),/no usable/);
assert.throws(()=>chooseOutput(webmOnly,"avi"),/Unsupported/);
console.log("PASS: automatic WebM codec fallback, explicit format policy, LGPL-friendly H264 preference");
