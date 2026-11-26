"use strict";
/* Standalone discovery and deletion regression fixtures.
 * Requires only Node. Tests operate on temporary files under home;
 * they never touch or catalog the user's actual media collection.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const path=require("node:path");
const os=require("node:os");
const catalog=require("../library-indexer.cjs");
async function run(){
  const fixture=await fs.mkdtemp(path.join(os.homedir(),".dk-kinehall-indexer-test-"));
  const movie=path.join(fixture,"Movie.2020.mp4");
  const tvDir=path.join(fixture,"TV","South Park","Season 1");
  const episode=path.join(tvDir,"01 - Pilot.mkv");
  try{
    await fs.mkdir(tvDir,{recursive:true});
    await fs.writeFile(movie,Buffer.from("movie fixture"));
    await fs.writeFile(episode,Buffer.from("episode fixture"));
    await fs.writeFile(path.join(fixture,"music.mp3"),"music fixture");
    await fs.mkdir(path.join(fixture,"node_modules"),{recursive:true});
    await fs.writeFile(path.join(fixture,"node_modules","fake.mp4"),"ignored");
    const first=await catalog.discover({manual:true,testRoots:[fixture]});
    assert.equal(first.complete,true);
    assert.equal(first.items.length,2,"only videos outside excluded folders");
    assert.ok(first.items.some(item=>item.filename==="Movie.2020.mp4"));
    const movieId=catalog.fileIdentity(movie);
    const opened=await catalog.openVideo(movieId,movie);
    assert.match(opened.url,/^file:\/\//);
    assert.equal(opened.size,13);
    const range=await catalog.readRange(movieId,movie,0,5);
    assert.equal(Buffer.from(range).toString(),"movie");
    await assert.rejects(catalog.readRange(movieId,movie,0,32*1024*1024),
      /byte range/);
    await assert.rejects(catalog.openVideo("native:bad",movie),/Invalid video/);
    const canceled=await catalog.deleteVideo(movieId,movie,{
      dialog:{showMessageBox:async()=>({response:0})},
      shell:{trashItem:async()=>{throw Error("should not trash");}}
    });
    assert.equal(canceled.deleted,false);
    assert.equal((await fs.stat(movie)).isFile(),true);
    let trashes=0;
    const result=await catalog.deleteVideo(movieId,movie,{
      dialog:{showMessageBox:async()=>({response:1})},
      shell:{trashItem:async target=>{
        assert.equal(target,movie);trashes++;await fs.unlink(target);
      }}
    });
    assert.equal(result.method,"trash");
    assert.equal(trashes,1);
    await assert.rejects(fs.stat(movie),{code:"ENOENT"});
    const remaining=await catalog.discover({manual:true,testRoots:[fixture]});
    assert.equal(remaining.items.length,1);
    console.log("PASS: automatic discovery, exclusions, native range reads and confirmed filesystem deletion");
  }finally{
    await fs.rm(fixture,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1});
