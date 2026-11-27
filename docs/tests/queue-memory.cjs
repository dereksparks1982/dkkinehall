const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"..","player.js"),"utf8");
const snippet=source.slice(source.indexOf("  let inspectionActive=null"),source.indexOf("  const load = (index, autoplay = true)"));
assert.ok(snippet.includes("inspectSelectedMkv"));
const add=source.slice(source.indexOf("  const addFiles ="),source.indexOf("  // Folder selection is permission-scoped."));
assert.ok(!add.includes(".inspectFile("),"Adding a folder must not read MKV headers");
assert.ok(source.includes("inspectSelectedMkv(item);"));
assert.ok(source.includes("if(previous&&previous!==item)releaseCompatible(previous);"));
async function run(){
 const queue=Array.from({length:338},(_,i)=>({name:i+".mkv",file:{name:i+".mkv"},mkvInspection:"not-mkv"}));
 let currentItem=queue[0],active=0,peak=0,seen=[],finish=[];
 const window={DKMatroska:{inspectFile(file){
   seen.push(file.name);peak=Math.max(peak,++active);
   return new Promise(resolve=>finish.push(()=>{active--;resolve({tracks:[]});}));
 }},DKMkvChapters:{inspectFile:async()=>[]}};
 const noop=()=>{};
 const select=new Function("window","state","current","updateSubtitleStatus","restoreAudioPreference","restoreEmbeddedSubtitlePreference","refreshOpenSubtitleMenu","mergeChapters",snippet+"\nreturn inspectSelectedMkv;")(window,{queue,stopped:false},()=>currentItem,noop,noop,noop,noop,noop);
 select(currentItem);
 for(const item of queue.slice(1)){currentItem=item;select(item);}
 assert.equal(seen.length,1);
 finish.shift()();
 for(let i=0;i<10;i++)await Promise.resolve();
 assert.deepEqual(seen,["0.mkv","337.mkv"]);
 assert.equal(peak,1);
 finish.shift()();
 for(let i=0;i<10;i++)await Promise.resolve();
 assert.equal(queue[337].mkvInspection,"complete");
 assert.equal(queue[100].mkvInspection,"deferred");
 assert.equal(queue[337].chaptersInspected,true);
 console.log("338-item queue: one active inspection, latest selection wins");
}
run().catch(error=>{console.error(error);process.exitCode=1;});
