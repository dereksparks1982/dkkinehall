/* DK Kinehall standalone Live TV. Guide timing adapted from DK Media Plus. */
(() => {
"use strict";
const bridge=window.DKLibraryBridge;
if(!bridge?.internalPages)return;
const $=id=>document.getElementById(id);
const ru=()=>document.documentElement.lang==="ru";
const tr=(en,russian)=>window.DKLocale?.pair(en,russian)??(ru()?russian:en);
const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;};
const button=(en,russian,fn,cls="dk-live-small")=>{const b=el("button",cls,tr(en,russian));b.type="button";b.addEventListener("click",fn);return b;};
const read=(k,fallback)=>{try{return JSON.parse(localStorage.getItem(k))??fallback;}catch(_){return fallback;}};
const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true;}catch(_){return false;}};
const keys={playlist:"dk-kinehall.live.playlist.v1",saved:"dk-kinehall.live.saved.v1",host:"dk-kinehall.live.host.v1"};
const validURL=value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password&&!u.hash&&u.href.length<=4096?u.href:null;}catch(_){return null;}};
let directory=[],directoryCountry="",guideSources=new Set(),guideLast=new Map(),logoObserver=null,logoGeneration=0,logoQueue=[],logoBusy=0;const logoCache=new Map();
let imported=read(keys.playlist,[]);if(!Array.isArray(imported))imported=[];
imported=imported.filter(x=>x&&validURL(x.url)&&typeof x.name==="string").slice(0,3000);
let saved=read(keys.saved,[]);if(!Array.isArray(saved))saved=[];
let host=read(keys.host,"");if(typeof host!=="string")host="";
let tuner=[],localChannels=[],broadcastPrograms=new Map(),atscRunning=false,atscCancelled=false,programs=new Map(),xmlNames=new Map(),logoFiles=[],mode="all",country="",active=false,busy=false,panel=null,notice=null,workspace=null,grid=null,heading=null,search=null,serial=0;
const aliases=[
["pbs kids","pbs_kids"],["ion plus","ion_plus"],["daystar espanol","daystar_espanol"],["one america news plus","oan_plus"],["oan plus","oan_plus"],["my network tv","mynetworktv"],["great american","great_american"],["family channel","family_channel"],["hasbro legends","hasbro_legends"],["moviesphere gold","moviesphere_gold"],["the nest","the_nest"],["true crime","true_crime"],["weather nation","weathernation"],["court tv","courttv"],["start tv","starttv"],["shop lc","shoplc"],["me tv","metv"],["catchy tv","catchy"],["the 365","365blk"],["action channel","action_channel"],["silver spur","silverspur"]
];
const normalize=s=>String(s??"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
const compact=s=>normalize(s).replace(/ /g,"");
function logo(row){
 const n=normalize(row.name),n2=compact(row.name);
 const station=logoFiles.find(x=>{const m=/^(\d+\.\d+)_(.+)\.bmp$/i.exec(x);return m&&m[1]===row.number&&(compact(m[2])===n2||n2.includes(compact(m[2])));});
 if(station)return station;
 for(const [key,value] of aliases){if((" "+n+" ").includes(" "+key+" ")||n2===compact(key)){const found=logoFiles.find(x=>x===value+".bmp");if(found)return found;}}
 return logoFiles.filter(x=>! /^\d+\./.test(x)).sort((a,b)=>b.length-a.length).find(x=>{const base=x.replace(/\.bmp$/i,""),name=normalize(base);return n2===compact(base)||(" "+n+" ").includes(" "+name+" ");})||"";
}
const entryKey=row=>row.kind==="atsc"?"atsc:"+row.device+":"+row.number:row.kind==="tuner"?"tuner:"+row.host+":"+row.number:"url:"+row.url;
const isSaved=row=>saved.some(x=>entryKey(x)===entryKey(row));
function saveRow(row){const key=entryKey(row);saved=isSaved(row)?saved.filter(x=>entryKey(x)!==key):[...saved,{...row,id:undefined}].slice(0,3000);if(!write(keys.saved,saved))report("Could not save channels.","Не удалось сохранить каналы.");render();}
function report(en,russian){if(notice)notice.textContent=tr(en,russian);}
function setBusy(v){busy=v;panel?.setAttribute("aria-busy",String(v));}
function epoch(v){return v===serial&&active;}
const countryLabel=c=>{try{return new Intl.DisplayNames([ru()?"ru":"en"],{type:"region"}).of(c)||c;}catch(_){return c;}};
function parseDate(s){
 const m=/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4}|Z)?$/.exec(String(s||"").trim());
 if(!m)return 0;
 const offset=m[7]&&m[7]!=="Z"?((m[7][0]==="-"?-1:1)*(Number(m[7].slice(1,3))*60+Number(m[7].slice(3)))):0;
 return Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0))/1000-offset*60;
}
function programRows(row){
 if(row.kind==="atsc"){const broadcast=broadcastPrograms.get(entryKey(row));if(broadcast?.length)return broadcast;}
 const ids=[row.guideId,row.guideId?.split("@")[0],row.name?.replace(/\s*\(\d+p\)\s*$/i,""),row.name,row.number].filter(Boolean);let id=ids.find(x=>programs.has(x));
 if(!id){id=ids.map(x=>xmlNames.get(normalize(x))).find(x=>x&&programs.has(x));}
 return programs.get(id)||[];
}
function guideInfo(row){
 const list=programRows(row),now=Date.now()/1000;
 return {current:list.find(p=>p.start<=now&&p.end>now),next:list.find(p=>p.start>now)};
}
const clock=t=>new Date(t*1000).toLocaleTimeString(ru()?"ru-RU":undefined,{hour:"2-digit",minute:"2-digit"});
function programBlock(label,translated,p){
 const d=el("div","dk-live-program");
 d.append(el("span","dk-live-label",tr(label,translated)));
 if(!p){d.append(el("span","dk-live-muted",tr("No guide data","Нет данных программы")));return d;}
 d.append(el("strong","",p.title),el("small","",clock(p.start)+" – "+clock(p.end)));
 if(p.desc)d.append(el("small","dk-live-description",p.desc));
 return d;
}
async function play(row){
 if(row.kind==="atsc"){report("Local tuner playback is not wired yet.","Воспроизведение с местного тюнера ещё не подключено.");return;}
 if(busy)return;const rev=serial;setBusy(true);report("Opening channel…","Открытие канала…");
 try{
  let id=row.id;
  if(row.kind==="tuner"&&!id){
   const rows=await bridge.liveTvLineup(row.host);id=rows.find(x=>x.number===row.number)?.id;
   if(!id)throw Error("Unavailable");
  }
  if(!epoch(rev))return;
  const localArt=logo(row),logoURL=validURL(row.logo||"");
  const art=localArt?"./assets/channel_logos/builtin/"+encodeURIComponent(localArt):logoCache.get(logoURL)||"";
  const alternates=row.kind==="url"&&row.guideId?[...new Set([...imported,...directory].filter(x=>x.guideId===row.guideId&&x.url!==row.url&&validURL(x.url)).map(x=>x.url))].slice(0,2):[];
  await bridge.liveTvPlay(row.kind==="tuner"?"tuner":"url",row.kind==="tuner"?id:row.url,row.name,art,alternates);
  report("Channel sent to Player.","Канал открыт в проигрывателе.");
 }catch(_){if(epoch(rev))report("Cannot open channel or unsupported stream.","Не удалось открыть канал или поток не поддерживается.");}
 finally{setBusy(false);}
}
function render(){
 if(!grid)return;
 const query=normalize(search?.value),all=[...tuner,...localChannels,...new Map([...imported,...directory].map(x=>[x.url,x])).values()];
 let rows=mode==="saved"?saved:mode==="world"?all.filter(x=>x.kind==="url"&&(!country||x.country===country)):all;
 if(query)rows=rows.filter(x=>normalize(x.number+" "+x.name+" "+(x.country||"")).includes(query));
 heading.textContent=mode==="saved"?tr("Saved Channels","Избранные каналы"):mode==="world"?tr("World TV","Мировое телевидение"):tr("Channel Guide","Телепрограмма");
 logoObserver?.disconnect();logoGeneration++;logoQueue=[];
 grid.replaceChildren();
 if(!rows.length){grid.append(el("p","dk-live-muted",mode==="world"?tr("Import a playlist with country information.","Импортируйте список с указанием страны."):mode==="saved"?tr("No saved channels yet.","Нет избранных каналов."):tr("Scan a tuner or import a playlist to find channels.","Найдите каналы через тюнер или импортируйте список.")));return;}
 const frag=document.createDocumentFragment();
 for(const row of rows.slice(0,250)){
  const card=el("article","dk-live-card"),identity=el("div","dk-live-identity"),art=el("div","dk-live-art"),name=el("div","dk-live-name");
  attachLogo(art,row);
  name.append(el("strong","",row.name),el("small","",row.number|| (row.country?countryLabel(row.country):tr("Stream","Поток"))));
  const star=button(isSaved(row)?"Remove saved":"Save",isSaved(row)?"Убрать":"Сохранить",()=>saveRow(row),"dk-live-small dk-live-save");
  identity.append(art,name,star);
  const {current,next}=guideInfo(row);
  const info=el("div","dk-live-programs");info.append(programBlock("Now","Сейчас",current),programBlock("Next","Далее",next));
  const watch=button("Watch Live","Смотреть",()=>void play(row),"dk-live-small dk-live-watch");
  if(row.kind==="atsc"){watch.disabled=true;watch.textContent=tr("Playback pending","Воспроизведение пока недоступно");}
  card.append(identity,info,watch);frag.append(card);
 }
 grid.append(frag);
 if(rows.length>250)grid.append(el("p","dk-live-muted",tr("Showing the first 250 channels. Use search to narrow the guide.","Показаны первые 250 каналов. Используйте поиск.")));
}
function attachLogo(art,row){
 const file=logo(row),url=validURL(row.logo||"");
 art.textContent=row.number||"▣";
 const paint=src=>{const img=el("img");img.alt="";img.loading="lazy";img.src=src;img.addEventListener("error",()=>{img.remove();art.textContent=row.number||"▣";},{once:true});art.replaceChildren(img);};
 if(file){paint("./assets/channel_logos/builtin/"+encodeURIComponent(file));return;}
 if(!url)return;
 if(logoCache.has(url)){paint(logoCache.get(url));return;}
 if(!logoObserver&&typeof IntersectionObserver==="function")logoObserver=new IntersectionObserver(entries=>{
  for(const e of entries)if(e.isIntersecting){logoObserver.unobserve(e.target);const job=e.target.dkLogoJob;if(job)logoQueue.push(job);}
  pumpLogos();
 },{rootMargin:"150px"});
 const job={url,paint,generation:logoGeneration};art.dkLogoJob=job;
 if(logoObserver)logoObserver.observe(art);else{logoQueue.push(job);pumpLogos();}
}
function pumpLogos(){
 while(logoBusy<3&&logoQueue.length){
  const job=logoQueue.shift();if(job.generation!==logoGeneration||!active)continue;
  logoBusy++;
  Promise.resolve().then(()=>bridge.liveTvResource(job.url,"logo")).then(data=>{
   if(!/^image\/(?:png|jpeg|webp|gif)$/.test(data.mime)||typeof data.base64!=="string"||data.base64.length>2800000)return;
   const src="data:"+data.mime+";base64,"+data.base64;
   if(src.length<400000){logoCache.set(job.url,src);while(logoCache.size>48)logoCache.delete(logoCache.keys().next().value);}
   if(active&&job.generation===logoGeneration)job.paint(src);
  }).catch(()=>{}).finally(()=>{logoBusy--;pumpLogos();});
 }
}
function clearWork(){workspace.replaceChildren();}
function makeInput(type,en,russian){const input=el("input","dk-live-input");input.type=type;input.placeholder=tr(en,russian);input.setAttribute("aria-label",tr(en,russian));return input;}
function showAll(){mode="all";country="";render();}
async function loadLineup(value){
 if(busy)return;const rev=serial;setBusy(true);report("Loading tuner channels…","Загрузка каналов тюнера…");
 try{const rows=await bridge.liveTvLineup(value.trim());if(!epoch(rev))return;host=value.trim();write(keys.host,host);tuner=rows.map(x=>({...x,kind:"tuner",host}));showAll();report(tuner.length?"Channels loaded.":"No compatible channels found.",tuner.length?"Каналы загружены.":"Совместимые каналы не найдены.");}
 catch(_){if(epoch(rev))report("Cannot load tuner channels.","Не удалось загрузить каналы тюнера.");}
 finally{setBusy(false);}
}
async function atscAction(action,device){
 if(busy||atscRunning)return;const rev=serial;atscCancelled=false;atscRunning=true;setBusy(true);
 report(action==="guide"?"Reading broadcast programme guide…":action==="scan"?"Scanning antenna channels…":"Loading saved antenna channels…",action==="guide"?"Чтение эфирной телепрограммы…":action==="scan"?"Поиск эфирных каналов…":"Загрузка сохранённых эфирных каналов…");
 try{
  const data=await bridge.liveTvAtscRun(action,device);if(!epoch(rev))return;
  localChannels=[...localChannels.filter(x=>x.device!==device),...data.channels.map(x=>({...x,kind:"atsc",device,guideId:x.number}))];
  for(const key of [...broadcastPrograms.keys()])if(key.startsWith("atsc:"+device+":"))broadcastPrograms.delete(key);
  for(const p of data.programs){const key="atsc:"+device+":"+p.number;if(!broadcastPrograms.has(key))broadcastPrograms.set(key,[]);broadcastPrograms.get(key).push(p);}
  for(const rows of broadcastPrograms.values())rows.sort((a,b)=>a.start-b.start);
  showAll();report("Antenna data loaded.","Эфирные данные загружены.");
 }catch(_){if(epoch(rev))report(atscCancelled?"Antenna operation cancelled.":"Antenna operation failed. Check tuner permissions and signal.",atscCancelled?"Операция отменена.":"Ошибка. Проверьте доступ к тюнеру и сигнал.");}
 finally{atscRunning=false;setBusy(false);}
}
bridge.onLiveTvAtscProgress?.(p=>{
 if(!active||!atscRunning)return;
 report((p.action==="guide"?"Guide":"Scan")+" "+p.completed+"/"+p.total+" · "+p.found,(p.action==="guide"?"Телепрограмма":"Поиск")+" "+p.completed+"/"+p.total+" · "+p.found);
});
function scanTuners(){
 if(busy)return;clearWork();showAll();
 const input=makeInput("text","Tuner IPv4 address","Адрес тюнера IPv4");input.value=host;
 const devices=el("div","dk-live-devices");workspace.append(input,button("Load Channels","Загрузить каналы",()=>void loadLineup(input.value)),devices);
 const rev=serial;setBusy(true);report("Searching for TV tuners…","Поиск телевизионных тюнеров…");
 void (async()=>{try{
  const [network,local]=await Promise.allSettled([bridge.liveTvDiscover(),bridge.liveTvLocalTuners()]);
  if(!epoch(rev))return;
  for(const d of network.status==="fulfilled"?network.value:[]){devices.append(button("HDHomeRun "+d.host,"Сетевой тюнер "+d.host,()=>{input.value=d.host;void loadLineup(d.host);}));}
  const ready=await bridge.liveTvAtscStatus?.().catch(()=>false);if(!epoch(rev))return;
  for(const d of local.status==="fulfilled"?local.value:[]){
   const group=el("div","dk-live-devices"),device="adapter"+d.adapter+"/frontend"+d.frontend;
   group.append(el("p","dk-live-muted",(d.name||tr("TV tuner","ТВ-тюнер"))+" "+d.adapter+":"+d.frontend+" · "+tr(!d.accessible?"Device permission required.":ready?"ATSC 1.0":"ATSC helper unavailable.",!d.accessible?"Требуется доступ к устройству.":ready?"ATSC 1.0":"Модуль ATSC недоступен.")));
   if(ready&&d.accessible)group.append(button("Scan Antenna","Поиск эфирных каналов",()=>void atscAction("scan",device)),button("Load Saved Antenna Channels","Загрузить эфирные каналы",()=>void atscAction("cached",device)),button("Refresh Broadcast Guide","Обновить эфирную телепрограмму",()=>void atscAction("guide",device)));
   devices.append(group);
  }
  if(ready)devices.append(button("Cancel Antenna Operation","Отменить операцию",()=>{atscCancelled=true;void bridge.liveTvAtscCancel?.().catch(()=>{});}));
  const count=(network.status==="fulfilled"?network.value.length:0)+(local.status==="fulfilled"?local.value.length:0);
  report(count?"Select a tuner or enter its address.":"No tuners found. Enter an address manually.",count?"Выберите тюнер или введите адрес.":"Тюнеры не найдены. Введите адрес вручную.");
 }catch(_){if(epoch(rev))report("Tuner discovery failed.","Ошибка поиска тюнеров.");}finally{setBusy(false);}})();
}
async function discover(){
 if(busy)return;clearWork();showAll();const rev=serial;setBusy(true);report("Discovering network media…","Поиск сетевых медиа…");
 try{const rows=await bridge.networkDiscover();if(!epoch(rev))return;
  for(const row of rows){let name;try{name=new URL(row.location).host;}catch(_){continue;}workspace.append(button("Browse "+name,"Обзор "+name,()=>void bridge.openMediaTool("network").catch(()=>report("Cannot open network browser.","Не удалось открыть сетевой обозреватель."))));}
  report(rows.length?"Network media servers found.":"No DLNA media servers found.",rows.length?"Сетевые медиасерверы найдены.":"Медиасерверы не найдены.");
 }catch(_){if(epoch(rev))report("Network discovery failed.","Ошибка поиска в сети.");}finally{setBusy(false);}
}
function direct(){
 if(busy)return;clearWork();const input=makeInput("url","HTTP or HTTPS stream address","Адрес потока HTTP или HTTPS");
 const open=()=>{const url=validURL(input.value.trim());if(!url){report("Enter a valid HTTP or HTTPS address.","Введите действительный адрес HTTP или HTTPS.");return;}if(/\.m3u$/i.test(new URL(url).pathname)){void remotePlaylist(url,false);return;}const name=new URL(url).hostname;void play({kind:"url",url,name});};
 workspace.append(input,button("Play Stream","Воспроизвести поток",open),button("Import URL","Импорт по адресу",()=>void remotePlaylist(input.value.trim(),false)));input.addEventListener("keydown",e=>{if(e.key==="Enter")open();});input.focus();
}
function parseM3U(text,base=null){
 let pending=null;const rows=[],seen=new Set();
 for(const raw of text.split(/\r?\n/)){
  const line=raw.trim();if(!line)continue;
  if(/^#EXTINF:/i.test(line)){
   const a={};for(const m of line.matchAll(/([\w-]+)="([^"]*)"/g))a[m[1].toLowerCase()]=m[2];
   let q=false,comma=-1;for(let i=0;i<line.length;i++){if(line[i]==='"')q=!q;else if(line[i]===","&&!q){comma=i;break;}}
   pending={name:(comma>=0?line.slice(comma+1):a["tvg-name"]||"").trim().slice(0,250),guideId:(a["tvg-id"]||"").slice(0,250),country:(a["tvg-country"]||/\.([a-z]{2})(?:@[^\s]+)?$/i.exec(a["tvg-id"]||"")?.[1]||"").split(/[;,]/)[0].trim().toUpperCase(),number:(a["tvg-chno"]||"").slice(0,20),logo:validURL(a["tvg-logo"]||"")||"",group:(a["group-title"]||"").slice(0,100)};
  }else if(!line.startsWith("#")){
   let address=line;try{if(base)address=new URL(line,base).href;}catch(_){}const url=validURL(address);if(url&&!seen.has(url)){seen.add(url);const m=pending||{};rows.push({kind:"url",url,name:m.name||new URL(url).hostname,guideId:m.guideId||"",country:/^[A-Z]{2}$/.test(m.country||"")?m.country:"",number:m.number||"",logo:m.logo||"",group:m.group||""});if(rows.length>=12000)break;}
   pending=null;
  }
 }
 return rows;
}
function chooseFile(accept,limit,fn){
 const input=el("input");input.type="file";input.accept=accept;input.hidden=true;panel.append(input);
 input.addEventListener("change",async()=>{const file=input.files?.[0];try{if(!file)return;if(file.size>limit)throw Error("size");await fn(await file.text());}catch(_){report("Could not import this file.","Не удалось импортировать файл.");}finally{input.remove();}},{once:true});
 input.addEventListener("cancel",()=>input.remove(),{once:true});input.click();
}
function importPlaylist(){
 if(busy)return;
 chooseFile(".m3u,.m3u8,text/plain,application/vnd.apple.mpegurl",4*1024*1024,text=>{
  if(/#EXT-X-(?:TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/i.test(text)){report("This is an HLS media manifest, not a channel list.","Это манифест HLS, а не список каналов.");return;}
  readGuideHeader(text);
  const rows=parseM3U(text);if(!rows.length){report("No compatible channel addresses in this playlist.","В списке нет совместимых адресов каналов.");return;}
  imported=[...new Map([...imported,...rows].map(x=>[x.url,x])).values()].slice(0,3000);
  if(!write(keys.playlist,imported))report("Playlist loaded for this session only.","Список загружен только для этого сеанса.");
  else report("Playlist imported.","Список импортирован.");clearWork();showAll();void autoGuide();
 });
}
function parseGuide(text){
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error("Invalid XML");
  const doc=new DOMParser().parseFromString(text,"application/xml");if(doc.querySelector("parsererror")||doc.documentElement.localName!=="tv")throw Error("Invalid guide");
  const names=new Map(),items=new Map();let count=0;
  for(const c of doc.querySelectorAll("channel")){const id=c.getAttribute("id");if(!id)continue;for(const n of c.querySelectorAll("display-name"))names.set(normalize(n.textContent),id);}
  for(const p of doc.querySelectorAll("programme")){
   if(++count>50000)break;const id=p.getAttribute("channel"),start=parseDate(p.getAttribute("start")),end=parseDate(p.getAttribute("stop"));
   if(!id||!start||end<=start)continue;const row={start,end,title:(p.querySelector("title")?.textContent||tr("Untitled programme","Без названия")).slice(0,250),desc:(p.querySelector("desc")?.textContent||"").slice(0,700)};
   if(!items.has(id))items.set(id,[]);items.get(id).push(row);
  }
  for(const rows of items.values())rows.sort((a,b)=>a.start-b.start);
  for(const [id,rows] of items)programs.set(id,rows);
  for(const [name,id] of names)xmlNames.set(name,id);
  while(programs.size>10000)programs.delete(programs.keys().next().value);
  render();
}
function importGuide(){
 if(busy)return;
 clearWork();
 const input=makeInput("url","Free XMLTV guide URL (.xml or .xml.gz)","Адрес бесплатной телепрограммы (.xml или .xml.gz)");
 workspace.append(input,button("Load Guide URL","Загрузить телепрограмму",()=>void fetchGuide(input.value.trim(),true)),button("Choose Guide File","Выбрать файл телепрограммы",()=>chooseFile(".xml,.xmltv,text/xml,application/xml",20*1024*1024,text=>{parseGuide(text);report("Programme guide imported.","Телепрограмма импортирована.");})),button("Refresh Free Guide","Обновить бесплатную телепрограмму",()=>void autoGuide(true)));
}
function readGuideHeader(text){
 const header=text.split(/\r?\n/,1)[0]||"";
 for(const m of header.matchAll(/(?:x-tvg-url|url-tvg|tvg-url)="([^"]+)"/gi))for(const url of m[1].split(",")){const u=validURL(url.trim());if(u&&guideSources.size<6)guideSources.add(u);}
}
const regionalGuides=Object.fromEntries(Object.entries({US:"US2",GB:"UK1",DE:"DE1",FR:"FR1",LT:"LT1",LV:"LV1",LU:"LU1",MX:"MX1",MY:"MY1",NG:"NG1",NL:"NL1",NO:"NO1",NZ:"NZ1",PA:"PA1",PE:"PE1",PH:"PH2",PL:"PL1",MT:"MT1",KZ:"KZ1",MN:"MN1"}).map(([country,tag])=>[country,"https://epgshare01.online/epgshare01/epg_ripper_"+tag+".xml.gz"]));
let guideLoading=false;
async function fetchGuide(value,manual=false){
 const url=validURL(value);if(!url||guideLoading||!active)return;
 if(!manual&&Date.now()-(guideLast.get(url)||0)<6*3600*1000)return;
 guideLoading=true;const rev=serial;report("Loading free programme guide…","Загрузка бесплатной телепрограммы…");
 try{
  const data=await bridge.liveTvResource(url,"guide");if(!epoch(rev))return;
  parseGuide(data.text);guideLast.set(url,Date.now());report("Guide loaded; available channel matches are shown.","Телепрограмма загружена; показаны найденные соответствия.");
 }catch(_){if(epoch(rev))report("Free guide unavailable or too large. Try another guide URL.","Бесплатная телепрограмма недоступна или слишком велика. Попробуйте другой адрес.");}
 finally{guideLoading=false;}
}
async function autoGuide(force=false){
 const url=[...guideSources][0]||regionalGuides[country||directoryCountry];
 if(url)await fetchGuide(url,force);
 else if(force)report("Select a supported country or enter a free XMLTV guide URL.","Выберите поддерживаемую страну или введите адрес бесплатной телепрограммы.");
}
async function remotePlaylist(value,worldMode,chosen=""){
 const url=validURL(value);if(!url||busy)return;
 const rev=serial;setBusy(true);report("Loading free channel directory…","Загрузка бесплатного списка каналов…");
 try{
  const data=await bridge.liveTvResource(url,"playlist");if(!epoch(rev))return;
  if(/#EXT-X-(?:TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/i.test(data.text)){setBusy(false);await play({kind:"url",url,name:new URL(url).hostname});return;}
  if(!/^\uFEFF?#EXTM3U/i.test(data.text))throw Error("Invalid list");
  readGuideHeader(data.text);const rows=parseM3U(data.text,validURL(data.url)||url);
  if(!rows.length)throw Error("Empty playlist");
  if(worldMode){directory=rows.map(x=>chosen&&!x.country?{...x,country:chosen}:x);directoryCountry=chosen;mode="world";country=chosen;render();}
  else{imported=[...new Map([...imported,...rows].map(x=>[x.url,x])).values()].slice(0,3000);write(keys.playlist,imported);showAll();}
  report("Channels loaded: "+rows.length,"Каналов загружено: "+rows.length);void autoGuide();
 }catch(_){if(epoch(rev))report("Channel directory unavailable.","Список каналов недоступен.");}
 finally{setBusy(false);}
}
function world(){
 clearWork();mode="world";country=directoryCountry;
 const select=el("select","dk-live-input"),all=el("option","",tr("All countries","Все страны"));all.value="";select.append(all);
 const countries=new Set([...("US GB CA AU NZ DE FR ES IT RU UA PL BR MX AR IN PK SA AE EG TR JP KR CN NL BE SE NO FI DK IE CH AT GR PT RO ZA NG KE MA TN DZ IQ IR IL ID MY PH TH VN SG CZ SK HU BG HR RS BA SI LT LV EE IS LU MT CY GE AM AZ KZ UZ BD LK NP CL CO PE VE EC UY PY BO CR PA DO CU JM TT").split(" "),...imported.map(x=>x.country).filter(Boolean)]);
 for(const c of [...countries].sort()){const opt=el("option","",countryLabel(c));opt.value=c;select.append(opt);}
 select.value=country;
 const load=()=>{if(busy){select.value=country;return;}const chosen=select.value;const url="https://iptv-org.github.io/iptv/"+(chosen?"countries/"+chosen.toLowerCase()+".m3u":"index.m3u");void remotePlaylist(url,true,chosen);};
 select.addEventListener("change",()=>{if(busy){select.value=country;return;}country=select.value;render();load();});
 workspace.append(select,button("Refresh Free Channels","Обновить бесплатные каналы",load),button("Refresh Free Guide","Обновить бесплатную телепрограмму",()=>void autoGuide(true)));render();
 if(!directory.length&&!busy)load();else void autoGuide();
}
function showSaved(){clearWork();mode="saved";render();}
const icons={discover:"◎",direct:"🌐",playlist:"≡+",scan:"⋔",world:"◉",saved:"☆"};
function makeTile(key,en,russian,fn){const b=button(en,russian,fn,"dk-live-tile dk-live-"+key);const label=el("span","",b.textContent);b.replaceChildren(el("span","dk-live-icon",icons[key]),label);return b;}
function init(){
 if(panel)return;
 panel=el("section","dk-live-panel");panel.id="liveTvPanel";panel.hidden=true;panel.setAttribute("role","tabpanel");
 const top=el("div","dk-live-toolbar"),title=el("h2","",tr("Live TV","Прямой эфир")),tiles=el("div","dk-live-tiles");
 tiles.append(makeTile("discover","Discover Streams","Поиск потоков",()=>void discover()),makeTile("direct","Open Network Stream","Открыть сетевой поток",direct),makeTile("playlist","Import Playlist","Импорт списка",importPlaylist),makeTile("scan","Scan TV Tuners","Поиск ТВ-тюнеров",scanTuners),makeTile("world","World TV","Мировое телевидение",world),makeTile("saved","Saved Channels","Избранные каналы",showSaved));
 top.append(title,tiles);workspace=el("div","dk-live-workspace");notice=el("p","dk-live-notice");notice.setAttribute("role","status");
 const guideBar=el("div","dk-live-guidebar");heading=el("h2","",tr("Channel Guide","Телепрограмма"));search=makeInput("search","Search channels","Поиск каналов");search.addEventListener("input",render);
 guideBar.append(heading,button("All Channels","Все каналы",()=>{clearWork();showAll();}),button("Import TV Guide","Импорт телепрограммы",importGuide),search);
 grid=el("div","dk-live-grid");panel.append(top,workspace,notice,guideBar,grid);
 $("libraryStatus").after(panel);
 fetch("./assets/channel_logos/manifest.json").then(r=>r.json()).then(m=>{logoFiles=m.files.map(x=>x.name);if(active)render();}).catch(()=>{});
 // File URLs may not support fetch in Chromium; the embedded manifest fallback
 // is generated from the same pinned artwork inventory.
 if(!logoFiles.length)logoFiles=["12.3_Heroes.bmp","12.4_Outlaw.bmp","15.1_K29NL-D.bmp","15.2_QVC.bmp","15.3_HSN2.bmp","15.4_QVC2.bmp","15.5_QVC3.bmp","24.1_FOX.bmp","26.12_SPURS.bmp","26.13_DIVRCTY.bmp","26.14_QUINLEY.bmp","26.8_OAN.bmp","26.9_RAV.bmp","28.2_ESPANOL.bmp","30.1_KSMI-LD.bmp","30.3_Hasbro.bmp","30.4_REVACT.bmp","30.5_Family.bmp","30.6_Revival.bmp","30.7_GLTVii.bmp","33.2_Catchy.bmp","33.3_The365.bmp","33.4_StartTV.bmp","34.1_KFVT-LD.bmp","34.2_KFVT-LD.bmp","34.3_KFVT-LD.bmp","34.4_KFVT-LD.bmp","34.5_KFVT-LD.bmp","34.6_KFVT-LD.bmp","34.7_KFVT-LD.bmp","36.1_ROAR.bmp","36.2_TheNest.bmp","36.3_Charge_.bmp","36.4_TCN.bmp","365blk.bmp","46.1_Univisn.bmp","46.2_Grit.bmp","abc.bmp","action_channel.bmp","biztv.bmp","bounce.bmp","busted.bmp","buzzr.bmp","catchy.bmp","cbn.bmp","cbs.bmp","charge.bmp","comet.bmp","courttv.bmp","cozi.bmp","create.bmp","cw.bmp","daystar.bmp","daystar_espanol.bmp","defy.bmp","divercity.bmp","diya.bmp","family_channel.bmp","fox.bmp","great_american.bmp","greater_love.bmp","grit.bmp","hasbro_legends.bmp","heartland.bmp","heroes.bmp","hsn.bmp","hsn2.bmp","ion.bmp","ion_plus.bmp","jtv.bmp","metv.bmp","moviesphere_gold.bmp","mynetworktv.bmp","nbc.bmp","newsmax.bmp","ntd.bmp","oan.bmp","oan_plus.bmp","outlaw.bmp","oxygen.bmp","pbs.bmp","pbs_kids.bmp","quinnly.bmp","qvc.bmp","qvc2.bmp","qvc3.bmp","rav.bmp","retro.bmp","revival.bmp","roar.bmp","shoplc.bmp","silverspur.bmp","sonlife.bmp","starttv.bmp","tcn.bmp","telemundo.bmp","the_nest.bmp","true_crime.bmp","truecrime.bmp","univision.bmp","weathernation.bmp"];
 new MutationObserver(()=>{if(active)render();}).observe(document.documentElement,{attributes:true,attributeFilter:["lang"]});
 setInterval(()=>{if(active&&programs.size)render();},60000);
}
function syncTabs(){if(!active)return;for(const id of ["tabMovies","tabTV"])$(id)?.setAttribute("aria-selected","false");$("libraryLiveTV")?.setAttribute("aria-selected","true");}
function open(){init();active=true;serial++;panel.hidden=false;panel.parentElement.classList.add("dk-live-active");syncTabs();render();}
function close(){if(!active)return;if(atscRunning){atscCancelled=true;void bridge.liveTvAtscCancel?.().catch(()=>{});}active=false;serial++;panel.hidden=true;panel.parentElement.classList.remove("dk-live-active");$("libraryLiveTV")?.setAttribute("aria-selected","false");}
window.DKLiveTV={open,close,syncTabs};
})();