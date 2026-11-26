/* DK Kinehall Library Home: Movies | TV Shows, Continue Watching and
 * the entire on-demand collection. No server, daemon or media duplication.
 * player.css supplies the SAME Soviet poster backdrop and approved icons.
 */
(() => {
"use strict";
const store=window.DKLibraryStore;
if(!store)return;
const $=id=>document.getElementById(id);
const storedMode=()=>{
  try{return localStorage.getItem("dk-kinehall.library.category.v1")==="tv"?"tv":"movie";}
  catch(_){return "movie";}
};
let mode=storedMode(),selectedSeries=null,selectedSeason=null;
let all=[],folders=[],visibleCount=72,renderEpoch=0;
let scanning=false,controller=null,repaintTimer=null;
let bottomObserver=null;
let deferredProgress=false;
const imageUrls=new Set();
const imageQueue=[],activeArtwork=new Map();
let artworkBusy=0;
const MAX_LOOKUPS=2,ARTWORK_LIMIT=1200;
let networkArtworkCount=0;
let legacyResume={};
try{legacyResume=JSON.parse(localStorage.getItem("dkmedia.web.resume.v1")||"{}")||{};}
catch(_){legacyResume={};}
const artworkFinder=window.DKMediaMetadata?.create({
  enabled:()=>true,token:()=>"",selectImage:(item,opts)=>
    window.DKJellyfinArtwork?.choose(item,opts)||null
});
const lang=()=>document.documentElement.lang==="ru"?"ru":"en";
const say=(english,russian)=>lang()==="ru"?russian:english;
const status=(en,ru=null,error=false)=>{
  const node=$("libraryStatus");
  node.textContent=ru?say(en,ru):en;
  node.classList.toggle("error",error);
};
const nameSort=(a,b)=>String(a).localeCompare(String(b),undefined,{
  numeric:true,sensitivity:"base"
});
const formatCode=row=>"S"+String(row.season).padStart(2,"0")+
  "E"+String(row.episode).padStart(2,"0");
const mediaName=row=>row.kind==="tv"?
  row.series+" · "+formatCode(row)+
  (row.episodeTitle?" · "+row.episodeTitle:""):
  row.title+(row.year?" ("+row.year+")":"");
const artId=row=>row.kind==="tv"?
  "tv:"+String(row.series||"").normalize("NFKC").toLowerCase():row.id;
const cleanImageUrls=()=>{
  for(const url of imageUrls)try{URL.revokeObjectURL(url);}catch(_){}
  imageUrls.clear();
};
function create(tag,cls,text){
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(text!==undefined)el.textContent=text;
  return el;
}
function currentProgress(row){
  if(Number(row.position)>12)return Number(row.position);
  const key="file:"+row.filename+":"+row.size+":"+row.modified;
  const value=Number(legacyResume[key]);
  return Number.isFinite(value)?value:0;
}
function needsContinue(row){
  const value=currentProgress(row),length=Number(row.duration)||0;
  return !row.missing&&!row.completed&&value>12&&
    (!length||value<Math.max(15,length-12));
}
function coverShell(landscape){
  const shell=create("span","library-poster");
  const fallback=create("span","library-poster-placeholder");
  const mark=create("span",null,landscape?"▶":"▣");
  const label=create("small",null,landscape?"":"DK KINEHALL");
  fallback.append(mark,label);
  shell.append(fallback);
  return shell;
}
function createCard(row,{landscape=false,series=false}={}){
  const card=create("button","library-card"+(row.missing?" library-unavailable":""));
  card.type="button";
  const box=coverShell(landscape);
  const title=create("span","library-card-title",
    series?row.series:row.kind==="tv"?
      (landscape?row.series+" · "+formatCode(row):formatCode(row)):
      mediaName(row));
  const detail=create("span","library-card-detail",
    series?"":row.kind==="tv"?(row.episodeTitle||""):row.year||"");
  card.append(box,title,detail);
  if(landscape){
    const bar=create("span","library-progress");
    const fill=create("span");
    const duration=Number(row.duration)||0;
    fill.style.width=duration>0?
      Math.max(3,Math.min(100,100*currentProgress(row)/duration))+"%":"10%";
    bar.append(fill);box.append(bar);
  }
  if(row.missing)card.title=say("File unavailable: reconnect its drive",
    "Файл недоступен: подключите накопитель");
  card.addEventListener("click",()=>{
    if(series){
      selectedSeries=row.series;
      selectedSeason=null;
      visibleCount=72;
      void render();
    }else void openVideo(row);
  });
  // Artwork requests are on-demand and bounded; never fetch every poster
  // or hold all image data in memory when a 25,000-file library opens.
  imageQueue.push({id:artId(row),row,box,epoch:renderEpoch});
  return card;
}
function findLocalArtworkFolder(folder,relative){
  const parent=relative.split("/").slice(0,-1).filter(Boolean);
  return async function(){
    let current=folder.handle;
    const dirs=[current];
    for(const segment of parent){
      current=await current.getDirectoryHandle(segment,{create:false});
      dirs.push(current);
    }
    const stem=String(relative.split("/").at(-1)||"").replace(/\.[^.]+$/,"");
    for(const dir of dirs.reverse()){
      for(const name of [
        stem+".jpg",stem+".png",stem+".webp",
        stem+"-poster.jpg",stem+"-poster.png",
        "poster.jpg","poster.png","poster.webp",
        "folder.jpg","folder.png","folder.webp",
        "cover.jpg","cover.png","cover.webp"
      ]){
        try{
          const file=await(await dir.getFileHandle(name,{create:false})).getFile();
          if(/^image\/(jpeg|png|webp)$/.test(file.type)&&file.size<3*1024*1024)
            return file;
        }catch(_){}
      }
    }
    return null;
  };
}
async function findArtwork(row,id){
  const cache=await store.artwork(id);
  if(cache?.blob)return cache.blob;
  const folder=folders.find(x=>x.id===row.folderId);
  if(folder?.handle){
    try{
      const local=await findLocalArtworkFolder(folder,row.relative)();
      if(local){
        await store.saveArtwork(id,local,"Local folder");
        return local;
      }
    }catch(_){}
  }
  if(!artworkFinder||networkArtworkCount>=ARTWORK_LIMIT||!navigator.onLine)
    return null;
  networkArtworkCount++;
  try{
    const result=await artworkFinder.find(row.filename);
    const url=row.kind==="tv"?(result?.fallbackUrl||result?.url):result?.url;
    if(!url||!/^https:\/\//.test(url))return null;
    const response=await fetch(url,{credentials:"omit",mode:"cors",cache:"force-cache"});
    if(!response.ok)return null;
    const blob=await response.blob();
    if(!/^image\/(jpeg|png|webp)$/.test(blob.type)||
       blob.size>3*1024*1024)return null;
    await store.saveArtwork(id,blob,result.provider||"");
    return blob;
  }catch(_){return null;}
}
async function pumpArtwork(){
  while(imageQueue.length){
    const task=imageQueue[0];
    if(task.epoch!==renderEpoch||!task.box.isConnected){
      imageQueue.shift();continue;
    }
    const ongoing=activeArtwork.get(task.id);
    if(ongoing){
      ongoing.views.push(imageQueue.shift());
      continue;
    }
    if(artworkBusy>=MAX_LOOKUPS)break;
    imageQueue.shift();
    const request={views:[task]};
    activeArtwork.set(task.id,request);
    artworkBusy++;
    (async()=>{
      try{
        const blob=await findArtwork(task.row,task.id);
        if(!blob)return;
        for(const view of request.views){
          if(view.epoch!==renderEpoch||!view.box.isConnected)continue;
          const url=URL.createObjectURL(blob);
          imageUrls.add(url);
          const image=create("img");
          image.src=url;
          image.alt="";
          image.loading="lazy";
          image.decoding="async";
          view.box.prepend(image);
        }
      }catch(_){}
      finally{
        activeArtwork.delete(task.id);
        artworkBusy--;
        pumpArtwork();
      }
    })();
  }
}
async function openVideo(row){
  if(row.missing){
    status("File unavailable. Reconnect its drive and scan again.",
      "Файл недоступен. Подключите накопитель и повторите сканирование.",true);
    return;
  }
  const page=new URL("./index.html",location.href);
  page.searchParams.set("libraryItem",row.id);
  // Desktop IPC creates a separate original player window and preserves
  // the library's state. The web edition opens a separate browser window.
  try{
    if(window.DKLibraryBridge?.openPlayer){
      await window.DKLibraryBridge.openPlayer(row.id);
      return;
    }
    const child=window.open(page.href,"dk-kinehall-player");
    if(!child)location.assign(page.href);
    else child.focus();
  }catch(error){
    status("Could not open the video player.",
      "Не удалось открыть окно проигрывателя.",true);
  }
}
function switchMode(value){
  mode=value==="tv"?"tv":"movie";
  selectedSeries=null;selectedSeason=null;visibleCount=72;
  try{localStorage.setItem("dk-kinehall.library.category.v1",mode);}catch(_){}
  void render();
}
async function render(){
  const epoch=++renderEpoch;
  if(bottomObserver)bottomObserver.disconnect();
  imageQueue.length=0;cleanImageUrls();
  folders=await store.folders();
  all=await store.entries();
  if(epoch!==renderEpoch)return;
  try{legacyResume=JSON.parse(localStorage.getItem("dkmedia.web.resume.v1")||"{}")||{};}
  catch(_){legacyResume={};}
  const tv=mode==="tv";
  $("tabMovies").setAttribute("aria-selected",String(!tv));
  $("tabTV").setAttribute("aria-selected",String(tv));
  const active=all.filter(x=>x.kind===mode);
  const resume=active.filter(needsContinue).sort((a,b)=>b.lastPlayed-a.lastPlayed)
    .slice(0,30);
  const continueList=$("continueWatching");
  continueList.replaceChildren(...resume.map(row=>createCard(row,{landscape:true})));
  const list=$("libraryCollection");
  const detail=$("seriesDetail");
  detail.hidden=!selectedSeries||!tv;
  let cards=[];
  if(tv&&selectedSeries){
    const rows=active.filter(row=>row.series===selectedSeries);
    const seasons=[...new Set(rows.map(x=>x.season))].sort((a,b)=>a-b);
    if(!seasons.includes(selectedSeason))
      selectedSeason=seasons.length?seasons[0]:null;
    const selected=$("seasonSelect");
    selected.replaceChildren(...seasons.map(n=>{
      const opt=create("option",null,
        say("Season "+n,"Сезон "+n));
      opt.value=String(n);
      opt.selected=n===selectedSeason;
      return opt;
    }));
    $("seriesTitle").textContent=selectedSeries;
    cards=rows.filter(row=>row.season===selectedSeason)
      .sort((a,b)=>a.episode-b.episode||nameSort(a.filename,b.filename));
    $("collectionTitle").textContent=
      say("Episodes","Серии");
  }else if(tv){
    const series=new Map();
    for(const row of active){
      const key=String(row.series||row.title).toLocaleLowerCase();
      if(!series.has(key))series.set(key,row);
      else if(!series.get(key).missing&&!row.missing)continue;
      else if(series.get(key).missing&&!row.missing)series.set(key,row);
    }
    cards=[...series.values()].sort((a,b)=>nameSort(a.series,b.series));
    $("collectionTitle").textContent=
      say("Your Entire TV Collection","Вся коллекция сериалов");
  }else{
    cards=active.sort((a,b)=>nameSort(a.title,b.title));
    $("collectionTitle").textContent=
      say("Your Entire Movie Collection","Вся коллекция фильмов");
  }
  $("collectionCount").textContent=cards.length+" "+
    say(cards.length===1?"title":"titles","наименований");
  $("emptyLibrary").hidden=all.length>0;
  visibleCount=Math.min(visibleCount,cards.length);
  list.replaceChildren(...cards.slice(0,visibleCount)
    .map(row=>createCard(row,{series:tv&&!selectedSeries})));
  const more=$("loadMoreLibrary");
  more.hidden=cards.length<=visibleCount;
  const appendMore=()=>{
    if(epoch!==renderEpoch||visibleCount>=cards.length)return;
    const start=visibleCount;
    visibleCount=Math.min(visibleCount+72,cards.length);
    list.append(...cards.slice(start,visibleCount)
      .map(row=>createCard(row,{series:tv&&!selectedSeries})));
    more.hidden=visibleCount>=cards.length;
    pumpArtwork();
  };
  more.onclick=appendMore;
  if(typeof IntersectionObserver==="function"){
    bottomObserver=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)&&
         !more.hidden&&epoch===renderEpoch)appendMore();
    },{rootMargin:"350px"});
    bottomObserver.observe(more);
  }
  $("folderSummary").textContent=folders.length?
    say("Saved local folders: ","Сохранённые локальные папки: ")+
      folders.map(folder=>folder.name).join(" · "):
    say("No media folders selected. Local video files are never copied into the library.",
      "Папки не выбраны. Видеофайлы не копируются в медиатеку.");
  if(!scanning)status(
    folders.length?"Library loaded from local cache.":"Add a local folder to begin.",
    folders.length?"Медиатека загружена из локального хранилища.":
      "Добавьте локальную папку.");
  pumpArtwork();
}
async function scan(manual=false){
  if(scanning){
    controller?.abort();
    return;
  }
  scanning=true;controller=new AbortController();
  $("scanLibrary").textContent=say("Stop Scan","Остановить");
  $("scanLibrary").setAttribute("aria-pressed","true");
  try{
    const results=await store.scanAll({
      manual,signal:controller.signal,
      onProgress:progress=>status(
        "Scanning "+progress.folder+": "+progress.visits+" checked…",
        "Проверка "+progress.folder+": "+progress.visits+" файлов…")
    });
    const counts=results.reduce((result,row)=>{
      result.added+=row.added||0;
      result.updated+=row.updated||0;
      result.missing+=row.missing||0;
      result.permissions+=row.needsPermission?1:0;
      return result;
    },{added:0,updated:0,missing:0,permissions:0});
    await render();
    status("Scan finished: "+counts.added+" added, "+counts.updated+
      " updated, "+counts.missing+" unavailable."+
      (counts.permissions?" "+counts.permissions+" folder(s) need permission.":""),
      "Проверка завершена: добавлено "+counts.added+", обновлено "+
      counts.updated+", недоступно "+counts.missing+".");
  }catch(error){
    status(controller.signal.aborted?"Scan stopped.":"Scan failed: "+error.message,
      controller.signal.aborted?"Проверка остановлена.":"Ошибка проверки.",true);
  }finally{
    scanning=false;controller=null;
    $("scanLibrary").textContent=say("Scan Library","Проверить медиатеку");
    $("scanLibrary").setAttribute("aria-pressed","false");
  }
}
async function chooseFolder(){
  if(scanning)return;
  if(typeof window.showDirectoryPicker!=="function"){
    status("Persistent folder selection is unavailable in this browser.",
      "Постоянный доступ к папкам недоступен в этом браузере.",true);
    return;
  }
  try{
    const handle=await window.showDirectoryPicker({
      id:"dk-kinehall-library",mode:"read"});
    const folder=await store.addFolder(handle,"both");
    await render();
    await scan(true);
  }catch(error){
    if(error?.name!=="AbortError")
      status("Could not add this folder: "+error.message,
        "Не удалось добавить папку.",true);
  }
}
function connect(){
  $("tabMovies").addEventListener("click",()=>switchMode("movie"));
  $("tabTV").addEventListener("click",()=>switchMode("tv"));
  $("addLibraryFolder").addEventListener("click",()=>void chooseFolder());
  $("addFirstFolder").addEventListener("click",()=>void chooseFolder());
  $("scanLibrary").addEventListener("click",()=>void scan(true));
  $("backToSeries").addEventListener("click",()=>{
    selectedSeries=null;selectedSeason=null;void render();
  });
  $("seasonSelect").addEventListener("change",event=>{
    selectedSeason=Number(event.target.value);visibleCount=72;void render();
  });
  store.onChange(event=>{
    if(scanning||(!event.progress&&!event.folders&&!event.entries))return;
    // Keep the video smooth on low-memory Surface Pro hardware. Playback
    // history still commits to IndexedDB; repaint only when Home is active.
    if(event.progress && (document.hidden||!document.hasFocus())){
      deferredProgress=true;
      return;
    }
    clearTimeout(repaintTimer);
    repaintTimer=setTimeout(()=>void render(),260);
  });
  const refreshOnReturn=()=>{
    if(deferredProgress&&!document.hidden&&document.hasFocus()){
      deferredProgress=false;
      void render();
    }
  };
  window.addEventListener("focus",refreshOnReturn);
  document.addEventListener("visibilitychange",refreshOnReturn);
  void render().then(()=>{
    // Render saved posters immediately. A bounded, one-shot rescan is
    // attempted only after initialization; no daemon or persistent server.
    const start=()=>{
      if(folders.length)void scan(false);
    };
    if("requestIdleCallback" in window)
      requestIdleCallback(start,{timeout:3500});
    else setTimeout(start,2500);
  }).catch(error=>status("Local library unavailable: "+error.message,
    "Локальная медиатека недоступна.",true));
}
connect();
})();
