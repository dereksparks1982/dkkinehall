"use strict";
/* Chromium-side adapter smoke checks without reading any real media. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.resolve(__dirname,"../native-file.js"),"utf8");
const parent={};
new Function("window","globalThis",source)(parent,parent);
assert.equal(typeof parent.DKNativeFile.create,"function");
const row={id:"native:"+"a".repeat(64),filename:"South.Park.S01E01.mkv",
  nativePath:"/home/example/Videos/South Park/S01E01.mkv",relative:"TV/South Park/S01E01.mkv",
  size:9,modified:12345};
const bytes=new TextEncoder().encode("123456789");
const bridge={
  readRange:async(id,filePath,from,to)=>{
    assert.equal(id,row.id);
    assert.equal(filePath,row.nativePath);
    return bytes.slice(from,to);
  }
};
(async()=>{
  const opened={url:"file:///home/example/Videos/South%20Park/S01E01.mkv"};
  const {file,src}=parent.DKNativeFile.create(row,opened,bridge);
  assert.equal(src,opened.url);
  assert.equal(file.nativeVirtual,true);
  assert.equal(file.name,row.filename);
  assert.equal(file.size,9);
  assert.equal(new TextDecoder().decode(await file.slice(2,6).arrayBuffer()),"3456");
  assert.equal((await file.slice(0,0).arrayBuffer()).byteLength,0);
  console.log("PASS: native video URL and bounded, on-demand movie metadata reads");
})().catch(error=>{console.error(error);process.exitCode=1});
