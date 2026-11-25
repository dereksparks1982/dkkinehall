"use strict";
const assert = require("node:assert/strict");
const {scan, playable} = require("../folder-access.js");
const file = name => ({kind:"file",name,getFile:async()=>({
  name, type:"video/mp4", size:20, lastModified:1
})});
const dir = (name, children = []) => ({
  kind:"directory",name,async *entries(){for(const child of children)yield [child.name,child];}
});
(async()=>{
  const root=dir("Media",[
    file("Movie 10.mp4"),file("notes.txt"),file("Movie 2.mkv"),
    dir("Season 1",[file("Episode 2.mp4"),file("Episode 1.mp4"),
      dir("Behind",[file("Featurette.webm")])]),
    file("broken.avi")
  ]);
  const bad=root.entries;
  root.entries=async function*(){for await(const x of bad.call(this)){
    if(x[0]==="broken.avi")yield [x[0],{kind:"file",getFile:async()=>{throw Error("unreadable")}}];
    else yield x;
  }};
  const result=await scan(root);
  assert.deepEqual(result.files.map(x=>x.path),[
    "Movie 2.mkv","Movie 10.mp4","Season 1/Behind/Featurette.webm",
    "Season 1/Episode 1.mp4","Season 1/Episode 2.mp4"
  ]);
  assert.equal(result.truncated,false);
  assert.equal(result.files.length,5);
  assert.equal((await scan(root,{maxFiles:2})).files.length,2);
  assert.equal((await scan(root,{maxFiles:2})).truncated,true);
  assert.equal((await scan(root,{maxDepth:1})).truncated,true);
  assert.equal(playable("test.MKV"),true);
  assert.equal(playable("document.pdf"),false);
  await assert.rejects(scan(null),TypeError);
  await assert.rejects(scan(root,{signal:{aborted:true}}),/cancelled/);
  console.log("PASS: folder scanning, nested episodes, ordering, caps, filters and cancellation");
})().catch(error=>{console.error(error);process.exitCode=1});
