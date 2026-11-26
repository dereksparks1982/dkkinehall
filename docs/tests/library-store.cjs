"use strict";
/* No server, npm dependency, codec download or external device required.
 * Memory-only IndexedDB adapter exercises the user-visible library contract.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
global.window={DKMediaMetadata:require("../episode-metadata.js")};
const databases=new Map();
global.indexedDB={open(name){
  const req={result:null,onsuccess:null,onerror:null,onupgradeneeded:null};
  setTimeout(()=>{
    let db=databases.get(name),fresh=false;
    if(!db){db=createDatabase();databases.set(name,db);fresh=true;}
    req.result=db;
    if(fresh)req.onupgradeneeded?.();
    req.onsuccess?.();
  },0);
  return req;
}};
function createDatabase(){
  const maps=new Map(),keys=new Map();
  const db={
    objectStoreNames:{contains:name=>maps.has(name)},
    createObjectStore(name,{keyPath="id"}={}){
      maps.set(name,new Map());keys.set(name,keyPath);
      return {createIndex(){}};
    },
    transaction(names,mode){
      const tx={oncomplete:null,onabort:null,error:null,_pending:0,_done:false,abort(){}};
      tx.objectStore=name=>{
        const rows=maps.get(name);
        if(!rows)throw Error("Unknown IndexedDB object store "+name);
        const operation=(kind,arg)=>{
          const request={result:undefined,onsuccess:null};
          tx._pending++;
          Promise.resolve().then(()=>{
            if(kind==="get")request.result=rows.get(arg);
            if(kind==="all")request.result=[...rows.values()];
            if(kind==="folder")
              request.result=[...rows.values()].filter(row=>row.folderId===arg);
            if(kind==="put")rows.set(arg[keys.get(name)],arg);
            if(kind==="delete")rows.delete(arg);
            request.onsuccess?.();
            tx._pending--;
            if(!tx._pending&&!tx._done){
              tx._done=true;
              setTimeout(()=>tx.oncomplete?.(),0);
            }
          });
          return request;
        };
        return {
          get:key=>operation("get",key),getAll:()=>operation("all"),
          put:row=>operation("put",row),delete:key=>operation("delete",key),
          index:key=>({getAll:id=>operation("folder",id)})
        };
      };
      return tx;
    }
  };
  return db;
}
const store=require("../library-store.js");
const files=new Map([
  ["South.Park.S03E07.mkv",{name:"South.Park.S03E07.mkv",size:130,lastModified:111}],
  ["The.Matrix.1999.mp4",{name:"The.Matrix.1999.mp4",size:250,lastModified:222}],
  ["A.Song.mp3",{name:"A.Song.mp3",size:30,lastModified:333}],
  ["Other.Audio.ogg",{name:"Other.Audio.ogg",size:50,lastModified:444}]
]);
const handle={kind:"directory",name:"Movies",
  queryPermission:async()=> "granted",
  isSameEntry:async other=>other?.name==="Movies",
  async *entries(){
    for(const [name,file] of files)yield [name,{
      kind:"file",name,getFile:async()=>file
    }];
  },
  getFileHandle:async(name)=>{
    if(!files.has(name))throw Error("Missing");
    return {getFile:async()=>files.get(name)};
  }
};
async function run(){
  assert.equal(store.classify("Music.mp3"),null);
  assert.equal(store.classify("Album.ogg"),null);
  assert.equal(store.classify("Film.mp4").kind,"movie");
  const nested=store.classify("01 - Cartman Gets An Anal Probe.mkv",
    "South Park/Season 1/01 - Cartman Gets An Anal Probe.mkv");
  assert.equal(nested.kind,"tv");
  assert.equal(nested.series,"South Park");
  assert.equal(nested.season,1);
  assert.equal(nested.episode,1);
  assert.match(nested.episodeTitle,/Cartman Gets/);
  assert.equal(store.classify("01 - Film.mkv","Movies/01 - Film.mkv").kind,"movie");
  const russianSeason=store.classify("02 - Проверка.mkv",
    "Сериал/Сезон 02/02 - Проверка.mkv");
  assert.equal(russianSeason.kind,"tv");
  assert.equal(russianSeason.season,2);
  assert.deepEqual(
    Object.fromEntries(Object.entries(store.classify("South.Park.S00E01.Special.mkv"))
      .filter(([key])=>["kind","season","episode"].includes(key))),
    {kind:"tv",season:0,episode:1}
  );
  const folder=await store.addFolder(handle);
  const first=await store.scanFolder(folder,{manual:true});
  assert.deepEqual([first.added,first.updated,first.missing],[2,0,0]);
  assert.equal((await store.folders()).length,1);
  assert.equal((await store.entries()).length,2);
  const episode=(await store.entries()).find(row=>row.kind==="tv");
  assert.ok(episode);
  await store.updateProgress(episode.id,29,100);
  await store.updateMetadata(episode.id,{episodeTitle:"Cat Orgy"});
  assert.equal((await store.item(episode.id)).position,29);
  assert.equal((await store.item(episode.id)).episodeTitle,"Cat Orgy");
  await store.updateProgress(episode.id,0,8,false);
  assert.equal((await store.item(episode.id)).completed,false,
    "Stopping a short clip at zero must not mark it watched");
  await store.updateProgress(episode.id,29,100,false);
  await store.updateProgress(episode.id,100,100,true);
  assert.equal((await store.item(episode.id)).completed,true);
  await store.updateProgress(episode.id,29,100,false);
  assert.equal((await store.item(episode.id)).completed,false);
  files.set("South.Park.S03E07.New.Title.mkv",{
    name:"South.Park.S03E07.New.Title.mkv",size:130,lastModified:111
  });
  files.delete("South.Park.S03E07.mkv");
  const renamed=await store.scanFolder(folder,{manual:true});
  assert.deepEqual([renamed.added,renamed.updated,renamed.missing],[0,1,0]);
  const newEpisode=(await store.entries()).find(row=>row.kind==="tv");
  assert.equal(newEpisode.episodeTitle,"Cat Orgy");
  assert.equal(newEpisode.position,29);
  assert.equal(newEpisode.metadataVerified,true);
  files.delete("The.Matrix.1999.mp4");
  const missing=await store.scanFolder(folder,{manual:true});
  assert.equal(missing.missing,1);
  assert.equal((await store.entries()).find(row=>row.kind==="movie").missing,true);
  files.set("The.Matrix.1999.mp4",{
    name:"The.Matrix.1999.mp4",size:250,lastModified:222
  });
  const returned=await store.scanFolder(folder,{manual:true});
  assert.equal(returned.updated,1);
  assert.equal((await store.entries()).find(row=>row.kind==="movie").missing,false);
  // Only a metadata/cache record is written; no video bytes are stored.
  assert.ok(!("blob" in newEpisode));
  const nativeId="native:"+"f".repeat(64);
  const discovered={
    id:nativeId,nativePath:"/home/example/Videos/Film.2024.mp4",
    filename:"Film.2024.mp4",relative:"Videos/Film.2024.mp4",
    root:"/home/example",size:12345,modified:42
  };
  const imported=await store.ingestNative({items:[discovered],complete:true});
  assert.equal(imported.added,1);
  assert.equal((await store.item(nativeId)).source,"native");
  assert.equal((await store.item(nativeId)).kind,"movie");
  await store.updateProgress(nativeId,40,120);
  await store.ingestNative({items:[discovered],complete:true});
  assert.equal((await store.item(nativeId)).position,40,
    "Automatic rescans preserve Continue Watching positions");
  await store.ingestNative({items:[],complete:false});
  assert.equal((await store.item(nativeId)).missing,false,
    "Partial scans never hide disconnected media");
  await store.ingestNative({items:[],complete:true});
  assert.equal((await store.item(nativeId)).missing,true,
    "Completed scans mark missing media without deleting it");
  assert.equal(await store.removeEntry(nativeId),true);
  assert.equal(await store.item(nativeId),undefined,
    "Completed filesystem deletion removes cached entry");
  console.log("PASS: Movies/TV-only catalog, Season 0, cache, progress, rename, missing and restored files");
}
run().catch(error=>{console.error(error);process.exitCode=1});
