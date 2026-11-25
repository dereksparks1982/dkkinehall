/* DK Kinehall real artwork for movies and episodes in Up Next.
 * Movies: automatic keyless Apple catalog art; TV: TVmaze episode still then
 * series poster. Optional Matroska cover and local frame as offline fallback.
 * No file bytes, paths, thumbnails or tokens are uploaded.
 */
(function(){
"use strict";
if(typeof document==="undefined"||!window.DKMediaMetadata)return;
const queue=document.getElementById("queue");
if(!queue)return;
const enabled=true,token="";
const STORE="dk-kinehall.artwork-links.v1",DAYS=14*86400000,MAX_CACHE=160;
let seen=new WeakSet(),cache=new Map(),retryScheduled=null,generation=0;
let retried=new Set(),retryQueue=new Set();
const choose=(item,opts)=>window.DKJellyfinArtwork?
  window.DKJellyfinArtwork.choose(item,opts):null;
const finder=window.DKMediaMetadata.create({
  enabled:()=>enabled,token:()=>token,selectImage:choose
});
const locale=(en,ru)=>document.documentElement.lang==="ru"?ru:en;
const stored=(()=>{
  try{
    const entries=JSON.parse(localStorage.getItem(STORE)||"[]");
    return new Map((Array.isArray(entries)?entries:[])
      .filter(x=>Array.isArray(x)&&typeof x[0]==="string"&&
        x[1]&&Date.now()-x[1].saved<DAYS&&
        x[1].url&&/^https:\/\//.test(x[1].url)).slice(-MAX_CACHE));
  }catch(_){return new Map();}
})();
function saveArt(name,art){
  if(!art||!art.url||!/^https:\/\//.test(art.url))return;
  stored.delete(name);stored.set(name,{...art,saved:Date.now()});
  while(stored.size>MAX_CACHE)stored.delete(stored.keys().next().value);
  try{localStorage.setItem(STORE,JSON.stringify([...stored]));}catch(_){}
}
function forgetArt(name){
  stored.delete(name);
  try{localStorage.setItem(STORE,JSON.stringify([...stored]));}catch(_){}
}
function status(box,message,state){
  if(!box)return;
  box.title=message;
  box.dataset.artworkStatus=state;
  box.setAttribute("aria-label",message);
}
function resetBox(box){
  box.replaceChildren();
  const fallback=document.createElement("span");
  fallback.className="queue-artwork-fallback";
  fallback.textContent="▶";
  box.append(fallback);
  box.classList.remove("has-art");
}
function showImage(box,art,requestedGeneration,source="provider"){
  if(!box.isConnected||requestedGeneration!==generation||!art?.url)return;
  const urls=[art.url,art.fallbackUrl].filter((url,i,all)=>url&&all.indexOf(url)===i);
  if(!urls.length)return;
  const image=document.createElement("img");
  image.className="queue-artwork-image";
  image.alt="";
  image.decoding="async";
  image.loading="eager";
  image.hidden=true;
  let index=0;
  image.onload=()=>{
    if(!box.isConnected||requestedGeneration!==generation)return;
    // The best verified image wins. Never let a late local frame replace
    // a real movie poster or episode still.
    if(source==="local"&&box.dataset.artworkStatus==="loaded"){
      image.remove();return;
    }
    for(const previous of box.querySelectorAll(".queue-artwork-image"))
      if(previous!==image)previous.remove();
    image.hidden=false;
    box.classList.add("has-art");
    const placeholder=box.querySelector(".queue-artwork-fallback");
    if(placeholder)placeholder.hidden=true;
    if(source==="local"){
      status(box,locale("Local movie preview","Кадр из файла"),"local-preview");
    }else{
      const provider=locale(art.provider==="TVmaze"?"TVmaze":art.provider,
        art.provider==="TVmaze"?"ТВмейз":
        art.provider==="Apple"?"Эппл":
        art.provider==="Cinemeta"?"Синемета":
        art.provider==="TMDb"?"ТМДБ":"Источник");
      status(box,provider+": "+locale(art.title||"Artwork","Изображение"),"loaded");
    }
  };
  image.onerror=()=>{
    if(!box.isConnected||requestedGeneration!==generation)return;
    if(++index<urls.length){image.src=urls[index];return;}
    image.remove();
    if(source==="provider"){
      const name=box.closest("li")?.querySelector(".item-title")?.textContent?.trim();
      if(name){cache.delete(name);forgetArt(name);}
      if(!box.querySelector(".queue-artwork-image:not([hidden])")){
        box.classList.remove("has-art");
        const fallback=box.querySelector(".queue-artwork-fallback");
        if(fallback)fallback.hidden=false;
      }
      status(box,locale("Artwork image failed to load; retrying",
        "Не удалось загрузить изображение, повторная попытка"),"image-error");
      scheduleRetry(name);
    }
  };
  box.append(image);
  image.src=urls[0];
}
const localThumbnails=window.DKQueueArtwork?.create({
  makeVideo:()=>document.createElement("video"),
  makeCanvas:()=>document.createElement("canvas"),
  metadataCover:file=>window.DKMatroskaCover?
    window.DKMatroskaCover.extract(file):Promise.resolve(null),
  isActive:item=>[...queue.children].some(li=>li.dkQueueItem===item),
  onReady:item=>{
    for(const li of queue.children){
      if(li.dkQueueItem!==item)continue;
      const box=li.querySelector(".queue-artwork");
      if(box&&box.dataset.artworkStatus!=="loaded")
        showImage(box,{url:item.thumbnail},generation,"local");
    }
  }
})||null;
function scheduleRetry(name){
  if(!enabled||!name||retried.has(name))return;
  retried.add(name);retryQueue.add(name);
  if(retryScheduled!==null)return;
  retryScheduled=setTimeout(()=>{
    retryScheduled=null;
    finder.clear();
    const names=new Set(retryQueue);
    for(const name of names){cache.delete(name);forgetArt(name);}
    retryQueue.clear();
    for(const li of queue.children){
      if(names.has(li.querySelector(".item-title")?.textContent?.trim())){
        seen.delete(li);
        if(intersection)intersection.unobserve(li);
      }
    }
    scan();
  },4800);
}
function lookup(li,box,name,parsed,epoch){
  if(li.dataset.artworkRequested==="1")return;
  li.dataset.artworkRequested="1";
  if(!cache.has(name))cache.set(name,finder.find(name).catch(()=>null));
  cache.get(name).then(art=>{
    if(!box.isConnected||epoch!==generation)return;
    if(art?.url){
      saveArt(name,art);
      showImage(box,art,epoch);
    }else{
      const willRetry=!retried.has(name);
      if(box.dataset.artworkStatus!=="local-preview")
        status(box,willRetry?
          locale(parsed.type==="movie"?
            "No movie poster found yet; retrying":"No episode artwork found yet; retrying",
            "Изображение не найдено. Повторная попытка"):
          locale("No matching artwork found. Check filename and provider",
            "Изображение не найдено. Проверьте имя файла и источник"),
          willRetry?"retrying":"unavailable");
      if(willRetry)scheduleRetry(name);
    }
  });
}
const intersection=typeof IntersectionObserver==="function"?
  new IntersectionObserver(entries=>{
    for(const entry of entries){
      if(!entry.isIntersecting)continue;
      intersection.unobserve(entry.target);
      const li=entry.target;
      const box=li.querySelector(".queue-artwork");
      const name=li.querySelector(".item-title")?.textContent?.trim();
      const parsed=name&&window.DKMediaMetadata.parseFilename(name);
      if(box&&parsed)lookup(li,box,name,parsed,generation);
    }
  },{root:queue,rootMargin:"280px"}):null;
function scan(){
  for(const li of queue.children){
    if(seen.has(li)||!li.matches("li")||li.classList.contains("queue-empty"))continue;
    seen.add(li);
    const box=li.querySelector(".queue-artwork");
    if(!box)continue;
    if(li.dataset.queueKind!=="file"||li.dataset.queueAudio==="1")continue;
    resetBox(box);
    const name=li.querySelector(".item-title")?.textContent?.trim();
    if(!name||name.length>220)continue;
    const parsed=window.DKMediaMetadata.parseFilename(name);
    if(!parsed){
      status(box,locale("Cannot identify movie or episode from filename",
        "Не удалось определить фильм или серию по имени файла"),"filename");
    }else{
      li.dataset.artworkType=parsed.type;
      const remembered=stored.get(name);
      if(remembered)showImage(box,remembered,generation);
      else status(box,locale(parsed.type==="movie"?
        "Finding movie poster…":"Finding episode artwork…",
        parsed.type==="movie"?"Поиск постера фильма…":"Поиск изображения серии…"),"loading");
      if(intersection)intersection.observe(li);
      else lookup(li,box,name,parsed,generation);
    }
    // Offline fallback runs only for items within the visible/sidebar region.
    // Keep the original source item rather than uploading or transcoding it.
    const item=li.dkQueueItem;
    if(item?.thumbnail)showImage(box,{url:item.thumbnail},generation,"local");
    else if(item&&localThumbnails) {
      // Defer 1.5 seconds so a fast provider poster avoids video decoding.
      setTimeout(()=>{
        if(!li.isConnected||box.dataset.artworkStatus==="loaded")return;
        localThumbnails.request(item);
      },1500);
    }
  }
}
const observer=new MutationObserver(scan);
observer.observe(queue,{childList:true});
scan();
})();
