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
let cinema=null,homePage=nativeBridge?.internalPages?"home":null,seriesMetadata=new Map(),homeSearchOpen=false;
let homeFilters={query:"",genre:"",year:"",rating:"",watched:"",sort:"title"};
let collectionFilter={kind:"",value:"",query:"",saved:false},collectionTools=null;
let all=[],folders=[],assignedSources=[],visibleCount=72,renderEpoch=0;
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
  document.body.style.setProperty("--dk-library-zoom",String(libraryZoom/100));
  if(persist)try{localStorage.setItem(libraryZoomKey,String(libraryZoom));}catch(_){}
  hideContextMenu();
  requestAnimationFrame(()=>window.dispatchEvent(new Event("resize")));
};
let deferredProgress=false,historyTimer=null,historyRevision=0;
const artAttempted=new Set(),titleAttempted=new Set(),jfChecked=new Map();
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
// Localized display text is never used as a filename, provider match or
// grouping identity. Missing translations fall back to source metadata.
const localized=(record,field,fallback="")=>record?.localizations?.[lang()]?.[field]||fallback;
const localizedRecord=record=>({...record,title:localized(record,"title",record?.title),details:{...record?.details,description:localized(record,"description",record?.details?.description)}});
const localizedSearch=record=>["en","ru"].map(code=>record?.localizations?.[code]?.title).filter(Boolean);
const displaySeriesName=row=>localized(seriesMetadata.get(seriesKey(row.series)),"title",row.series||row.title);
const status=(en,ru=null,error=false)=>{
  const node=$("libraryStatus");
  node.textContent=ru?say(en,ru):en;
  node.classList.toggle("error",error);
  node.classList.toggle("dk-cinema-idle",en==="Library loaded from local cache."&&!error);
};
const nameSort=(a,b)=>String(a).localeCompare(String(b),undefined,{
  numeric:true,sensitivity:"base"
});
const seriesKey=value=>window.DKMediaMetadata?.normalize(value)||String(value||"").trim().toLowerCase();
const formatCode=row=>Number(row.episode)>0?"S"+String(row.season).padStart(2,"0")+"E"+String(row.episode).padStart(2,"0"):say("Unnumbered","Без номера");
const metadataFilename=row=>row.manualClassification||row.verifiedClassification?(row.kind==="movie"?row.title.replace(/[:]/g,"")+(row.year?" ("+row.year+")":"")+".mkv":row.series+"."+formatCode(row)+".mkv"):row.kind==="movie"&&(row.featureClassification||store.knownFeatureSpecial(row.filename,row.relative))?row.title.replace(/[:]/g,"")+" ("+row.year+").mkv":row.kind==="movie"&&Number(row.year)===1974&&
  seriesKey(row.title)==="the man with the golden gun"?"The Man with the Golden Gun (1974).mkv":row.kind==="tv"&&
  window.DKMediaMetadata?.parseFilename?.(row.filename)?.type!=="episode"?
  Number(row.episode)>0?row.series+".S"+String(row.season).padStart(2,"0")+
    "E"+String(row.episode).padStart(2,"0")+
    row.filename.slice(row.filename.lastIndexOf(".")):row.filename:
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
  if(nativeBridge&&Number.isFinite(row.watchedSeconds)&&Number.isFinite(row.position))return Math.max(0,row.position);
  if(Number(row.position)>2)return Number(row.position);
  if(row.watchResetAt)return 0;
  if(nativeBridge)return legacyProgressById.get(row.id)||0;
  const key="file:"+row.filename+":"+row.size+":"+row.modified;
  const value=Number(legacyResume[key]);
  return Number.isFinite(value)?value:0;
}
function needsContinue(row){
  if(row.continueHidden||row.completed)return false;
  const value=currentProgress(row),length=Number(row.duration)||0;
  // Once eligible, a rewind to zero, temporary unavailability or a short
  // decoder duration must not remove an unfinished standalone resume card.
  if(nativeBridge)return Number.isFinite(row.watchedSeconds)?row.watchedSeconds>=10:value>=10;
  return !row.missing&&!row.unavailable&&value>2&&(!length||value<length);
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
  if(!mark){
    mark=create("button","dk-watched-mark");mark.type="button";
    mark.addEventListener("click",async event=>{
      event.preventDefault();event.stopPropagation();
      if(mark.disabled)return;
      const latest=all.find(item=>item.id===card.dataset.libraryId);
      if(!latest)return;
      const targets=card.dataset.displayRole==="series"?seriesRows(latest):[latest];
      if(!targets.length)return;
      const watched=!targets.every(item=>item.completed);
      mark.disabled=true;
      try{await markHistory(targets,watched);}
      finally{mark.disabled=false;}
    });
    box.append(mark);
  }
  mark.textContent=done?"✓":"";
  mark.setAttribute("aria-pressed",String(done));
  mark.title=series?(done?say("Mark Entire Series as Unwatched","Отметить весь сериал непросмотренным"):say("Mark Entire Series as Watched","Отметить весь сериал просмотренным")):(done?say("Mark as Unwatched","Отметить непросмотренным"):say("Mark as Watched","Отметить просмотренным"));
  mark.setAttribute("aria-label",mark.title);
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
  for(const card of document.querySelectorAll("#libraryCollection .library-card,#continueWatching .library-card,#dkCinemaShelves .library-card")){
    const row=map.get(card.dataset.libraryId);
    if(row)paintWatchedCard(card,row,card.dataset.displayRole==="series");
  }
  refreshSeasonWatched();
}
function createCard(row,{landscape=false,series=false}={}){
  // Separate native buttons for playback and watched status. A button
  // inside another button is invalid and can trigger the wrong action.
  const card=create(nativeBridge?"div":"button","library-card"+((row.missing||row.unavailable)?" library-unavailable":""));
  if(!nativeBridge)card.type="button";
  card.dataset.libraryId=row.id;
  card.dataset.displayRole=series?"series":landscape?"resume":"entry";
  const box=coverShell(landscape&&!nativeBridge);
  const title=create("span","library-card-title",
    series?displaySeriesName(row):row.kind==="tv"?
      (landscape?displaySeriesName(row)+" · "+formatCode(row):formatCode(row)):
      (nativeBridge?localized(row,"title",row.title):mediaName(row)));
  const detail=create("span","library-card-detail",
    series?"":row.kind==="tv"?localized(row,"title",row.episodeTitle||""):row.year||"");
  if(row.kind==="movie"&&window.DKCollections){const version=window.DKCollections.edition(row);if(version)detail.textContent=[row.year,editionName(version)].filter(Boolean).join(" · ");}
  if(row.classificationReview||row.kind==="tv"&&!Number(row.episode)&&!series){detail.textContent=[detail.textContent,say("Check classification","Проверить категорию")].filter(Boolean).join(" · ");}
  card.append(box,title,detail);
  if(cinema&&homePage==="home"&&!landscape){card.classList.add("dk-cinema-overlay-card");box.append(title);}
  if(nativeBridge){
    const open=create("button","dk-library-open-card");
    open.type="button";
    const label=series?say("Open series","Открыть сериал"):say("Play video","Воспроизвести видео");
    open.setAttribute("aria-label",label+": "+[title.textContent,detail.textContent].filter(Boolean).join(" · "));
    card.append(open);
  }
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
  if(row.missing||row.unavailable)card.title=say("File unavailable: reconnect its drive",
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
      homePage=null;mode="tv";collectionFilter={kind:"",value:"",query:"",saved:false};
      selectedSeries=row.series;
      selectedSeason=null;
      visibleCount=72;
      void render().then(recordNavigation);
    }else void openVideo(all.find(item=>item.id===row.id)||row);
  });
  // Artwork requests are on-demand and bounded; never fetch every poster
  // or hold all image data in memory when a 25,000-file library opens.
  const posterSeries=series||!!(cinema&&landscape&&row.kind==="tv");
  imageQueue.push({id:artId(row,posterSeries),row,series:posterSeries,box,epoch:renderEpoch});
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
    movieDetails:result.details,movieProvider:result.provider,jellyfinIdentity:result.identity});
  return true;
}
async function jellyfinArtwork(row,id,series,force){
  if(!nativeBridge?.metadataRequest||!row.nativePath||!row.id)return null;
  const url="dk-jellyfin://catalog/item?"+new URLSearchParams({id:row.id,path:row.nativePath,type:row.kind==="movie"?"Movie":"Episode",series:series?"1":"0",force:force?"1":"0"});
  try{
    const response=await nativeBridge.metadataRequest(url,"json");
    if(!response.ok)return null;
    const result=JSON.parse(response.text);
    if(!result?.title)return null;
    if(row.kind==="movie")await saveMovieResult(row,result);
    else if(!series)await store.updateMetadata(row.id,{episodeTitle:result.title,episodeDetails:result.details,jellyfinIdentity:result.identity});
    else await store.saveHierarchyMetadata(artId(row,true),result);
    const image=await nativeBridge.metadataRequest(url,"image");
    if(!image.ok)return null;
    const blob=new Blob([image.bytes],{type:image.mime});
    if(!/^image\/(jpeg|png|webp)$/.test(blob.type)||blob.size>3*1024*1024)return null;
    if(!await store.saveArtwork(id,blob,"Jellyfin"))return (await store.artwork(id))?.blob||null;return blob;
  }catch(_){return null;}
}
async function verifyMediaCategory(row){
 if(!nativeBridge||row.manualClassification||row.manualMatch||row.manualFields||row.missing)return row;
 const parsed=window.DKMediaMetadata?.parseFilename(row.filename);
 if(!parsed||row.featureClassification||store.knownFeatureSpecial(row.filename,row.relative)||row.kind==="tv"&&Number(row.episode)>0||row.kind==="movie"&&parsed.type!=="episode"&&row.movieMetadataVerified&&!row.classificationReview)return row;
 let result=null;
 if(nativeBridge.metadataRequest){
  try{
   const params={id:row.id,path:row.nativePath,title:parsed.type==="episode"?parsed.series:parsed.title,series:parsed.type==="episode"?parsed.series:row.kind==="tv"?row.series:""};
   if(parsed.year)params.year=parsed.year;
   if(parsed.type==="episode"){params.season=parsed.season;params.episode=parsed.episode;}
   result=await jfCall("classification",params);
  }catch(_){}
 }
 if(!result&&navigator.onLine&&artworkFinder?.classifyMedia)result=await artworkFinder.classifyMedia(row.filename,{seriesHint:row.kind==="tv"?row.series:""});
 if(result&&await store.applyVerifiedClassification(row,result))return await store.item(row.id)||row;
 return row;
}
async function findArtwork(row,id,series=false,force=false){
  const cache=await store.artwork(id);
  if(cache?.manual){if(force)await jellyfinArtwork(row,id,series,force);return cache.blob;}
  // A stored poster is usable immediately; missing details cannot invalidate it.
  if(cache?.blob&&!force&&nativeBridge&&(!jfRevision||jfChecked.get(id)===jfRevision))return cache.blob;
  if(jfRevision)jfChecked.set(id,jfRevision);
  if(nativeBridge&&!force&&artAttempted.has(id))return cache?.blob||null;
  if(nativeBridge&&!force)artAttempted.add(id);
  // Local Jellyfin catalog is preferred when explicitly configured. Failure
  // leaves the existing provider pipeline and cached art intact.
  const jellyfin=await jellyfinArtwork(row,id,series,force);
  if(jellyfin)return jellyfin;
  if((await store.item(row.id))?.manualMatch)return cache?.blob||null;
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
      await store.updateMetadata(row.id,{episodeTitle:result.title.trim().slice(0,180)})
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
  $("movieDetailsAction").hidden=false;
  $("movieDetailsAction").textContent=row.kind==="movie"?say("Movie Details","О фильме"):seriesOnly?say("Series Details","О сериале"):say("Episode Details","О серии");
  $("refreshMovieMetadata").hidden=!["movie","tv"].includes(row.kind);
  $("refreshMovieMetadata").disabled=scanning||maintaining;
  $("fixMatch").hidden=!["movie","tv"].includes(row.kind);
  $("fixMatch").disabled=scanning||maintaining;
  $("editLocalMetadata").hidden=false; $("editLocalMetadata").disabled=scanning||maintaining;
  $("chooseArtwork").hidden=false; $("chooseArtwork").disabled=scanning||maintaining;
  $("chooseBackground").hidden=row.kind!=="movie"&&!seriesOnly; $("chooseBackground").disabled=scanning||maintaining; $("chooseBackground").textContent=say("Choose Background","Выбрать фон");
  $("reclassifyMedia").hidden=seriesOnly; $("reclassifyMedia").disabled=scanning||maintaining;
  $("reclassifyMedia").textContent=row.kind==="tv"?say("Move to Movies","Перенести в фильмы"):say("Move to TV Shows","Перенести в сериалы");
  $("removeContinueWatching").hidden=seriesOnly||!fromContinue;
  $("removeFromLibrary").hidden=seriesOnly;
  $("showInFolder").hidden=seriesOnly||!nativeBridge.showInFolder;
  $("showInFolder").disabled=!!(row.missing||row.unavailable);
  $("locateFile").hidden=seriesOnly||!nativeBridge.locateFile;
  menu.hidden=false;
  const scale=nativeBridge?.internalPages?libraryZoom/100:1;
  menu.style.left=Math.max(4,Math.min(x/scale,
    window.innerWidth/scale-menu.offsetWidth-8))+"px";
  menu.style.top=Math.max(4,Math.min(y/scale,
    window.innerHeight/scale-menu.offsetHeight-8))+"px";
  (seriesOnly?watch:row.kind==="movie"?$("movieDetailsAction"):!$("showInFolder").hidden&&!$("showInFolder").disabled?$("showInFolder"):$("deleteFromDisk")).focus();
}
const creditRole=type=>({Actor:say("Actor","Актёр"),Director:say("Director","Режиссёр"),Writer:say("Writer","Сценарист"),Producer:say("Producer","Продюсер"),GuestStar:say("Guest star","Приглашённый актёр"),Composer:say("Composer","Композитор"),ExecutiveProducer:say("Executive producer","Исполнительный продюсер"),VoiceActor:say("Voice actor","Актёр озвучивания"),Lyricist:say("Lyricist","Автор текста"),Conductor:say("Conductor","Дирижёр"),Arranger:say("Arranger","Аранжировщик"),Sound:say("Sound","Звук"),Unknown:say("Crew","Съёмочная группа")}[type]||say("Crew","Съёмочная группа"));
const creditParams=(row,scope)=>({id:row.id,path:row.nativePath,type:row.kind==="movie"?"Movie":"Episode",scope});
const personPhotoPending=new Map(),personProfilePending=new Map();
const personCacheAge=7*86400000,personPhotoAge=30*86400000;
const cachedPersonMatches=(cached,person)=>cached&&seriesKey(cached.name)===seriesKey(person.name);
async function creditImage(row,scope,person,force=false){
 if(!person?.id||!person.name)return null;
 let cached=null;
 try{cached=await store.personCache(person.id,"photo");}catch(_){}
 if(!cachedPersonMatches(cached,person))cached=null;
 if(cached?.blob&&!force&&Date.now()-cached.updatedAt<personPhotoAge)return cached.blob;
 const key=person.id+":"+seriesKey(person.name);
 if(personPhotoPending.has(key))return personPhotoPending.get(key);
 const work=(async()=>{
  try{
   const url="dk-jellyfin://catalog/person-image?"+new URLSearchParams({...creditParams(row,scope),person:person.id});
   const response=await nativeBridge.metadataRequest(url,"image");
   if(!response.ok||!/^image\/(jpeg|png|webp)$/.test(response.mime))return cached?.blob||null;
   const blob=new Blob([response.bytes],{type:response.mime});
   try{await store.savePersonCache(person.id,"photo",person.name,blob);}catch(_){}
   return blob;
  }catch(_){return cached?.blob||null;}
 })().finally(()=>personPhotoPending.delete(key));
 personPhotoPending.set(key,work);return work;
}
async function getPersonProfile(row,scope,person,force=false){
 let cached=null;
 try{cached=await store.personCache(person.id,"profile");}catch(_){}
 if(!cachedPersonMatches(cached,person))cached=null;
 if(cached?.record&&!force&&Date.now()-cached.updatedAt<personCacheAge)return {data:cached.record,cached:true,stale:false,updatedAt:cached.updatedAt};
 const key=person.id+":"+seriesKey(person.name);
 if(personProfilePending.has(key))return personProfilePending.get(key);
 const work=(async()=>{
  try{
   const data=await jfCall("person",{...creditParams(row,scope),person:person.id});
   if(!data?.name)throw Error("Invalid profile");
   try{await store.savePersonCache(person.id,"profile",person.name,data);}catch(_){}
   return {data,cached:false,stale:false,updatedAt:Date.now()};
  }catch(error){if(cached?.record)return {data:cached.record,cached:true,stale:true,updatedAt:cached.updatedAt};throw error;}
 })().finally(()=>personProfilePending.delete(key));
 personProfilePending.set(key,work);return work;
}
async function showPersonProfile(row,scope,credit){
 const {dialog,message,close}=localEditDialog(credit.name);
 const image=create("img","dk-person-photo");image.alt="";image.hidden=true;
 const role=create("p",null,[creditRole(credit.type),credit.role].filter(Boolean).join(" · "));
 const facts=create("dl"),bio=create("p","dk-person-biography"),heading=create("h3",null,say("In your library","В вашей медиатеке")),titles=create("div","dk-person-titles");
 const refresh=cinemaButton("Refresh Profile","Обновить сведения",()=>void load(true));
 let objectURL=null,epoch=0;
 dialog.addEventListener("close",()=>{epoch++;if(objectURL)URL.revokeObjectURL(objectURL);});
 dialog.append(image,role,facts,bio,heading,titles,message,refresh,close);dialog.showModal();
 async function load(force=false){
  const revision=++epoch,valid=()=>dialog.open&&revision===epoch;
  refresh.disabled=true;message.textContent=say("Loading profile…","Загрузка сведений…");
  void (async()=>{try{const blob=await creditImage(row,scope,credit,force);if(blob&&valid()){if(objectURL)URL.revokeObjectURL(objectURL);objectURL=URL.createObjectURL(blob);image.src=objectURL;image.hidden=false;}}catch(_){}})();
  try{
   const {data,cached,stale,updatedAt}=await getPersonProfile(row,scope,credit,force);
   if(!valid())return;
   facts.replaceChildren();titles.replaceChildren();
   const add=(label,value)=>{if(value)facts.append(create("dt",null,label),create("dd",null,String(value)));};
   const date=value=>{if(!value)return "";const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(lang(),{dateStyle:"long",timeZone:"UTC"}).format(d):"";};
   add(say("Born","Дата рождения"),date(data.born));add(say("Died","Дата смерти"),date(data.died));add(say("Locations","Места"),data.locations?.join(", "));
   bio.textContent=data.biography||say("No biography available.","Биография недоступна.");
   // Reconcile cached filmographies against today's catalog, not removed
   // paths or unrelated server titles. Link verified matches to details.
   const owned=new Map();
   for(const r of all){const id=r.kind==="movie"?r.jellyfinIdentity?.itemId:r.jellyfinIdentity?.seriesId;if(id&&!owned.has(id)&&cinemaEligible(r))owned.set(id,r);}
   const credited=new Set();
   for(const title of data.filmography||[]){
    const local=owned.get(title.id);if(!local||credited.has(title.id))continue;credited.add(title.id);
    const item=create("div","dk-person-title");
    const open=cinemaButton(cinemaTitle(local),cinemaTitle(local),()=>{dialog.close();contextRow=local;contextSeries=local.kind==="tv";void showMovieDetails();},"btn small");
    item.append(open,create("span","helper",String(title.year||"")));
    const roles=(title.roles||[]).map(p=>[creditRole(p.type),p.role].filter(Boolean).join(" · ")).join("; ");
    if(roles)item.append(create("span","helper",roles));titles.append(item);
   }
   if(!titles.children.length)titles.append(create("p","helper",data.filmographyAvailable?say("No matching indexed titles.","Нет совпадающих проиндексированных записей."):say("Library credits unavailable.","Сведения о работах в медиатеке недоступны.")));
   const messages=[];if(cached)messages.push((stale?say("Offline/stale profile saved on ","Устаревшие сохранённые сведения от "):say("Cached profile saved on ","Сведения сохранены "))+date(updatedAt));
   if(data.limited)messages.push(say("Some library results may be omitted.","Некоторые записи медиатеки могут быть пропущены."));
   message.textContent=messages.join(" · ");
  }catch(_){if(valid())message.textContent=say("Profile unavailable from the metadata engine.","Сведения недоступны в службе метаданных.");}
  finally{if(valid())refresh.disabled=false;}
 }
 void load();
}
function personCreditsPanel(dialog,row,scope,people=[]){
  const panel=create("section","dk-person-credits");
  const heading=create("h3",null,say("Cast and Crew","Актёры и съёмочная группа"));
  const status=create("p","helper");status.setAttribute("role","status");
  const grid=create("div","dk-person-grid");
  const refresh=create("button","btn",say("Load cast and crew","Загрузить актёров и съёмочную группу"));refresh.type="button";
  const more=create("button","btn",say("Show more","Показать ещё"));more.type="button";more.hidden=true;
  let credits=[],shown=0,epoch=0,urls=[],closed=false;
  const clear=()=>{epoch++;for(const url of urls)URL.revokeObjectURL(url);urls=[];grid.replaceChildren();shown=0;};
  const cleanup=()=>{closed=true;clear();};
  dialog.addEventListener("close",cleanup,{once:true});
  function append(){
    const revision=epoch,entries=credits.slice(shown,shown+20),images=[];
    shown+=entries.length;
    for(const person of entries){
      const card=create("button","btn dk-person-card");card.type="button";
      const img=create("img");img.alt="";img.hidden=true;
      card.append(img,create("strong",null,person.name),create("span",null,[creditRole(person.type),person.role].filter(Boolean).join(" · ")));
      card.addEventListener("click",()=>void showPersonProfile(row,scope,person));grid.append(card);
      if(person.hasImage)images.push({person,img});
    }
    more.hidden=shown>=credits.length;
    void (async()=>{for(const {person,img} of images){
      if(closed||!dialog.open||!panel.isConnected||epoch!==revision)break;
      try{const blob=await creditImage(row,scope,person);if(!blob||closed||!dialog.open||!panel.isConnected||epoch!==revision)continue;const u=URL.createObjectURL(blob);urls.push(u);img.src=u;img.hidden=false;}catch(_){}
    }})();
  }
  function show(values){
    clear();credits=Array.isArray(values)?values.filter(x=>x?.id&&x.name):[];
    status.textContent=credits.length?"":say("No person records available.","Сведения об участниках недоступны.");
    append();
  }
  refresh.addEventListener("click",async()=>{
    refresh.disabled=true;status.textContent=say("Loading credits…","Загрузка сведений об участниках…");
    try{const data=await jfCall("item",{...creditParams(row,scope),force:"1"});if(!closed&&panel.isConnected)show(data.details?.people);}
    catch(_){if(!closed)status.textContent=say("Credits unavailable from the metadata engine.","Сведения недоступны в службе метаданных.");}
    finally{refresh.disabled=false;}
  });
  more.addEventListener("click",append);
  panel.append(heading,refresh,status,grid,more);
  // Start only after the caller attaches the panel and opens its dialog.
  queueMicrotask(()=>{if(panel.isConnected&&dialog.open)show(people);});
  panel.dispose=cleanup;return panel;
}

