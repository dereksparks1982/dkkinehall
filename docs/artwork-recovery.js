/* DK Kinehall artwork recovery for the ORIGINAL Chromium player.
 * Runs only when the existing Up Next artwork lookup has not displayed a
 * usable image. Never replaces successful episode stills, folder posters,
 * or local frames. No local paths, file data, tokens or media bytes leave
 * the device. No additional interface elements or dependencies are added.
 */
(function(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DKArtworkRecovery = api;
  if (root && root.document) {
    const start = () => api.install(root);
    if (root.document.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', start, {once:true});
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';
  const MAX_CACHE = 180, DAYS = 21, MAX_RESPONSE = 2 * 1024 * 1024;
  const CACHE_KEY = 'dk-kinehall.artwork-recovery.v1';
  const TVMAZE = 'https://api.tvmaze.com';
  const CINEMETA = 'https://v3-cinemeta.strem.io';
  const APPLE = 'https://itunes.apple.com/search';
  const normalize = value => String(value || '').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ')
    .replace(/['’]/g, '').replace(/[^a-zA-Z0-9\u0400-\u04ff]+/g, ' ')
    .toLowerCase().replace(/\s+/g, ' ').trim();
  const keyFor = name => normalize(name).slice(0, 180);
  function parseFilename(file) {
    const name = String(file || '').split(/[\\/]/).pop()
      .replace(/\.(?:mkv|m4v|mp4|mov|avi|webm|ts|ogv)$/i, '')
      .replace(/[._\[\]{}]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 230) return null;
    const episode = /(?:^|[\s-])(?:s(\d{1,2})\s*[- .]?\s*e(\d{1,3})|(\d{1,2})\s*x\s*(\d{1,3}))(?:\b|\s|-)/i.exec(name);
    if (episode) {
      let series = name.slice(0, episode.index).replace(/[\s:,-]+$/, '').trim();
      const yearMatch = /(?:^|\s)((?:19|20)\d{2})$/.exec(series);
      if (yearMatch) series = series.slice(0, yearMatch.index).trim();
      const season = Number(episode[1] || episode[3]);
      const number = Number(episode[2] || episode[4]);
      if (series.length >= 2 && season >= 0 && season <= 99 && number >= 1 && number <= 999)
        return {type:'episode', series, season, episode:number, year:yearMatch ? +yearMatch[1] : null};
      return null;
    }
    const year = /(?:^|\s)((?:19|20)\d{2})(?:\b|$)/.exec(name);
    let title = year ? name.slice(0, year.index).trim() : name;
    title = title.replace(/\s+(?:2160p|1080p|720p|480p|4k|uhd|hdr10?|bluray|blu ray|brrip|dvdrip|webrip|web dl|h26[45]|x26[45]|hevc|av1)(?:\b.*)?$/i, '').trim();
    if (title.length < 2 || title.length > 140) return null;
    return {type:'movie',title,year:year ? +year[1] : null};
  }
  function imageURL(url, provider) {
    if (typeof url !== 'string') return null;
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.username || u.password) return null;
      if (provider === 'TVmaze' && /^(?:static|images)\.tvmaze\.com$/.test(u.hostname)) return u.href;
      if (provider === 'Cinemeta' && u.hostname === 'images.metahub.space') return u.href;
      if (provider === 'Apple' && /^(?:is\d+-ssl|a\d+|is\d+)\.mzstatic\.com$/.test(u.hostname)) return u.href;
    } catch (_) { /* Bad remote URL is not artwork. */ }
    return null;
  }
  function pickShow(info, rows) {
    const target = normalize(info.series);
    const compact = s => normalize(s).replace(/\s+/g, '');
    const matches = (Array.isArray(rows) ? rows : []).filter(row =>
      Number.isSafeInteger(row?.show?.id) && row.show.id > 0 &&
      (normalize(row.show.name) === target || compact(row.show.name) === compact(target)));
    if (info.year) {
      const dated = matches.filter(r => String(r.show.premiered || '').startsWith(String(info.year)));
      if (dated.length === 1) return dated[0].show;
    }
    return matches.length === 1 ? matches[0].show : null;
  }
  function pickMovie(info, metas) {
    const matches = (Array.isArray(metas) ? metas : []).filter(row =>
      normalize(row?.name) === normalize(info.title) && imageURL(row.poster, 'Cinemeta'));
    const dated = info.year ? matches.filter(row => +row.year === info.year) : matches;
    // When a year was specified, never attach the artwork from a remake.
    const chosen = dated.length === 1 ? dated[0] : null;
    return chosen ? imageURL(chosen.poster, 'Cinemeta') : null;
  }
  function pickApple(info, rows) {
    const matches = (Array.isArray(rows) ? rows : []).filter(row =>
      row?.kind === 'feature-movie' && normalize(row.trackName) === normalize(info.title));
    const dated = info.year ? matches.filter(row =>
      String(row.releaseDate || '').startsWith(String(info.year))) : matches;
    const row = dated.length === 1 ? dated[0] : null;
    if (!row) return null;
    const original = imageURL(row.artworkUrl100, 'Apple');
    if (!original) return null;
    // The catalogue returns 100px images, but supports bigger poster URLs.
    const enlarged = original.replace(/\/100x100(?:bb|-75)(\.(?:png|jpe?g|webp))(?:\?.*)?$/i,
      '/400x600bb$1');
    return imageURL(enlarged, 'Apple');
  }
  function createResolver({fetchJSON, appleSearch, timeoutMs=9000, sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
    const fetcher = fetchJSON || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    const waitLimits = new Map();
    const inflight = new Map();
    async function request(url, spacing=700) {
      if (!fetcher) return null;
      // De-duplicate rapid queue redraws for the same title.
      if (inflight.has(url)) return inflight.get(url);
      const run = (async()=>{
        const hostname = new URL(url).hostname;
        const now = Date.now();
        const wait = Math.max(0, (waitLimits.get(hostname) || 0) - now);
        if (wait) await sleep(wait);
        waitLimits.set(hostname,Date.now()+spacing);
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(()=>controller.abort(),timeoutMs) : null;
        try {
          const response = await fetcher(url,{method:'GET',mode:'cors',credentials:'omit',
            ...(controller ? {signal:controller.signal} : {})});
          if (!response?.ok) return null;
          if (typeof response.text === 'function') {
            const raw = await response.text();
            return raw.length <= MAX_RESPONSE ? JSON.parse(raw) : null;
          }
          return typeof response.json === 'function' ? await response.json() : null;
        } catch (_) { return null; }
        finally { if (timer) clearTimeout(timer); }
      })();
      inflight.set(url,run);
      try { return await run; } finally { inflight.delete(url); }
    }
    async function episode(info) {
      const results=[];
      const shows=await request(TVMAZE+'/search/shows?q='+encodeURIComponent(info.series),1000);
      const show=pickShow(info,shows);
      if (!show) return results;
      const episodeURL=TVMAZE+'/shows/'+show.id+'/episodebynumber?season='+info.season+'&number='+info.episode;
      const detail=await request(episodeURL,1000);
      const still = imageURL(detail?.image?.original || detail?.image?.medium,'TVmaze');
      const series = imageURL(show.image?.original || show.image?.medium,'TVmaze');
      if (still) results.push({url:still,provider:'TVmaze',kind:'episode'});
      if (series && series !== still) results.push({url:series,provider:'TVmaze',kind:'series'});
      return results;
    }
    async function movie(info) {
      const images=[];
      const search=CINEMETA+'/catalog/movie/top/search='+encodeURIComponent(info.title)+'.json';
      const cinema=await request(search,1000);
      const found=pickMovie(info,cinema?.metas);
      if(found)images.push({url:found,provider:'Cinemeta',kind:'poster'});
      const params=new URLSearchParams({term:info.title,media:'movie',entity:'movie',
        attribute:'movieTerm',limit:'25',country:'US'});
      const appleUrl=APPLE+'?'+params.toString();
      let apple = await request(appleUrl,3200);
      if (!apple && appleSearch) {
        try { apple = await appleSearch(appleUrl); } catch (_) { /* Optional JSONP fallback. */ }
      }
      const poster=pickApple(info,apple?.results);
      if (poster && !images.some(i=>i.url===poster))
        images.push({url:poster,provider:'Apple',kind:'poster'});
      return images;
    }
    const resolve = async name => {
      const info=parseFilename(name);
      if (!info) return [];
      return info.type === 'episode' ? episode(info) : movie(info);
    };
    return {resolve,request};
  }
  function readCache(storage) {
    if (!storage) return new Map();
    try {
      const entries=JSON.parse(storage.getItem(CACHE_KEY)||'[]');
      return new Map((Array.isArray(entries)?entries:[]).filter(entry=>
        Array.isArray(entry) && typeof entry[0]==='string' && entry[1] &&
        Date.now()-entry[1].at < DAYS*86400000 &&
        imageURL(entry[1].url,entry[1].provider)).slice(-MAX_CACHE));
    } catch (_) { return new Map(); }
  }
  function install(win,options={}) {
    const doc=win?.document;
    const queue=doc?.getElementById('queue');
    if(!queue || queue.__dkArtworkRecoveryInstalled) return false;
    queue.__dkArtworkRecoveryInstalled=true;
    const storage=(()=>{try{return win.localStorage;}catch(_){return null;}})();
    const cache=readCache(storage),busy=new WeakSet();
    const timers=new WeakMap(),resolver=createResolver({
      fetchJSON:options.fetchJSON || (win.fetch ? win.fetch.bind(win) : null),
      appleSearch:options.appleSearch || (async(url)=>{
        // JSONP is used only if Apple's documented CORS endpoint cannot be read.
        if(!doc?.head || !doc.createElement) return null;
        return new Promise(resolve=>{
          const name='__dkArtworkRecovery'+Math.floor(Math.random()*1e9);
          const script=doc.createElement('script');
          let done=false;
          const finish=value=>{
            if(done)return;done=true;
            clearTimeout(timeout);try{delete win[name];}catch(_){win[name]=undefined;}
            script.remove();resolve(value);
          };
          win[name]=finish;
          script.async=true;script.referrerPolicy='no-referrer';
          script.onerror=()=>finish(null);
          const timeout=setTimeout(()=>finish(null),8500);
          script.src=url+'&callback='+encodeURIComponent(name);
          doc.head.append(script);
        });
      })
    });
    function save(key,picture){
      cache.delete(key);cache.set(key,{...picture,at:Date.now()});
      while(cache.size>MAX_CACHE)cache.delete(cache.keys().next().value);
      try {storage?.setItem(CACHE_KEY,JSON.stringify([...cache]));}catch(_){/* optional */}
    }
    function usable(box) {
      return box?.dataset?.artworkStatus==='loaded' ||
        box?.dataset?.artworkStatus==='folder-loaded' ||
        box?.dataset?.artworkStatus==='local-preview' ||
        box?.querySelector?.('.queue-artwork-image:not([hidden])') != null;
    }
    function display(li,box,name,list,onExhaust=null) {
      let index=0;
      const next=()=>{
        if(!li.isConnected || !box.isConnected || usable(box))return;
        const candidate=list[index++];
        if(!candidate){if(onExhaust)void onExhaust();return;}
        if(!imageURL(candidate.url,candidate.provider)){next();return;}
        const img=doc.createElement('img');
        img.className='queue-artwork-image';img.alt='';
        img.decoding='async';img.loading='eager';img.hidden=true;
        img.onload=()=>{
          if(!li.isConnected || !box.isConnected || usable(box)){
            img.remove();return;
          }
          for(const other of box.querySelectorAll('.queue-artwork-image'))
            if(other!==img)other.remove();
          img.hidden=false;box.classList.add('has-art');
          const icon=box.querySelector('.queue-artwork-fallback');
          if(icon)icon.hidden=true;
          box.dataset.artworkStatus='loaded';
          box.dataset.artworkRecovered='1';
          const russian=doc.documentElement?.lang==='ru';
          box.title=russian?'Изображение найдено':'Artwork recovered';
          save(keyFor(name),candidate);
        };
        img.onerror=()=>{img.remove();next();};
        box.append(img);img.src=candidate.url;
      };
      next();
    }
    async function rescue(li) {
      if(!li.isConnected)return;
      const box=li.querySelector('.queue-artwork');
      if(!box || usable(box) || busy.has(li) || li.dataset.queueAudio==='1')return;
      // The visible label is shortened; resolver still needs full filename.
      const name=li.dkQueueItem?.name ||
        li.querySelector('.item-title')?.textContent?.trim();
      if(!name || !parseFilename(name) || name.length>230)return;
      busy.add(li);
      const key=keyFor(name),cached=cache.get(key);
      try {
        const images=cached?[cached]:[];
        // Verify cached images in the browser again; the remote CDN may change.
        // Fresh source alternatives are fetched only if no cached poster exists.
        if(!images.length)images.push(...await resolver.resolve(name));
        if(!li.isConnected || usable(box))return;
        display(li,box,name,images,cached?async()=>{
          // A previously valid CDN link can expire. Remove it, then try
          // other trusted providers instead of poisoning the saved cache.
          cache.delete(key);
          try{storage?.setItem(CACHE_KEY,JSON.stringify([...cache]));}catch(_){}
          const alternatives=await resolver.resolve(name);
          if(li.isConnected&&!usable(box))display(li,box,name,alternatives);
        }:null);
      } catch (_) { /* Leave the original player's fallback artwork alone. */ }
    }
    function scan() {
      for(const li of queue.children){
        if(!li.matches?.('li') || li.classList.contains('queue-empty') ||
           li.dataset.queueKind!=='file' || li.dataset.queueAudio==='1' ||
           timers.has(li))continue;
        const timeout=setTimeout(()=>{timers.delete(li);void rescue(li);},
          Math.max(1000,options.delayMs||6200));
        timers.set(li,timeout);
      }
    }
    const Observer=options.MutationObserver||win.MutationObserver;
    if(Observer){const observer=new Observer(scan);observer.observe(queue,{childList:true});}
    scan();
    return true;
  }
  return Object.freeze({parseFilename,normalize,imageURL,pickShow,pickMovie,pickApple,createResolver,readCache,install});
});
