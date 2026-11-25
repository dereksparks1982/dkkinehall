"use strict";
/* Tests visible movie posters, TV still -> series fallback, cache, queue redraw.
 * Simulates <img> load success/failure and DOM replacement, not just API JSON.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const src=fs.readFileSync(path.join(__dirname,"../metadata-ui.js"),"utf8");
const observerFns=[],timers=[],persist=new Map();
class El{
 constructor(className=""){
  this.className=className;this.children=[];this.parent=null;this.dataset={};
  this.isConnected=true;this.hidden=false;this.title="";this.attributes={};
  this.classList={s:new Set(),add:x=>this.classList.s.add(x),
    remove:x=>this.classList.s.delete(x),contains:x=>this.classList.s.has(x)};
 }
 append(node){this.children.push(node);node.parent=this;}
 replaceChildren(...nodes){this.children=[...nodes];for(const n of nodes)n.parent=this;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
 setAttribute(k,v){this.attributes[k]=v;}
 querySelector(q){
  if(q===".queue-artwork-fallback")return this.children.find(x=>x.className==="queue-artwork-fallback")||null;
  if(q===".item-title")return this.name?{textContent:this.name}:null;
  if(q===".queue-artwork")return this.box||null;
  if(q===".queue-artwork-image:not([hidden])")
   return this.children.find(x=>x.className==="queue-artwork-image"&&!x.hidden)||null;
  return null;
 }
 querySelectorAll(q){return q===".queue-artwork-image"?
   this.children.filter(x=>x.className==="queue-artwork-image") : [];}
 matches(q){return q==="li";}
 closest(q){return q==="li"?this.parent:null;}
}
function item(name){
 const li=new El();li.name=name;li.dataset={queueKind:"file",queueAudio:"0"};
 li.box=new El("queue-artwork");li.box.parent=li;
 return li;
}
const queue=new El("queue");
let movie=item("The.Matrix.1999.1080p.mkv"),episode=item("Example.Show.S01E02.mkv");
queue.children=[movie,episode];
const movieURL="https://is1-ssl.mzstatic.com/image/thumb/Video/a/400x600bb.jpg";
const stillURL="https://static.tvmaze.com/failed-still.jpg";
const seriesURL="https://static.tvmaze.com/series-poster.jpg";
const requests=[];
const ctx={
 window:{
  DKMediaMetadata:{
   parseFilename:name=>name.startsWith("The.Matrix")?
     {type:"movie",title:"The Matrix",year:1999}:
     {type:"episode",series:"Example Show",season:1,episode:2},
   create:()=>({
    find:async name=>{
     requests.push(name);
     return name.startsWith("The.Matrix")?
      {url:movieURL,provider:"Apple",title:"The Matrix"}:
      {url:stillURL,fallbackUrl:seriesURL,provider:"TVmaze",title:"Episode 2"};
    },clear(){}
   })
  }
 },
 document:{
  documentElement:{lang:"en"},
  getElementById:id=>id==="queue"?queue:null,
  createElement(tag){
   const el=new El();
   if(tag==="img")Object.defineProperty(el,"src",{
    set(url){this.currentSrc=url;
     Promise.resolve().then(()=>{if(url===stillURL)this.onerror?.();else this.onload?.();});
    },get(){return this.currentSrc;}
   });
   return el;
  }
 },
 MutationObserver:class{constructor(fn){observerFns.push(fn);}observe(){}},
 localStorage:{getItem:k=>persist.get(k)||null,setItem:(k,v)=>persist.set(k,v)},
 setTimeout:fn=>{timers.push(fn);return timers.length},
 clearTimeout:()=>{},
 console,Date,Promise
};
vm.runInNewContext(src,ctx,{filename:"metadata-ui.js"});
const flush=async()=>{for(let i=0;i<14;i++)await Promise.resolve();};
(async()=>{
 await flush();
 assert.equal(requests.length,2,"Movie AND episode must request artwork");
 assert.equal(movie.box.dataset.artworkStatus,"loaded","Movie poster should load");
 assert.equal(movie.dataset.artworkType,"movie");
 assert.equal(movie.box.classList.contains("has-art"),true);
 const poster=movie.box.children.find(x=>x.className==="queue-artwork-image");
 assert.equal(poster.src,movieURL);
 assert.equal(episode.box.dataset.artworkStatus,"loaded","Series poster should replace missing still");
 assert.equal(episode.dataset.artworkType,"episode");
 assert.equal(episode.box.children.find(x=>x.className==="queue-artwork-image").src,seriesURL);
 assert.ok([...persist.values()].some(v=>v.includes(movieURL)),"Poster URL should survive reload");

 // Queue redraws occur on every playback change. Artwork must reappear in
 // fresh <li> nodes instead of disappearing with the old DOM.
 const replacement=item("The.Matrix.1999.1080p.mkv");
 queue.children=[replacement,episode];
 observerFns[0]();
 await flush();
 assert.equal(replacement.box.dataset.artworkStatus,"loaded");
 assert.equal(requests.filter(x=>x.startsWith("The.Matrix")).length,1,
   "Re-render must use existing metadata, not refetch the movie");
 console.log("PASS: movie poster and episode still->series fallback rendered as real images");
 console.log("PASS: cached poster links and image re-render after queue replacement");
})().catch(e=>{console.error(e);process.exitCode=1});
