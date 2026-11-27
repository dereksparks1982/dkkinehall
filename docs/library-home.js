/* DK Kinehall Library Home: Movies | TV Shows, Continue Watching and
 * the entire on-demand collection. No server, daemon or media duplication.
 * player.css supplies the SAME Soviet poster backdrop and approved icons.
 */
(() => {
"use strict";
const store=window.DKLibraryStore;
const nativeBridge=window.DKLibraryBridge?.nativeLibrary?
  window.DKLibraryBridge:null;
if(!store)return;
const $=id=>document.getElementById(id);
const storedMode=()=>{
  try{return localStorage.getItem("dk-kinehall.library.category.v1")==="tv"?"tv":"movie";}
  catch(_){return "movie";}
};
let mode=storedMode(),selectedSeries=null,selectedSeason=null;
let collectionFilter={kind:"",value:"",query:"",saved:false},collectionTools=null;
let all=[],folders=[],visibleCount=72,renderEpoch=0;
let scanning=false,controller=null,repaintTimer=null;
let maintaining=false,refreshCancelled=false;
let bottomObserver=null;
let contextRow=null,contextSeries=false,watchedFilter="";
let libraryZoom=100;
const libraryZoomKey="dk-kinehall.library.zoom.v1";
const applyLibraryZoom=(value,persist=true)=>{
  if(!nativeBridge?.internalPages)return;
  libraryZoom=Math.max(50,Math.min(200,Math.round(value/10)*10));
  // A page-local CSS zoom avoids Electron's shared-origin zoom preference
  // affecting the independent player WebContentsView.
  document.body.style.zoom=String(libraryZoom/100);
  if(persist)try{localStorage.setItem(libraryZoomKey,String(libraryZoom));}catch(_){}
  hideContextMenu();
  requestAnimationFrame(()=>window.dispatchEvent(new Event("resize")));
};
let deferredProgress=false,historyTimer=null,historyRevision=0;
const artAttempted=new Set(),titleAttempted=new Set();
const imageUrls=new Set();
const imageQueue=[],activeArtwork=new Map();
let artworkBusy=0;
const MAX_LOOKUPS=2,ARTWORK_LIMIT=1200;
let networkArtworkCount=0;
let networkTitleCount=0;
const TITLE_LOOKUP_LIMIT=400;
let legacyResume={},legacyProgressById=new Map();
try{legacyResume=JSON.parse(localStorage.getItem("dkmedia.web.resume.v1")||"{}")||{};}
catch(_){legacyResume={};}
const nativeJSON=nativeBridge?.metadataRequest?async(url,opts)=>{
  const result=await nativeBridge.metadataRequest(String(url),"json");
  return {ok:result.ok,status:result.status,text:async()=>result.text,json:async()=>JSON.parse(result.text)};
}:null;
const artworkFinder=window.DKMediaMetadata?.create({
  ...(nativeJSON?{fetchJSON:nativeJSON,appleSearch:null}:{}),
  enabled:()=>true,token:()=>"",selectImage:(item,opts)=>
    window.DKJellyfinArtwork?.choose(item,opts)||null
});
const lang=()=>document.documentElement.lang==="ru"?"ru":"en";
const say=(english,russian)=>window.DKLocale?.pair(english,russian)??(lang()==="ru"?russian:english);
const status=(en,ru=null,error=false)=>{
  const node=$("libraryStatus");
  node.textContent=ru?say(en,ru):en;
  node.classList.toggle("error",error);
};
const nameSort=(a,b)=>String(a).localeCompare(String(b),undefined,{
  numeric:true,sensitivity:"base"
});
const seriesKey=value=>window.DKMediaMetadata?.normalize(value)||String(value||"").trim().toLowerCase();
const formatCode=row=>"S"+String(row.season).padStart(2,"0")+
  "E"+String(row.episode).padStart(2,"0");
const metadataFilename=row=>row.kind==="movie"&&Number(row.year)===1974&&
  seriesKey(row.title)==="the man with the golden gun"?"The Man with the Golden Gun (1974).mkv":row.kind==="tv"&&
  window.DKMediaMetadata?.parseFilename?.(row.filename)?.type!=="episode"?
  row.series+".S"+String(row.season).padStart(2,"0")+
    "E"+String(row.episode).padStart(2,"0")+
    row.filename.slice(row.filename.lastIndexOf(".")):
  row.filename;
const mediaName=row=>row.kind==="tv"?
  row.series+" · "+formatCode(row)+
  (row.episodeTitle?" · "+row.episodeTitle:""):
  row.title+(row.year?" ("+row.year+")":"");
// Series posters and episode stills are DIFFERENT artwork records. The
// previous shared TV key made every episode display the series poster.
const artId=(row,series=false)=>row.kind==="tv"&&series?
  "tv-series:"+String(row.series||"").normalize("NFKC").toLowerCase():
  row.id;
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
// File API timestamps may be rounded while native scans retain fractions.
 // Recover a saved resume position only for an unambiguous catalog match.
function recoverLegacyProgress(rows){
  const byFingerprint=new Map(),result=new Map();
  for(const row of rows){
    if(!Number.isFinite(row.size)||!Number.isFinite(row.modified))continue;
    const key="file:"+row.filename+":"+row.size;
    if(!byFingerprint.has(key))byFingerprint.set(key,[]);
    byFingerprint.get(key).push(row);
  }
  for(const [key,raw] of Object.entries(legacyResume)){
    const split=key.lastIndexOf(":");
    if(split<0||!key.startsWith("file:"))continue;
    const modified=Number(key.slice(split+1)),position=Number(raw);
    if(!Number.isFinite(modified)||!Number.isFinite(position)||position<=2)continue;
    const matches=(byFingerprint.get(key.slice(0,split))||[])
      .filter(row=>Math.abs(row.modified-modified)<=1);
    const live=matches.filter(row=>row.source==="native"&&!row.missing);
    const row=live.length===1?live[0]:matches.length===1?matches[0]:null;
    if(row)result.set(row.id,Math.max(result.get(row.id)||0,position));
  }
  return result;
}
function currentProgress(row){
  if(row.completed)return 0;
  if(Number(row.position)>2)return Number(row.position);
  if(row.watchResetAt)return 0;
  if(nativeBridge)return legacyProgressById.get(row.id)||0;
  const key="file:"+row.filename+":"+row.size+":"+row.modified;
  const value=Number(legacyResume[key]);
  return Number.isFinite(value)?value:0;
}
function needsContinue(row){
  if(row.continueHidden)return false;
  const value=currentProgress(row),length=Number(row.duration)||0;
  // Unavailable media still has history; retain its disabled/unavailable card.
  const eligible=!nativeBridge?value>2:Number.isFinite(row.watchedSeconds)?row.watchedSeconds>=60:value>=60;
  return !row.completed&&eligible&&value>2&&(!length||value<length);
}
function coverShell(landscape){
  const shell=create("span","library-poster");
  const fallback=create("span","library-poster-placeholder");
  const mark=create("span",null,landscape?"▶":"▣");
  const label=create("small",null,landscape?"":
    say("DK KINEHALL","ДК КИНЕХОЛЛ"));
  fallback.append(mark,label);
  shell.append(fallback);
  return shell;
}
function seriesRows(row){return all.filter(x=>x.kind==="tv"&&seriesKey(x.series)===seriesKey(row.series));}
function historyBucket(row){return row.completed?"watched":currentProgress(row)>2?"progress":"unwatched";}
function paintWatchedCard(card,row,series=false){
  const box=card.querySelector(".library-poster");
  if(!box)return;
  const rows=series?seriesRows(row):[row],count=rows.filter(x=>x.completed).length;
  const done=rows.length>0&&count===rows.length;
  let mark=box.querySelector(".dk-watched-mark");
  if(done){
    if(!mark){mark=create("span","dk-watched-mark","✓");box.append(mark);}
    mark.title=say("Watched","Просмотрено");mark.setAttribute("aria-label",mark.title);
  }else mark?.remove();
  let bar=box.querySelector(".library-progress");
  const value=series?count:currentProgress(row),duration=series?rows.length:Number(row.duration)||0;
  if(!done&&(series?count>0:value>2)){
    if(!bar){bar=create("span","library-progress");bar.append(create("span"));box.append(bar);}
    bar.firstElementChild.style.width=duration>0?Math.max(3,Math.min(100,100*value/duration))+"%":"10%";
  }else bar?.remove();
  if(series){
    const detail=card.querySelector(".library-card-detail");
    if(detail)detail.textContent=say(count+" of "+rows.length+" watched","Просмотрено "+count+" из "+rows.length);
  }
}
function refreshSeasonWatched(){
  const count=$("seasonWatchedCount");
  if(!count||!selectedSeries)return;
  const rows=all.filter(x=>x.kind==="tv"&&seriesKey(x.series)===seriesKey(selectedSeries)&&x.season===selectedSeason);
  count.textContent=say(rows.filter(x=>x.completed).length+" of "+rows.length+" watched","Просмотрено "+rows.filter(x=>x.completed).length+" из "+rows.length);
}
function refreshWatchedCards(){
  const map=new Map(all.map(row=>[row.id,row]));
  for(const card of document.querySelectorAll("#libraryCollection .library-card,#continueWatching .library-card")){
    const row=map.get(card.dataset.libraryId);
    if(row)paintWatchedCard(card,row,card.dataset.displayRole==="series");
  }
  refreshSeasonWatched();
}
function createCard(row,{landscape=false,series=false}={}){
  const card=create("button","library-card"+(row.missing?" library-unavailable":""));
  card.type="button";
  card.dataset.libraryId=row.id;
  card.dataset.displayRole=series?"series":landscape?"resume":"entry";
  const box=coverShell(landscape&&!nativeBridge);
  const title=create("span","library-card-title",
    series?row.series:row.kind==="tv"?
      (landscape?row.series+" · "+formatCode(row):formatCode(row)):
      (nativeBridge?row.title:mediaName(row)));
  const detail=create("span","library-card-detail",
    series?"":row.kind==="tv"?(row.episodeTitle||""):row.year||"");
  if(row.kind==="movie"&&window.DKCollections){const version=window.DKCollections.edition(row);if(version)detail.textContent=[row.year,editionName(version)].filter(Boolean).join(" · ");}
  card.append(box,title,detail);
  if(window.DKCollections?.has(row))box.append(create("span","dk-watchlist-mark","★"));
  if(nativeBridge)paintWatchedCard(card,row,series);
  else if(landscape){
    const bar=create("span","library-progress");
    const fill=create("span");
    const duration=Number(row.duration)||0;
    fill.style.width=duration>0?
      Math.max(3,Math.min(100,100*currentProgress(row)/duration))+"%":"10%";
    bar.append(fill);box.append(bar);
  }
  if(row.missing)card.title=say("File unavailable: reconnect its drive",
    "Файл недоступен: подключите накопитель");
  card.addEventListener("contextmenu",event=>{
    if(!nativeBridge)return;
    event.preventDefault();
    if(series&&window.DKCollections){
      showContextMenu(row,event.clientX,event.clientY,false,true);return;
    }
    if(series){
      status("Open the TV show to delete an individual episode.",
        "Откройте сериал и выберите серию для удаления.");
      return;
    }
    showContextMenu(all.find(item=>item.id===row.id)||row,event.clientX,event.clientY,landscape);
  });
  card.addEventListener("click",()=>{
    if(series){
      selectedSeries=row.series;
      selectedSeason=null;
      visibleCount=72;
      void render().then(recordNavigation);
    }else void openVideo(all.find(item=>item.id===row.id)||row);
  });
  // Artwork requests are on-demand and bounded; never fetch every poster
  // or hold all image data in memory when a 25,000-file library opens.
  imageQueue.push({id:artId(row,series),row,series,box,epoch:renderEpoch});
  return card;
}
function findLocalArtworkFolder(folder,relative,series=false){
  const parent=relative.split("/").slice(0,-1).filter(Boolean);
  return async function(){
    let current=folder.handle;
    const dirs=[current];
    for(const segment of parent){
      current=await current.getDirectoryHandle(segment,{create:false});
      dirs.push(current);
    }
    const stem=String(relative.split("/").at(-1)||"").replace(/\.[^.]+$/,"");
    const sidecarNames=[
      stem+".jpg",stem+".png",stem+".webp",
      stem+"-still.jpg",stem+"-still.png",stem+"-still.webp"
    ];
    const posterNames=[
      "poster.jpg","poster.png","poster.webp",
      "folder.jpg","folder.png","folder.webp",
      "cover.jpg","cover.png","cover.webp"
    ];
    const check=async(dir,names)=>{
      for(const name of names){
        try{
          const file=await(await dir.getFileHandle(name,{create:false})).getFile();
          if(/^image\/(jpeg|png|webp)$/.test(file.type)&&file.size<3*1024*1024)
            return file;
        }catch(_){}
      }
      return null;
    };
    // A mixed movie folder may contain a poster.jpg for an unrelated
    // title. Only a dedicated subfolder may supply generic poster art.
    if(!series){
      const still=await check(dirs.at(-1),sidecarNames);
      if(still)return still;
      if(parent.length){
        const cover=await check(dirs.at(-1),posterNames);
        if(cover)return cover;
      }
    }else if(parent.length){
      // TV show poster belongs to the series directory, not an individual
      // season or episode. Skip a shared collection root entirely.
      const showFolder=parent.length>=2?dirs.at(-2):dirs.at(-1);
      const cover=await check(showFolder,posterNames);
      if(cover)return cover;
    }
    return null;
  };
}
async function saveMovieResult(row,result){
  if(!result?.title)return false;
  await store.updateMetadata(row.id,{movieTitle:result.title,movieYear:result.year,
    movieDetails:result.details,movieProvider:result.provider});
  return true;
}
async function findArtwork(row,id,series=false,force=false){
  const cache=await store.artwork(id);
  // A stored poster is usable immediately; missing details cannot invalidate it.
  if(cache?.blob&&!force&&nativeBridge)return cache.blob;
  if(nativeBridge&&!force&&artAttempted.has(id))return cache?.blob||null;
  if(nativeBridge&&!force)artAttempted.add(id);
  let movieResult=null;
  // Native movie metadata is fetched independently of local and cached art.
  if(nativeBridge&&row.kind==="movie"&&(force||!row.movieDetails)&&
     artworkFinder&&navigator.onLine&&(force||networkTitleCount<TITLE_LOOKUP_LIMIT)&&
     (force||!titleAttempted.has(row.id))){
    titleAttempted.add(row.id);
    networkTitleCount++;
    try{
      movieResult=await artworkFinder.find(metadataFilename(row),{details:true});
      await saveMovieResult(row,movieResult);
    }catch(_){}
  }
  // Episode titles and stills are independent. A cached local poster must
  // not suppress title retrieval. Only visible episodes are requested,
  // and successful titles are persisted to IndexedDB once.
  if(row.kind==="tv"&&!series&&(force||!row.metadataVerified)&&
     artworkFinder?.episodeTitle&&navigator.onLine&&
     (force||networkTitleCount<TITLE_LOOKUP_LIMIT)&&(force||!titleAttempted.has(row.id))){
    titleAttempted.add(row.id);
    networkTitleCount++;
    try{
      const verified=await artworkFinder.episodeTitle(metadataFilename(row));
      if(verified)await store.updateMetadata(row.id,{episodeTitle:verified});
    }catch(_){}
  }
  if(cache?.blob&&!force)return cache.blob;
  if(!force&&nativeBridge&&row.source==="native"&&row.nativePath){
    try{
      const picture=await nativeBridge.localCover(
        row.id,row.nativePath,series,row.kind);
      if(picture?.bytes&&picture.mime){
        const blob=new Blob([picture.bytes],{type:picture.mime});
        if(blob.size<=3*1024*1024){
          await store.saveArtwork(id,blob,"Local artwork");
          return blob;
        }
      }
    }catch(_){}
  }
  const folder=folders.find(x=>x.id===row.folderId);
  if(!force&&folder?.handle){
    try{
      const local=await findLocalArtworkFolder(folder,row.relative,series)();
      if(local){
        await store.saveArtwork(id,local,"Local folder");
        return local;
      }
    }catch(_){}
  }
  if(!artworkFinder||(!force&&networkArtworkCount>=ARTWORK_LIMIT)||!navigator.onLine)
    return cache?.blob||null;
  networkArtworkCount++;
  try{
    const excluded=[];
    for(let attempt=0;attempt<(row.kind==="movie"&&nativeBridge?3:1);attempt++){
    const result=attempt===0&&movieResult?movieResult:await artworkFinder.find(metadataFilename(row),{excludeProviders:excluded,details:!!nativeBridge&&row.kind==="movie"});
    if(result?.provider)excluded.push(result.provider);
    else if(!result)break;
    // Episode cards use episode stills; the series grid uses series art.
    const url=row.kind==="tv"&&series?
      (nativeBridge?(result?.seriesUrl||result?.fallbackUrl):(result?.fallbackUrl||result?.url)):result?.url;
    if(row.kind==="tv"&&!series&&
       typeof result?.title==="string"&&result.title.trim()&&
       typeof store.updateMetadata==="function"){
      void store.updateMetadata(row.id,{episodeTitle:result.title.trim().slice(0,180)})
        .catch(()=>{});
    }
    if(row.kind==="movie"&&result?.title&&(!movieResult||!movieResult.details?.description))await saveMovieResult(row,result);
    if(!url||!/^https:\/\//.test(url)){if(result?.provider&&row.kind==="movie")continue;return cache?.blob||null;}
    let blob;
    if(nativeBridge?.metadataRequest){
      const image=await nativeBridge.metadataRequest(url,"image");
      if(!image.ok)continue;
      blob=new Blob([image.bytes],{type:image.mime});
    }else{
      const response=await fetch(url,{credentials:"omit",mode:"cors",cache:"force-cache"});
      if(!response.ok)return null;
      blob=await response.blob();
    }
    if(!/^image\/(jpeg|png|webp)$/.test(blob.type)||
       blob.size>3*1024*1024)continue;
    await store.saveArtwork(id,blob,result.provider||"");
    return blob;
    }
    return cache?.blob||null;
  }catch(_){return cache?.blob||null;}
}
// Fetch missing descriptive data independently of cached image display.
// Do not repeatedly request a failed match during the same Home session.
function displayArtwork(view,blob){
  if(view.epoch!==renderEpoch||!view.box.isConnected||view.box.querySelector("img"))return;
  const url=URL.createObjectURL(blob);imageUrls.add(url);
  const image=create("img");image.src=url;image.alt="";image.loading="lazy";image.decoding="async";
  view.box.prepend(image);
}
async function fillCachedDetails(row,series){
  if(!nativeBridge||!artworkFinder||!navigator.onLine||titleAttempted.has(row.id)||networkTitleCount>=TITLE_LOOKUP_LIMIT)return;
  const latest=all.find(item=>item.id===row.id)||row;
  if(latest.kind==="movie"?!!latest.movieDetails:series||!!latest.metadataVerified)return;
  titleAttempted.add(row.id);networkTitleCount++;
  try{
    if(latest.kind==="movie"){
      const result=await artworkFinder.find(metadataFilename(latest),{details:true});
      await saveMovieResult(latest,result);
    }else if(artworkFinder.episodeTitle){
      const title=await artworkFinder.episodeTitle(metadataFilename(latest));
      if(title)await store.updateMetadata(latest.id,{episodeTitle:title});
    }
  }catch(_){}
}
async function pumpArtwork(){
  while(imageQueue.length){
    const task=imageQueue[0];
    if(task.epoch!==renderEpoch||!task.box.isConnected){
      imageQueue.shift();continue;
    }
    const ongoing=activeArtwork.get(task.id);
    if(ongoing){
      const view=imageQueue.shift();
      if(ongoing.blob)displayArtwork(view,ongoing.blob);
      else ongoing.views.push(view);
      continue;
    }
    if(artworkBusy>=MAX_LOOKUPS)break;
    imageQueue.shift();
    const request={views:[task],blob:null};
    activeArtwork.set(task.id,request);
    artworkBusy++;
    (async()=>{
      try{
        const blob=await findArtwork(task.row,task.id,task.series);
        if(!blob)return;
        request.blob=blob;
        for(const view of request.views)displayArtwork(view,blob);
        request.views.length=0;
        await fillCachedDetails(task.row,task.series);
      }catch(_){}
      finally{
        activeArtwork.delete(task.id);
        artworkBusy--;
        pumpArtwork();
      }
    })();
  }
}
function hideContextMenu(){
  contextRow=null;contextSeries=false;
  const menu=$("libraryContextMenu");
  if(menu)menu.hidden=true;
}
function showContextMenu(row,x,y,fromContinue=false,seriesOnly=false){
  const menu=$("libraryContextMenu");
  if(!menu||!nativeBridge||!row?.nativePath)return;
  contextRow=row;contextSeries=seriesOnly;
  const mark=$("markWatched"),unmark=$("markUnwatched");
  mark.hidden=false;unmark.hidden=false;
  mark.textContent=seriesOnly?say("Mark Entire Series as Watched","Отметить весь сериал просмотренным"):say("Mark as Watched","Отметить просмотренным");
  unmark.textContent=seriesOnly?say("Mark Entire Series as Unwatched","Отметить весь сериал непросмотренным"):say("Отметить непросмотренным","Отметить непросмотренным");
  if(!seriesOnly)unmark.textContent=say("Mark as Unwatched","Отметить непросмотренным");
  const watch=$("watchlistAction");
  if(watch){watch.hidden=!window.DKCollections;watch.textContent=window.DKCollections?.has(row)?say("Remove from Watchlist","Убрать из списка просмотра"):say("Add to Watchlist","Добавить в список просмотра");}
  const collection=$("manageMovieCollection"),edition=$("manageMovieEdition");
  if(collection){collection.hidden=seriesOnly||row.kind!=="movie"||!window.DKCollections;collection.textContent=say("Manage Collections","Управление коллекциями");}
  if(edition){edition.hidden=seriesOnly||row.kind!=="movie"||!window.DKCollections;edition.textContent=say("Movie Editions","Версии фильма");}
  $("deleteFromDisk").hidden=seriesOnly;
  $("movieDetailsAction").hidden=seriesOnly||row.kind!=="movie";
  $("refreshMovieMetadata").hidden=seriesOnly||row.kind!=="movie";
  $("removeContinueWatching").hidden=seriesOnly||!fromContinue;
  $("removeFromLibrary").hidden=seriesOnly;
  $("showInFolder").hidden=seriesOnly||!nativeBridge.showInFolder;
  $("showInFolder").disabled=!!row.missing;
  menu.hidden=false;
  const scale=nativeBridge?.internalPages?libraryZoom/100:1;
  menu.style.left=Math.max(4,Math.min(x/scale,
    window.innerWidth/scale-menu.offsetWidth-8))+"px";
  menu.style.top=Math.max(4,Math.min(y/scale,
    window.innerHeight/scale-menu.offsetHeight-8))+"px";
  (seriesOnly?watch:row.kind==="movie"?$("movieDetailsAction"):!$("showInFolder").hidden&&!$("showInFolder").disabled?$("showInFolder"):$("deleteFromDisk")).focus();
}
let detailMovieId=null;
function displayMovieDetails(row){
  const d=$("movieDetailsDialog");
  const data=row.movieDetails||{};
  detailMovieId=row.id;
  $("movieDetailsTitle").textContent=row.title+(row.year?" ("+row.year+")":"");
  $("movieDetailsDescription").textContent=data.description||say("No description available.","Описание недоступно.");
  const list=$("movieDetailsFields");list.replaceChildren();
  const add=(label,value)=>{if(value){list.append(create("dt",null,label),create("dd",null,value));}};
  const addLinks=(label,kind,values)=>{
    if(!window.DKCollections||!Array.isArray(values)||!values.length){add(label,values?.join(", "));return;}
    const dd=create("dd","dk-facet-links");for(const value of values){const b=create("button","btn small",value);b.type="button";b.addEventListener("click",()=>{d.close();window.DKLiveTV?.close();mode="movie";selectedSeries=null;selectedSeason=null;collectionFilter={kind,value,query:"",saved:false};visibleCount=72;void render();});dd.append(b);}list.append(create("dt",null,label),dd);
  };
  addLinks(say("Genre","Жанр"),"genre",data.genres);
  add(say("Runtime","Продолжительность"),data.runtime?data.runtime+say(" min"," мин"):null);
  addLinks(say("Director","Режиссёр"),"director",data.directors);
  addLinks(say("Cast","В ролях"),"actor",data.cast);
  add(say("Rating","Рейтинг"),data.rating);
  add(say("Source","Источник"),row.movieProvider==="Cinemeta"?say("Cinemeta","Синемета"):row.movieProvider==="Apple"?say("Apple","Эпл"):row.movieProvider||null);
  $("movieDetailsClose").title=say("Close","Закрыть");
  $("movieDetailsClose").setAttribute("aria-label",say("Close","Закрыть"));
  if(!d.open)d.showModal();
}
let fileInfoRevision=0;
function showFileFields(row,info=null,loading=false){
  const list=$("movieFileFields"),section=$("movieFileSection");
  section.hidden=!nativeBridge; if(section.hidden)return;
  $("movieFileHeading").textContent=say("File Information","Сведения о файле");
  list.replaceChildren();
  const add=(label,value)=>{if(value!==null&&value!==undefined&&value!=="")list.append(create("dt",null,label),create("dd",null,String(value)));};
  const filename=info?.filename||row.filename||"";
  const ext=info?.extension||filename.split(".").pop()?.toUpperCase()||"";
  const formatNames={MKV:"Matroska",MP4:"MPEG-4",M4V:"MPEG-4",MOV:"QuickTime",AVI:"AVI",WEBM:"WebM",TS:"MPEG-TS",M2TS:"MPEG-TS",VOB:"DVD Video"};
  const detected=String(info?.format||"").split(",");
  const family=detected.includes("matroska")?(ext==="WEBM"?"WebM":"Matroska / WebM"):
    detected.includes("mp4")?"MPEG-4 / QuickTime":detected.includes("avi")?"AVI":
    detected.includes("mpegts")?"MPEG-TS":detected.includes("mpeg")?"MPEG":null;
  add(say("Format","Формат"),ext+(family||formatNames[ext]?" ("+(family||formatNames[ext])+")":""));
  if(info?.probeStatus==="ok"&&info.format&&!family)add(say("Detected container","Обнаруженный контейнер"),info.format);
  const bytes=Number(info?.size??row.size);
  if(Number.isFinite(bytes)&&bytes>=0)add(say("File size","Размер файла"),new Intl.NumberFormat(lang(),{maximumFractionDigits:2}).format(bytes/1073741824)+say(" GiB"," ГиБ"));
  add(say("Filename","Имя файла"),filename);
  add(say("Location","Расположение"),info?.path||row.nativePath);
  const streams=Array.isArray(info?.streams)?info.streams:[];
  const video=streams.find(x=>x.codec_type==="video"),audio=streams.filter(x=>x.codec_type==="audio"),subs=streams.filter(x=>x.codec_type==="subtitle");
  const codec=x=>({h264:"H.264 / AVC",hevc:"H.265 / HEVC",av1:"AV1",aac:"AAC",ac3:"AC-3",eac3:"E-AC-3",dts:"DTS",vp9:"VP9",subrip:"SRT"}[x]||String(x||"").toUpperCase());
  const language=x=>{const value=String(x||"und").toLowerCase();try{return new Intl.DisplayNames([lang()],{type:"language"}).of(value);}catch(_){return value==="und"?say("Unspecified","Не указан"):value;}};
  if(video){
    add(say("Video codec","Видеокодек"),codec(video.codec_name));
    if(video.width&&video.height)add(say("Resolution","Разрешение"),video.width+" × "+video.height);
    const rate=String(video.avg_frame_rate||video.r_frame_rate||"").split("/").map(Number);
    const fps=rate.length===2&&rate[1]?rate[0]/rate[1]:rate[0];
    if(Number.isFinite(fps)&&fps>0)add(say("Frame rate","Частота кадров"),new Intl.NumberFormat(lang(),{maximumFractionDigits:3}).format(fps)+say(" FPS"," кадр/с"));
  }
  if(audio.length){
    add(say("Audio codecs","Аудиокодеки"),audio.map(x=>codec(x.codec_name)+(x.tags?.language?" ("+language(x.tags.language)+")":"")).join(", "));
    add(say("Audio channels","Аудиоканалы"),audio.map(x=>x.channels?String(x.channels):"").filter(Boolean).join(", "));
  }
  if(info?.probeStatus==="ok")add(say("Embedded subtitles","Встроенные субтитры"),subs.length?subs.map(x=>language(x.tags?.language)+" ("+codec(x.codec_name)+")").join(", "):say("None","Нет"));
  $("movieFileStatus").textContent=loading?say("Reading local file…","Чтение локального файла…"):info?.probeStatus==="ok"?"":say("Stream details unavailable; format and file size are based on the catalog or file extension.","Сведения о потоках недоступны; формат и размер указаны по каталогу или расширению файла.");
}
async function showMovieDetails(){
  const row=contextRow;hideContextMenu();
  if(row?.kind!=="movie")return;
  const latest=await store.item(row.id)||row;
  displayMovieDetails(latest);
  const revision=++fileInfoRevision;
  showFileFields(latest,null,!!nativeBridge?.fileInfo);
  if(!nativeBridge?.fileInfo)return;
  try{
    const info=await nativeBridge.fileInfo(latest.id,latest.nativePath);
    if(revision===fileInfoRevision&&detailMovieId===latest.id&&$("movieDetailsDialog").open)showFileFields(latest,info);
  }catch(_){
    if(revision===fileInfoRevision&&detailMovieId===latest.id&&$("movieDetailsDialog").open)showFileFields(latest);
  }
}
async function refreshMovie(){
  const row=contextRow;hideContextMenu();
  if(row?.kind!=="movie")return;
  if(!navigator.onLine){status("Metadata refresh requires an internet connection.","Для обновления данных требуется интернет.",true);return;}
  if(activeArtwork.has(row.id)){status("This movie is already being updated.","Данные фильма уже обновляются.");return;}
  status("Refreshing movie metadata…","Обновление данных фильма…");
  artworkFinder?.clear();artAttempted.delete(row.id);titleAttempted.delete(row.id);
  try{
    await findArtwork(row,row.id,false,true);
    const updated=await store.item(row.id);
    await render();
    if(updated?.movieMetadataVerified){
      status("Movie metadata refreshed where available.","Доступные данные фильма обновлены.");
    }else status("No matching movie metadata found.","Данные фильма не найдены.",true);
  }catch(_){status("Could not refresh movie metadata.","Не удалось обновить данные фильма.",true);}
}
async function markHistory(rows,watched){
  if(!rows.length)return;
  if(rows.length>1&&!window.confirm(say((watched?"Mark as watched: ":"Mark as unwatched: ")+rows.length+" videos?",(watched?"Отметить просмотренными: ":"Отметить непросмотренными: ")+rows.length+" видео?")))return;
  try{
    await store.setWatched(rows.map(row=>row.id),watched);
    // Old resume snapshots must not resurrect manually reset history.
    const resume=JSON.parse(localStorage.getItem("dkmedia.web.resume.v1")||"{}")||{};
    const fingerprints=new Map(rows.map(row=>["file:"+row.filename+":"+row.size,row.modified]));
    for(const key of Object.keys(resume)){
      const split=key.lastIndexOf(":");
      if(fingerprints.has(key.slice(0,split))&&Math.abs(Number(key.slice(split+1))-Number(fingerprints.get(key.slice(0,split))))<=1)delete resume[key];
    }
    localStorage.setItem("dkmedia.web.resume.v1",JSON.stringify(resume));
    await render();
    status(watched?"Marked as watched.":"Marked as unwatched.",watched?"Отмечено просмотренным.":"Отмечено непросмотренным.");
  }catch(_){status("Could not save watched status.","Не удалось сохранить состояние просмотра.",true);}
}
function markContext(watched){
  const row=contextRow,series=contextSeries;hideContextMenu();
  if(row)void markHistory(series?seriesRows(row):[row],watched);
}
async function removeContinueWatching(){
  const row=contextRow;hideContextMenu();if(!row)return;
  try{await store.setContinueHidden(row.id,true);const latest=await store.item(row.id);if(latest)all=all.map(item=>item.id===row.id?latest:item);paintContinueWatching();}
  catch(_){status("Could not remove from Continue Watching.","Не удалось убрать из списка продолжения просмотра.",true);}
}
async function removeFromLibrary(){
  const row=contextRow;hideContextMenu();
  if(!row||scanning||maintaining){status("Stop the current library operation first.","Сначала остановите текущую операцию.",true);return;}
  if(!window.confirm(say("Remove this card from the library? The video file will not be deleted, and this path will stay hidden in future scans.","Убрать эту карточку из медиатеки? Видеофайл не будет удалён, а этот путь останется скрытым при следующих проверках.")))return;
  try{
    await store.hideEntry(row.id);await render();
    status("Removed from library. Video file unchanged.","Карточка удалена из медиатеки. Видеофайл не изменён.");
  }catch(_){status("Could not remove library card.","Не удалось удалить карточку.",true);}
}
async function showInFolder(){
  const row=contextRow;hideContextMenu();
  if(!row?.nativePath||!nativeBridge?.showInFolder)return;
  try{await nativeBridge.showInFolder(row.id,row.nativePath);}
  catch(_){status("Could not locate this file. Reconnect its drive or scan the library.","Не удалось найти файл. Подключите накопитель или проверьте медиатеку.",true);}
}
async function deleteFromDisk(){
  const row=contextRow;
  hideContextMenu();
  if(!nativeBridge||!row?.nativePath)return;
  try{
    // The desktop main process performs its own filesystem validation
    // and native OS confirmation, including an irreversible-delete warning.
    const result=await nativeBridge.deleteVideo(row.id,row.nativePath);
    if(!result?.deleted)return;
    await store.removeEntry(row.id);
    await render();
    status(result.method==="trash"?
      "Video moved to Trash and removed from your library.":
      "Video permanently deleted from disk and removed from your library.",
      result.method==="trash"?
      "Видео перемещено в корзину и удалено из медиатеки.":
      "Видео безвозвратно удалено с диска и из медиатеки.");
  }catch(error){
    status("Could not delete the file: "+(error?.message||""),
      "Не удалось удалить файл с диска.",true);
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
      if(row.continueHidden)await store.setContinueHidden(row.id,false);
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
  window.DKLiveTV?.close();
  if(mode!==(value==="tv"?"tv":"movie"))collectionFilter={kind:"",value:"",query:"",saved:false};
  mode=value==="tv"?"tv":"movie";
  selectedSeries=null;selectedSeason=null;visibleCount=72;
  try{localStorage.setItem("dk-kinehall.library.category.v1",mode);}catch(_){}
  void render().then(recordNavigation);
}
function recordNavigation(){
  if(nativeBridge?.recordNavigation)void nativeBridge.recordNavigation({mode,series:selectedSeries,season:selectedSeason}).catch(()=>{});
}
// History is a separate view, never a reason to rebuild the collection.
function paintContinueWatching(){
  const list=$("continueWatching");
  const rows=all.filter(row=>row.kind===mode&&!(nativeBridge&&/(?:^|[ ._-])sample(?:[ ._-]|$)/i.test(row.filename))&&needsContinue(row))
    .sort((a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0)).slice(0,30);
  const existing=new Map(Array.from(list.children).map(card=>[card.dataset.libraryId,card]));
  const keep=new Set(rows.map(row=>row.id));
  for(const [id,card] of existing){
    if(keep.has(id))continue;
    for(const image of card.querySelectorAll("img")){
      const url=image.src;if(imageUrls.delete(url))URL.revokeObjectURL(url);
    }
    card.remove();
  }
  rows.forEach((row,i)=>{
    let card=existing.get(row.id);
    if(!card)card=createCard(row,{landscape:true});
    const fill=card.querySelector(".library-progress>span");
    const duration=Number(row.duration)||0;
    if(fill)fill.style.width=duration>0?Math.max(3,Math.min(100,100*currentProgress(row)/duration))+"%":"10%";
    card.classList.toggle("library-unavailable",!!row.missing);
    if(list.children[i]!==card)list.insertBefore(card,list.children[i]||null);
  });
  pumpArtwork();
}
function scheduleHistoryRefresh(){
  // Electron's hidden WebContentsView can report focus/visibility incorrectly.
  // Only reconcile this small section, irrespective of focus.
  clearTimeout(historyTimer);
  historyTimer=setTimeout(async()=>{
    const revision=++historyRevision;
    try{
      const rows=(await store.entries()).filter(row=>!nativeBridge||!store.excludedDiscovery?.(row));
      if(revision!==historyRevision)return;
      // Do not add/remove collection entries here; structural events own that.
      const latest=new Map(rows.map(row=>[row.id,row]));
      all=all.map(row=>latest.get(row.id)||row);
      try{legacyResume=JSON.parse(localStorage.getItem("dkmedia.web.resume.v1")||"{}")||{};}catch(_){legacyResume={};}
      if(nativeBridge)legacyProgressById=recoverLegacyProgress(all);
      paintContinueWatching();refreshWatchedCards();
    }catch(_){}
  },180);
}
const editionNames={director:["Director's cut","Режиссёрская версия"],extended:["Extended edition","Расширенная версия"],theatrical:["Theatrical cut","Прокатная версия"],unrated:["Unrated cut","Версия без рейтинга"],special:["Special edition","Специальная версия"],standard:["Standard edition","Обычная версия"]};
function editionName(value){return editionNames[value]?say(...editionNames[value]):"";}
function collectionDialog(row,mode){
 if(!row||row.kind!=="movie"||!window.DKCollections)return;
 const api=window.DKCollections,dlg=create("dialog","dk-collection-dialog"),header=create("h2",null,mode==="collection"?say("Manage Collections","Управление коллекциями"):say("Movie Editions","Версии фильма"));
 const body=create("div","dk-collection-dialog-body"),feedback=create("p","helper"),close=create("button","btn",say("Close","Закрыть"));close.type="button";close.addEventListener("click",()=>dlg.close());
 const button=(label,fn)=>{const b=create("button","btn small",label);b.type="button";b.addEventListener("click",fn);return b;};
 const update=()=>{feedback.textContent=say("Saved locally.","Сохранено локально.");void render();};
 const fail=()=>{feedback.textContent=say("Could not save changes.","Не удалось сохранить изменения.");};
 const draw=()=>{
  body.replaceChildren();
  if(mode==="collection"){
   const groups=api.groups().sort((a,b)=>nameSort(a.name,b.name));
   for(const g of groups){const label=create("label","dk-collection-membership"),check=create("input");check.type="checkbox";check.checked=g.members.includes(row.id);label.append(check,create("span",null,g.name));check.addEventListener("change",()=>{if(api.setMembership(row,g.name,check.checked)){update();draw();}else{fail();check.checked=!check.checked;}});body.append(label);}
   const entry=create("input","select");entry.type="text";entry.maxLength=100;entry.placeholder=say("New collection name","Название новой коллекции");
   const add=()=>{if(api.setMembership(row,entry.value,true)){update();draw();}else fail();};
   const line=create("div","dk-collection-membership");line.append(entry,button(say("Create and Add","Создать и добавить"),add));body.append(line);
  }else{
   const select=create("select","select"),current=api.edition(row);
   for(const key of ["",...Object.keys(editionNames)]){const opt=create("option",null,key?editionName(key):say("Detect from filename","Определять по имени файла"));opt.value=key;select.append(opt);}
   select.value=current||"";body.append(select,button(say("Save Edition","Сохранить версию"),()=>{if(api.setEdition(row,select.value))update();else fail();}));
   const matches=api.relatedEditions(row,all);
   body.append(create("p","helper",say("Possible versions with the same title and release year. Files are not merged or renamed.","Возможные версии с одинаковым названием и годом выпуска. Файлы не объединяются и не переименовываются.")));
   for(const match of matches){const line=create("div","dk-collection-membership");line.append(create("span",null,(editionName(api.edition(match))||say("Unspecified edition","Версия не указана"))+" · "+match.filename),button(say("Play","Воспроизвести"),()=>{dlg.close();void openVideo(match);}));body.append(line);}
  }
 };
 dlg.append(header,create("strong",null,row.title),body,feedback,close);document.body.append(dlg);dlg.addEventListener("close",()=>dlg.remove(),{once:true});draw();dlg.showModal();
}
function setupCollectionTools(){
 if(!window.DKCollections||collectionTools)return;
 const bar=create("div","dk-collection-tools");bar.id="collectionTools";
 const select=create("select","select"),value=create("select","select"),search=create("input","select");
 search.type="search";
 const label=create("label","dk-watchlist-filter"),check=create("input");check.type="checkbox";
 const checkText=create("span");label.append(check,checkText);
 const clear=create("button","btn");clear.type="button";
 bar.append(search,select,value,label,clear);
 $("collectionTitle").closest(".section-heading").after(bar);
 const apply=()=>{visibleCount=72;void render();};
 select.addEventListener("change",()=>{collectionFilter.kind=select.value;collectionFilter.value="";apply();});
 value.addEventListener("change",()=>{collectionFilter.value=value.value;apply();});
 search.addEventListener("change",()=>{collectionFilter.query=search.value;apply();});
 search.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();search.blur();}});
 check.addEventListener("change",()=>{collectionFilter.saved=check.checked;apply();});
 clear.addEventListener("click",()=>{collectionFilter={kind:"",value:"",query:"",saved:false};apply();});
 collectionTools={bar,select,value,search,check,checkText,clear};
}
function syncCollectionTools(rows,tv){
 if(!collectionTools)return;
 const {bar,select,value,search,check,checkText,clear}=collectionTools;
 const facets=tv?[["","All categories","Все категории"]]:[["","All categories","Все категории"],["genre","Genre","Жанр"],["decade","Decade","Десятилетие"],["actor","Actor","Актёр"],["director","Director","Режиссёр"],["collection","Collections","Коллекции"],["edition","Edition","Версия фильма"],["versions","Movie versions","Версии фильмов"]];
 if(!facets.some(x=>x[0]===collectionFilter.kind)){collectionFilter.kind="";collectionFilter.value="";}
 const opt=(v,t)=>{const o=create("option",null,t);o.value=v;return o;};
 select.replaceChildren(...facets.map(([v,en,ru])=>opt(v,say(en,ru))));
 select.value=collectionFilter.kind;select.hidden=tv;
 const editionLabels={director:["Director's cut","Режиссёрская версия"],extended:["Extended edition","Расширенная версия"],theatrical:["Theatrical cut","Прокатная версия"],unrated:["Unrated cut","Версия без рейтинга"]};
 let opts=collectionFilter.kind?window.DKCollections.options(rows,collectionFilter.kind):[];
 if(collectionFilter.kind==="versions"){const counts=new Map();for(const row of rows){const id=window.DKCollections.movieIdentity(row);if(id)counts.set(id,(counts.get(id)||0)+1);}opts=opts.filter(x=>(counts.get(x)||0)>1);}
 if(collectionFilter.value&&!opts.includes(collectionFilter.value))opts.unshift(collectionFilter.value);
 value.replaceChildren(opt("",say("All","Все")),...opts.map(v=>opt(v,collectionFilter.kind==="edition"?editionName(v):collectionFilter.kind==="decade"?say(v+"s",v+"-е"):v)));
 value.hidden=!collectionFilter.kind||tv;value.value=collectionFilter.value;
 search.placeholder=say("Search library (Enter)","Поиск в медиатеке (Ввод)");
 search.setAttribute("aria-label",search.placeholder);
 if(document.activeElement!==search)search.value=collectionFilter.query;
 select.setAttribute("aria-label",say("Collection category","Категория коллекции"));
 value.setAttribute("aria-label",say("Collection filter","Фильтр коллекции"));
 check.checked=collectionFilter.saved;checkText.textContent=say("Watchlist","Список просмотра");
 clear.textContent=say("Clear Filters","Сбросить фильтры");
}
async function render(){
  const epoch=++renderEpoch;
  if(bottomObserver)bottomObserver.disconnect();
  imageQueue.length=0;cleanImageUrls();
  historyRevision++;
  folders=await store.folders();
  all=(await store.entries()).filter(row=>!nativeBridge||!store.excludedDiscovery?.(row));
  if(epoch!==renderEpoch)return;
  try{legacyResume=JSON.parse(localStorage.getItem("dkmedia.web.resume.v1")||"{}")||{};}
  catch(_){legacyResume={};}
  if(nativeBridge)legacyProgressById=recoverLegacyProgress(all);
  const tv=mode==="tv";
  $("tabMovies").setAttribute("aria-selected",String(!tv));
  $("tabTV").setAttribute("aria-selected",String(tv));
  window.DKLiveTV?.syncTabs();
  const unfiltered=all.filter(x=>x.kind===mode&&!(nativeBridge&&/(?:^|[ ._-])sample(?:[ ._-]|$)/i.test(x.filename)));
  syncCollectionTools(unfiltered,tv);
  const baseActive=window.DKCollections?window.DKCollections.filter(unfiltered,collectionFilter.kind,collectionFilter.value,collectionFilter.query,collectionFilter.saved):unfiltered;
  const active=nativeBridge&&watchedFilter?baseActive.filter(row=>historyBucket(row)===watchedFilter):baseActive;
  $("watchedFilter").hidden=!nativeBridge;
  $("watchedFilter").value=watchedFilter;
  const resume=unfiltered.filter(needsContinue).sort((a,b)=>b.lastPlayed-a.lastPlayed)
    .slice(0,30);
  const continueList=$("continueWatching");
  continueList.replaceChildren(...resume.map(row=>createCard(row,{landscape:true})));
  const list=$("libraryCollection");
  const detail=$("seriesDetail");
  detail.hidden=!selectedSeries||!tv;
  let cards=[];
  if(tv&&selectedSeries){
    const rows=active.filter(row=>seriesKey(row.series)===seriesKey(selectedSeries));
    const seasonRows=unfiltered.filter(row=>seriesKey(row.series)===seriesKey(selectedSeries));
    const seasons=[...new Set(seasonRows.map(x=>x.season))].sort((a,b)=>a-b);
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
    $("seasonWatchedCount").hidden=!nativeBridge;
    $("markSeasonWatched").hidden=!nativeBridge;$("markSeasonUnwatched").hidden=!nativeBridge;
    refreshSeasonWatched();
    cards=rows.filter(row=>row.season===selectedSeason)
      .sort((a,b)=>a.episode-b.episode||nameSort(a.filename,b.filename));
    $("collectionTitle").textContent=
      say("Episodes","Серии");
  }else if(tv){
    const series=new Map();
    for(const row of active){
      const key=seriesKey(row.series||row.title);
      if(!series.has(key))series.set(key,row);
      else if(!series.get(key).missing&&!row.missing)continue;
      else if(series.get(key).missing&&!row.missing)series.set(key,row);
    }
    cards=[...series.values()].sort((a,b)=>nameSort(a.series,b.series));
    $("collectionTitle").textContent=
      say("Your Entire TV Collection","Вся коллекция сериалов");
  }else{
    cards=active.sort((a,b)=>collectionFilter.kind==="collection"?(Number(a.year)||9999)-(Number(b.year)||9999)||nameSort(a.title,b.title):nameSort(a.title,b.title));
    $("collectionTitle").textContent=
      say("Your Entire Movie Collection","Вся коллекция фильмов");
  }
  if(collectionFilter.saved)$("collectionTitle").textContent=say("Watchlist","Список просмотра");
  $("collectionCount").textContent=say(cards.length+" "+(cards.length===1?"title":"titles"),cards.length+" наименований");
  $("emptyLibrary").hidden=all.length>0;
  if(nativeBridge){
    $("addLibraryFolder").hidden=true;
    $("addFirstFolder").hidden=true;
    const empty=$("emptyLibrary");
    const heading=empty?.querySelector("h3");
    const info=empty?.querySelector("p");
    if(heading)heading.textContent=say("No movies or TV shows discovered yet",
      "Фильмы и сериалы пока не найдены");
    if(info)info.textContent=say(
      "DK Kinehall searches your device and connected drives automatically. Use Scan Library to search again.",
      "ДК Кинехолл автоматически ищет видео на устройстве и подключённых накопителях. Повторите поиск кнопкой проверки.");
  }
  visibleCount=Math.min(Math.max(72,visibleCount),cards.length);
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
  $("folderSummary").textContent=nativeBridge?
    say("Automatic local media discovery · no media server · no duplicated video files",
      "Автоматический поиск местных видео · без медиасервера · без копирования видео"):
    folders.length?
      say("Saved local folders: ","Сохранённые локальные папки: ")+
        folders.map(folder=>folder.name).join(" · "):
      say("No media folders selected. Local video files are never copied into the library.",
        "Папки не выбраны. Видеофайлы не копируются в медиатеку.");
  if(!scanning)status(
    nativeBridge?"Library loaded from local cache.":
      folders.length?"Library loaded from local cache.":"Add a local folder to begin.",
    nativeBridge||folders.length?
      "Медиатека загружена из локального хранилища.":
      "Добавьте локальную папку.");
  pumpArtwork();
}
function showScanIssues(errors){
  let details=$("nativeScanIssues");
  if(!details){
    details=create("details","library-scan-issues");
    details.id="nativeScanIssues";
    const summary=create("summary",null,"");
    const list=create("ul");
    details.append(summary,list);
    $("libraryStatus").after(details);
  }
  const rows=Array.isArray(errors)?errors:[];
  details.hidden=rows.length===0;
  details.open=false;
  details.querySelector("summary").textContent=say("Scan issues ("+rows.length+")","Ошибки проверки ("+rows.length+")");
  const list=details.querySelector("ul");
  // Report all actual paths on demand, keeping the main collection clean.
  list.replaceChildren();
  details.ontoggle=()=>{
    if(!details.open||list.childNodes.length)return;
    const fragment=document.createDocumentFragment();
    for(const issue of rows){
      const operation=issue.operation==="open-directory"?say("Open folder","Открытие папки"):
        issue.operation==="read-directory"?say("Read folder","Чтение папки"):say("Inspect video","Проверка видео");
      const code=issue.code==="UNVERIFIED_VIDEO"?say("Video format could not be verified","Не удалось проверить формат видео"):
        String(issue.code||"UNKNOWN");
      fragment.append(create("li",null,operation+": "+String(issue.path||"")+" ("+code+")"));
    }
    list.append(fragment);
  };
}
async function scan(manual=false){
  if(maintaining)return;
  if(scanning){
    controller?.abort();
    if(nativeBridge)void nativeBridge.cancelScan();
    return;
  }
  scanning=true;controller=new AbortController();
  if(nativeBridge)showScanIssues([]);
  if(nativeBridge?.internalPages)void nativeBridge.setScanState(true).catch(()=>{});
  $("scanLibrary").textContent=say("Stop Scan","Остановить");
  $("scanLibrary").setAttribute("aria-pressed","true");
  let stopListening=null;
  try{
    if(nativeBridge){
      stopListening=nativeBridge.onScanProgress(progress=>{
        status("Searching device: "+progress.found+" videos found…",
          "Поиск на устройстве: найдено видео "+progress.found+"…");
      });
      const discovered=await nativeBridge.discover(manual);
      // Cancellation retains successfully discovered records. Never mark
      // unseen records missing after an interrupted or errored scan.
      const cancelled=!!discovered.cancelled||controller.signal.aborted;
      const counts=await store.ingestNative(cancelled?{...discovered,complete:false}:discovered);
      const merged=cancelled?0:await store.reconcileNative();
      if(manual||counts.added||counts.updated||counts.missing||merged)await render();
      else scheduleHistoryRefresh();
      const errors=Array.isArray(discovered.errors)?discovered.errors:[];
      showScanIssues(errors);
      status((cancelled?"Scan stopped. ":discovered.partial?"Scan finished with errors. ":"Scan complete. ")+
        counts.found+" videos found. "+counts.added+" added, "+counts.updated+" updated, "+
        counts.missing+" unavailable. "+merged+" duplicate records merged."+
        (errors.length?" "+errors.length+" filesystem or video verification issue(s). See scan issues below.":"")+
        (cancelled?" Discovered videos retained.":""),
        (cancelled?"Проверка остановлена. ":discovered.partial?"Проверка завершена с ошибками. ":"Проверка завершена. ")+
        "Найдено видео: "+counts.found+". Добавлено: "+counts.added+". Обновлено: "+counts.updated+
        ". Недоступно: "+counts.missing+". Объединено записей: "+merged+"."+
        (errors.length?" Ошибок проверки: "+errors.length+". Подробности ниже.":"")+
        (cancelled?" Найденные видео сохранены.":""),errors.length>0);
      return;
    }
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
      result.partial+=row.complete===false?1:0;
      return result;
    },{added:0,updated:0,missing:0,permissions:0,partial:0});
    await render();
    const partial=counts.partial+counts.permissions;
    status((partial?"Scan incomplete: ":"Scan finished: ")+
      counts.added+" added, "+counts.updated+" updated, "+
      counts.missing+" unavailable."+
      (counts.permissions?" "+counts.permissions+" folder(s) need permission.":"")+
      (counts.partial?" "+counts.partial+" folder(s) reached scan limits or had read errors.":""),
      (partial?"Проверка не завершена: ":"Проверка завершена: ")+
      "добавлено "+counts.added+", обновлено "+
      counts.updated+", недоступно "+counts.missing+"."+
      (counts.permissions?" Требуется разрешение на доступ к папкам.":"")+
      (counts.partial?" Есть ошибки чтения или достигнут предел проверки.":""),
      partial>0);
  }catch(error){
    status(controller.signal.aborted?"Scan stopped.":"Scan failed: "+error.message,
      controller.signal.aborted?"Проверка остановлена.":"Ошибка проверки.",true);
  }finally{
    stopListening?.();
    scanning=false;controller=null;
    if(nativeBridge?.internalPages)void nativeBridge.setScanState(false).catch(()=>{});
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
async function libraryMaintenance(action){
  if(maintaining){if(action==="refresh")refreshCancelled=true;return;}
  maintaining=true;refreshCancelled=false;
  const send=value=>nativeBridge.setMaintenanceStatus({action,...value}).catch(()=>{});
  let result={busy:false};
  try{
    if(action==="trash"){
      if(!nativeBridge.checkCatalogPaths)throw Error("Path verification unavailable");
      const rows=(await store.entries()).filter(row=>row.source==="native"&&row.nativePath);
      const confirmed=[];let uncertain=0;
      for(let start=0;start<rows.length;start+=128){
        const batch=rows.slice(start,start+128).map(({id,nativePath,volumeIdentity})=>({id,nativePath,volumeIdentity}));
        const checked=await nativeBridge.checkCatalogPaths(batch);
        for(const entry of checked){
          if(entry.state==="missing")confirmed.push(entry.id);
          else if(entry.state==="unknown")uncertain++;
        }
        status("Checking library files: "+Math.min(start+128,rows.length)+" / "+rows.length,
          "Проверка файлов: "+Math.min(start+128,rows.length)+" / "+rows.length);
      }
      const removed=await store.emptyTrash(confirmed);
      result={busy:false,removed,merged:0};
      await render();
      status("Empty Trash: "+removed+" deleted-file records removed. "+uncertain+" uncertain paths retained.",
        "Корзина очищена: удалено записей "+removed+". Сохранено непроверенных путей: "+uncertain+".");
    }else if(action==="refresh"){
      if(!navigator.onLine)throw Error("Offline");
      // Explicit full-library refresh: one item at a time, with a stop
      // command. Retain existing metadata/art when providers fail.
      artworkFinder?.clear();artAttempted.clear();titleAttempted.clear();
      const rows=(await store.entries()).filter(row=>!row.missing&&!store.excludedDiscovery?.(row));
      const tasks=rows.map(row=>({row,series:false,id:artId(row)}));
      const seen=new Set();
      for(const row of rows){
        if(row.kind!=="tv")continue;
        const id=artId(row,true);
        if(!seen.has(id)){seen.add(id);tasks.push({row,series:true,id});}
      }
      let done=0;
      await send({busy:true,done,total:tasks.length});
      for(const task of tasks){
        if(refreshCancelled)break;
        try{await findArtwork(task.row,task.id,task.series,true);}catch(_){}
        done++;
        status("Refreshing metadata: "+done+" / "+tasks.length,
          "Обновление данных: "+done+" / "+tasks.length);
        await send({busy:true,done,total:tasks.length});
      }
      result={busy:false,done,total:tasks.length,cancelled:refreshCancelled};
      await render();
      status(refreshCancelled?"Metadata refresh stopped.":"Metadata refresh finished; existing data retained when providers had no match.",
        refreshCancelled?"Обновление остановлено.":"Обновление завершено; прежние данные сохранены при отсутствии совпадений.");
    }
  }catch(_){
    result={busy:false,failed:true};
    status("Library maintenance failed.","Не удалось выполнить обслуживание медиатеки.",true);
  }finally{maintaining=false;await send(result);}
}
function connect(){
  setupCollectionTools();
  $("watchlistAction")?.addEventListener("click",()=>{const row=contextRow;hideContextMenu();if(!row||!window.DKCollections)return;if(!window.DKCollections.toggle(row)){status("Could not save watchlist.","Не удалось сохранить список просмотра.",true);return;}void render();});
  $("manageMovieCollection")?.addEventListener("click",()=>{const row=contextRow;hideContextMenu();collectionDialog(row,"collection");});
  $("manageMovieEdition")?.addEventListener("click",()=>{const row=contextRow;hideContextMenu();collectionDialog(row,"edition");});
  $("movieDetailsAction").addEventListener("click",()=>void showMovieDetails());
  $("refreshMovieMetadata").addEventListener("click",()=>void refreshMovie());
  $("movieDetailsClose").addEventListener("click",()=>$("movieDetailsDialog").close());
  $("movieDetailsDialog").addEventListener("close",()=>{detailMovieId=null;});
  $("markWatched").addEventListener("click",()=>markContext(true));
  $("markUnwatched").addEventListener("click",()=>markContext(false));
  $("watchedFilter").addEventListener("change",event=>{watchedFilter=event.target.value;visibleCount=72;void render();});
  for(const [id,watched] of [["markSeasonWatched",true],["markSeasonUnwatched",false]]){
    $(id).addEventListener("click",()=>void markHistory(all.filter(row=>row.kind==="tv"&&seriesKey(row.series)===seriesKey(selectedSeries)&&row.season===selectedSeason),watched));
  }
  $("removeContinueWatching").addEventListener("click",()=>void removeContinueWatching());
  $("removeFromLibrary").addEventListener("click",()=>void removeFromLibrary());
  $("showInFolder").addEventListener("click",()=>void showInFolder());
  $("deleteFromDisk").addEventListener("click",()=>void deleteFromDisk());
  document.addEventListener("pointerdown",event=>{
    if(!event.target.closest("#libraryContextMenu"))hideContextMenu();
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape")hideContextMenu();
  });
  window.addEventListener("blur",hideContextMenu);
  $("tabMovies").addEventListener("click",()=>switchMode("movie"));
  $("tabTV").addEventListener("click",()=>switchMode("tv"));
  $("addLibraryFolder").addEventListener("click",()=>void chooseFolder());
  $("addFirstFolder").addEventListener("click",()=>void chooseFolder());
  $("scanLibrary").addEventListener("click",()=>void scan(true));
  // Standalone navigation only; leave the hosted library unchanged.
  if(nativeBridge?.internalPages){
    document.documentElement.classList.add("dk-standalone");
    let savedZoom=100;
    try{const value=Number(localStorage.getItem(libraryZoomKey)||100);if(Number.isFinite(value))savedZoom=value;}catch(_){}
    applyLibraryZoom(savedZoom,false);
    let lastZoomWheel=0;
    window.addEventListener("wheel",event=>{
      if(!event.ctrlKey)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(!event.deltaY)return;
      const now=performance.now();
      // Coalesce high-frequency trackpad events without affecting wheel notches.
      if(now-lastZoomWheel<65)return;
      lastZoomWheel=now;
      applyLibraryZoom(libraryZoom+(event.deltaY<0?10:-10));
    },{capture:true,passive:false});
    window.addEventListener("mousedown",event=>{
      if(event.ctrlKey&&event.button===1){
        event.preventDefault();event.stopImmediatePropagation();applyLibraryZoom(100);
      }
    },true);
    window.addEventListener("auxclick",event=>{
      if(event.ctrlKey&&event.button===1){event.preventDefault();event.stopImmediatePropagation();}
    },true);
    if(nativeBridge.openACP){
      const footer=create("footer","footer dk-branded-footer");
      const brand=create("span",null,"DK Kinehall ☭ DK Softworks");
      const link=create("a",null,"ACP");link.href="https://acp.us/";
      link.addEventListener("click",event=>{
        event.preventDefault();
        void nativeBridge.openACP().catch(()=>status("Could not open external website.","Не удалось открыть внешний сайт.",true));
      });
      footer.append(brand,link);
      document.querySelector(".library-shell>main")?.after(footer);
    }
    const labels=()=>{$("scanLibrary").textContent=say(scanning?"Stop Scan":"Scan Library",scanning?"Остановить":"Проверить медиатеку");$("movieDetailsAction").textContent=say("Movie Details","О фильме");$("refreshMovieMetadata").textContent=say("Refresh Metadata","Обновить данные");};
    labels();$("languageSelect").addEventListener("change",()=>queueMicrotask(labels));
    const trash=$("libraryEmptyTrash");
    if(nativeBridge.requestMaintenance){
      trash.hidden=false;
      trash.addEventListener("click",()=>void nativeBridge.requestMaintenance("trash",lang()).catch(()=>status("Library maintenance failed.","Не удалось выполнить обслуживание медиатеки.",true)));
      let busy=false;
      nativeBridge.onMaintenanceStatus?.(value=>{busy=!!value.busy;trash.disabled=busy||scanning;});
      nativeBridge.onScanState?.(value=>{trash.disabled=busy||!!value;});
    }
    $("scanLibrary").classList.remove("primary","ghost");
    $("scanLibrary").classList.add("dk-scan");
    nativeBridge.onScanRequest(()=>void scan(true));
    nativeBridge.onMaintenanceRequest?.(action=>void libraryMaintenance(action));
    nativeBridge.onRestoreNavigation?.(value=>{
      mode=value.mode;selectedSeries=value.series;selectedSeason=value.season;visibleCount=72;
      void render();
    });
    document.addEventListener("auxclick",event=>{
      if(event.button!==3&&event.button!==4)return;
      event.preventDefault();event.stopPropagation();
      void nativeBridge.navigateHistory(event.button===3?-1:1).catch(()=>{});
    },true);
  }
  if(nativeBridge?.internalPages&&nativeBridge.liveTvLineup&&nativeBridge.openMediaTool){
    const tv=create("button","btn primary","Live TV");tv.type="button";tv.id="libraryLiveTV";
    tv.setAttribute("role","tab");tv.setAttribute("aria-selected","false");
    tv.setAttribute("aria-controls","liveTvPanel");
    $("tabTV").after(tv);
    tv.addEventListener("click",()=>window.DKLiveTV?.open());
    window.DKLocale?.apply();
  }
  if(nativeBridge?.showPlayer){
    const button=document.createElement("button");
    button.type="button";button.id="showPlayer";button.className="btn primary dk-window-nav";
    button.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 3l15 9L6 21z" fill="currentColor"/></svg><span>Player</span>';
    $("scanLibrary").before(button);
    button.addEventListener("click",async()=>{
      try{await nativeBridge.showPlayer();}
      catch(_){status("Could not open the video player.","Не удалось открыть окно проигрывателя.",true);}
    });
  }
  if(nativeBridge?.openSharedSettings&&nativeBridge?.changeSharedSetting){
    const button=create("button","btn","Settings");button.type="button";button.id="librarySettings";
    $("scanLibrary").after(button);
    const dlg=create("dialog","dk-library-settings-dialog");dlg.setAttribute("aria-label","Settings");
    const header=create("div","dk-library-settings-heading");
    const title=create("strong",null,"Settings");
    const close=create("button","btn","Close");close.type="button";
    const feedback=create("p","helper");feedback.setAttribute("role","status");
    const body=create("div","playback-settings-panel dk-library-settings-content");
    header.append(title,close);dlg.append(header,feedback,body);document.body.append(dlg);
    let epoch=0,busy=false,selectedCategory=null;
    const categories=[["playback","Playback"],["picture","Picture Settings"],["audio","Audio"],["subtitles","Subtitles"],["disc","DVD & Disc"],["network","Network"],["library","Library"],["general","General"]];
    const nav=create("div","dk-settings-category-nav");dlg.insertBefore(nav,body);
    const back=create("button","btn small","Back to settings");back.type="button";nav.append(back);
    const categoryButtons=new Map();
    const extra=create("div","dk-settings-extra");body.after(extra);
    const chooseCategory=id=>{
      selectedCategory=id;
      title.textContent=categories.find(([key])=>key===id)?.[1]||"Settings";
      back.hidden=!id;for(const [key,btn] of categoryButtons)btn.hidden=!!id;
      body.hidden=!id;for(const section of body.children)section.hidden=section.dataset.settingsCategory!==id;
      extra.replaceChildren();extra.hidden=true;
      const toolButton=(label,handler)=>{const btn=create("button","btn",label);btn.type="button";btn.addEventListener("click",handler);extra.append(btn);extra.hidden=false;};
      if(id==="network"||id==="disc"){
        if(nativeBridge.openMediaTool)toolButton(id==="network"?"Network media…":"Open DVD…",async()=>{if(busy)return;busy=true;try{await nativeBridge.openMediaTool(id);dlg.close();}catch(_){setFeedback("Could not open media tool.");}finally{busy=false;}});
        extra.append(create("p","helper",id==="network"?"Discover DLNA servers and open compatible local network streams.":"Open DVD drives, ISO images and DVD folders with a compatible decoder."));
      }
      if(id==="library"){
        toolButton("Scan Library",()=>{dlg.close();void scan(true);});
        toolButton("Refresh Metadata",()=>{dlg.close();void libraryMaintenance("refresh");});
        toolButton("Empty Trash",()=>{dlg.close();void nativeBridge.requestMaintenance("trash",lang());});
      }
      if(id==="general")extra.append(create("p","helper","Use the header language selector to change the interface language."));
      if(id==="general")extra.hidden=false;
      body.scrollTop=0;window.DKLocale?.apply();
    };
    back.addEventListener("click",()=>chooseCategory(null));
    for(const [key,label] of categories){const btn=create("button","btn",label);btn.type="button";btn.addEventListener("click",()=>chooseCategory(key));nav.append(btn);categoryButtons.set(key,btn);}
    chooseCategory(null);
    const setFeedback=message=>{feedback.textContent=message;window.DKLocale?.apply();};
    // Only copy the static settings markup owned by the local Player.
    // Allowlist element/attribute names; no executable markup or URLs.
    function renderShared(sections){
      if(!Array.isArray(sections)||sections.length>12)throw Error("Invalid settings response");
      const fragment=document.createDocumentFragment();
      const allowedTags=new Set(["SECTION","DIV","STRONG","LABEL","SELECT","OPTION","INPUT","OUTPUT","BUTTON","P","SPAN"]);
      const allowedAttrs=new Set(["class","id","for","type","value","min","max","step","checked","selected","disabled","role","aria-label","aria-live","data-shared-setting","data-settings-category"]);
      function clean(source){
        if(source.nodeType===3)return document.createTextNode(source.nodeValue);
        if(source.nodeType!==1||!allowedTags.has(source.tagName))return null;
        const node=document.createElement(source.tagName.toLowerCase());
        for(const attr of source.attributes)if(allowedAttrs.has(attr.name))node.setAttribute(attr.name,attr.value);
        if(node.tagName==="BUTTON")node.type="button";
        if(node.tagName==="INPUT"&&!["range","checkbox"].includes(node.type))return null;
        for(const child of source.childNodes){const safe=clean(child);if(safe)node.append(safe);}
        return node;
      }
      for(const markup of sections){
        if(typeof markup!=="string"||markup.length>100000)throw Error("Invalid settings section");
        const parsed=new DOMParser().parseFromString(markup,"text/html");
        for(const source of parsed.body.children){const node=clean(source);if(node)fragment.append(node);}
      }
      const top=body.scrollTop;
      const focusId=body.contains(document.activeElement)?document.activeElement.dataset.sharedSetting:null;
      body.replaceChildren(fragment);chooseCategory(selectedCategory);body.scrollTop=top;
      if(focusId)Array.from(body.querySelectorAll("[data-shared-setting]")).find(n=>n.dataset.sharedSetting===focusId)?.focus({preventScroll:true});
      window.DKLocale?.apply();
    }
    async function applyControl(node,action){
      if(busy||!dlg.open||node.disabled)return;
      busy=true;body.inert=true;const ticket=epoch;
      try{
        const value=action==="click"?null:node.type==="checkbox"?node.checked:node.value;
        const sections=await nativeBridge.changeSharedSetting(node.dataset.sharedSetting,action,value);
        if(ticket===epoch&&dlg.open){body.inert=false;renderShared(sections);setFeedback("");}
      }catch(_){if(ticket===epoch&&dlg.open){setFeedback("Could not apply this setting.");try{renderShared(await nativeBridge.openSharedSettings(lang()));}catch(_){}}}
      finally{busy=false;body.inert=false;}
    }
    body.addEventListener("change",event=>{
      if(event.target.matches("input[data-shared-setting],select[data-shared-setting]"))void applyControl(event.target,"change");
    });
    body.addEventListener("click",event=>{
      const node=event.target.closest("button[data-shared-setting]");if(node)void applyControl(node,"click");
    });
    body.addEventListener("input",event=>{
      const node=event.target;if(node.type!=="range")return;
      const output=Array.from(body.querySelectorAll("output")).find(out=>out.htmlFor.value===node.id||out.getAttribute("for")===node.id);
      if(output){const suffix=output.textContent.match(/(?:%|°|\s?dB|\s?дБ)$/)?.[0]||"";output.textContent=node.value+suffix;}
    });
    close.addEventListener("click",()=>{if(!busy)dlg.close();});
    dlg.addEventListener("cancel",event=>{if(busy)event.preventDefault();});
    dlg.addEventListener("close",()=>{epoch++;body.replaceChildren();button.focus();});
    button.addEventListener("click",async()=>{
      if(dlg.open)return;const ticket=++epoch;
      chooseCategory(null);dlg.showModal();setFeedback("Loading settings…");body.inert=true;busy=true;
      try{const sections=await nativeBridge.openSharedSettings(lang());if(ticket===epoch&&dlg.open){renderShared(sections);setFeedback("");}}
      catch(_){if(ticket===epoch&&dlg.open)setFeedback("Could not open settings.");}
      finally{busy=false;body.inert=false;}
    });
  }
  $("backToSeries").addEventListener("click",()=>{
    selectedSeries=null;selectedSeason=null;void render().then(recordNavigation);
  });
  $("seasonSelect").addEventListener("change",event=>{
    selectedSeason=Number(event.target.value);visibleCount=72;void render().then(recordNavigation);
  });
  store.onChange(event=>{
    if(event.metadata&&event.id){
      // A verified episode name must update only its visible text, not
      // discard/rebuild the artwork for the entire library.
      void store.item(event.id).then(row=>{
        if(!row)return;
        const index=all.findIndex(item=>item.id===row.id);if(index>=0)all[index]=row;
        if(detailMovieId===row.id&&$("movieDetailsDialog").open)displayMovieDetails(row);
        for(const card of document.querySelectorAll(".library-card")){
          if(card.dataset.libraryId!==row.id ||
             card.dataset.displayRole==="series")continue;
          const detail=card.querySelector(".library-card-detail");
          if(row.kind==="tv"){if(detail)detail.textContent=row.episodeTitle||"";}
          else{const title=card.querySelector(".library-card-title");if(title)title.textContent=nativeBridge?row.title:mediaName(row);if(detail)detail.textContent=nativeBridge?(row.year||""):"";}
        }
      }).catch(()=>{});
      return;
    }
    if(nativeBridge&&event.progress){scheduleHistoryRefresh();return;}
    if(scanning||maintaining||(!event.progress&&!event.folders&&!event.entries))return;
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
    if(deferredProgress&&!document.hidden){
      deferredProgress=false;
      void render();
    }
  };
  window.addEventListener("focus",()=>{
    if(nativeBridge){
      deferredProgress=false;
      scheduleHistoryRefresh();
    }else refreshOnReturn();
  });
  document.addEventListener("visibilitychange",refreshOnReturn);
  if(nativeBridge)window.addEventListener("storage",event=>{
    if(event.key!=="dkmedia.web.resume.v1")return;
    scheduleHistoryRefresh();
  });
  if(nativeBridge){
    const collection=$("libraryCollection"),resume=$("continueWatching");
    const matchResumeCards=()=>{
      if(!collection||!resume)return;
      const style=getComputedStyle(collection);
      // Auto-fill retains empty tracks; the first computed track therefore
      // matches actual poster widths even with a sparse collection.
      const track=/^([\d.]+)px(?:\s|$)/.exec(style.gridTemplateColumns);
      if(track&&Number(track[1])>0){
        resume.style.setProperty("--dk-library-card-width",track[1]+"px");
        resume.style.setProperty("--dk-library-card-gap",style.columnGap);
      }
    };
    if(typeof ResizeObserver==="function"){
      const observer=new ResizeObserver(matchResumeCards);observer.observe(collection);
    }
    window.addEventListener("resize",matchResumeCards);
    matchResumeCards();
    requestAnimationFrame(matchResumeCards);
  }
  void render().then(()=>{
    recordNavigation();
    // Render saved posters immediately. A bounded, one-shot rescan is
    // attempted only after initialization; no daemon or persistent server.
    const start=()=>{
      if(nativeBridge||folders.length)void scan(false);
    };
    if("requestIdleCallback" in window)
      requestIdleCallback(start,{timeout:3500});
    else setTimeout(start,2500);
  }).catch(error=>status("Local library unavailable: "+error.message,
    "Локальная медиатека недоступна.",true));
}
connect();
})();
