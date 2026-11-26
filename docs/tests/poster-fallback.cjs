"use strict";
/* Regressions for original Chromium Up Next movie-poster fallback.
 * Uses the real metadata API and simulated DOM image load/failure.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const meta=require("../episode-metadata.js");
const jelly=require("../jellyfin-artwork.js");
const cinemaURL="https://images.metahub.space/poster/medium/tt0133093/img";
const appleThumb="https://is1-ssl.mzstatic.com/image/thumb/Video123/v4/a.jpg/100x100bb.jpg";
const appleURL=meta.applePoster(appleThumb);
const matched={id:"tt0133093",name:"The Matrix",year:"1999",poster:cinemaURL};
const apple={kind:"feature-movie",trackName:"The Matrix",releaseDate:"1999-03-31",
  artworkUrl100:appleThumb,trackViewUrl:"https://itunes.apple.com/us/movie/id100"};
const requested=[];
const provider=meta.create({
  selectImage:jelly.choose,sleep:async()=>{},
  appleSearch:async()=>({results:[apple]}),
  fetchJSON:async url=>{
    requested.push(url);
    if(url.includes("cinemeta.strem.io"))
      return {ok:true,json:async()=>({metas:[matched]})};
    throw Error("Unexpected provider request: "+url);
  }
});
class El{
  constructor(cls=""){
    this.className=cls;this.children=[];this.parent=null;this.dataset={};
    this.hidden=false;this.isConnected=true;this.attributes={};
    this.classList={values:new Set(),add:x=>this.classList.values.add(x),
      remove:x=>this.classList.values.delete(x),
      contains:x=>this.classList.values.has(x)};
  }
  append(node){this.children.push(node);node.parent=this;}
  replaceChildren(...nodes){this.children=nodes;for(const n of nodes)n.parent=this;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
  setAttribute(k,v){this.attributes[k]=v;}
  closest(q){return q==="li"?this.parent:null;}
  matches(q){return q==="li";}
  querySelector(q){
    if(q===".queue-artwork")return this.box||null;
    if(q===".item-title")return this.name?{textContent:this.name}:null;
    if(q===".queue-artwork-fallback")return this.children.find(x=>x.className==="queue-artwork-fallback")||null;
    if(q===".queue-artwork-image:not([hidden])")
      return this.children.find(x=>x.className==="queue-artwork-image"&&!x.hidden)||null;
    return null;
  }
  querySelectorAll(q){return q===".queue-artwork-image"?
    this.children.filter(x=>x.className==="queue-artwork-image"):[];}
}
const li=new El();
li.name="The.Matrix.1999.1080p.mkv";
li.dkQueueItem={name:li.name};
li.dataset={queueKind:"file",queueAudio:"0"};
li.box=new El("queue-artwork");li.box.parent=li;
const queue=new El("queue");queue.children=[li];
const persist=new Map(),observers=[],timers=[],findCalls=[];
const src=fs.readFileSync(path.join(__dirname,"../metadata-ui.js"),"utf8");
const context={
  window:{
    DKMediaMetadata:{
      parseFilename:meta.parseFilename,
      create:()=>({
        find:(name,options)=>{findCalls.push({name,options});return provider.find(name,options);},
        clear:()=>provider.clear()
      })
    }
  },
  document:{
    documentElement:{lang:"en"},
    getElementById:id=>id==="queue"?queue:null,
    createElement:tag=>{
      const el=new El();
      if(tag==="img")Object.defineProperty(el,"src",{
        get(){return this.loadedSrc;},
        set(url){this.loadedSrc=url;Promise.resolve().then(()=>{
          if(url===cinemaURL)this.onerror?.();else this.onload?.();
        });}
      });
      return el;
    }
  },
  MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},
  localStorage:{getItem:k=>persist.get(k)||null,setItem:(k,v)=>persist.set(k,v)},
  setTimeout:fn=>{timers.push(fn);return timers.length;},
  clearTimeout:()=>{},Date,Promise,console
};
vm.runInNewContext(src,context,{filename:"metadata-ui.js"});
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
(async()=>{
  await flush();
  const image=li.box.querySelector(".queue-artwork-image:not([hidden])");
  assert.ok(image,"a movie poster should become visible");
  assert.equal(image.src,appleURL,"a failed Cinemeta image must fall back to Apple's poster");
  assert.equal(li.box.dataset.artworkStatus,"loaded");
  assert.ok(persist.get("dk-kinehall.artwork-links.v1").includes(appleURL),
    "only a poster URL confirmed by the image element is cached");
  assert.equal(findCalls.length,2,"primary artwork and one alternative provider");
  assert.deepEqual(Array.from(findCalls[1].options.excludeProviders),["Cinemeta"]);
  assert.equal(requested.length,1,"do not repeat the failed Cinemeta metadata request");

  const replacement=new El();
  replacement.name=li.name;
  replacement.dkQueueItem={name:li.name};
  replacement.dataset={queueKind:"file",queueAudio:"0"};
  replacement.box=new El("queue-artwork");replacement.box.parent=replacement;
  queue.children=[replacement];
  observers[0]();
  await flush();
  const cached=replacement.box.querySelector(".queue-artwork-image:not([hidden])");
  assert.ok(cached&&cached.src===appleURL,"queue redraw should keep the verified poster");
  assert.equal(findCalls.length,2,"verified art should be reused without refetching");
  assert.match(src,/delete li\.dataset\.artworkRequested/,
    "scheduled retries must reset the lookup guard");
  console.log("PASS: failed poster CDN switches providers, verifies cache, survives queue redraw");
})().catch(e=>{console.error(e);process.exitCode=1;});
