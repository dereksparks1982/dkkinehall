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
let imported=read(keys.playlist,[]);if(!Array.isArray(imported))imported=[];
imported=imported.filter(x=>x&&validURL(x.url)&&typeof x.name==="string").slice(0,3000);
let saved=read(keys.saved,[]);if(!Array.isArray(saved))saved=[];
let host=read(keys.host,"");if(typeof host!=="string")host="";
let tuner=[],programs=new Map(),xmlNames=new Map(),logoFiles=[],mode="all",country="",active=false,busy=false,panel=null,notice=null,workspace=null,grid=null,heading=null,search=null,serial=0;
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
const entryKey=row=>row.kind==="tuner"?"tuner:"+row.host+":"+row.number:"url:"+row.url;
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
 const ids=[row.guideId,row.name,row.number].filter(Boolean);let id=ids.find(x=>programs.has(x));
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
 if(busy)return;const rev=serial;setBusy(true);report("Opening channel…","Открытие канала…");
 try{
  let id=row.id;
  if(row.kind==="tuner"&&!id){
   const rows=await bridge.liveTvLineup(row.host);id=rows.find(x=>x.number===row.number)?.id;
   if(!id)throw Error("Unavailable");
  }
  if(!epoch(rev))return;
  await bridge.liveTvPlay(row.kind==="tuner"?"tuner":"url",row.kind==="tuner"?id:row.url,row.name);
  report("Channel sent to Player.","Канал открыт в проигрывателе.");
 }catch(_){if(epoch(rev))report("Cannot open channel or unsupported stream.","Не удалось открыть канал или поток не поддерживается.");}
 finally{setBusy(false);}
}
function render(){
 if(!grid)return;
 const query=normalize(search?.value),all=[...tuner,...imported];
 let rows=mode==="saved"?saved:mode==="world"?imported.filter(x=>x.country&&(!country||x.country===country)):all;
 if(query)rows=rows.filter(x=>normalize(x.number+" "+x.name+" "+(x.country||"")).includes(query));
 heading.textContent=mode==="saved"?tr("Saved Channels","Избранные каналы"):mode==="world"?tr("World TV","Мировое телевидение"):tr("Channel Guide","Телепрограмма");
 grid.replaceChildren();
 if(!rows.length){grid.append(el("p","dk-live-muted",mode==="world"?tr("Import a playlist with country information.","Импортируйте список с указанием страны."):mode==="saved"?tr("No saved channels yet.","Нет избранных каналов."):tr("Scan a tuner or import a playlist to find channels.","Найдите каналы через тюнер или импортируйте список.")));return;}
 const frag=document.createDocumentFragment();
 for(const row of rows.slice(0,250)){
  const card=el("article","dk-live-card"),identity=el("div","dk-live-identity"),art=el("div","dk-live-art"),name=el("div","dk-live-name");
  const file=logo(row);
  if(file){const img=el("img");img.alt="";img.loading="lazy";img.src="./assets/channel_logos/builtin/"+encodeURIComponent(file);img.addEventListener("error",()=>{img.remove();art.textContent=row.number||"▣";},{once:true});art.append(img);}
  else art.textContent=row.number||"▣";
  name.append(el("strong","",row.name),el("small","",row.number|| (row.country?countryLabel(row.country):tr("Stream","Поток"))));
  const star=button(isSaved(row)?"Remove saved":"Save",isSaved(row)?"Убрать":"Сохранить",()=>saveRow(row),"dk-live-small dk-live-save");
  identity.append(art,name,star);
  const {current,next}=guideInfo(row);
  const info=el("div","dk-live-programs");info.append(programBlock("Now","Сейчас",current),programBlock("Next","Далее",next));
  const watch=button("Watch Live","Смотреть",()=>void play(row),"dk-live-small dk-live-watch");
  card.append(identity,info,watch);frag.append(card);
 }
 grid.append(frag);
 if(rows.length>250)grid.append(el("p","dk-live-muted",tr("Showing the first 250 channels. Use search to narrow the guide.","Показаны первые 250 каналов. Используйте поиск.")));
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
function scanTuners(){
 if(busy)return;clearWork();showAll();
 const input=makeInput("text","Tuner IPv4 address","Адрес тюнера IPv4");input.value=host;
 const devices=el("div","dk-live-devices");workspace.append(input,button("Load Channels","Загрузить каналы",()=>void loadLineup(input.value)),devices);
 const rev=serial;setBusy(true);report("Searching for TV tuners…","Поиск телевизионных тюнеров…");
 void (async()=>{try{
  const [network,local]=await Promise.allSettled([bridge.liveTvDiscover(),bridge.liveTvLocalTuners()]);
  if(!epoch(rev))return;
  for(const d of network.status==="fulfilled"?network.value:[]){devices.append(button("HDHomeRun "+d.host,"Сетевой тюнер "+d.host,()=>{input.value=d.host;void loadLineup(d.host);}));}
  for(const d of local.status==="fulfilled"?local.value:[]){devices.append(el("p","dk-live-muted",(d.name||tr("TV tuner","ТВ-тюнер"))+" "+d.adapter+":"+d.frontend+" · "+tr(d.accessible?"Detected; local channel scanning not yet implemented.":"Device permission required.",d.accessible?"Обнаружен; поиск каналов ещё не реализован.":"Требуется доступ к устройству.")));}
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
 const open=()=>{const url=validURL(input.value.trim());if(!url){report("Enter a valid HTTP or HTTPS address.","Введите действительный адрес HTTP или HTTPS.");return;}const name=new URL(url).hostname;void play({kind:"url",url,name});};
 workspace.append(input,button("Play Stream","Воспроизвести поток",open));input.addEventListener("keydown",e=>{if(e.key==="Enter")open();});input.focus();
}
function parseM3U(text){
 let pending=null;const rows=[],seen=new Set();
 for(const raw of text.split(/\r?\n/)){
  const line=raw.trim();if(!line)continue;
  if(/^#EXTINF:/i.test(line)){
   const a={};for(const m of line.matchAll(/([\w-]+)="([^"]*)"/g))a[m[1].toLowerCase()]=m[2];
   let q=false,comma=-1;for(let i=0;i<line.length;i++){if(line[i]==='"')q=!q;else if(line[i]===","&&!q){comma=i;break;}}
   pending={name:(comma>=0?line.slice(comma+1):a["tvg-name"]||"").trim().slice(0,250),guideId:(a["tvg-id"]||"").slice(0,250),country:(a["tvg-country"]||"").split(/[;,]/)[0].trim().toUpperCase(),number:(a["tvg-chno"]||"").slice(0,20)};
  }else if(!line.startsWith("#")){
   const url=validURL(line);if(url&&!seen.has(url)){seen.add(url);const m=pending||{};rows.push({kind:"url",url,name:m.name||new URL(url).hostname,guideId:m.guideId||"",country:/^[A-Z]{2}$/.test(m.country||"")?m.country:"",number:m.number||""});if(rows.length>=3000)break;}
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
  const rows=parseM3U(text);if(!rows.length){report("No compatible channel addresses in this playlist.","В списке нет совместимых адресов каналов.");return;}
  imported=[...new Map([...imported,...rows].map(x=>[x.url,x])).values()].slice(0,3000);
  if(!write(keys.playlist,imported))report("Playlist loaded for this session only.","Список загружен только для этого сеанса.");
  else report("Playlist imported.","Список импортирован.");clearWork();showAll();
 });
}
function importGuide(){
 if(busy)return;
 chooseFile(".xml,.xmltv,text/xml,application/xml",20*1024*1024,text=>{
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
  programs=items;xmlNames=names;render();report("Programme guide imported for this session.","Телепрограмма импортирована на этот сеанс.");
 });
}
function world(){
 clearWork();mode="world";country="";
 const select=el("select","dk-live-input"),all=el("option","",tr("All countries","Все страны"));all.value="";select.append(all);
 for(const c of [...new Set(imported.map(x=>x.country).filter(Boolean))].sort()){const opt=el("option","",countryLabel(c));opt.value=c;select.append(opt);}
 select.addEventListener("change",()=>{country=select.value;render();});workspace.append(select);render();
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
function close(){if(!active)return;active=false;serial++;panel.hidden=true;panel.parentElement.classList.remove("dk-live-active");$("libraryLiveTV")?.setAttribute("aria-selected","false");}
window.DKLiveTV={open,close,syncTabs};
})();