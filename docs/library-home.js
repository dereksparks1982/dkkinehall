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
let all=[],folders=[],visibleCount=72,renderEpoch=0;
let scanning=false,controller=null,repaintTimer=null;
let maintaining=false,refreshCancelled=false;
let bottomObserver=null;
let contextRow=null;
let deferredProgress=false;
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
const say=(english,russian)=>lang()==="ru"?russian:english;
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
const metadataFilename=row=>row.kind==="tv"&&
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
  if(Number(row.position)>2)return Number(row.position);
  if(nativeBridge)return legacyProgressById.get(row.id)||0;
  const key="file:"+row.filename+":"+row.size+":"+row.modified;
  const value=Number(legacyResume[key]);
  return Number.isFinite(value)?value:0;
}
function needsContinue(row){
  const value=currentProgress(row),length=Number(row.duration)||0;
  // Unavailable media still has history; retain its disabled/unavailable card.
  return !row.completed&&value>2&&(!length||value<length);
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
function createCard(row,{landscape=false,series=false}={}){
  const card=create("button","library-card"+(row.missing?" library-unavailable":""));
  card.type="button";
  card.dataset.libraryId=row.id;
  card.dataset.displayRole=series?"series":landscape?"resume":"entry";
  const box=coverShell(landscape);
  const title=create("span","library-card-title",
    series?row.series:row.kind==="tv"?
      (landscape?row.series+" · "+formatCode(row):formatCode(row)):
      (nativeBridge?row.title:mediaName(row)));
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
  card.addEventListener("contextmenu",event=>{
    if(!nativeBridge)return;
    event.preventDefault();
    if(series){
      status("Open the TV show to delete an individual episode.",
        "Откройте сериал и выберите серию для удаления.");
      return;
    }
    showContextMenu(row,event.clientX,event.clientY);
  });
  card.addEventListener("click",()=>{
    if(series){
      selectedSeries=row.series;
      selectedSeason=null;
      visibleCount=72;
      void render().then(recordNavigation);
    }else void openVideo(row);
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
  let movieResult=null;
  // Native movie metadata is fetched independently of local and cached art.
  if(nativeBridge&&row.kind==="movie"&&(force||!row.movieDetails)&&
     artworkFinder&&navigator.onLine&&(force||networkTitleCount<TITLE_LOOKUP_LIMIT)){
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
     (force||networkTitleCount<TITLE_LOOKUP_LIMIT)){
    networkTitleCount++;
    try{
      const verified=await artworkFinder.episodeTitle(metadataFilename(row));
      if(verified)await store.updateMetadata(row.id,{episodeTitle:verified});
    }catch(_){}
  }
  const cache=await store.artwork(id);
  if(cache?.blob&&!force&&(row.kind!=="movie"||row.movieMetadataVerified||movieResult||!nativeBridge))return cache.blob;
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
    for(let attempt=0;attempt<(row.kind==="movie"&&nativeBridge?2:1);attempt++){
    const result=attempt===0&&movieResult?movieResult:await artworkFinder.find(metadataFilename(row),{excludeProviders:excluded,details:!!nativeBridge&&row.kind==="movie"});
    if(result?.provider)excluded.push(result.provider);
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
        const blob=await findArtwork(task.row,task.id,task.series);
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
function hideContextMenu(){
  contextRow=null;
  const menu=$("libraryContextMenu");
  if(menu)menu.hidden=true;
}
function showContextMenu(row,x,y){
  const menu=$("libraryContextMenu");
  if(!menu||!nativeBridge||!row?.nativePath)return;
  contextRow=row;
  menu.hidden=false;
  menu.style.left=Math.max(4,Math.min(x,
    window.innerWidth-menu.offsetWidth-8))+"px";
  menu.style.top=Math.max(4,Math.min(y,
    window.innerHeight-menu.offsetHeight-8))+"px";
  $("movieDetailsAction").hidden=row.kind!=="movie";
  $("refreshMovieMetadata").hidden=row.kind!=="movie";
  (row.kind==="movie"?$("movieDetailsAction"):$("deleteFromDisk")).focus();
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
  add(say("Genre","Жанр"),data.genres?.join(", "));
  add(say("Runtime","Продолжительность"),data.runtime?data.runtime+say(" min"," мин"):null);
  add(say("Director","Режиссёр"),data.directors?.join(", "));
  add(say("Cast","В ролях"),data.cast?.join(", "));
  add(say("Rating","Рейтинг"),data.rating);
  add(say("Source","Источник"),row.movieProvider==="Cinemeta"?say("Cinemeta","Синемета"):row.movieProvider==="Apple"?say("Apple","Эпл"):row.movieProvider||null);
  $("movieDetailsClose").title=say("Close","Закрыть");
  $("movieDetailsClose").setAttribute("aria-label",say("Close","Закрыть"));
  if(!d.open)d.showModal();
}
async function showMovieDetails(){
  const row=contextRow;hideContextMenu();
  if(row?.kind!=="movie")return;
  displayMovieDetails(await store.item(row.id)||row);
}
async function refreshMovie(){
  const row=contextRow;hideContextMenu();
  if(row?.kind!=="movie")return;
  if(!navigator.onLine){status("Metadata refresh requires an internet connection.","Для обновления данных требуется интернет.",true);return;}
  if(activeArtwork.has(row.id)){status("This movie is already being updated.","Данные фильма уже обновляются.");return;}
  status("Refreshing movie metadata…","Обновление данных фильма…");
  artworkFinder?.clear();
  try{
    await findArtwork(row,row.id,false,true);
    const updated=await store.item(row.id);
    await render();
    if(updated?.movieMetadataVerified){
      status("Movie metadata refreshed where available.","Доступные данные фильма обновлены.");
    }else status("No matching movie metadata found.","Данные фильма не найдены.",true);
  }catch(_){status("Could not refresh movie metadata.","Не удалось обновить данные фильма.",true);}
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
  void render().then(recordNavigation);
}
function recordNavigation(){
  if(nativeBridge?.recordNavigation)void nativeBridge.recordNavigation({mode,series:selectedSeries,season:selectedSeason}).catch(()=>{});
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
  if(nativeBridge)legacyProgressById=recoverLegacyProgress(all);
  const tv=mode==="tv";
  $("tabMovies").setAttribute("aria-selected",String(!tv));
  $("tabTV").setAttribute("aria-selected",String(tv));
  const active=all.filter(x=>x.kind===mode&&!(nativeBridge&&/(?:^|[ ._-])sample(?:[ ._-]|$)/i.test(x.filename)));
  const resume=active.filter(needsContinue).sort((a,b)=>b.lastPlayed-a.lastPlayed)
    .slice(0,30);
  const continueList=$("continueWatching");
  continueList.replaceChildren(...resume.map(row=>createCard(row,{landscape:true})));
  const list=$("libraryCollection");
  const detail=$("seriesDetail");
  detail.hidden=!selectedSeries||!tv;
  let cards=[];
  if(tv&&selectedSeries){
    const rows=active.filter(row=>seriesKey(row.series)===seriesKey(selectedSeries));
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
      const key=seriesKey(row.series||row.title);
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
async function scan(manual=false){
  if(maintaining)return;
  if(scanning){
    controller?.abort();
    if(nativeBridge)void nativeBridge.cancelScan();
    return;
  }
  scanning=true;controller=new AbortController();
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
      if(controller.signal.aborted)return;
      const counts=await store.ingestNative(discovered);
      const merged=await store.reconcileNative();
      await render();
      status((discovered.partial?"Scan incomplete. ":"Scan complete. ")+
        counts.found+" videos found. "+
        counts.added+" added, "+counts.updated+" updated, "+
        counts.missing+" unavailable. "+merged+" duplicate records merged."+
        (discovered.partial?" Some folders could not be searched or scan limits were reached.":""),
        (discovered.partial?"Проверка не завершена. ":"Проверка завершена. ")+
        "Найдено видео: "+counts.found+
        ". Добавлено: "+counts.added+
        ". Обновлено: "+counts.updated+
        ". Недоступно: "+counts.missing+". Объединено записей: "+merged+".",
        discovered.partial);
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
      const merged=await store.reconcileNative();
      const removed=await store.emptyTrash();
      result={busy:false,removed,merged};
      await render();
      status("Empty Trash: "+removed+" unavailable records removed, "+merged+" duplicates merged.",
        "Корзина очищена: удалено записей "+removed+", объединено "+merged+".");
    }else if(action==="refresh"){
      if(!navigator.onLine)throw Error("Offline");
      // Explicit full-library refresh: one item at a time, with a stop
      // command. Retain existing metadata/art when providers fail.
      artworkFinder?.clear();
      const rows=(await store.entries()).filter(row=>!row.missing);
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
  $("movieDetailsAction").addEventListener("click",()=>void showMovieDetails());
  $("refreshMovieMetadata").addEventListener("click",()=>void refreshMovie());
  $("movieDetailsClose").addEventListener("click",()=>$("movieDetailsDialog").close());
  $("movieDetailsDialog").addEventListener("close",()=>{detailMovieId=null;});
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
    const labels=()=>{$("movieDetailsAction").textContent=say("Movie Details","О фильме");$("refreshMovieMetadata").textContent=say("Refresh Metadata","Обновить данные");};
    labels();$("languageSelect").addEventListener("change",()=>queueMicrotask(labels));
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
      void render();
    }else refreshOnReturn();
  });
  document.addEventListener("visibilitychange",refreshOnReturn);
  if(nativeBridge)window.addEventListener("storage",event=>{
    if(event.key!=="dkmedia.web.resume.v1")return;
    if(document.hidden||!document.hasFocus()||scanning||maintaining){
      deferredProgress=true;return;
    }
    clearTimeout(repaintTimer);
    repaintTimer=setTimeout(()=>void render(),260);
  });
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
