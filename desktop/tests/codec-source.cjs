"use strict";
const assert=require("node:assert/strict");
const path=require("node:path");
const {parseSource,resolveSource}=require("../codec-source.cjs");
(async()=>{
  const selected="/home/example/Videos/South Park/S01E01.mkv";
  assert.deepEqual(parseSource(selected),{kind:"picked",path:selected});
  assert.equal(await resolveSource(selected),selected,
    "Selected files already resolved by Electron webUtils keep their path");
  assert.throws(()=>parseSource("../../etc/passwd"),/local file/);
  assert.throws(()=>parseSource("/tmp/\0movie.mkv"),/local file/);
  const id="native:"+"b".repeat(64);
  const value={kind:"native",id,path:selected};
  let checked=0;
  const resolved=await resolveSource(value,async(receivedId,receivedPath)=>{
    checked++;
    assert.equal(receivedId,id);
    assert.equal(receivedPath,selected);
    return {target:selected};
  });
  assert.equal(checked,1);
  assert.equal(resolved,selected);
  await assert.rejects(resolveSource(value,async()=>{
    throw Error("Video is outside the local library scope");
  }),/outside the local library/);
  await assert.rejects(resolveSource(value),/verification is unavailable/);
  assert.throws(()=>parseSource({kind:"native",id:"native:bad",path:selected}),
    /discovered video/);
  assert.throws(()=>parseSource({kind:"native",id,path:"/tmp/\0evil.mkv"}),
    /discovered video/);
  assert.throws(()=>parseSource({kind:"picked",path:"/etc/shadow"}),
    /discovered video/);
  console.log("PASS: native discovery must be verified in Electron main before ffprobe/ffmpeg");
})().catch(error=>{console.error(error);process.exitCode=1;});