let detailMovieId=null;
// Backdrops use separate cache keys and never overwrite card posters.
const backdropKey=(row,scope)=>"backdrop:"+(scope==="series"?artId(row,true):row.id);
const backdropAttempts=new Set(),backdropPending=new Map(),backdropViews=new WeakMap();
function clearBackdrop(node){
 const view=backdropViews.get(node);if(view?.url)URL.revokeObjectURL(view.url);
 backdropViews.delete(node);node.style.removeProperty("--dk-detail-backdrop");node.classList.remove("dk-has-detail-backdrop");
}
async function paintBackdrop(node,row,scope){
 if(!node||!row||!nativeBridge)return;
 const id=backdropKey(row,scope),prior=backdropViews.get(node);
 if(prior?.id===id&&(prior.url||prior.loading||backdropAttempts.has(id)))return;
 clearBackdrop(node);const view={id,url:null,loading:true};backdropViews.set(node,view);
 try{
  let art=await store.artwork(id);
  if(!art?.blob&&!backdropAttempts.has(id)&&nativeBridge.metadataRequest){
   backdropAttempts.add(id);
   const pending=(async()=>{
    try{const r=await nativeBridge.metadataRequest("dk-jellyfin://catalog/item?"+new URLSearchParams({id:row.id,path:row.nativePath,type:row.kind==="movie"?"Movie":"Episode",scope,image:"Backdrop"}),"image");
     if(r.ok&&/^image\/(jpeg|png|webp)$/.test(r.mime)){const blob=new Blob([r.bytes],{type:r.mime});await store.saveArtwork(id,blob,"Jellyfin");}}
    catch(_){}
   })();backdropPending.set(id,pending);await pending;backdropPending.delete(id);
  }else if(backdropPending.has(id))await backdropPending.get(id);
  art=await store.artwork(id);
  if(backdropViews.get(node)!==view||!node.isConnected||!art?.blob)return;
  view.url=URL.createObjectURL(art.blob);node.style.setProperty("--dk-detail-backdrop",'url("'+view.url+'")');node.classList.add("dk-has-detail-backdrop");
 }catch(_){}finally{view.loading=false;}
}
function invalidateBackdrop(id){
 backdropAttempts.delete(id);
 for(const node of [$("movieDetailsDialog"),$("seriesDetail")])if(node&&backdropViews.get(node)?.id===id)clearBackdrop(node);
}
function displayMovieDetails(row){
  const d=$("movieDetailsDialog");
  const data=row.movieDetails||{};
  detailMovieId=row.id;
  $("movieDetailsTitle").textContent=localized(row,"title",row.title)+(row.year?" ("+row.year+")":"");
  $("movieDetailsDescription").textContent=localized(row,"description",data.description)||say("No description available.","Описание недоступно.");
  const list=$("movieDetailsFields");list.replaceChildren();
  const add=(label,value)=>{if(value){list.append(create("dt",null,label),create("dd",null,value));}};
  const addLinks=(label,kind,values)=>{
    if(!window.DKCollections||!Array.isArray(values)||!values.length){add(label,values?.join(", "));return;}
    const dd=create("dd","dk-facet-links");for(const value of values){const b=create("button","btn small",value);b.type="button";b.addEventListener("click",()=>{d.close();window.DKLiveTV?.close();homePage=null;mode="movie";selectedSeries=null;selectedSeason=null;collectionFilter={kind,value,query:"",saved:false};visibleCount=72;void render();});dd.append(b);}list.append(create("dt",null,label),dd);
  };
  addLinks(say("Genre","Жанр"),"genre",data.genres);
  add(say("Runtime","Продолжительность"),data.runtime?data.runtime+say(" min"," мин"):null);
  addLinks(say("Director","Режиссёр"),"director",data.directors);
  addLinks(say("Cast","В ролях"),"actor",data.cast);
  add(say("Rating","Рейтинг"),data.rating);
  add(say("Original title","Оригинальное название"),data.originalTitle);
  add(say("Alternative titles","Другие названия"),data.alternativeTitles?.join(", "));
  add(say("Studios","Студии"),data.studios?.join(", "));
  add(say("Countries","Страны"),data.countries?.join(", "));
  add(say("Release date","Дата выпуска"),data.releaseDate);
  add(say("Age rating","Возрастной рейтинг"),data.officialRating);

  add(say("Source","Источник"),row.movieProvider==="Cinemeta"?say("Cinemeta","Синемета"):row.movieProvider==="Apple"?say("Apple","Эпл"):row.movieProvider||null);
  $("movieDetailsClose").title=say("Close","Закрыть");
  $("movieDetailsClose").setAttribute("aria-label",say("Close","Закрыть"));
  if(!d.open)d.showModal();
  void paintBackdrop(d,row,"item");
  const previous=d.querySelector(".dk-person-credits");
  const key=row.id+":"+JSON.stringify(data.people||[]);
  if(!previous||previous.dataset.creditKey!==key){
    if(previous){previous.dispose?.();previous.remove();}
    const panel=personCreditsPanel(d,row,"item",data.people);panel.dataset.creditKey=key;list.after(panel);
  }
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
  const row=contextRow,series=contextSeries;hideContextMenu();
  if(!row)return;
  if(row.kind==="tv"){await showTVDetails(row,series?"series":"item");return;}
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
async function refreshSelection(){
  const row=contextRow,series=contextSeries;hideContextMenu();
  if(!row||!["movie","tv"].includes(row.kind))return;
  if(scanning||maintaining)return status("Stop the current library operation first.","Сначала остановите текущую операцию.",true);
  if(!navigator.onLine)return status("Metadata refresh requires an internet connection.","Для обновления данных требуется интернет.",true);
  await libraryMaintenance("refresh",{row,series});
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
    // Update only history indicators unless an active filter requires
    // rebuilding the collection. Do not reload posters on each click.
    if(watchedFilter)await render();
    else{
      const ids=new Set(rows.map(row=>row.id));
      const latest=new Map((await store.entries()).filter(row=>ids.has(row.id)).map(row=>[row.id,row]));
      all=all.map(row=>latest.get(row.id)||row);
      paintContinueWatching();refreshWatchedCards();
    }
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
let recoveringFile=false;
async function recoverFile(row,manual=false){
 if(recoveringFile||!row?.nativePath||!nativeBridge?.playbackAvailability)return null;
 recoveringFile=true;
 try{
  const latest=await store.item(row.id);if(!latest)return null;row=latest;
  if(await nativeBridge.playbackAvailability(row.id,row.nativePath)){
    if(row.missing||row.unavailable){row=await store.setUnavailable(row.id,false);await render();}
    return row;
  }
  row=await store.setUnavailable(row.id,true);await render();if(!row)return null;
  // No implicit scans, even on missing-file playback. Use Scan Library.
  if(manual){
   const file=await nativeBridge.locateFile(document.documentElement.lang);if(!file)return null;
   if(file.id===row.id){await store.setUnavailable(row.id,false);await render();return store.item(row.id);}
   if(!confirm(say("Use this file for "+row.title+"? Watch history will be transferred to the selected file.","Использовать выбранный файл для этой записи? История просмотра будет перенесена.")))return null;
   const updated=await store.relocateNative(row,file);if(updated){await render();status("File location updated. History restored.","Расположение файла обновлено. История восстановлена.");return updated;}
  }
  status("File unavailable. Right-click its card and choose Locate File.","Файл недоступен. Откройте контекстное меню карточки и выберите поиск файла.",true);
  return null;
 }catch(_){status("Could not recover the video. Reconnect the drive or use Locate File.","Не удалось восстановить видео. Подключите накопитель или найдите файл вручную.",true);return null;}
 finally{recoveringFile=false;}
}
async function openVideo(row){
  if(row.source==="native"&&nativeBridge?.playbackAvailability){row=await recoverFile(row);if(!row)return;}
  if(row.missing||row.unavailable){
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
  homePage=null;
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
  const candidates=all.filter(row=>(homePage==="home"||row.kind===mode)&&!(nativeBridge&&/(?:^|[ ._-])sample(?:[ ._-]|$)/i.test(row.filename))&&needsContinue(row))
    .sort((a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0));
  const rows=nativeBridge?candidates:candidates.slice(0,30);
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
    card.classList.toggle("library-unavailable",!!(row.missing||row.unavailable));
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
  if(cinema){await readSeriesMetadata(epoch);if(epoch!==renderEpoch)return;syncCinema();if(homePage){if(homePage==="collections")renderCollections();else renderHome();pumpArtwork();return;}}
  $("tabMovies").setAttribute("aria-selected",String(!tv));
  $("tabTV").setAttribute("aria-selected",String(tv));
  window.DKLiveTV?.syncTabs();
  const unfiltered=all.filter(x=>x.kind===mode&&!(nativeBridge&&/(?:^|[ ._-])sample(?:[ ._-]|$)/i.test(x.filename)));
  syncCollectionTools(unfiltered,tv);
  const baseActive=window.DKCollections?window.DKCollections.filter(unfiltered,collectionFilter.kind,collectionFilter.value,collectionFilter.query,collectionFilter.saved):unfiltered;
  const activeBase=nativeBridge&&watchedFilter?baseActive.filter(row=>historyBucket(row)===watchedFilter):baseActive;
  const active=cinema?sortCinema(activeBase.filter(matchesCinema)):activeBase;
  $("watchedFilter").hidden=!nativeBridge;
  $("watchedFilter").value=watchedFilter;
  const resumeCandidates=unfiltered.filter(needsContinue).sort((a,b)=>b.lastPlayed-a.lastPlayed);
  const resume=nativeBridge?resumeCandidates:resumeCandidates.slice(0,30);
  const continueList=$("continueWatching");
  continueList.replaceChildren(...resume.map(row=>createCard(row,{landscape:true})));
  const list=$("libraryCollection");
  const detail=$("seriesDetail");
  detail.hidden=!selectedSeries||!tv;
  if(detail.hidden)clearBackdrop(detail);
  list.classList.toggle("dk-cinema-episodes",!!(tv&&selectedSeries));
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
    $("tvMetadataActions").hidden=!nativeBridge;
    $("seriesBackground").textContent=say("Series Background","Фон сериала");
    void displayHierarchy();
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
    cards=cinema?sortCinema([...series.values()]):[...series.values()].sort((a,b)=>nameSort(a.series,b.series));
    $("collectionTitle").textContent=
      say("Your Entire TV Collection","Вся коллекция сериалов");
  }else{
    cards=cinema&&homeFilters.sort!=="title"?sortCinema(active):active.sort((a,b)=>collectionFilter.kind==="collection"?(Number(a.year)||9999)-(Number(b.year)||9999)||nameSort(a.title,b.title):nameSort(a.title,b.title));
    $("collectionTitle").textContent=
      say("Your Entire Movie Collection","Вся коллекция фильмов");
  }
  if(collectionFilter.saved)$("collectionTitle").textContent=say("Watchlist","Список просмотра");
  $("collectionCount").textContent=say(cards.length+" "+(cards.length===1?"title":"titles"),cards.length+" наименований");
  $("emptyLibrary").hidden=unfiltered.length>0;
  if(nativeBridge){
    $("addLibraryFolder").hidden=false;
    $("addFirstFolder").hidden=false;
    $("addLibraryFolder").textContent=say("Add Folder","Добавить папку");
    const empty=$("emptyLibrary");
    const heading=empty?.querySelector("h3");
    const info=empty?.querySelector("p");
    if(heading)heading.textContent=say("No movies or TV shows discovered yet",
      "Фильмы и сериалы пока не найдены");
    if(info)info.textContent=say(
      "Assign Movies and TV Shows folders, then select Scan Library. Only those folders will be searched.",
      "Выберите папки фильмов и сериалов, затем запустите проверку. Поиск выполняется только в выбранных папках.");
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
    say("Assigned folders: "+assignedSources.length+" · Manual scans only","Выбранные папки: "+assignedSources.length+" · Только ручная проверка"):
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
      assignedSources=await nativeBridge.librarySources();
      await store.applyNativeScope(assignedSources);
      if(!assignedSources.length){await render();status("Add a Movies or TV Shows folder before scanning.","Добавьте папку фильмов или сериалов перед проверкой.");return;}
      stopListening=nativeBridge.onScanProgress(progress=>{
        status("Scanning assigned folders: "+progress.found+" videos found…",
          "Проверка выбранных папок: найдено видео "+progress.found+"…");
      });
      const discovered=await nativeBridge.discover(manual);
      // Cancellation retains successfully discovered records. Never mark
      // unseen records missing after an interrupted or errored scan.
      let cancelled=!!discovered.cancelled||controller.signal.aborted;
      const counts=await store.ingestNative(cancelled?{...discovered,complete:false}:discovered);
      const merged=cancelled?0:await store.reconcileNative();
      if(!cancelled){
        const candidates=(await store.entries()).filter(row=>row.source==="native"&&!store.excludedDiscovery(row)&&!row.missing&&!row.manualClassification&&!row.manualMatch&&!row.manualFields&&!row.verifiedClassification&&(row.kind==="tv"&&!Number(row.episode)||row.kind==="movie"&&window.DKMediaMetadata?.parseFilename(row.filename)?.type==="episode"));
        for(let i=0;i<candidates.length&&!controller.signal.aborted;i++){
          status("Checking media categories: "+(i+1)+" / "+candidates.length,"Проверка категорий: "+(i+1)+" / "+candidates.length);
          try{await verifyMediaCategory(candidates[i]);}catch(_){}
        }
      }
      cancelled=cancelled||controller.signal.aborted;
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
async function openLibraryManagement(){
 if(scanning||maintaining||recoveringFile)return status("Stop the current library operation first.","Сначала остановите текущую операцию.",true);
 const dlg=create("dialog","dk-collection-dialog dk-library-management"),body=create("div","dk-library-management-body"),feedback=create("p","helper"),close=create("button","btn",say("Close","Закрыть"));
 close.type="button";close.addEventListener("click",()=>dlg.close());dlg.append(create("h2",null,say("Library Management","Управление медиатекой")),body,feedback,close);document.body.append(dlg);
 dlg.addEventListener("close",()=>dlg.remove(),{once:true});let busy=false;
 const action=async(fn)=>{if(busy||scanning||maintaining||recoveringFile)return;busy=true;body.inert=true;close.disabled=true;try{await fn();await render();if(dlg.open)draw();}catch(_){feedback.textContent=say("Operation failed. Check folder access and overlapping paths.","Операция не выполнена. Проверьте доступ к папкам и пересечения путей.");}finally{busy=false;body.inert=false;close.disabled=false;}};
 const button=(en,ru,fn,style="")=>{const b=create("button","btn "+style,say(en,ru));b.type="button";b.addEventListener("click",()=>void action(fn));return b;};
 const reset=async(kind,keep)=>{
  if(!confirm(say("Clear the selected library catalog? Video files will not be deleted. "+(keep?"Keep viewing history.":"Erase viewing history."),"Очистить выбранную медиатеку? Видеофайлы не будут удалены. "+(keep?"Сохранить историю просмотров.":"Удалить историю просмотров."))))return;
  const removed=await store.resetNativeLibrary(kind,keep);
  if(!keep){try{
   const resume=JSON.parse(localStorage.getItem("dkmedia.web.resume.v1")||"{}");
   const fingerprints=new Map(removed.map(row=>["file:"+row.filename+":"+row.size,row.modified]));
   for(const key of Object.keys(resume)){const split=key.lastIndexOf(":");if(kind==="all"||fingerprints.has(key.slice(0,split))&&Math.abs(Number(key.slice(split+1))-Number(fingerprints.get(key.slice(0,split))))<=1)delete resume[key];}
   localStorage.setItem("dkmedia.web.resume.v1",JSON.stringify(resume));
   localStorage.setItem("dk-kinehall.library-reset.v1",JSON.stringify({kind,ids:removed.map(r=>r.id),time:Date.now()}));
  }catch(_){}}
  selectedSeries=null;selectedSeason=null;visibleCount=72;artAttempted.clear();titleAttempted.clear();
  feedback.textContent=say("Library cleared. Files and folder assignments unchanged. Scan when ready.","Медиатека очищена. Файлы и выбранные папки не изменены. Запустите проверку при необходимости.");
 };
 let preserve=true;
 function draw(){
  body.replaceChildren();
  body.append(create("p","helper",say("Device-wide discovery disabled. Only assigned folders are scanned, on request.","Поиск по всему устройству отключён. Проверяются только выбранные папки по запросу.")));
  const keep=create("label","dk-collection-membership"),check=create("input");check.type="checkbox";check.checked=preserve;check.addEventListener("change",()=>{preserve=check.checked;});keep.append(check,create("span",null,say("Keep viewing history when clearing","Сохранять историю просмотров при очистке")));body.append(keep);
  for(const [kind,en,ru] of [["movie","Movies","Фильмы"],["tv","TV Shows","Сериалы"]]){
   const group=create("section","dk-library-source-group "+kind);group.append(create("strong",null,say(en,ru)));
   const rows=assignedSources.filter(r=>r.kind===kind);
   if(!rows.length)group.append(create("p","helper",say("No folders assigned","Папки не выбраны")));
   for(const row of rows){
    const line=create("div","dk-library-source-row");line.append(create("span",null,row.path),button("Remove","Удалить",async()=>{if(!confirm(say("Remove this folder from the library? Files stay on disk.","Убрать папку из медиатеки? Файлы останутся на диске.")))return;assignedSources=await nativeBridge.removeLibrarySource(row.id);await store.applyNativeScope(assignedSources);},"dk-source-brown"));group.append(line);
   }
   group.append(button("+ Add Folder","+ Добавить папку",async()=>{assignedSources=await nativeBridge.addLibrarySource(kind,lang());await store.applyNativeScope(assignedSources);},"dk-source-brown"),button(kind==="movie"?"Clear Movies":"Clear TV Shows",kind==="movie"?"Очистить фильмы":"Очистить сериалы",()=>reset(kind,preserve),"dk-source-red"));body.append(group);
  }
  body.append(button("Reset Entire Library","Очистить всю медиатеку",()=>reset("all",preserve),"dk-source-red"));
  const scanButton=create("button","btn dk-scan",say("Scan Library","Проверить медиатеку"));scanButton.type="button";scanButton.addEventListener("click",()=>{if(busy)return;dlg.close();void scan(true);});body.append(scanButton);
 }
 try{assignedSources=await nativeBridge.librarySources();draw();dlg.showModal();}catch(_){dlg.remove();status("Could not open Library Management.","Не удалось открыть управление медиатекой.",true);}
}
async function chooseFolder(){
  if(scanning||maintaining)return;
  if(nativeBridge?.addLibrarySource){
    try{assignedSources=await nativeBridge.addLibrarySource(mode,lang());await store.applyNativeScope(assignedSources);await render();status("Folders saved. Select Scan Library when ready.","Папки сохранены. Запустите проверку медиатеки.");}catch(_){status("Could not add folder. Library folders must not overlap.","Не удалось добавить папку. Папки не должны пересекаться.",true);}return;
  }
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
async function libraryMaintenance(action,selection=null){
  if(maintaining){if(action==="refresh"&&!selection)refreshCancelled=true;return;}
  if(scanning)return;
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
      const entries=(await store.entries()).filter(row=>!row.userHidden&&!store.excludedDiscovery?.(row));
      const rows=selection?entries.filter(row=>selection.series?row.kind==="tv"&&seriesKey(row.series)===seriesKey(selection.row.series):row.id===selection.row.id):entries.filter(row=>!row.missing);
      const tasks=rows.map(row=>({row,series:false,id:artId(row)}));
      const seen=new Set();
      for(const row of rows){
        if(row.kind!=="tv"||(selection&&!selection.series))continue;
        const id=artId(row,true);
        if(!seen.has(id)){seen.add(id);tasks.push({row,series:true,id});}
      }
      let done=0;
      await send({busy:true,done,total:tasks.length});
      if(!tasks.length){status("No matching library records to refresh.","Нет записей для обновления.",true);return;}
      for(const task of tasks){
        if(refreshCancelled)break;
        try{
          // Wait for any earlier background lookup to finish before forcing a new one.
          while(activeArtwork.has(task.id)&&!refreshCancelled)await new Promise(resolve=>setTimeout(resolve,80));
          if(refreshCancelled)break;
          const current=await store.item(task.row.id)||task.row;
          const classified=task.series?current:await verifyMediaCategory(current);
          if(!task.series||classified.kind==="tv")await findArtwork(classified,artId(classified,task.series),task.series,true);
        }catch(_){}
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
let jfLast=null,jfPollBusy=false,jfPowerBusy=false,jfRevision=0;
let openCinemaSettings=null;
async function jfCall(route,params={}){
  const r=await nativeBridge.metadataRequest("dk-jellyfin://catalog/"+route+"?"+new URLSearchParams(params),"json");
  if(!r.ok)throw Error("Jellyfin unavailable");return JSON.parse(r.text);
}
function paintJellyfinState(data){
 const controls=$("jellyfinServerControls"),button=$("jellyfinPower"),light=$("jellyfinStatusLight"),node=$("jellyfinScanStatus");
 if(!controls||!button||!light||!node)return;
 const messages={off:say("Server off","Сервер выключен"),starting:say("Starting server…","Запуск сервера…"),stopping:say("Stopping server…","Остановка сервера…"),scanning:say("Server running · Scanning library","Сервер работает · Сканирование медиатеки"),ready:say("Server running","Сервер работает"),external:say("External server configured (read only)","Настроен внешний сервер (только чтение)"),unavailable:say("Server unavailable · Fallback metadata","Сервер недоступен · Резервные метаданные"),unknown:say("Server status unknown","Состояние сервера неизвестно")};
 controls.hidden=false;light.dataset.state=data.state;node.textContent=(messages[data.state]||messages.unknown)+(data.state==="scanning"&&data.progress!=null?" "+Math.round(data.progress)+"%":"");
 light.title=node.textContent;light.setAttribute("aria-label",node.textContent);
 const shortcut=$("dkSidebarServer"),lamp=$("dkSidebarServerLight");
 if(lamp){lamp.dataset.state=data.state;lamp.title=node.textContent;}
 if(shortcut){shortcut.title=node.textContent;shortcut.setAttribute("aria-label",say("Server Settings","Настройки сервера")+" · "+node.textContent);}
 button.textContent=data.enabled&&(data.state!=="unavailable"||data.runningProcess)?say("Stop Server","Остановить сервер"):say("Start Server","Запустить сервер");
 button.title=button.textContent+" · "+node.textContent;button.setAttribute("aria-label",button.title);
 button.disabled=jfPowerBusy||!data.controllable||!nativeBridge?.jellyfinPower;
}
async function toggleJellyfinPower(){
 if(jfPowerBusy||!jfLast?.controllable||!nativeBridge?.jellyfinPower)return;
 const enabled=!(jfLast.enabled&&(jfLast.state!=="unavailable"||jfLast.runningProcess));
 jfPowerBusy=true;paintJellyfinState(jfLast);
 try{await nativeBridge.jellyfinPower(enabled);}catch(_){status("Could not change server power.","Не удалось изменить состояние сервера.",true);}
 finally{jfPowerBusy=false;await pollJellyfin();}
}
async function pollJellyfin(){
  if(jfPollBusy||document.hidden||!nativeBridge?.metadataRequest)return;
  jfPollBusy=true;
  try{
    const data=await jfCall("status");paintJellyfinState(data);
    const completed=data.state==="ready"&&jfLast&&(jfLast.state!=="ready"||data.completed!==jfLast.completed);
    jfLast=data;
    if(completed&&!scanning&&!maintaining){
      jfRevision++;backdropAttempts.clear();artAttempted.clear();titleAttempted.clear();networkArtworkCount=0;networkTitleCount=0;
      void render();
    }
  }catch(_){paintJellyfinState({state:"unknown",enabled:false,controllable:false});}finally{jfPollBusy=false;}
}
async function showFixMatch(){
  const row=contextRow;hideContextMenu();if(!row||!nativeBridge?.metadataRequest)return;
  const dialog=document.createElement("dialog");dialog.className="dk-movie-details dk-fix-match";
  const title=create("h2",null,say("Fix Match","Исправить совпадение"));
  const form=document.createElement("form"),name=document.createElement("input"),year=document.createElement("input");
  name.type="text";name.required=true;name.maxLength=160;name.value=row.kind==="movie"?row.title:row.series;
  year.type="number";year.min="1800";year.max="2100";year.placeholder=say("Year (optional)","Год (необязательно)");if(row.kind==="movie"&&row.year)year.value=row.year;
  name.setAttribute("aria-label",say("Title","Название"));year.setAttribute("aria-label",say("Year","Год"));
  const search=create("button","btn",say("Search","Поиск"));search.type="submit";
  const close=create("button","btn",say("Close","Закрыть"));close.type="button";
  const message=create("p","helper",say("Search the metadata engine and choose the correct title. For TV, this changes the entire series.","Найдите правильное название. Для телесериала изменяется весь сериал."));
  message.setAttribute("role","status");
  const results=create("div","dk-fix-match-results");let busy=false;
  const params={id:row.id,path:row.nativePath,type:row.kind==="movie"?"Movie":"Series"};
  const setBusy=value=>{busy=value;search.disabled=value;close.disabled=value;name.disabled=value;year.disabled=value;for(const button of results.querySelectorAll("button"))button.disabled=value;};
  close.addEventListener("click",()=>{if(!busy)dialog.close();});
  dialog.addEventListener("cancel",event=>{if(busy)event.preventDefault();});
  dialog.addEventListener("close",()=>dialog.remove());
  form.append(name,year,search,close);dialog.append(title,form,message,results);document.body.append(dialog);dialog.showModal();
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(busy)return;results.replaceChildren();setBusy(true);message.textContent=say("Searching…","Поиск…");
    try{
      const data=await jfCall("search",{...params,name:name.value.trim(),year:year.value});
      for(const choice of data.choices||[]){
        const button=create("button","btn",choice.name+(choice.year?" ("+choice.year+")":""));button.type="button";
        button.addEventListener("click",async()=>{
          if(busy)return;setBusy(true);message.textContent=say("Applying match…","Применение совпадения…");
          try{
            const applied=await jfCall("apply",{...params,ticket:choice.ticket});
            if(!applied.applied)throw Error("Match not applied");
            const rows=row.kind==="movie"?[row]:(await store.entries()).filter(x=>x.kind==="tv"&&seriesKey(x.series)===seriesKey(row.series)&&x.nativeRoot===row.nativeRoot);
            for(const entry of rows){
              await store.updateMetadata(entry.id,{manualMatch:{providerIds:applied.providerIds,title:choice.name,year:choice.year}});
              artAttempted.delete(artId(entry));titleAttempted.delete(entry.id);
            }
            artAttempted.delete(artId(row,true));jfRevision++;
            setBusy(false);dialog.close();await libraryMaintenance("refresh",{row,series:row.kind==="tv"});
          }catch(_){message.textContent=say("Could not apply match. Search again or wait for the metadata scan.","Не удалось применить совпадение. Повторите поиск или дождитесь завершения сканирования.");setBusy(false);}
        });
        results.append(button);
      }
      message.textContent=results.children.length?say("Select the correct match.","Выберите правильное совпадение."):say("No matches found.","Совпадений не найдено.");
    }catch(_){message.textContent=say("Private metadata engine is not ready or the item is not indexed yet.","Служба метаданных не готова или запись ещё не проиндексирована.");}
    finally{setBusy(false);}
  });
}

function localEditDialog(title){
  const dialog=document.createElement("dialog");dialog.className="dk-movie-details dk-local-edit";
  dialog.append(create("h2",null,title));
  const message=create("p","helper");message.setAttribute("role","status");
  const close=create("button","btn",say("Close","Закрыть"));close.type="button";
  close.addEventListener("click",()=>dialog.close());
  dialog.addEventListener("close",()=>dialog.remove());
  document.body.append(dialog);return {dialog,message,close};
}
async function reclassifyDialog(){
 const row=contextRow,seriesOnly=contextSeries;hideContextMenu();if(!row||seriesOnly||scanning||maintaining)return;
 const kind=row.kind==="tv"?"movie":"tv";
 const {dialog,message,close}=localEditDialog(kind==="movie"?say("Move to Movies","Перенести в фильмы"):say("Move to TV Shows","Перенести в сериалы"));
 const form=document.createElement("form");
 const note=create("p","helper",say("Only the library category changes. Your video file, artwork and playback history stay in place.","Изменится только категория библиотеки. Видеофайл, обложка и история просмотра сохранятся."));
 form.append(note);
 const field=(label,value,type="text")=>{const wrapper=create("label",null,label),node=document.createElement("input");node.type=type;node.value=value??"";wrapper.append(node);form.append(wrapper);return node;};
 const known=store.knownFeatureSpecial(row.filename,row.relative);
 const title=field(kind==="movie"?say("Movie title","Название фильма"):say("Series title","Название сериала"),kind==="movie"?(known?.title||row.episodeTitle||row.filename.replace(/\.[^.]+$/,"")):row.title);
 title.required=true;title.maxLength=180;
 const year=field(say("Year (optional)","Год (необязательно)"),known?.year||row.year,"number");year.min="1800";year.max="2100";year.step="1";
 let season,episode,episodeTitle;
 if(kind==="tv"){
  season=field(say("Season number","Номер сезона"),"","number");season.required=true;season.min="0";season.max="99";season.step="1";
  episode=field(say("Episode number","Номер серии"),"","number");episode.required=true;episode.min="1";episode.max="999";episode.step="1";
  episodeTitle=field(say("Episode title (optional)","Название серии (необязательно)"),"");episodeTitle.maxLength=180;
 }
 const save=create("button","btn",say("Save classification","Сохранить категорию"));save.type="submit";
 form.append(save,close);dialog.append(form,message);
 form.addEventListener("submit",async event=>{event.preventDefault();save.disabled=true;try{
  if(scanning||maintaining||!await store.reclassifyNative(row.id,{kind,title:title.value,year:year.value,season:season?.value,episode:episode?.value,episodeTitle:episodeTitle?.value}))throw Error();
  dialog.close();await render();
 }catch(_){message.textContent=say("Could not change the category.","Не удалось изменить категорию.");save.disabled=false;}});
 dialog.showModal();
}
const advancedMetadataFields=[
 ["description","Description","Описание","textarea"],
 ["originalTitle","Original title","Оригинальное название","text"],
 ["alternativeTitles","Alternative titles (comma-separated)","Другие названия (через запятую)","text"],
 ["studios","Studios (comma-separated)","Студии (через запятую)","text"],
 ["countries","Countries (comma-separated)","Страны (через запятую)","text"],
 ["releaseDate","Release date","Дата выпуска","date"],
 ["officialRating","Age rating","Возрастной рейтинг","text"],
 ["rating","Audience rating (0–10)","Оценка зрителей (0–10)","rating"],
 ["genres","Genres (comma-separated)","Жанры (через запятую)","text"]
];
function metadataEditor(form,record,initialLocks,includeYear){
 const fields={},locks={};
 function add(key,en,ru,value,type){
  const row=create("div","dk-meta-edit-row"),label=create("label",null,say(en,ru)),node=create(type==="textarea"?"textarea":"input");
  if(type!=="textarea")node.type=type==="rating"?"number":type;
  if(type==="rating"){node.min="0";node.max="10";node.step="0.1";}
  if(type==="number"){node.min="1800";node.max="2100";}
  if(type==="textarea"){node.maxLength=6000;node.rows=5;}else if(type==="text")node.maxLength=key==="title"?180:5000;
  node.value=Array.isArray(value)?value.join(", "):value??"";
  if(key==="title")node.required=true;
  label.append(node);
  const lockLabel=create("label","dk-meta-lock"),lock=create("input");lock.type="checkbox";lock.checked=!!initialLocks?.[key];lockLabel.append(lock,create("span",null,say("Lock","Защитить")));
  lock.setAttribute("aria-label",say("Lock "+en,"Защитить: "+ru));
  node.addEventListener("input",()=>{lock.checked=true;});
  row.append(label,lockLabel);form.append(row);fields[key]=node;locks[key]=lock;
 }
 form.append(create("p","helper",say("Editing a field locks it automatically. Uncheck Lock to allow future provider refreshes. Only checked fields are protected.","При изменении поля защита включается автоматически. Снимите отметку, чтобы разрешить обновление из источника. Защищены только отмеченные поля.")));
 add("title","Title","Название",record.title,"text");
 if(includeYear)add("year","Year","Год",record.year,"number");
 for(const [key,en,ru,type] of advancedMetadataFields)add(key,en,ru,record.details?.[key],type);
 const translated=create("details","dk-localized-fields");translated.append(create("summary",null,say("English and Russian metadata","Английские и русские метаданные")));
 translated.append(create("p","helper",say("Optional local translations. The selected interface language uses its saved text. Blank fields use source metadata; nothing is automatically translated.","Необязательные локальные переводы. Для выбранного языка используются сохранённые тексты. Пустые поля используют исходные метаданные; автоматический перевод не выполняется.")));
 const translations={};
 for(const [code,label] of [["en",say("English","Английский")],["ru",say("Russian","Русский")]]){
  const block=create("fieldset","dk-localized-fieldset");block.append(create("legend",null,label));translations[code]={};
  for(const [key,en,ru,tag,max] of [["title","Title","Название","input",180],["description","Description","Описание","textarea",6000]]){
   const wrap=create("label",null,say(en,ru)),node=create(tag);node.value=record.localizations?.[code]?.[key]||"";node.maxLength=max;node.lang=code;if(tag==="textarea")node.rows=4;wrap.append(node);block.append(wrap);translations[code][key]=node;
  }
  translated.append(block);
 }
 form.append(translated);
 return ()=>{const detailValues={};for(const [key] of advancedMetadataFields)detailValues[key]=fields[key].value;
  return {title:fields.title.value.trim(),year:fields.year?.value||null,description:detailValues.description,details:detailValues,localizations:Object.fromEntries(Object.entries(translations).map(([code,fields])=>[code,{title:fields.title.value,description:fields.description.value}])),locks:Object.fromEntries(Object.entries(locks).map(([key,n])=>[key,n.checked]))};
 };
}
async function editMetadataDialog(){
 const row=contextRow,series=contextSeries;hideContextMenu();if(!row)return;
 if(series){await editHierarchyDialog(row,"series");return;}
 const latest=await store.item(row.id)||row;
 const {dialog,message,close}=localEditDialog(say("Edit Metadata","Редактировать метаданные"));
 const form=document.createElement("form");
 const values=metadataEditor(form,{title:latest.kind==="movie"?latest.title:latest.episodeTitle,year:latest.year,localizations:latest.localizations,details:latest.kind==="movie"?latest.movieDetails:{...latest.episodeDetails,description:latest.episodeDescription}},latest.manualFields,latest.kind==="movie");
 const save=create("button","btn",say("Save Metadata","Сохранить метаданные"));save.type="submit";
 const unlock=create("button","btn",say("Unlock All","Снять всю защиту"));unlock.type="button";unlock.disabled=!latest.manualFields;
 form.append(save,unlock,close);dialog.append(form,message);
 form.addEventListener("submit",async event=>{event.preventDefault();save.disabled=true;try{if(!await store.editLocalMetadata(latest.id,values()))throw Error();dialog.close();await render();}catch(_){message.textContent=say("Could not save metadata.","Не удалось сохранить метаданные.");save.disabled=false;}});
 unlock.addEventListener("click",async()=>{try{await store.editLocalMetadata(latest.id,{},true);dialog.close();await render();}catch(_){message.textContent=say("Could not unlock fields.","Не удалось разблокировать поля.");}});
 dialog.showModal();
}
function attachOnlineArtworkGallery(dialog,row,scope,select,isBusy,backdropOnly=false){
  const panel=create("section","dk-online-art");
  const heading=create("h3",null,say("Online Artwork","Обложки из интернета"));
  const filter=document.createElement("select");
  filter.setAttribute("aria-label",say("Artwork type","Тип изображения"));
  for(const [value,en,ru] of [["Primary","Posters","Обложки"],["Backdrop","Backgrounds","Фоновые изображения"],["Thumb","Thumbnails","Миниатюры"]]){
    if(backdropOnly&&value!=="Backdrop")continue;
    const opt=create("option",null,say(en,ru));opt.value=value;filter.append(opt);
  }
  if(!backdropOnly&&row.kind==="tv"&&scope==="item")filter.value="Thumb";
  const load=create("button","btn",say("Browse online","Найти в интернете"));load.type="button";
  const prev=create("button","btn",say("Previous","Назад"));prev.type="button";prev.disabled=true;
  const next=create("button","btn",say("Next","Далее"));next.type="button";next.disabled=true;
  const controls=create("div","dk-art-options");controls.append(filter,load,prev,next);
  const status=create("p","helper");status.setAttribute("role","status");
  const grid=create("div","dk-online-art-grid");
  panel.append(heading,controls,status,grid);
  const params={id:row.id,path:row.nativePath,type:row.kind==="movie"?"Movie":"Episode",scope};
  let epoch=0,current=0,nextIndex=0,hasNext=false,loading=false,choosing=false,urls=[];
  const clear=()=>{for(const u of urls)URL.revokeObjectURL(u);urls=[];grid.replaceChildren();};
  const valid=revision=>dialog.open&&revision===epoch;
  const sync=()=>{load.disabled=loading||choosing;filter.disabled=choosing;prev.disabled=loading||choosing||current===0;next.disabled=loading||choosing||!hasNext;};
  const requestImage=async(ticket,preview)=>{
    const url="dk-jellyfin://catalog/gallery-image?"+new URLSearchParams({...params,ticket,preview:preview?"1":"0"});
    const r=await nativeBridge.metadataRequest(url,"image");
    if(!r.ok||!/^image\/(jpeg|png|webp)$/.test(r.mime))throw Error("Image unavailable");
    return new Blob([r.bytes],{type:r.mime});
  };
  async function browse(start){
    if(isBusy()||choosing)return;
    const revision=++epoch;clear();loading=true;current=start;hasNext=false;sync();
    status.textContent=say("Searching artwork…","Поиск изображений…");
    try{
      const data=await jfCall("gallery",{...params,image:filter.value,start});
      if(!valid(revision))return;
      const cards=[];
      for(const item of data.choices||[]){
        const card=create("button","btn dk-online-art-card");card.type="button";
        const image=create("img");image.alt="";image.hidden=true;
        const label=create("span",null,[item.width&&item.height?item.width+" × "+item.height:"",item.language||""].filter(Boolean).join(" · ")||say("Image","Изображение"));
        card.append(image,label);grid.append(card);cards.push({item,card,image});
        card.addEventListener("click",async()=>{
          if(choosing||isBusy()||!valid(revision))return;
          choosing=true;sync();status.textContent=say("Loading selected artwork…","Загрузка выбранного изображения…");
          try{const blob=await requestImage(item.ticket,false);if(valid(revision)){select(blob);for(const c of cards)c.card.setAttribute("aria-pressed",String(c.card===card));status.textContent=say("Selected. Save artwork to apply.","Выбрано. Сохраните обложку для применения.");}}
          catch(_){if(valid(revision))status.textContent=say("Image unavailable or too large. Choose another image.","Изображение недоступно или слишком велико. Выберите другое.");}
          finally{choosing=false;sync();}
        });
      }
      nextIndex=data.next;hasNext=!!data.hasNext;
      status.textContent=cards.length?say("Choose an image to preview and save.","Выберите изображение для просмотра и сохранения."):say("No supported artwork found on this page.","На этой странице нет поддерживаемых изображений.");
      // Sequential thumbnails avoid competing with normal library lookups.
      void (async()=>{for(const {item,image} of cards){
        if(!valid(revision))break;
        try{const blob=await requestImage(item.ticket,true);if(!valid(revision))break;const u=URL.createObjectURL(blob);urls.push(u);image.src=u;image.hidden=false;}catch(_){}
      }})();
    }catch(_){if(valid(revision))status.textContent=say("Online artwork unavailable. Check the metadata engine and its providers.","Обложки недоступны. Проверьте службу метаданных и её источники.");}
    finally{if(valid(revision)){loading=false;sync();}}
  }
  load.addEventListener("click",()=>void browse(0));
  filter.addEventListener("change",()=>void browse(0));
  prev.addEventListener("click",()=>void browse(Math.max(0,current-12)));
  next.addEventListener("click",()=>void browse(nextIndex));
  dialog.addEventListener("close",()=>{epoch++;clear();});
  return panel;
}

async function chooseArtworkDialog(target=null,scope=null,backdropOnly=false){
  const row=target||contextRow,series=scope==="series"||(!target&&contextSeries);hideContextMenu();if(!row)return;
  const id=backdropOnly?backdropKey(row,series?"series":"item"):scope==="season"?hierarchyKey(row,"season"):artId(row,series),{dialog,message,close}=localEditDialog(backdropOnly?say("Choose Background","Выбрать фон"):say("Choose Artwork","Выбрать обложку"));
  const preview=create("img","dk-art-preview");preview.alt="";preview.hidden=true;
  let blob=null,objectURL=null,busy=false;
  const select=next=>{if(objectURL)URL.revokeObjectURL(objectURL);blob=next;objectURL=next?URL.createObjectURL(next):null;preview.hidden=!next;if(next)preview.src=objectURL;save.disabled=!next;};
  dialog.addEventListener("close",()=>{if(objectURL)URL.revokeObjectURL(objectURL);});
  const source=document.createElement("input");source.type="file";source.accept="image/jpeg,image/png,image/webp";source.setAttribute("aria-label",say("Choose local image","Выбрать местное изображение"));
  const choices=create("div","dk-art-options"),save=create("button","btn",say("Save artwork","Сохранить обложку"));
  save.type="button";save.disabled=true;
  const reset=create("button","btn",say("Restore automatic artwork","Восстановить автоматический выбор"));reset.type="button";
  const setBusy=value=>{busy=value;for(const button of choices.querySelectorAll("button"))button.disabled=value;source.disabled=value;close.disabled=value;reset.disabled=value;save.disabled=value||!blob;};
  dialog.addEventListener("cancel",event=>{if(busy)event.preventDefault();});
  source.addEventListener("change",()=>{const file=source.files?.[0];if(!file)return;if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>3*1024*1024||!file.size){message.textContent=say("Choose a JPEG, PNG or WebP image up to 3 MB.","Выберите изображение до 3 МБ в поддерживаемом формате.");return;}select(file);message.textContent="";});
  for(const [kind,en,ru] of [["Primary","Poster / primary","Основная обложка"],["Backdrop","Background","Фоновое изображение"],["Thumb","Thumbnail","Миниатюра"]]){
    if(backdropOnly&&kind!=="Backdrop")continue;
    const button=create("button","btn",say(en,ru));button.type="button";choices.append(button);
    button.addEventListener("click",async()=>{if(busy)return;setBusy(true);try{const url="dk-jellyfin://catalog/item?"+new URLSearchParams({id:row.id,path:row.nativePath,type:row.kind==="movie"?"Movie":"Episode",series:series?"1":"0",scope:scope||(series?"series":"item"),image:kind});const result=await nativeBridge.metadataRequest(url,"image");if(!result.ok)throw Error();select(new Blob([result.bytes],{type:result.mime}));message.textContent="";}catch(_){message.textContent=say("This image is not available from the metadata engine.","Это изображение недоступно в службе метаданных.");}finally{setBusy(false);}});
  }
  save.addEventListener("click",async()=>{if(!blob||busy)return;setBusy(true);try{while(activeArtwork.has(id)||backdropPending.has(id))await new Promise(resolve=>setTimeout(resolve,80));if(!await store.saveArtwork(id,blob,"Manual",true))throw Error();if(backdropOnly)invalidateBackdrop(id);dialog.close();await render();}catch(_){message.textContent=say("Could not save artwork.","Не удалось сохранить обложку.");setBusy(false);}});
  reset.addEventListener("click",async()=>{if(busy)return;setBusy(true);try{while(activeArtwork.has(id)||backdropPending.has(id))await new Promise(resolve=>setTimeout(resolve,80));await store.removeArtwork(id);artAttempted.delete(id);jfChecked.delete(id);if(backdropOnly)invalidateBackdrop(id);dialog.close();await render();}catch(_){message.textContent=say("Could not restore automatic artwork.","Не удалось восстановить автоматический выбор.");setBusy(false);}});
  const gallery=attachOnlineArtworkGallery(dialog,row,scope||(series?"series":"item"),select,()=>busy,backdropOnly);
  dialog.append(source,choices,preview,message,save,reset,close,gallery);dialog.showModal();
  const current=await store.artwork(id);if(dialog.open&&current?.blob&&!blob)select(current.blob);
}

const hierarchyKey=(row,scope)=>scope==="season"?"tv-season:"+String(row.series||"").normalize("NFKC").toLowerCase()+":"+row.season:artId(row,true);
const tvRepresentative=(scope)=>all.find(row=>row.kind==="tv"&&!row.missing&&!row.unavailable&&seriesKey(row.series)===seriesKey(selectedSeries)&&(scope!=="season"||row.season===selectedSeason));
async function tvRecord(row,scope,force=false){
  const latest=await store.item(row.id)||row;
  const key=scope==="item"?null:hierarchyKey(row,scope);
  const cached=key?await store.hierarchyMetadata(key):null;
  if(cached?.record&&!force)return cached.record;
  const local=scope==="item"?{title:latest.episodeTitle||formatCode(latest),localizations:latest.localizations,details:{...latest.episodeDetails,description:latest.episodeDescription||latest.episodeDetails?.description||""}}:cached?.record||{title:scope==="series"?row.series:say("Season "+row.season,"Сезон "+row.season),details:{}};
  if(!nativeBridge?.metadataRequest)return local;
  try{
    const response=await jfCall("item",{id:row.id,path:row.nativePath,type:"Episode",scope,force:force?"1":"0"});
    if(!response?.title)return local;
    if(key){await store.saveHierarchyMetadata(key,response);return (await store.hierarchyMetadata(key))?.record||response;}
    await store.updateMetadata(row.id,{episodeTitle:response.title,episodeDetails:response.details,jellyfinIdentity:response.identity});
    const saved=await store.item(row.id);
    return {...response,title:saved?.episodeTitle||response.title,localizations:saved?.localizations,details:{...response.details,...saved?.episodeDetails,description:saved?.episodeDescription??response.details?.description}};
  }catch(_){return local;}
}
async function showTVDetails(row,scope){
  const {dialog,message,close}=localEditDialog(scope==="series"?say("Series Details","О сериале"):scope==="season"?say("Season Details","О сезоне"):say("Episode Details","О серии"));
  const image=create("img","dk-art-preview");image.alt="";image.hidden=true;
  let url=null;
  dialog.addEventListener("close",()=>{if(url)URL.revokeObjectURL(url);});
  const heading=create("h3"),description=create("p"),fields=create("dl");
  message.textContent=say("Loading metadata…","Загрузка метаданных…");
  dialog.append(image,heading,description,fields,message,close);dialog.showModal();
  const cached=await store.artwork(scope==="item"?artId(row):hierarchyKey(row,scope));
  let blob=cached?.blob;
  if(!blob&&nativeBridge?.metadataRequest){
    try{const r=await nativeBridge.metadataRequest("dk-jellyfin://catalog/item?"+new URLSearchParams({id:row.id,path:row.nativePath,type:"Episode",scope,image:"Primary"}),"image");if(r.ok){blob=new Blob([r.bytes],{type:r.mime});await store.saveArtwork(scope==="item"?artId(row):hierarchyKey(row,scope),blob,"Jellyfin");}}catch(_){}
  }
  if(!dialog.open)return;
  if(blob){url=URL.createObjectURL(blob);image.src=url;image.hidden=false;}
  const data=localizedRecord(await tvRecord(row,scope,true));if(!dialog.open)return;
  heading.textContent=data.title+(data.year?" ("+data.year+")":"");
  description.textContent=data.details?.description||say("No description available.","Описание недоступно.");
  const add=(label,value)=>{if(value)fields.append(create("dt",null,label),create("dd",null,String(value)));};
  add(say("Genre","Жанр"),data.details?.genres?.join(", "));
  add(say("Cast","В ролях"),data.details?.cast?.join(", "));
  add(say("Director","Режиссёр"),data.details?.directors?.join(", "));
  add(say("Rating","Рейтинг"),data.details?.rating);
  add(say("Original title","Оригинальное название"),data.details?.originalTitle);
  add(say("Alternative titles","Другие названия"),data.details?.alternativeTitles?.join(", "));
  add(say("Studios","Студии"),data.details?.studios?.join(", "));
  add(say("Countries","Страны"),data.details?.countries?.join(", "));
  add(say("Release date","Дата выпуска"),data.details?.releaseDate);
  add(say("Age rating","Возрастной рейтинг"),data.details?.officialRating);

  if(scope==="item")add(say("Episode","Серия"),formatCode(row));
  fields.after(personCreditsPanel(dialog,row,scope,data.details?.people));
  message.textContent="";
}
async function editHierarchyDialog(row,scope){
 const key=hierarchyKey(row,scope),data=await tvRecord(row,scope),prior=await store.hierarchyMetadata(key);
 const {dialog,message,close}=localEditDialog(scope==="season"?say("Edit Season Metadata","Редактировать сведения о сезоне"):say("Edit Series Metadata","Редактировать сведения о сериале"));
 const form=document.createElement("form");
 const values=metadataEditor(form,data,prior?.manualFields??(prior?.manual?{title:true,year:true,description:true}:{}),true);
 const save=create("button","btn",say("Save Metadata","Сохранить метаданные"));save.type="submit";
 const unlock=create("button","btn",say("Unlock All","Снять всю защиту"));unlock.type="button";unlock.disabled=!prior?.manual&&!prior?.manualFields;
 form.append(save,unlock,close);dialog.append(form,message);
 form.addEventListener("submit",async event=>{event.preventDefault();save.disabled=true;try{const v=values();if(!await store.saveHierarchyMetadata(key,{...data,title:v.title,year:Number(v.year)||null,localizations:v.localizations,details:{...data.details,...v.details}},v.locks))throw Error();dialog.close();await render();}catch(_){message.textContent=say("Could not save metadata.","Не удалось сохранить метаданные.");save.disabled=false;}});
 unlock.addEventListener("click",async()=>{try{await store.saveHierarchyMetadata(key,null,false,true);dialog.close();await render();}catch(_){message.textContent=say("Could not unlock fields.","Не удалось разблокировать поля.");}});
 dialog.showModal();
}
let hierarchyRender=0;
async function displayHierarchy(){
  const revision=++hierarchyRender,show=tvRepresentative("series"),season=tvRepresentative("season"),seriesName=selectedSeries,seasonNumber=selectedSeason;
  const summary=$("seriesMetadataSummary"),seasonSummary=$("seasonMetadataSummary");
  summary.textContent="";seasonSummary.textContent="";
  const valid=()=>revision===hierarchyRender&&selectedSeries===seriesName&&selectedSeason===seasonNumber;
  if(!show||!nativeBridge)return;
  void paintBackdrop($("seriesDetail"),show,"series");
  const seriesData=localizedRecord(await tvRecord(show,"series"));
  if(!valid())return;
  $("seriesTitle").textContent=seriesData.title||seriesName;
  summary.textContent=seriesData.details?.description||"";
  if(season){const data=localizedRecord(await tvRecord(season,"season"));if(valid())seasonSummary.textContent=data.details?.description||"";}
}


/* Cinema Home: existing catalog, playback, metadata and history; no new database. */
const cinemaTitle=r=>r.kind==="tv"?displaySeriesName(r):localized(r,"title",r.title);
const cinemaDetails=r=>r.kind==="tv"?(seriesMetadata.get(seriesKey(r.series))?.details||r.episodeDetails||{}):(r.movieDetails||{});
const cinemaGenres=r=>Array.isArray(cinemaDetails(r).genres)?cinemaDetails(r).genres.filter(g=>typeof g==="string"&&g.trim()):[];
const cinemaYear=r=>Number(r.kind==="tv"?(seriesMetadata.get(seriesKey(r.series))?.year||r.year):r.year)||0;
const cinemaRating=r=>{const v=cinemaDetails(r).rating;return /^\d+(?:\.\d+)?(?:\s*\/\s*10)?$/.test(String(v||"").trim())?parseFloat(v):0;};
const cinemaEligible=r=>!/(?:^|[ ._-])sample(?:[ ._-]|$)/i.test(r.filename||"");
function uniqueSeries(rows){
 const result=new Map();for(const row of rows){const k=seriesKey(row.series||row.title);if(!result.has(k)||result.get(k).missing&&!row.missing)result.set(k,row);}return [...result.values()];
}
async function readSeriesMetadata(epoch){
 const next=new Map(),rows=uniqueSeries(all.filter(r=>r.kind==="tv"));
 for(let i=0;i<rows.length;i+=32){
  if(epoch!==renderEpoch)return;
  await Promise.all(rows.slice(i,i+32).map(async r=>{try{const v=(await store.hierarchyMetadata(hierarchyKey(r,"series")))?.record;if(v)next.set(seriesKey(r.series),v);}catch(_){}}));
 }
 if(epoch===renderEpoch)seriesMetadata=next;
}
function matchesCinema(r){
 const f=homeFilters,q=seriesKey(f.query),d=cinemaDetails(r);
 return (!q||[cinemaTitle(r),r.title,r.series,r.episodeTitle,...localizedSearch(r),...localizedSearch(seriesMetadata.get(seriesKey(r.series))),d.originalTitle,...(Array.isArray(d.alternativeTitles)?d.alternativeTitles:[]),...cinemaGenres(r),...(Array.isArray(d.cast)?d.cast:[])].some(x=>seriesKey(x).includes(q)))&&
 (!f.genre||cinemaGenres(r).some(g=>seriesKey(g)===seriesKey(f.genre)))&&(!f.year||cinemaYear(r)===Number(f.year))&&(!f.rating||cinemaRating(r)>=Number(f.rating))&&(!f.watched||historyBucket(r)===f.watched);
}
function sortCinema(rows){
 const s=homeFilters.sort;
 return [...rows].sort((a,b)=>(s==="year"?cinemaYear(b)-cinemaYear(a):s==="rating"?cinemaRating(b)-cinemaRating(a):s==="played"?(b.lastPlayed||0)-(a.lastPlayed||0):s==="reverse"?-nameSort(cinemaTitle(a),cinemaTitle(b)):0)||nameSort(cinemaTitle(a),cinemaTitle(b)));
}
function cinemaButton(en,ru,action,cls="btn"){
 const b=create("button",cls,say(en,ru));b.type="button";b.addEventListener("click",action);return b;
}
let featureId=null,featureTimer=null,featureEpoch=0,externalShowing=false,externalBusy=false;
const discoveryCache=new Map(),discovered=new Set();
function profile(){
 const scores=new Map(),seen=new Set();
 for(const r of all){
  if(!cinemaEligible(r)||(!r.completed&&currentProgress(r)<10)||!cinemaGenres(r).length)continue;
  const id=r.kind==="tv"?"series:"+seriesKey(r.series):r.id;if(seen.has(id))continue;seen.add(id);
  for(const g of cinemaGenres(r)){const k=seriesKey(g);scores.set(k,(scores.get(k)||0)+(r.completed?2:1));}
 }
 return {scores,learned:seen.size>=3};
}
function pickMovie(p){
 const pool=all.filter(r=>r.kind==="movie"&&cinemaEligible(r)&&!r.missing&&!r.unavailable);
 if(!pool.length)return null;
 const choices=pool.length>1?pool.filter(r=>r.id!==featureId):pool;
 if(!p.learned)return choices[Math.floor(Math.random()*choices.length)];
 return choices.map(r=>({r,score:cinemaGenres(r).reduce((n,g)=>n+(p.scores.get(seriesKey(g))||0),0)+(r.completed?0:2)+Math.random()})).sort((a,b)=>b.score-a.score)[0].r;
}
function clearFeature(){
 clearTimeout(featureTimer);featureTimer=null;featureEpoch++;externalShowing=false;externalBusy=false;
 if(cinema)clearBackdrop(cinema.hero);
}
function nextLocal(){
 if(homePage!=="home"||!cinema)return;
 clearFeature();const p=profile(),r=pickMovie(p);featureId=r?.id||null;
 const hero=cinema.hero;hero.replaceChildren();hero.classList.remove("dk-discovery");
 if(r){
  const d=cinemaDetails(r);
  hero.append(create("span","dk-hero-kicker",p.learned?say("PICKED FOR YOU · YOUR LIBRARY","ПОДБОРКА ДЛЯ ВАС · ВАША МЕДИАТЕКА"):say("RANDOM PICK · YOUR LIBRARY","СЛУЧАЙНЫЙ ВЫБОР · ВАША МЕДИАТЕКА")),create("h1",null,localized(r,"title",r.title)),create("p","dk-hero-meta",[r.year,d.runtime?d.runtime+say(" min"," мин"):"",...cinemaGenres(r).slice(0,3)].filter(Boolean).join(" · ")),create("p","dk-hero-description",localized(r,"description",d.description)||say("From your personal movie collection.","Из вашей коллекции фильмов.")));
  const actions=create("div","dk-hero-actions");actions.append(cinemaButton("▶ Play","▶ Смотреть",()=>void openVideo(r)),cinemaButton("Details","Подробнее",()=>{contextRow=r;contextSeries=false;void showMovieDetails();}));hero.append(actions);void paintBackdrop(hero,r,"item");
 }else{hero.append(create("span","dk-hero-kicker",say("YOUR CINEMA","ВАШ КИНОТЕАТР")),create("h1",null,say("Welcome to Kinehall","Добро пожаловать в Кинехолл")),create("p",null,say("Add a movie folder to begin.","Добавьте папку с фильмами.")),cinemaButton("Library Management","Управление медиатекой",()=>void openLibraryManagement()));}
 const ticket=featureEpoch;hero.append(cinemaButton("Next suggestion ›","Следующая рекомендация ›",()=>void discover(ticket),"btn dk-hero-next"));
 featureTimer=setTimeout(()=>rotateFeature(ticket),14000);
}
function rotateFeature(ticket){
 if(ticket!==featureEpoch||homePage!=="home")return;
 if(document.hidden||document.querySelector("dialog[open]")||cinema.hero.matches(":hover")||cinema.hero.contains(document.activeElement)){featureTimer=setTimeout(()=>rotateFeature(ticket),4000);return;}
 if(externalShowing)nextLocal();else void discover(ticket);
}
const publicGenres=["Action","Adventure","Animation","Biography","Comedy","Crime","Documentary","Drama","Family","Fantasy","History","Horror","Music","Mystery","Romance","Sci-Fi","Sport","Thriller","War","Western"];
async function discoveryRows(genre){
 const key=genre||"top",cached=discoveryCache.get(key);
 if(cached&&Date.now()-cached.time<3600000)return cached.rows;
 const url="https://v3-cinemeta.strem.io/catalog/movie/top"+(genre?"/genre="+encodeURIComponent(genre):"")+".json";
 const r=await nativeBridge.metadataRequest(url,"json");if(!r.ok)return [];
 const data=JSON.parse(r.text),rows=Array.isArray(data.metas)?data.metas.slice(0,100):[];
 discoveryCache.set(key,{time:Date.now(),rows});return rows;
}
async function discover(ticket){
 if(ticket!==featureEpoch||homePage!=="home"||externalBusy||externalShowing)return;
 clearTimeout(featureTimer);externalBusy=true;
 const p=profile(),top=[...p.scores].sort((a,b)=>b[1]-a[1])[0]?.[0],local=all.find(r=>r.id===featureId);
 const genre=publicGenres.find(g=>seriesKey(g)===top)||publicGenres.find(g=>local&&cinemaGenres(local).some(x=>seriesKey(x)===seriesKey(g)));
 let rows=[];try{rows=await discoveryRows(genre);if(!rows.length&&genre)rows=await discoveryRows(null);}catch(_){}
 if(ticket!==featureEpoch||homePage!=="home")return;
 externalBusy=false;
 const owned=new Set(all.filter(r=>r.kind==="movie").map(r=>seriesKey(r.title)));
 const ids=new Set(all.map(r=>r.jellyfinIdentity?.providerIds?.Imdb||r.movieDetails?.imdbId).filter(Boolean));
 const candidates=rows.filter(r=>r&&/^tt\d{6,11}$/.test(r.id||"")&&typeof r.name==="string"&&r.name.trim()&&!owned.has(seriesKey(r.name))&&!ids.has(r.id));
 let fresh=candidates.filter(r=>!discovered.has(r.id));if(!fresh.length){discovered.clear();fresh=candidates;}
 const r=fresh[Math.floor(Math.random()*Math.min(fresh.length,20))];
 if(!r){featureTimer=setTimeout(()=>{if(ticket===featureEpoch)nextLocal();},14000);return;}
 discovered.add(r.id);externalShowing=true;
 const hero=cinema.hero;clearBackdrop(hero);hero.replaceChildren();hero.classList.add("dk-discovery");
 hero.append(create("span","dk-hero-kicker",say("DISCOVER · OUTSIDE YOUR LIBRARY","ОТКРЫТИЯ · ВНЕ ВАШЕЙ МЕДИАТЕКИ")),create("h1",null,r.name),create("p","dk-hero-meta",[String(r.releaseInfo||r.year||"").slice(0,12),...(Array.isArray(r.genres)?r.genres.slice(0,3):[])].filter(Boolean).join(" · ")),create("p","dk-hero-description",typeof r.description==="string"?r.description.slice(0,550):say("A movie you might enjoy.","Фильм, который может вам понравиться.")),create("p","dk-hero-meta",p.learned?say("Based on your viewing history.","На основе истории просмотров."):say("Explore something new.","Откройте для себя что-то новое.")),cinemaButton("‹ Back to your library","‹ К вашей медиатеке",nextLocal,"btn dk-hero-next"));
 featureTimer=setTimeout(()=>rotateFeature(ticket),14000);
 try{const im=await nativeBridge.metadataRequest("https://images.metahub.space/background/medium/"+r.id+"/img","image");if(ticket!==featureEpoch||!externalShowing||!im.ok||!/^image\/(jpeg|png|webp)$/.test(im.mime))return;const url=URL.createObjectURL(new Blob([im.bytes],{type:im.mime}));backdropViews.set(hero,{id:"discovery:"+r.id,url});hero.style.setProperty("--dk-detail-backdrop",'url("'+url+'")');hero.classList.add("dk-has-detail-backdrop");}catch(_){}
}
function navigateCinema(page){
 window.DKLiveTV?.close();clearFeature();homeSearchOpen=false;homePage=page;collectionBrowseId=null;selectedSeries=null;selectedSeason=null;visibleCount=72;collectionFilter={kind:"",value:"",query:"",saved:false};void render();
}
function setupCinema(){
 const shell=document.querySelector(".library-shell"),main=shell.querySelector("main"),top=shell.querySelector(".topbar"),tabs=main.querySelector(".library-tabs");
 const side=create("aside","dk-cinema-sidebar"),nav=create("nav","dk-cinema-nav"),bottom=create("div","dk-cinema-bottom"),brand=top.querySelector(".brand");
 const collapse=cinemaButton("☰","☰",()=>{const v=shell.classList.toggle("dk-cinema-collapsed");collapse.setAttribute("aria-expanded",String(!v));try{localStorage.setItem("dk-kinehall.cinema.collapsed",v?"1":"0");}catch(_){}},"btn dk-cinema-collapse");collapse.setAttribute("aria-expanded","true");
 side.id="dkCinemaSidebar";
 const brandRow=create("div","dk-cinema-brand-row");brandRow.append(brand,collapse);side.append(brandRow,nav,bottom);shell.prepend(side);shell.classList.add("dk-cinema");
 try{if(localStorage.getItem("dk-kinehall.cinema.collapsed")==="1"){shell.classList.add("dk-cinema-collapsed");collapse.setAttribute("aria-expanded","false");}}catch(_){}
 const navButton=(id,icon,en,ru,fn)=>{const b=cinemaButton(en,ru,fn);b.id=id;return adopt(b,icon,en,ru);};
 function adopt(b,icon,en,ru){
  if(!b)return null;
  b.classList.add("dk-cinema-nav-button");b.dataset.icon=icon;b.dataset.en=en;b.dataset.ru=ru;b.removeAttribute("role");
  const paths={dkNavSearch:"M21 21l-5-5M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0",dkNavHome:"M3 10l9-7 9 7v10H4V10M9 20v-7h6v7",tabMovies:"M4 3h16v18H4zM4 8h16M4 16h16M8 3v18M16 3v18",tabTV:"M3 5h18v14H3zM6 9h12M6 12h12M6 15h12",libraryLiveTV:"M3 7h18v13H3zM8 3l4 4 4-4",dkNavWatch:"m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-3-5.5 3 1-6.2L3 9.6l6.2-.9z",dkNavCollections:"M3 4h4v16H3zM10 4h4v16h-4zM17 4h4v16h-4z",showPlayer:"M6 3l15 9-15 9z",librarySettings:"M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0"};
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg"),path=document.createElementNS("http://www.w3.org/2000/svg","path");
  svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");svg.setAttribute("class","dk-cinema-nav-icon");path.setAttribute("d",paths[b.id]||paths.dkNavHome);path.setAttribute("fill",b.id==="showPlayer"?"currentColor":"none");path.setAttribute("stroke","currentColor");path.setAttribute("stroke-width","1.65");path.setAttribute("stroke-linejoin","round");path.setAttribute("stroke-linecap","round");svg.append(path);
  b.replaceChildren(svg,create("span","dk-cinema-nav-label",say(en,ru)));return b;
 }
 nav.append(navButton("dkNavSearch","⌕","Search","Поиск",()=>{if(main.classList.contains("dk-live-active"))navigateCinema("home");homeSearchOpen=true;if(cinema)syncCinema();requestAnimationFrame(()=>$("dkCinemaSearch").focus());}),navButton("dkNavHome","⌂","Home","Главная",()=>navigateCinema("home")));
 for(const [id,icon,en,ru] of [["tabMovies","▣","Movies","Фильмы"],["tabTV","▤","TV Shows","Сериалы"],["libraryLiveTV","▦","Live TV","Прямой эфир"]]){const b=adopt($(id),icon,en,ru);if(b)nav.append(b);}
 nav.append(navButton("dkNavWatch","☆","Watchlist","Список просмотра",()=>navigateCinema("watch")),navButton("dkNavCollections","▥","Collections","Коллекции",()=>navigateCinema("collections")));
 const player=adopt($("showPlayer"),"▶","Player","Проигрыватель");if(player)nav.append(player);
 const settings=adopt($("librarySettings"),"⚙","Settings","Настройки");if(settings)bottom.append(settings);
 if(settings&&openCinemaSettings){
  const server=cinemaButton("Server","Сервер",()=>void openCinemaSettings("server"),"dk-sidebar-server");
  server.id="dkSidebarServer";
  const lamp=create("span","dk-server-light");lamp.id="dkSidebarServerLight";lamp.dataset.state=jfLast?.state||"unknown";lamp.setAttribute("aria-hidden","true");
  const label=create("span","dk-cinema-nav-label",say("Server","Сервер"));
  server.replaceChildren(lamp,label);server.setAttribute("aria-haspopup","dialog");server.setAttribute("aria-label",say("Server Settings","Настройки сервера"));bottom.append(server);
  if(jfLast)paintJellyfinState(jfLast);
 }
 tabs.hidden=true;
 // Keep the application-wide footer outside the sidebar.
 const footer=shell.querySelector(".dk-branded-footer");if(footer){footer.classList.add("dk-cinema-window-footer");shell.append(footer);}
 for(const id of ["addLibraryFolder","scanLibrary","libraryEmptyTrash","libraryRefreshMetadata"])$(id)?.classList.add("dk-management-only");
 const heading=create("h1","dk-cinema-heading");top.prepend(heading);
 const hero=create("section","dk-cinema-hero");hero.id="dkCinemaHero";hero.hidden=true;hero.setAttribute("aria-live","polite");
 const filters=create("div","dk-cinema-filters"),input=create("input","select");filters.id="dkCinemaFilters";input.id="dkCinemaSearch";input.type="search";filters.append(input);
 let searchTimer=null;input.addEventListener("input",()=>{homeFilters.query=input.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{visibleCount=72;void render();},180);});
 const controls={};for(const key of ["genre","year","rating","watched","sort"]){const s=create("select","select");s.addEventListener("change",()=>{homeFilters[key]=s.value;visibleCount=72;void render();});controls[key]=s;filters.append(s);}
 const reset=cinemaButton("Clear Filters","Сбросить фильтры",()=>{homeFilters={query:"",genre:"",year:"",rating:"",watched:"",sort:"title"};collectionFilter={kind:"",value:"",query:"",saved:false};watchedFilter="";input.value="";visibleCount=72;void render();});filters.append(reset);
 const shelves=create("div","dk-cinema-shelves");shelves.id="dkCinemaShelves";
 function shelf(kind,en,ru){
  const section=create("section","library-section"),head=create("div","section-heading"),title=create("h2"),list=create("div","library-posters dk-cinema-shelf");
  const key="dk-kinehall.cinema.shelf."+kind;let collapsed=false;
  try{collapsed=localStorage.getItem(key)==="collapsed";}catch(_){}
  list.id="dkCinemaShelf-"+kind;
  const toggle=cinemaButton(en,ru,()=>{collapsed=!collapsed;try{localStorage.setItem(key,collapsed?"collapsed":"expanded");}catch(_){};apply();if(!collapsed)void render();},"dk-cinema-shelf-toggle");
  const arrow=create("span","dk-shelf-chevron"),label=create("span","dk-shelf-label",say(en,ru));arrow.setAttribute("aria-hidden","true");toggle.replaceChildren(arrow,label);toggle.setAttribute("aria-controls",list.id);
  function apply(){list.hidden=collapsed;toggle.setAttribute("aria-expanded",String(!collapsed));arrow.textContent=collapsed?"▸":"▾";}
  title.append(toggle);head.append(title);section.append(head,list);shelves.append(section);apply();
  return {title:label,list,toggle,apply};
 }
 const movies=shelf("movie","Your Movies","Ваши фильмы"),tv=shelf("tv","Your TV Shows","Ваши сериалы");
 const resume=$("continueWatching");
 // Wheel over the resume shelf scrolls horizontally; at either end the
 // normal vertical page scroll resumes. Do not intercept Ctrl+wheel zoom.
 resume.addEventListener("wheel",event=>{
  if(event.ctrlKey||event.metaKey||event.defaultPrevented)return;
  if(Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
  const max=resume.scrollWidth-resume.clientWidth;if(max<=1||!event.deltaY)return;
  const delta=event.deltaY*(event.deltaMode===1?24:event.deltaMode===2?resume.clientWidth:1);
  if((delta<0&&resume.scrollLeft<=1)||(delta>0&&resume.scrollLeft>=max-1))return;
  event.preventDefault();resume.scrollLeft+=delta;
 },{passive:false});
 main.insertBefore(hero,$("libraryStatus"));hero.after(filters);$("continueSection").after(shelves);
 const collection=$("libraryCollection").closest(".library-section");collection.id="dkCinemaCollection";
 cinema={shell,main,side,nav,bottom,collapse,heading,hero,filters,input,controls,reset,shelves,movies,tv,collection};
 $("languageSelect").addEventListener("change",()=>queueMicrotask(()=>{clearFeature();void render();}));
}
function setOptions(key,label,values){
 const s=cinema.controls[key];s.setAttribute("aria-label",label);
 s.replaceChildren(...values.map(([v,t])=>{const o=create("option",null,t);o.value=String(v);return o;}));
 s.value=homeFilters[key];if(s.selectedIndex<0){homeFilters[key]=key==="sort"?"title":"";s.value=homeFilters[key];}
}
function syncCinema(){
 const n=cinema,live=n.main.classList.contains("dk-live-active"),home=homePage==="home",watch=homePage==="watch",collections=homePage==="collections";
 n.shell.classList.toggle("dk-cinema-home",home&&!live);n.shell.classList.toggle("dk-cinema-watch",watch&&!live);
 if($("dkBoxSetTools"))$("dkBoxSetTools").hidden=!collections||live;if(collectionTools)collectionTools.bar.hidden=collections;
 n.hero.hidden=!home||live;n.shelves.hidden=!(home||watch)||live;n.collection.hidden=home||watch||live;n.filters.hidden=live||collections||(home&&!homeSearchOpen);
 $("continueSection").hidden=!home||live;
 if(!home||live){if(featureTimer||externalBusy||externalShowing)clearFeature();}
 n.heading.textContent=live?say("Live TV","Прямой эфир"):home?say("Home","Главная"):watch?say("Watchlist","Список просмотра"):collections?say("Collections","Коллекции"):mode==="tv"?say("TV Shows","Сериалы"):collectionFilter.kind==="collection"?say("Collections","Коллекции"):say("Movies","Фильмы");
 const selected=live?"libraryLiveTV":home?"dkNavHome":watch?"dkNavWatch":collections?"dkNavCollections":mode==="tv"?"tabTV":collectionFilter.kind==="collection"?"dkNavCollections":"tabMovies";
 for(const b of n.side.querySelectorAll(".dk-cinema-nav-button")){const label=say(b.dataset.en,b.dataset.ru);const span=b.querySelector(".dk-cinema-nav-label");if(span)span.textContent=label;b.title=label;b.setAttribute("aria-label",label);if(b.id===selected)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");if(b.hasAttribute("aria-selected"))b.setAttribute("aria-selected",String(b.id===selected));}
 const shortcut=$("dkSidebarServer");if(shortcut){shortcut.querySelector(".dk-cinema-nav-label").textContent=say("Server","Сервер");if(jfLast)paintJellyfinState(jfLast);else shortcut.setAttribute("aria-label",say("Server Settings","Настройки сервера"));}
 n.collapse.setAttribute("aria-label",say("Toggle sidebar","Свернуть или развернуть меню"));
 n.input.placeholder=say("Search library","Поиск в медиатеке");n.input.setAttribute("aria-label",n.input.placeholder);if(document.activeElement!==n.input)n.input.value=homeFilters.query;
 const pool=all.filter(r=>cinemaEligible(r)&&(home||watch||r.kind===mode));
 const genres=[...new Map(pool.flatMap(cinemaGenres).map(g=>[seriesKey(g),g])).values()].sort(nameSort),years=[...new Set(pool.map(cinemaYear).filter(Boolean))].sort((a,b)=>b-a);
 setOptions("genre",say("Genre","Жанр"),[["",say("All genres","Все жанры")],...genres.map(g=>[g,g])]);
 setOptions("year",say("Year","Год"),[["",say("All years","Все годы")],...years.map(y=>[y,String(y)])]);
 setOptions("rating",say("Rating","Рейтинг"),[["",say("Any rating","Любой рейтинг")],["6","6+"],["7","7+"],["8","8+"],["9","9+"]]);
 setOptions("watched",say("Viewing status","Статус просмотра"),[["",say("All statuses","Все статусы")],["watched",say("Watched","Просмотрено")],["unwatched",say("Unwatched","Не просмотрено")],["progress",say("In progress","В процессе")]]);
 setOptions("sort",say("Sort","Сортировка"),[["title",say("Title A–Z","Название А–Я")],["reverse",say("Title Z–A","Название Я–А")],["year",say("Year","Год")],["rating",say("Rating","Рейтинг")],["played",say("Last watched","Последний просмотр")]]);
 n.reset.textContent=say("Clear Filters","Сбросить фильтры");n.movies.title.textContent=say("Your Movies","Ваши фильмы");n.tv.title.textContent=say("Your TV Shows","Ваши сериалы");
 for(const x of [n.movies,n.tv])x.apply();
}
let collectionBrowseId=null,collectionFetchAt=0,collectionFetchBusy=false,collectionFetchError=false;
function collectionRows(group){
 const members=new Set(group.members);
 return all.filter(r=>r.kind==="movie"&&cinemaEligible(r)&&members.has(r.id)).sort((a,b)=>(Number(a.year)||9999)-(Number(b.year)||9999)||nameSort(a.title,b.title));
}
async function refreshAutomaticCollections(force=false){
 if(collectionFetchBusy||(!force&&Date.now()-collectionFetchAt<300000))return;
 collectionFetchBusy=true;collectionFetchAt=Date.now();collectionFetchError=false;
 try{
  const data=await jfCall("collections",{force:force?"1":"0"});
  if(!Array.isArray(data))throw Error("Invalid collections");
  const ids=new Map();
  for(const row of all)if(row.kind==="movie"&&row.jellyfinIdentity?.itemId){const key=row.jellyfinIdentity.itemId;if(!ids.has(key))ids.set(key,[]);ids.get(key).push(row.id);}
  window.DKCollections.setAutomatic(data.map(g=>({...g,members:(g.members||[]).flatMap(id=>ids.get(id)||[])})));
 }catch(_){collectionFetchError=true;}
 finally{collectionFetchBusy=false;if(homePage==="collections")void render();}
}
async function paintCollectionArt(box,group,first,epoch){
 if(!group.id){imageQueue.push({id:artId(first),row:first,series:false,box,epoch});pumpArtwork();return;}
 const key="boxset:"+group.id;
 try{
  let art=await store.artwork(key);
  if(!art?.blob){const r=await nativeBridge.metadataRequest("dk-jellyfin://catalog/collection-image?"+new URLSearchParams({id:group.id}),"image");
   if(r.ok&&/^image\/(jpeg|png|webp)$/.test(r.mime)){const blob=new Blob([r.bytes],{type:r.mime});await store.saveArtwork(key,blob,"Jellyfin");art={blob};}}
  if(epoch!==renderEpoch||!box.isConnected)return;
  if(art?.blob){displayArtwork({box,epoch},art.blob);return;}
 }catch(_){}
 if(epoch===renderEpoch&&box.isConnected){imageQueue.push({id:artId(first),row:first,series:false,box,epoch});pumpArtwork();}
}
function renderCollections(){
 const list=$("libraryCollection"),section=cinema.collection,api=window.DKCollections;
 $("seriesDetail").hidden=true;$("emptyLibrary").hidden=true;$("loadMoreLibrary").hidden=true;
 $("continueSection").hidden=true;cinema.shelves.hidden=true;list.classList.remove("dk-cinema-episodes");
 if(collectionTools)collectionTools.bar.hidden=true;
 let toolbar=$("dkBoxSetTools");
 if(!toolbar){toolbar=create("div","dk-boxset-tools");toolbar.id="dkBoxSetTools";list.before(toolbar);}
 toolbar.hidden=false;toolbar.replaceChildren();
 const groups=api.groups().map(g=>({...g,rows:collectionRows(g)})).filter(g=>g.rows.length).sort((a,b)=>nameSort(a.name,b.name));
 const chosen=groups.find(g=>seriesKey(g.name)===collectionBrowseId);
 list.replaceChildren();
 const refresh=cinemaButton("Refresh Collections","Обновить коллекции",()=>void refreshAutomaticCollections(true));
 refresh.disabled=collectionFetchBusy;
 toolbar.append(refresh);
 if(chosen){
  toolbar.prepend(cinemaButton("All Collections","Все коллекции",()=>{collectionBrowseId=null;void render();}));
  if(chosen.description)toolbar.append(create("p","helper",chosen.description));
  $("collectionTitle").textContent=chosen.name;
  $("collectionCount").textContent=say(chosen.rows.length+" movies",chosen.rows.length+" фильмов");
  let count=72;list.replaceChildren(...chosen.rows.slice(0,count).map(row=>createCard(row)));
  if(chosen.rows.length>count){const more=cinemaButton("Show more","Показать ещё",()=>{for(const row of chosen.rows.slice(count,count+72))list.insertBefore(createCard(row),more);count+=72;if(count>=chosen.rows.length)more.remove();pumpArtwork();});list.append(more);}
 }else{
  collectionBrowseId=null;$("collectionTitle").textContent=say("Your Collections","Ваши коллекции");$("collectionCount").textContent=say(groups.length+" collections",groups.length+" коллекций");
  for(const group of groups.slice(0,700)){
   const card=create("button","library-card dk-boxset-card");card.type="button";
   const box=coverShell(false);card.append(box,create("span","library-card-title",group.name),create("span","library-card-detail",say(group.rows.length+" movies",group.rows.length+" фильмов")));
   card.addEventListener("click",()=>{collectionBrowseId=seriesKey(group.name);void render();});list.append(card);
   void paintCollectionArt(box,group,group.rows[0],renderEpoch);
  }
  if(!groups.length)list.append(create("p","helper",say("No collections yet. Refresh verified server collections or use Manage Collections on a movie.","Коллекций пока нет. Обновите коллекции сервера или выберите управление коллекциями в меню фильма.")));
 }
 if(collectionFetchError)toolbar.append(create("p","helper",say("Server collections unavailable. Saved collections remain accessible.","Коллекции сервера недоступны. Сохранённые коллекции доступны.")));
 else if(collectionFetchBusy)toolbar.append(create("p","helper",say("Refreshing collections…","Обновление коллекций…")));
 void refreshAutomaticCollections();
}
function renderHome(){
 const n=cinema,home=homePage==="home",rows=all.filter(r=>cinemaEligible(r)&&matchesCinema(r)&&(home||window.DKCollections?.has(r)));
 const movies=sortCinema(rows.filter(r=>r.kind==="movie")),tv=sortCinema(uniqueSeries(rows.filter(r=>r.kind==="tv")));
 for(const [s,items,series] of [[n.movies,movies,false],[n.tv,tv,true]]){
  if(s.list.hidden){s.list.replaceChildren();continue;}
  let count=home?72:72;
  s.list.replaceChildren(...items.slice(0,count).map(r=>createCard(r,{series})));
  if(!items.length)s.list.append(create("p","helper",say("No matching titles.","Нет подходящих наименований.")));
  if(items.length>count){const more=cinemaButton("Show more","Показать ещё",()=>{for(const r of items.slice(count,count+24))s.list.insertBefore(createCard(r,{series}),more);count+=24;if(count>=items.length)more.remove();pumpArtwork();});s.list.append(more);}
 }
 $("libraryCollection").replaceChildren();
 if(home){const resume=$("continueWatching"),scroll=resume.scrollLeft;resume.replaceChildren(...all.filter(r=>cinemaEligible(r)&&needsContinue(r)).sort((a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0)).map(r=>createCard(r,{landscape:true})));resume.scrollLeft=scroll;if(!featureTimer&&!externalBusy)nextLocal();}
 else $("continueWatching").replaceChildren();
 if(!scanning)status("Library loaded from local cache.","Медиатека загружена из локального хранилища.");
 $("folderSummary").textContent=say("Assigned folders: "+assignedSources.length+" · Manual scans only","Выбранные папки: "+assignedSources.length+" · Только ручная проверка");
}

function connect(){
  setupCollectionTools();
  for(const [id,scope,action] of [["seriesDetails","series",showTVDetails],["seasonDetails","season",showTVDetails],["editSeriesDetails","series",editHierarchyDialog],["editSeasonDetails","season",editHierarchyDialog],["seasonArtwork","season",chooseArtworkDialog]]){
    $(id)?.addEventListener("click",()=>{const row=tvRepresentative(scope);if(row)void action(row,scope);});
  }
  $("watchlistAction")?.addEventListener("click",()=>{const row=contextRow;hideContextMenu();if(!row||!window.DKCollections)return;if(!window.DKCollections.toggle(row)){status("Could not save watchlist.","Не удалось сохранить список просмотра.",true);return;}void render();});
  $("manageMovieCollection")?.addEventListener("click",()=>{const row=contextRow;hideContextMenu();collectionDialog(row,"collection");});
  $("manageMovieEdition")?.addEventListener("click",()=>{const row=contextRow;hideContextMenu();collectionDialog(row,"edition");});
  $("movieDetailsAction").addEventListener("click",()=>void showMovieDetails());
  $("refreshMovieMetadata").addEventListener("click",()=>void refreshSelection());
  $("fixMatch").addEventListener("click",()=>void showFixMatch());
  $("editLocalMetadata").addEventListener("click",()=>void editMetadataDialog());
  $("chooseArtwork").addEventListener("click",()=>void chooseArtworkDialog());
  $("chooseBackground").addEventListener("click",()=>void chooseArtworkDialog(null,null,true));
  $("seriesBackground").addEventListener("click",()=>{const row=tvRepresentative("series");if(row)void chooseArtworkDialog(row,"series",true);});
  $("seriesBackground").textContent=say("Series Background","Фон сериала");
  $("reclassifyMedia").addEventListener("click",()=>void reclassifyDialog());
  if(nativeBridge?.metadataRequest){$("jellyfinPower")?.addEventListener("click",()=>void toggleJellyfinPower());paintJellyfinState({state:"unknown",enabled:false,controllable:false});void pollJellyfin();setInterval(pollJellyfin,2000);}
  $("movieDetailsClose").addEventListener("click",()=>$("movieDetailsDialog").close());
  $("movieDetailsDialog").addEventListener("close",()=>{detailMovieId=null;clearBackdrop($("movieDetailsDialog"));const p=$("movieDetailsDialog").querySelector(".dk-person-credits");p?.dispose?.();p?.remove();});
  $("markWatched").addEventListener("click",()=>markContext(true));
  $("markUnwatched").addEventListener("click",()=>markContext(false));
  $("watchedFilter").addEventListener("change",event=>{watchedFilter=event.target.value;visibleCount=72;void render();});
  for(const [id,watched] of [["markSeasonWatched",true],["markSeasonUnwatched",false]]){
    $(id).addEventListener("click",()=>void markHistory(all.filter(row=>row.kind==="tv"&&seriesKey(row.series)===seriesKey(selectedSeries)&&row.season===selectedSeason),watched));
  }
  $("removeContinueWatching").addEventListener("click",()=>void removeContinueWatching());
  $("removeFromLibrary").addEventListener("click",()=>void removeFromLibrary());
  $("showInFolder").addEventListener("click",()=>void showInFolder());
  $("locateFile").addEventListener("click",()=>{const row=contextRow;hideContextMenu();void recoverFile(row,true);});
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
    const labels=()=>{$("scanLibrary").textContent=say(scanning?"Stop Scan":"Scan Library",scanning?"Остановить":"Проверить медиатеку");$("movieDetailsAction").textContent=say("Movie Details","О фильме");$("refreshMovieMetadata").textContent=say("Refresh Metadata","Обновить метаданные");};
    labels();$("languageSelect").addEventListener("change",()=>queueMicrotask(labels));
    const trash=$("libraryEmptyTrash"),refresh=$("libraryRefreshMetadata");
    if(nativeBridge.requestMaintenance){
      trash.hidden=false;refresh.hidden=false;
      refresh.addEventListener("click",()=>void nativeBridge.requestMaintenance("refresh",lang()).catch(()=>status("Library maintenance failed.","Не удалось выполнить обслуживание медиатеки.",true)));
      trash.addEventListener("click",()=>void nativeBridge.requestMaintenance("trash",lang()).catch(()=>status("Library maintenance failed.","Не удалось выполнить обслуживание медиатеки.",true)));
      let busy=false,refreshing=false,scanBusy=false;
      const sync=()=>{trash.disabled=busy||scanning||scanBusy;refresh.disabled=scanBusy||scanning||(busy&&!refreshing);refresh.textContent=refreshing?say("Stop Refresh","Остановить обновление"):say("Refresh Metadata","Обновить метаданные");};
      nativeBridge.onMaintenanceStatus?.(value=>{busy=!!value.busy;refreshing=busy&&value.action==="refresh";sync();});
      nativeBridge.onScanState?.(value=>{scanBusy=!!value;sync();});
      $("languageSelect").addEventListener("change",()=>queueMicrotask(sync));sync();
    }
    $("scanLibrary").classList.remove("primary","ghost");
    $("scanLibrary").classList.add("dk-scan");
    nativeBridge.onScanRequest(()=>void scan(true));
    nativeBridge.onMaintenanceRequest?.(action=>void libraryMaintenance(action));
    nativeBridge.onRestoreNavigation?.(value=>{
      homePage=null;mode=value.mode;selectedSeries=value.series;selectedSeason=value.season;visibleCount=72;
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
    tv.addEventListener("click",()=>{homePage=null;window.DKLiveTV?.open();if(cinema)syncCinema();});
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
    const categories=[["playback","Playback"],["picture","Picture Settings"],["audio","Audio"],["subtitles","Subtitles"],["disc","DVD & Disc"],["network","Network"],["library","Library"],["server",say("Server","Сервер")],["general","General"]];
    const nav=create("div","dk-settings-category-nav");dlg.insertBefore(nav,body);
    const back=create("button","btn small","Back to settings");back.type="button";nav.append(back);
    const categoryButtons=new Map();
    const extra=create("div","dk-settings-extra");body.after(extra);
    // Keep the original power button and status nodes connected at all times.
    // Polling and existing event handlers continue to operate while settings close.
    const serverPanel=create("section","dk-server-settings");
    serverPanel.hidden=true;dlg.append(serverPanel);
    const serverControls=$("jellyfinServerControls");
    if(serverControls)serverPanel.append(serverControls);
    const lifecycle=create("p","helper");
    const networkInfo=create("p","helper");
    const diagnosticsTitle=create("h3",null,say("Diagnostics","Диагностика"));
    const diagnostics=create("pre","dk-server-diagnostics");
    diagnostics.setAttribute("aria-live","polite");
    const reportActions=create("div","dk-server-report-actions");
    const refreshReport=create("button","btn",say("Refresh Diagnostics","Обновить диагностику"));refreshReport.type="button";
    const exportReport=create("button","btn",say("Export Report","Сохранить отчёт"));exportReport.type="button";exportReport.disabled=true;
    reportActions.append(refreshReport,exportReport);
    serverPanel.append(lifecycle,networkInfo,diagnosticsTitle,diagnostics,reportActions);
    let report=null,reportEpoch=0;
    const updateServerLabels=()=>{
      lifecycle.textContent=say("The power choice is remembered for automatic startup. The private server is designed to remain running after the app closes.","Выбранное состояние питания сохраняется для автоматического запуска. Частный сервер может продолжать работу после закрытия приложения.");
      networkInfo.textContent=say("The integrated private server is local-only. Remote access is not enabled.","Встроенный частный сервер доступен только локально. Удалённый доступ не включён.");
      diagnosticsTitle.textContent=say("Diagnostics","Диагностика");
      refreshReport.textContent=say("Refresh Diagnostics","Обновить диагностику");
      exportReport.textContent=say("Export Report","Сохранить отчёт");
    };
    async function updateReport(){
      const ticket=++reportEpoch;report=null;exportReport.disabled=true;
      diagnostics.textContent=say("Reading server status…","Получение состояния сервера…");
      try{
        const d=await jfCall("diagnostics");
        if(ticket!==reportEpoch||serverPanel.hidden)return;
        report={generatedAt:new Date().toISOString(),...d};
        const words={off:["Off","Выключен"],starting:["Starting","Запускается"],stopping:["Stopping","Останавливается"],ready:["Running","Работает"],scanning:["Scanning","Сканирование"],external:["External server","Внешний сервер"],unavailable:["Unavailable","Недоступен"],unknown:["Unknown","Неизвестно"]};
        const state=words[d.state]||words.unknown;
        const yn=v=>v?say("Yes","Да"):say("No","Нет");
        diagnostics.textContent=[
          say("State: ","Состояние: ")+say(...state),
          say("Runtime executable present: ","Исполняемый файл доступен: ")+yn(d.runtimeExecutable),
          say("Enabled for startup: ","Автозапуск включён: ")+yn(d.enabled),
          say("Managed process running: ","Управляемый процесс работает: ")+yn(d.runningProcess),
          say("Assigned media folders: ","Назначенные папки: ")+d.folderCount,
          say("Local port: ","Локальный порт: ")+(d.port??say("Not assigned","Не назначен")),
          ...(typeof d.progress==="number"?[say("Scan progress: ","Ход сканирования: ")+Math.round(d.progress)+"%"]:[]),
          say("Last successful scan: ","Последнее успешное сканирование: ")+(d.completed||say("Unknown","Неизвестно"))
        ].join("\n");
        exportReport.disabled=false;
      }catch(_){if(ticket===reportEpoch)diagnostics.textContent=say("Server diagnostics unavailable.","Диагностика сервера недоступна.");}
    }
    refreshReport.addEventListener("click",()=>{void pollJellyfin();void updateReport();});
    exportReport.addEventListener("click",()=>{
      if(!report)return;
      const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)+"\n"],{type:"application/json"}));
      const a=create("a");a.href=url;a.download="DK-Kinehall-Server-Diagnostics.json";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    });
    const chooseCategory=id=>{
      selectedCategory=id;
      title.textContent=id==="server"?say("Server","Сервер"):categories.find(([key])=>key===id)?.[1]||"Settings";
      back.hidden=!id;for(const [key,btn] of categoryButtons)btn.hidden=!!id;
      body.hidden=!id;for(const section of body.children)section.hidden=section.dataset.settingsCategory!==id;
      extra.replaceChildren();extra.hidden=true;
      serverPanel.hidden=id!=="server";if(id==="server"){body.hidden=true;updateServerLabels();void updateReport();void pollJellyfin();}else{reportEpoch++;}
      const toolButton=(label,handler)=>{const btn=create("button","btn",label);btn.type="button";btn.addEventListener("click",handler);extra.append(btn);extra.hidden=false;};
      if(id==="network"||id==="disc"){
        if(nativeBridge.openMediaTool)toolButton(id==="network"?"Network media…":"Open DVD…",async()=>{if(busy)return;busy=true;try{await nativeBridge.openMediaTool(id);dlg.close();}catch(_){setFeedback("Could not open media tool.");}finally{busy=false;}});
        extra.append(create("p","helper",id==="network"?"Discover DLNA servers and open compatible local network streams.":"Open DVD drives, ISO images and DVD folders with a compatible decoder."));
      }
      if(id==="library"){
        if(nativeBridge.librarySources)toolButton(say("Library Management","Управление медиатекой"),()=>{dlg.close();void openLibraryManagement();});
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
    dlg.addEventListener("close",()=>{epoch++;reportEpoch++;serverPanel.hidden=true;body.replaceChildren();button.focus();});
    openCinemaSettings=async(category=null)=>{
      if(dlg.open){chooseCategory(category);return;}
      const ticket=++epoch;dlg.showModal();chooseCategory(category);setFeedback(category==="server"?"":"Loading settings…");body.inert=true;busy=true;
      try{const sections=await nativeBridge.openSharedSettings(lang());if(ticket===epoch&&dlg.open){renderShared(sections);setFeedback("");}}
      catch(_){if(ticket===epoch&&dlg.open&&selectedCategory!=="server")setFeedback("Could not open settings.");}
      finally{busy=false;body.inert=false;}
    };
    button.addEventListener("click",()=>void openCinemaSettings(null));
  }
  if(nativeBridge?.internalPages)setupCinema();
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
  if(nativeBridge&&!cinema){
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
  void (async()=>{if(nativeBridge?.librarySources){assignedSources=await nativeBridge.librarySources();await store.applyNativeScope(assignedSources);}await render();})().then(()=>{
    recordNavigation();
    // Render saved posters immediately. A bounded, one-shot rescan is
    // attempted only after initialization; no daemon or persistent server.
    const start=()=>{
      if(!nativeBridge&&folders.length)void scan(false);
    };
    if("requestIdleCallback" in window)
      requestIdleCallback(start,{timeout:3500});
    else setTimeout(start,2500);
  }).catch(error=>status("Local library unavailable: "+error.message,
    "Локальная медиатека недоступна.",true));
}
connect();
})();
