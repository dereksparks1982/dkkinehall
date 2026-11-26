/* DK Media Player: browser-side episode & movie artwork metadata.
 * TVmaze (CC BY-SA, https://www.tvmaze.com/api) is keyless and CORS-enabled.
 * Optional TMDb Read Access Token enables a second source (not embedded).
 * No file bytes or full local paths leave the browser: only parsed titles,
 * seasons and episode numbers are sent to the selected provider.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.DKMediaMetadata=api;
})(typeof window!=="undefined"?window:globalThis,function(){
 "use strict";
 const TV="https://api.tvmaze.com";
 const TM="https://api.themoviedb.org/3";
 const APPLE="https://itunes.apple.com/search";
 const CINEMETA="https://v3-cinemeta.strem.io";
 const MAX_BODY=3*1024*1024;
 function normalize(value){
   return String(value||"").normalize("NFKD")
     .replace(/[\u0300-\u036f]/g,"").replace(/&/g," and ")
     .replace(/['’]/g,"").replace(/[^a-zA-Z0-9\u0400-\u04ff]+/g," ")
     .toLowerCase().replace(/\s+/g," ").trim();
 }
 function cleanTitle(name){
   return String(name||"").replace(/[\\/]/g," ").replace(/\.[a-z0-9]{2,5}$/i,"")
     .replace(/[\[\]()]/g," ").replace(/[._]+/g," ")
     .replace(/\s+/g," ").trim().slice(0,170);
 }
 function parseFilename(name){
   const text=cleanTitle(name);
   const tv=/(?:^|[\s-])(?:s(\d{1,2})[\s-]*e(\d{1,3})|(\d{1,2})[\s-]*x[\s-]*(\d{1,3}))(?=$|[\s-])/i.exec(text);
   if(tv){
     let series=text.slice(0,tv.index).replace(/[\s:-]+$/,"").trim();
     const yearMatch=/\s+((?:19|20)\d{2})$/.exec(series);
     const year=yearMatch?Number(yearMatch[1]):null;
     series=series.replace(/\s+(?:19|20)\d{2}$/,"").trim();
     const season=Number(tv[1]||tv[3]),episode=Number(tv[2]||tv[4]);
     // A release filename may already provide the episode name. Use it only
     // as a display fallback, never as a substitute for verified metadata.
     const episodeTitle=text.slice(tv.index+tv[0].length)
       .replace(/^[\s:–—-]+/,"")
       .replace(/(?:^|\s)(?:2160p|1080p|720p|480p|4k|uhd|hdr10?|bluray|blu ray|brrip|dvdrip|web[\s-]?rip|web[\s-]?dl|h26[45]|x26[45]|hevc|av1|aac|ac3|ddp|dts|remux|repack|proper)(?:\b.*)?$/i,"")
       .replace(/[\s:–—-]+$/,"").trim();
     if(series.length>=2&&season<=99&&episode>=1&&episode<=999)
       return {type:"episode",series,season,episode,year,
         ...(episodeTitle?{episodeTitle:episodeTitle.slice(0,140)}:{})};
     return null;
   }
   const withoutTags=text.replace(/\s+(?:2160p|1080p|720p|480p|4k|uhd|hdr10?|dv|bluray|blu ray|brrip|bdrip|dvdrip|webrip|web dl|web rip|h26[45]|x26[45]|hevc|av1|ddp|dts|aac|ac3)(?:\b.*)?$/i,"").trim();
   const movie=/^(.+?)\s+((?:19|20)\d{2})(?:\s|$)/.exec(withoutTags);
   let title=movie?movie[1].trim():withoutTags;
   if(title.length<2)return null;
   return {type:"movie",title:title.slice(0,120),year:movie?Number(movie[2]):null};
 }
 function findExact(query,values,getName){
   const norm=normalize(query);
   const matches=(Array.isArray(values)?values:[]).filter(x=>normalize(getName(x))===norm);
   return matches.length===1?matches[0]:null;
 }
 function findShow(info,values){
   const norm=normalize(info.series);
   const compact=value=>normalize(value).replace(/\s+/g,"");
   const entries=(Array.isArray(values)?values:[]).filter(x=>x?.show&&
     typeof x.show.name==="string"&&Number.isSafeInteger(x.show.id));
   const exact=entries.filter(x=>normalize(x.show.name)===norm);
   // Jellyfin-style robust normalization: "Butt-Head", "Butthead" and
   // "Butt.Head" should be one candidate, not three unrelated TV shows.
   const collapsed=entries.filter(x=>compact(x.show.name)===compact(norm));
   const tail=entries.filter(x=>{
     const name=normalize(x.show.name);
     return norm.length>=11 && (name.endsWith(" "+norm)||norm.endsWith(" "+name));
   });
   const candidate=exact.length?exact:collapsed.length?collapsed:tail;
   if(info.year){
     const dated=candidate.filter(x=>String(x.show.premiered||"").slice(0,4)===String(info.year));
     if(dated.length===1)return dated[0].show;
   }
   return candidate.length===1?candidate[0].show:null;
 }
 function allowedImage(url,provider){
   if(typeof url!=="string")return null;
   try{
     const parsed=new URL(url);
     const hosts=provider==="TVmaze"?["static.tvmaze.com","images.tvmaze.com"]:
       provider==="TMDb"?["image.tmdb.org"]:[];
     const cinema=provider==="Cinemeta" &&
       parsed.hostname==="images.metahub.space";
     const apple=provider==="Apple" &&
       /^(?:is\d+-ssl|a\d+|is\d+)\.mzstatic\.com$/.test(parsed.hostname);
     return parsed.protocol==="https:"&&(hosts.includes(parsed.hostname)||apple||cinema)?
       parsed.href:null;
   }catch(_){return null;}
 }
 function allowedCredit(url,provider){
   if(typeof url!=="string")return null;
   try{
     const parsed=new URL(url);
     const hosts=provider==="TVmaze"?["www.tvmaze.com","tvmaze.com"]:
       provider==="TMDb"?["www.themoviedb.org","themoviedb.org"]:
       provider==="Apple"?["itunes.apple.com","tv.apple.com"]:
       provider==="Cinemeta"?["www.imdb.com"]:[];
     return parsed.protocol==="https:"&&hosts.includes(parsed.hostname)?parsed.href:null;
   }catch(_){return null;}
 }
 // Apple movie posters are available without a TMDb token. Its public
 // Search API explicitly supports cross-site JSONP, including file://
 // Chromium applications where ordinary CORS fetch may be restricted.
 let jsonpSerial=0;
 function appleJSONP(url){
   if(typeof document==="undefined"||!document.createElement)return Promise.resolve(null);
   return new Promise(resolve=>{
     const callback="__dkKinehallApple"+(++jsonpSerial);
     const script=document.createElement("script");
     let finished=false;
     const finish=value=>{
       if(finished)return;
       finished=true;
       clearTimeout(timer);
       delete globalThis[callback];
       script.remove();
       resolve(value);
     };
     globalThis[callback]=value=>finish(value);
     script.async=true;
     script.referrerPolicy="no-referrer";
     script.onerror=()=>finish(null);
     const timer=setTimeout(()=>finish(null),9500);
     script.src=url+(url.includes("?")?"&":"?")+"callback="+callback;
     document.head.append(script);
   });
 }
 function applePoster(url){
   const source=allowedImage(url,"Apple");
   if(!source)return null;
   // Apple's URLs are 100px thumbnails by default. Request a poster-sized
   // asset from the same trusted CDN without storing image bytes locally.
   const large=source.replace(/\/100x100(?:bb|-75)(\.(?:jpe?g|png|webp))(?:\?.*)?$/i,
     "/400x600bb$1");
   return allowedImage(large,"Apple");
 }
 function pickAppleMovie(info,rows){
   const title=normalize(info.title);
   const candidates=(Array.isArray(rows)?rows:[]).filter(row=>{
     if(!row||row.kind!=="feature-movie"||
        normalize(row.trackName||"")!==title)return false;
     return !!applePoster(row.artworkUrl100);
   });
   if(!candidates.length)return null;
   const year=Number(info.year)||null;
   // No poster for an ambiguous remake: a search match needs to agree
   // with the year when the filename identifies one.
   const dated=year?candidates.filter(row=>
     String(row.releaseDate||"").slice(0,4)===String(year)):[];
   const chosen=year?(dated[0]||(
     candidates.length===1&&!candidates[0].releaseDate?candidates[0]:null)):
     candidates[0];
   if(!chosen)return null;
   return {type:"movie",still:applePoster(chosen.artworkUrl100),series:null,
     title:chosen.trackName||info.title,provider:"Apple",
     credit:allowedCredit(chosen.trackViewUrl,"Apple")||"https://itunes.apple.com"};
 }
 function pickCinemetaMovie(info,metas){
   const title=normalize(info.title);
   const matches=(Array.isArray(metas)?metas:[]).filter(row=>
     row&&normalize(row.name||"")===title &&
     allowedImage(row.poster,"Cinemeta"));
   const year=Number(info.year)||null;
   const sameYear=year?matches.filter(row=>String(row.year||"")===String(year)):[];
   const chosen=year?(sameYear[0]||(
     matches.length===1&&!matches[0].year?matches[0]:null)):matches[0];
   if(!chosen)return null;
   const id=/^tt\d{6,11}$/.test(String(chosen.id||""))?chosen.id:null;
   return {type:"movie",still:allowedImage(chosen.poster,"Cinemeta"),
     series:null,title:chosen.name||info.title,provider:"Cinemeta",
     credit:id?"https://www.imdb.com/title/"+id+"/":null};
 }
 function create({fetchJSON=typeof fetch==="function"?fetch.bind(globalThis):null,
                  selectImage=null,token=()=>"",enabled=()=>true,
                  appleSearch=typeof document!=="undefined"?appleJSONP:null,
                  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
   const searchTV=new Map(),episodesTV=new Map();
   const searchTM=new Map(),searchApple=new Map(),searchCinema=new Map();
   let appleGate=Promise.resolve(),lastAppleRequest=0;
   const queuedApple = url => {
     const task=appleGate.catch(()=>{}).then(async()=>{
       // The public catalog recommends at most ~20 requests per minute.
       // Visible images are prioritized by the sidebar's observer.
       const remaining=Math.max(0,3150-(Date.now()-lastAppleRequest));
       if(remaining)await sleep(remaining);
       lastAppleRequest=Date.now();
       let result=appleSearch?await appleSearch(url):null;
       if(!result)result=await request(url);
       return result;
     });
     appleGate=task.then(()=>undefined,()=>undefined);
     return task;
   };
   let gate=Promise.resolve(),lastRequest=0;
   // One request at a time and at least 650ms apart: well below TVmaze's
   // documented rate limit. Requests for a series share in-flight promises.
   function request(url,headers={}){
     const task=gate.catch(()=>{}).then(async()=>{
       if(!fetchJSON)return null;
       // Retry temporary network errors and rate limits. Never retry
       // permanent 404 responses or a provider's rejected credentials.
       for(let attempt=0;attempt<3;attempt++){
         const wait=Math.max(0,650-(Date.now()-lastRequest));
         if(wait)await sleep(wait);
         lastRequest=Date.now();
         const opts={method:"GET",mode:"cors",credentials:"omit",headers};
         const controller=typeof AbortController!=="undefined"?new AbortController():null;
         let timer;
         if(controller){
           opts.signal=controller.signal;
           timer=setTimeout(()=>controller.abort(),10000);
         }
         try{
           const response=await fetchJSON(url,opts);
           const status=Number(response?.status)||0;
           if(response?.ok){
             if(typeof response.text==="function"){
               const raw=await response.text();
               return raw.length<=MAX_BODY?JSON.parse(raw):null;
             }
             return typeof response.json==="function"?await response.json():null;
           }
           if(status!==429&&(status<500||status>=600))return null;
         }catch(_){/* Network outage or timeout; try again below. */}
         finally{clearTimeout(timer);}
         if(attempt<2)await sleep(1000*(attempt+1));
       }
       return null;
     });
     gate=task.then(()=>undefined,()=>undefined);
     return task;
   }
   async function tvEpisode(info){
     const key=normalize(info.series);
     if(!searchTV.has(key)){
       searchTV.set(key,request(TV+"/search/shows?q="+encodeURIComponent(info.series))
         .then(list=>findShow(info,list)));
     }
     let show=await searchTV.get(key);
     // A compact alternate query helps with dot-separated and unhyphenated
     // filenames, without accepting an ambiguous result.
     if(!show){
       const compact=info.series
         .replace(/\bbutt[\s-]*head\b/ig,"Butt-Head")
         .replace(/\bjudges\b/ig,"Judge's");
       if(compact!==info.series){
         const alt=await request(TV+"/search/shows?q="+encodeURIComponent(compact));
         show=findShow(info,alt);
       }
     }
     if(!show||!Number.isSafeInteger(show.id)||show.id<=0)return null;
     if(!episodesTV.has(show.id))
       episodesTV.set(show.id,request(TV+"/shows/"+show.id+"/episodes"));
     const episodes=await episodesTV.get(show.id);
     const episode=(Array.isArray(episodes)?episodes:[]).find(x=>
       x&&x.season===info.season&&x.number===info.episode);
     // The show's own art is a safe fallback if an episode still is absent
     // or an episode list cannot be retrieved. Never fabricate an image.
     const series=allowedImage(show.image?.medium||show.image?.original,"TVmaze");
     if(!episode&&!series)return null;
     const still=allowedImage(episode?.image?.medium||episode?.image?.original,"TVmaze");
     return {still,series,title:episode?.name||"",show:show.name||"",
       provider:"TVmaze",credit:allowedCredit(episode?.url||show.url,"TVmaze")||
         "https://www.tvmaze.com"};
   }
   function tmdbImage(path,size){
     if(typeof path!=="string"||!/^\/[a-zA-Z0-9_./-]+\.(?:jpg|jpeg|png|webp)$/i.test(path))
       return null;
     return allowedImage("https://image.tmdb.org/t/p/"+size+path,"TMDb");
   }
   async function tmdbSearch(kind,title,year){
     const secret=String(token()||"").trim();
     if(!secret||secret.length<20||secret.length>1500)return null;
     const searchKey=kind+":"+normalize(title)+":"+(year||"")+":"+secret;
     if(!searchTM.has(searchKey)){
       const url=new URL(TM+"/search/"+kind);
       url.searchParams.set("query",title);
       url.searchParams.set("include_adult","false");
       if(year)url.searchParams.set(kind==="movie"?"year":"first_air_date_year",year);
       searchTM.set(searchKey,request(url.href,{Authorization:"Bearer "+secret})
         .then(data=>findExact(title,data?.results,x=>x?.name||x?.title)));
     }
     return searchTM.get(searchKey);
   }
   async function tmdbEpisode(info){
     const found=await tmdbSearch("tv",info.series,null);
     if(!found||!Number.isSafeInteger(found.id)||found.id<=0)return null;
     const secret=String(token()||"").trim();
     const ep=await request(TM+"/tv/"+found.id+"/season/"+info.season+
       "/episode/"+info.episode,{Authorization:"Bearer "+secret});
     if(!ep)return null;
     return {still:tmdbImage(ep.still_path,"w300"),
       series:tmdbImage(found.backdrop_path,"w300")||tmdbImage(found.poster_path,"w185"),
       title:ep.name||"",show:found.name||"",provider:"TMDb",
       credit:"https://www.themoviedb.org/tv/"+found.id+
         "/season/"+info.season+"/episode/"+info.episode};
   }
   async function cinemetaMovie(info){
     const key=normalize(info.title)+":"+(info.year||"");
     if(!searchCinema.has(key)){
       const url=CINEMETA+"/catalog/movie/top/search="+
         encodeURIComponent(info.title)+".json";
       searchCinema.set(key,(async()=>{
         if(!fetchJSON)return null;
         const controller=typeof AbortController==="function"?new AbortController():null;
         const timer=controller?setTimeout(()=>controller.abort(),8500):null;
         try {
           const response=await fetchJSON(url,{method:"GET",mode:"cors",
             credentials:"omit",...(controller?{signal:controller.signal}:{})});
           if(!response?.ok)return null;
           const data=typeof response.json==="function"?
             await response.json():typeof response.text==="function"?
             JSON.parse(await response.text()):null;
           return pickCinemetaMovie(info,data?.metas);
         }catch(_){return null;}
         finally{if(timer)clearTimeout(timer);}
       })());
     }
     return searchCinema.get(key);
   }
   async function appleMovie(info){
     const key=normalize(info.title)+":"+(info.year||"");
     if(!searchApple.has(key)){
       const params=new URLSearchParams({
         term:info.title,country:"US",media:"movie",entity:"movie",
         attribute:"movieTerm",limit:"25"
       });
       const url=APPLE+"?"+params.toString();
       searchApple.set(key,queuedApple(url)
         .then(data=>pickAppleMovie(info,data?.results)));
     }
     return searchApple.get(key);
   }
   async function tmdbMovie(info){
     const found=await tmdbSearch("movie",info.title,info.year);
     if(!found)return null;
     if(info.year&&typeof found.release_date==="string"&&
        !found.release_date.startsWith(String(info.year)))return null;
     // Prefer a movie poster over a landscape backdrop.
     const art=tmdbImage(found.poster_path,"w342")||tmdbImage(found.backdrop_path,"w300");
     if(!art)return null;
     return {type:"movie",still:art,series:null,title:found.title||info.title,
       provider:"TMDb",credit:"https://www.themoviedb.org/movie/"+found.id};
   }
   function choose(data){
     if(!data)return null;
     // Jellyfin-style image priority is implemented by the source adaptation.
     // Thumb = episode still, SeriesThumb = show fallback artwork.
     const item=data.type==="movie"?
       {Type:"Movie",ImageTags:{Primary:data.still}}:
       {Type:"Episode",ImageTags:{Thumb:data.still},
         SeriesThumbImageTag:data.series};
     const picked=selectImage?selectImage(item,{preferThumb:true}):
       data.still?{url:data.still,kind:"Thumb"}:
       data.series?{url:data.series,kind:"Thumb"}:null;
     return picked?{url:picked.url,kind:picked.kind,provider:data.provider,
       credit:data.credit,title:data.title,
       fallbackUrl:data.series&&data.series!==picked.url?data.series:null}:null;
   }
   async function find(filename,options={}){
     if(!enabled())return null;
     const info=parseFilename(filename);
     if(!info)return null;
     if(info.type==="movie"){
       // Broken images can fall back to a different trusted provider.
       const excluded=new Set(Array.isArray(options.excludeProviders)?
         options.excludeProviders:[]);
       if(!excluded.has("TMDb")&&token()){
         const tm=choose(await tmdbMovie(info));
         if(tm)return tm;
       }
       if(!excluded.has("Cinemeta")){
         const cinema=choose(await cinemetaMovie(info));
         if(cinema)return cinema;
       }
       return excluded.has("Apple")?null:choose(await appleMovie(info));
     }
     const tv=await tvEpisode(info);
     if(tv?.still)return choose({...tv,type:"episode"});
     if(token()){
       const tm=await tmdbEpisode(info);
       if(tm?.still)return choose({...tm,type:"episode"});
       if(tv?.series)return choose({...tv,type:"episode"});
       return choose(tm?{...tm,type:"episode"}:null);
     }
     return choose(tv?{...tv,type:"episode"}:null);
   }
   // Episode names can resolve even when artwork is unavailable.
   async function episodeTitle(filename){
     const info=parseFilename(filename);
     if(info?.type!=="episode")return null;
     const tv=await tvEpisode(info);
     if(typeof tv?.title==="string"&&tv.title.trim())return tv.title.trim();
     if(token()){
       const tm=await tmdbEpisode(info);
       if(typeof tm?.title==="string"&&tm.title.trim())return tm.title.trim();
     }
     return null;
   }
   function clear(){
     searchTV.clear();episodesTV.clear();searchTM.clear();searchApple.clear();searchCinema.clear();
   }
   return {find,episodeTitle,clear};
 }
 return {normalize,parseFilename,findExact,findShow,allowedImage,allowedCredit,applePoster,pickAppleMovie,pickCinemetaMovie,create};
});