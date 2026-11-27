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
let checks=new Map(),checkObserver=null,checkQueue=[],checking=0,availableOnly=false,guideRestored=false,guideSaveTimer=null,recent=read("dk-kinehall.live.recent.v1",[]);if(!Array.isArray(recent))recent=[];
let catalogPending=false,catalogAgain=false,catalogAt=0,categoryFilter="",languageFilter="",filters=null,guideRefreshTimer=null;const catalogMatches=new Map();
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
function paintSavedStar(star,row){
 const selected=isSaved(row),label=selected?tr("Remove from saved channels","Убрать из избранных каналов"):tr("Save channel","Сохранить канал");
 star.textContent=selected?"★":"☆";
 star.setAttribute("aria-pressed",String(selected));
 star.setAttribute("aria-label",label);
 star.title=label;
}
function saveRow(row,star){
 const key=entryKey(row),removing=isSaved(row);
 if(!removing&&saved.length>=3000){report("Saved channel limit reached.","Достигнут предел избранных каналов.");return;}
 const next=removing?saved.filter(x=>entryKey(x)!==key):[...saved,{...row,id:undefined}];
 if(!write(keys.saved,next)){report("Could not save channels.","Не удалось сохранить каналы.");return;}
 saved=next;
 // No full grid render: keep existing art, availability requests, focus,
 // card geometry and scroll position stable when saving or unsaving.
 if(mode==="saved"&&removing){
  const card=star.closest(".dk-live-card");
  const target=card?.nextElementSibling?.querySelector(".dk-live-save")||card?.previousElementSibling?.querySelector(".dk-live-save");
  logoObserver?.unobserve(card?.querySelector(".dk-live-art")||star);
  if(card)checkObserver?.unobserve(card);
  card?.remove();
  if(!grid.querySelector(".dk-live-card")){grid.replaceChildren(el("p","dk-live-muted",tr("No saved channels match this view.","Нет избранных каналов в этом разделе.")));return;}
  target?.focus({preventScroll:true});
 }else{
  paintSavedStar(star,row);
 }
}
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
 const ids=[row.guideId,row.guideId?.split("@")[0],row.catalogId,row.catalogName,row.name?.replace(/\s*\(\d+p\)\s*$/i,""),row.name].filter(Boolean);let id=ids.find(x=>programs.has(x));
 if(!id&&row.country){id=ids.map(x=>xmlNames.get(row.country+":"+compact(x.replace(/\.[a-z]{2}(?:@.*)?$/i,"")))).find(x=>x&&programs.has(x));}
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
 if(!p){d.append(el("span","dk-live-muted dk-live-program-title",tr("No guide data","Нет данных программы")));return d;}
 const title=el("strong","dk-live-program-title",p.title);
 title.title=[p.title,p.desc].filter(Boolean).join("\n");
 d.append(title,el("small","dk-live-program-time",clock(p.start)+" – "+clock(p.end)));
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
  recent=[{...row,id:undefined},...recent.filter(x=>entryKey(x)!==entryKey(row))].slice(0,50);write("dk-kinehall.live.recent.v1",recent);
  report("Channel sent to Player.","Канал открыт в проигрывателе.");
 }catch(_){if(epoch(rev))report("Cannot open channel or unsupported stream.","Не удалось открыть канал или поток не поддерживается.");}
 finally{setBusy(false);}
}
function render(){
 if(!grid)return;
 const query=normalize(search?.value),all=[...tuner,...localChannels,...new Map([...imported,...directory].map(x=>[x.url,x])).values()].map(enriched);
 let rows=mode==="recent"?recent.map(enriched):mode==="saved"?saved.map(enriched):mode==="world"?all.filter(x=>x.kind==="url"&&(!country||x.country===country)):all;
 syncFilters(rows);
 if(categoryFilter)rows=rows.filter(x=>x.categories?.includes(categoryFilter)||x.group===categoryFilter);
 if(languageFilter)rows=rows.filter(x=>x.languages?.includes(languageFilter));
 if(query)rows=rows.filter(x=>normalize((x.number||"")+" "+x.name+" "+(x.country||"")+" "+(x.country?countryLabel(x.country):"")+" "+(x.group||"")+" "+(x.categories||[]).join(" ")).includes(query));
 heading.textContent=mode==="recent"?tr("Recently opened channels","Недавно открытые каналы"):mode==="saved"?tr("Saved Channels","Избранные каналы"):mode==="world"?tr("World TV","Мировое телевидение"):tr("Channel Guide","Телепрограмма");
 const candidates=rows;logoObserver?.disconnect();checkObserver?.disconnect();logoGeneration++;logoQueue=[];checkQueue=[];
 if(availableOnly){rows=rows.filter(x=>["working","reachable"].includes(checks.get(x.url)?.state));for(const row of candidates.slice(0,60))if(row.kind==="url"&&!checks.has(row.url))enqueueCheck(row.url,null); }
 grid.replaceChildren();
 if(!rows.length){grid.append(el("p","dk-live-muted",mode==="world"?tr("Import a playlist with country information.","Импортируйте список с указанием страны."):mode==="saved"?tr("No saved channels yet.","Нет избранных каналов."):tr("Scan a tuner or import a playlist to find channels.","Найдите каналы через тюнер или импортируйте список.")));return;}
 const frag=document.createDocumentFragment();
 for(const row of rows.slice(0,250)){
  const card=el("article","dk-live-card"),identity=el("div","dk-live-identity"),art=el("div","dk-live-art"),name=el("div","dk-live-name");
  attachLogo(art,row);
  const channelTitle=el("strong","dk-live-channel-title",row.name);channelTitle.title=row.name;name.append(channelTitle);
  const location=row.country?flag(row.country)+" "+countryLabel(row.country):row.kind==="url"?tr("Country unknown","Страна неизвестна"):tr("Local tuner","Местный тюнер");
  const locationText=[row.number,location].filter(Boolean).join(" · ");
  const countryLine=el("small","dk-live-country",locationText);countryLine.title=locationText;name.append(countryLine);
  const details=[(row.categories||[]).map(categoryName).join(", "),(row.languages||[]).map(languageName).join(", ")].filter(Boolean).join(" · ");
  if(details){const detailLine=el("small","dk-live-details",details);detailLine.title=details;name.append(detailLine);}
  if(row.kind==="url"){const badge=el("small","dk-live-check");paintCheck(badge,checks.get(row.url));name.append(badge);observeCheck(card,row.url,badge);}
  const star=el("button","dk-live-small dk-live-save");star.type="button";paintSavedStar(star,row);star.addEventListener("click",()=>saveRow(row,star));
  identity.append(art,name,star);
  const {current,next}=guideInfo(row);
  const info=el("div","dk-live-programs");info.append(programBlock("Now","Сейчас",current),programBlock("Next","Далее",next));
  const watch=button("Watch Live","Смотреть",()=>void play(row),"dk-live-small dk-live-watch");
  if(row.kind==="atsc"){watch.disabled=true;watch.textContent=tr("Playback pending","Воспроизведение пока недоступно");}
  const actions=el("div","dk-live-card-actions");actions.append(watch,button("Schedule","Расписание",()=>showSchedule(row)));
  const record=button("Record","Запись",()=>showRecord(row));record.disabled=row.kind!=="url";actions.append(record);
  card.append(identity,info,actions);frag.append(card);
 }
 grid.append(frag);
 if(rows.length>250)grid.append(el("p","dk-live-muted",tr("Showing the first 250 channels. Use search to narrow the guide.","Показаны первые 250 каналов. Используйте поиск.")));
}
function paintCheck(node,result){if(!node)return;const state=result?.state||"unknown";const labels={working:["Played successfully","Воспроизведён успешно"],reachable:["Stream responds","Поток отвечает"],denied:["Access denied","Доступ отклонён"],offline:["Unavailable","Недоступен"],unknown:["Not verified","Не проверен"]};node.textContent=tr(...(labels[state]||labels.unknown));node.dataset.state=state;}
function enqueueCheck(url,node,force=false){
 const old=checks.get(url);if(old&&!force&&Date.now()-old.at<3*3600000){paintCheck(node,old);return;}
 if(checkQueue.length>=100)return;checkQueue.push({url,node,force,rev:serial});pumpChecks();
}
function observeCheck(card,url,node){
 if(!checkObserver&&typeof IntersectionObserver==="function")checkObserver=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){checkObserver.unobserve(e.target);const j=e.target.dkCheck;if(j)enqueueCheck(j.url,j.node);}}, {rootMargin:"100px"});
 if(checkObserver){card.dkCheck={url,node};checkObserver.observe(card);}else enqueueCheck(url,node);
}
function pumpChecks(){
 while(active&&checking<2&&checkQueue.length){const job=checkQueue.shift();if(!epoch(job.rev))continue;checking++;
  bridge.liveTvCheck(job.url,job.force).then(r=>{checks.set(job.url,{...r,at:r.at||Date.now()});while(checks.size>4000)checks.delete(checks.keys().next().value);if(epoch(job.rev))paintCheck(job.node,r);}).catch(()=>{checks.set(job.url,{state:"unknown",at:Date.now()});}).finally(()=>{checking--;if(active&&availableOnly&&!checking&&!checkQueue.length)render();pumpChecks();});
 }
}
async function dvr(action="status",data=null){return bridge.liveTvDVR(action,data);}
async function recordRow(row,programme,series=false){
 if(row.kind!=="url")return;
 const item={url:row.url,name:row.name,title:programme.title,start:programme.start,end:programme.end};
 try{let s=await dvr();if(!s.folder)s=await dvr("folder");if(!s.folder)return;
 await dvr(series?"series":"add",item);report("Recording scheduled.","Запись запланирована.");if(series)void syncSeries();}catch(_){report("Could not schedule recording. Check destination and programme time.","Не удалось запланировать запись. Проверьте папку и время.");}
}
function showRecord(row){
 clearWork();const wrap=el("div","dk-live-schedule"),duration=el("select","dk-live-input");
 for(const min of [15,30,60,90,120,180]){const option=el("option","",min+tr(" minutes"," мин."));option.value=String(min);duration.append(option);}duration.value="60";
 wrap.append(el("h2","",row.name),el("p","",tr("Record live television for:","Длительность записи:")),duration,button("Start Recording","Начать запись",()=>{const start=Date.now()/1000;void recordRow(row,{start,end:start+Number(duration.value)*60,title:row.name});}));workspace.append(wrap);
}
function showSchedule(row){
 clearWork();const wrap=el("div","dk-live-schedule");wrap.append(el("h2","",row.name));
 const from=el("input","dk-live-input");from.type="datetime-local";const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());from.value=d.toISOString().slice(0,16);
 const listBox=el("div");wrap.append(from,listBox);workspace.append(wrap);
 const draw=()=>{listBox.replaceChildren();const time=new Date(from.value).getTime()/1000||Date.now()/1000;
 const list=programRows(row).filter(x=>x.end>time).slice(0,100);
 if(!list.length)listBox.append(el("p","dk-live-muted",tr("No published programme schedule.","Нет опубликованной телепрограммы.")));
 for(const programme of list){const line=el("div","dk-live-schedule-row");const summary=el("span","",new Date(programme.start*1000).toLocaleString(ru()?"ru-RU":undefined)+" · "+programme.title);if(programme.desc)summary.title=programme.desc;line.append(summary);
 if(row.kind==="url"&&programme.end>Date.now()/1000)line.append(button("Record","Записать",()=>void recordRow(row,programme)),button("Record Series","Записать сериал",()=>void recordRow(row,programme,true)));listBox.append(line);}};
 from.addEventListener("change",draw);draw();
}
async function showDVR(){
 clearWork();const wrap=el("div","dk-live-schedule");workspace.append(wrap);
 try{const s=await dvr();if(!wrap.isConnected)return;wrap.append(el("h2","",tr("Recordings","Записи")),el("p","",s.folder||tr("Choose a recording folder.","Выберите папку записей.")),el("p","dk-live-muted",tr("Keep Kinehall open for scheduled recordings. One recording at a time.","Для записи по расписанию не закрывайте проигрыватель. Одна запись одновременно.")),button("Recording Folder","Папка записей",async()=>{await dvr("folder");void showDVR();}),button("Refresh","Обновить",()=>void showDVR()));
 const names={scheduled:["Scheduled","Запланировано"],recording:["Recording","Запись"],complete:["Complete","Завершено"],cancelled:["Cancelled","Отменено"],missed:["Missed","Пропущено"],failed:["Failed","Ошибка"],interrupted:["Interrupted","Прервано"]};
 for(const job of [...s.jobs].reverse().slice(0,100)){const line=el("div","dk-live-schedule-row");line.append(el("span","",job.name+" · "+job.title+" · "+new Date(job.start*1000).toLocaleString()+" · "+tr(...(names[job.state]||names.failed))));if(["scheduled","recording"].includes(job.state))line.append(button("Cancel","Отменить",async()=>{await dvr("cancel",job.id);void showDVR();}));wrap.append(line);}
 for(const rule of s.series){const line=el("div","dk-live-schedule-row");line.append(el("span","",tr("Series: ","Сериал: ")+rule.title),button("Remove rule","Убрать правило",async()=>{await dvr("remove-series",rule);void showDVR();}));wrap.append(line);}
 }catch(_){wrap.append(el("p","",tr("Recordings unavailable.","Записи недоступны.")));}
}
function saveGuideCache(){
 clearTimeout(guideSaveTimer);guideSaveTimer=setTimeout(()=>{
  const now=Date.now()/1000,rows=[];let count=0;
  for(const [id,items] of programs){const valid=items.filter(x=>x.end>now-3600).slice(0,100).map(x=>({...x,desc:String(x.desc||"").slice(0,160)}));if(valid.length&&count+valid.length<=18000){rows.push([id,valid]);count+=valid.length;}}
  void bridge.liveTvGuideCache("write",{programs:rows,names:[...xmlNames].slice(0,40000)}).catch(()=>{});
 },1200);
}
async function restoreGuide(){
 if(guideRestored)return;guideRestored=true;
 try{const data=await bridge.liveTvGuideCache("read");if(!data||!Array.isArray(data.programs)||!Array.isArray(data.names))return;
 const now=Date.now()/1000;for(const [id,rows] of data.programs)if(!programs.has(id)&&Array.isArray(rows))programs.set(id,rows.filter(x=>x.end>now-3600));for(const [key,id] of data.names)if(!xmlNames.has(key))xmlNames.set(key,id);if(active){render();void syncSeries();}
 }catch(_){}
}
async function syncSeries(){
 try{const s=await dvr();if(!s.series.length)return;const rows=[];
 for(const rule of s.series){const raw=[...imported,...directory,...saved,...recent].find(x=>x.url===rule.url);if(!raw)continue;for(const programme of programRows(enriched(raw)))if(programme.title===rule.title&&programme.end>Date.now()/1000)rows.push({...programme,url:rule.url,name:raw.name});}
 if(rows.length)await dvr("sync",rows.slice(0,3000));
 }catch(_){}
}
function flag(c){return /^[A-Z]{2}$/.test(c)?String.fromCodePoint(...[...c].map(x=>127397+x.charCodeAt(0))):"";}
const categoryLabels={general:["General","Общие"],news:["News","Новости"],sports:["Sports","Спорт"],movies:["Movies","Фильмы"],music:["Music","Музыка"],entertainment:["Entertainment","Развлечения"],documentary:["Documentary","Документальные"],kids:["Children","Детские"],education:["Education","Образование"],religious:["Religion","Религия"],series:["Series","Сериалы"],lifestyle:["Lifestyle","Образ жизни"],business:["Business","Бизнес"],culture:["Culture","Культура"],comedy:["Comedy","Комедия"],family:["Family","Семейные"],animation:["Animation","Анимация"],weather:["Weather","Погода"],shop:["Shopping","Покупки"],travel:["Travel","Путешествия"],cooking:["Cooking","Кулинария"],outdoor:["Outdoors","Природа"],science:["Science","Наука"],auto:["Automotive","Автомобили"],classic:["Classic","Классика"],legislative:["Legislative","Парламент"],relax:["Relaxation","Отдых"],xxx:["Adult","Для взрослых"]};
const categoryName=c=>categoryLabels[c]?tr(...categoryLabels[c]):c;
const languageName=c=>{try{return new Intl.DisplayNames([ru()?"ru":"en"],{type:"language"}).of(c)||c;}catch(_){return c;}};
function enriched(row){
 if(row.kind!=="url")return row;
 const m=catalogMatches.get(row.url);
 if(!m)return row;
 return {...row,country:m.country||row.country,guideId:row.guideId||m.id+(m.feed?"@"+m.feed:""),catalogId:m.id,catalogName:m.name,logo:m.logo||row.logo,playlistLogo:row.logo,categories:m.categories,languages:m.languages};
}
async function enrichCatalog(){
 if(!active)return;
 if(catalogPending){catalogAgain=true;return;}
 const rows=[...new Map([...imported,...directory,...saved.filter(x=>x.kind==="url")].map(x=>[x.url,x])).values()].slice(0,12000);
 const pending=rows.filter(x=>!catalogMatches.has(x.url)||Date.now()-catalogAt>12*3600000);
 if(!pending.length){void autoGuide();return;}
 catalogPending=true;const rev=serial;
 try{
  const matches=await bridge.liveTvCatalog(pending.map(x=>({url:x.url,id:x.guideId||""})));
  if(!Array.isArray(matches)||matches.length!==pending.length)throw Error("Invalid catalog");
  matches.forEach((m,i)=>catalogMatches.set(pending[i].url,m));
  catalogAt=Date.now();while(catalogMatches.size>16000)catalogMatches.delete(catalogMatches.keys().next().value);
  if(epoch(rev)){render();void autoGuide();}
 }catch(_){if(epoch(rev))report("Channel metadata source unavailable; playlist data retained.","База телеканалов недоступна; сохранены данные списка.");}
 finally{catalogPending=false;if(catalogAgain){catalogAgain=false;void enrichCatalog();}}
}
function syncFilters(rows){
 if(!filters)return;
 const opt=(v,t)=>{const o=el("option","",t);o.value=v;return o;};
 const cats=[...new Set(rows.flatMap(x=>x.categories?.length?x.categories:x.group?[x.group]:[]))].sort();
 const langs=[...new Set(rows.flatMap(x=>x.languages||[]))].sort();
 if(!cats.includes(categoryFilter))categoryFilter="";if(!langs.includes(languageFilter))languageFilter="";
 filters.cat.replaceChildren(opt("",tr("All categories","Все категории")),...cats.map(c=>opt(c,categoryName(c))));filters.cat.value=categoryFilter;
 filters.lang.replaceChildren(opt("",tr("All languages","Все языки")),...langs.map(c=>opt(c,languageName(c))));filters.lang.value=languageFilter;
}
function attachLogo(art,row){
 const file=logo(row),url=validURL(row.logo||"");
 const initials=String(row.catalogName||row.name||"").replace(/\s*\(\d+p\)\s*$/i,"").split(/\s+/).map(x=>x[0]||"").join("").slice(0,4).toUpperCase();
 art.textContent=initials||row.number||"▣";
 const paint=src=>{const img=el("img");img.alt="";img.loading="lazy";img.src=src;img.addEventListener("error",()=>{img.remove();art.textContent=initials||row.number||"▣";},{once:true});art.replaceChildren(img);};
 if(file){paint("./assets/channel_logos/builtin/"+encodeURIComponent(file));return;}
 if(!url)return;
 if(logoCache.has(url)){paint(logoCache.get(url));return;}
 if(!logoObserver&&typeof IntersectionObserver==="function")logoObserver=new IntersectionObserver(entries=>{
  for(const e of entries)if(e.isIntersecting){logoObserver.unobserve(e.target);const job=e.target.dkLogoJob;if(job)logoQueue.push(job);}
  pumpLogos();
 },{rootMargin:"150px"});
 const job={url,paint,generation:logoGeneration,alternate:validURL(row.playlistLogo||"")};art.dkLogoJob=job;
 if(logoObserver)logoObserver.observe(art);else{logoQueue.push(job);pumpLogos();}
}
function pumpLogos(){
 while(logoBusy<3&&logoQueue.length){
  const job=logoQueue.shift();if(job.generation!==logoGeneration||!active)continue;
  logoBusy++;
  Promise.resolve().then(()=>bridge.liveTvResource(job.url,"logo")).then(data=>{
   if(!/^image\/(?:png|jpeg|webp|gif|svg\+xml|avif)$/.test(data.mime)||typeof data.base64!=="string"||data.base64.length>2800000)return;
   const src="data:"+data.mime+";base64,"+data.base64;
   if(src.length<400000){logoCache.set(job.url,src);while(logoCache.size>48)logoCache.delete(logoCache.keys().next().value);}
   if(active&&job.generation===logoGeneration)job.paint(src);
  }).catch(()=>{if(job.alternate&&job.alternate!==job.url&&job.generation===logoGeneration)logoQueue.push({...job,url:job.alternate,alternate:null});}).finally(()=>{logoBusy--;pumpLogos();});
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
 const open=()=>{const url=validURL(input.value.trim());if(!url){report("Enter a valid HTTP or HTTPS address.","Введите действительный адрес HTTP или HTTPS.");return;}if(/\.(?:m3u|pls|xspf|asx|wax|wvx)$/i.test(new URL(url).pathname)){void remotePlaylist(url,false);return;}const name=new URL(url).hostname;void play({kind:"url",url,name});};
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
// Import only media addresses, never execute playlist-supplied directives,
 // VLC options, scripts, XML entities, or local filesystem references.
function parsePlaylist(text,base=null){
 text=String(text||"").replace(/^\uFEFF/,"").trim();
 if(text.length>8*1024*1024)throw Error("Playlist too large");
 if(/^#EXTM3U/i.test(text)||!/^(\[playlist\]|<)/i.test(text))return parseM3U(text,base);
 const rows=[],seen=new Set();
 const resolve=(value,origin=base)=>{if(!value||/^[a-z]:[\\/]|^\\\\/i.test(value))return null;try{return validURL(origin?new URL(value,origin).href:value);}catch(_){return null;}};
 const add=(address,title="",art="",origin=base)=>{
  const url=resolve(String(address||"").trim(),origin);if(!url||seen.has(url)||rows.length>=12000)return;
  seen.add(url);rows.push({kind:"url",url,name:String(title||new URL(url).hostname).trim().slice(0,250)||new URL(url).hostname,guideId:"",country:"",number:"",logo:resolve(String(art||"").trim(),origin)||"",group:""});
 };
 if(/^\[playlist\]/i.test(text)){
  const entries=new Map();
  for(const line of text.split(/\r?\n/)){
   const m=/^\s*(File|Title)(\d{1,6})\s*=(.*)$/i.exec(line);if(!m)continue;
   const n=Number(m[2]);if(n<1||n>12000)continue;
   const row=entries.get(n)||{};row[m[1].toLowerCase()]=m[3].trim();entries.set(n,row);
  }
  for(const [,row] of [...entries].sort((a,b)=>a[0]-b[0]))if(row.file)add(row.file,row.title);
  return rows;
 }
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error("Unsafe playlist XML");
 const doc=new DOMParser().parseFromString(text,"application/xml");
 if(doc.querySelector("parsererror"))throw Error("Invalid playlist XML");
 const root=doc.documentElement,tag=node=>node.localName.toLowerCase(),children=(node,name)=>Array.from(node.children).filter(x=>tag(x)===name),value=(node,name)=>children(node,name)[0]?.textContent?.trim()||"";
 const attr=(node,name)=>Array.from(node.attributes).find(x=>x.localName.toLowerCase()===name)?.value||"";
 if(tag(root)==="playlist"){
  for(const list of children(root,"tracklist"))for(const track of children(list,"track")){
   const title=value(track,"title"),art=value(track,"image");
   for(const location of children(track,"location"))add(location.textContent,title,art);
  }
 }else if(tag(root)==="asx"){
  const title=value(root,"title");
  for(const entry of children(root,"entry")){
   for(const ref of children(entry,"ref"))add(attr(ref,"href"),value(entry,"title")||title);
  }
  // ENTRYREF points to another list, not a media file. Do not recurse.
 }else throw Error("Unsupported playlist");
 return rows;
}
function chooseFile(accept,limit,fn){
 const input=el("input");input.type="file";input.accept=accept;input.hidden=true;panel.append(input);
 input.addEventListener("change",async()=>{const file=input.files?.[0];try{if(!file)return;if(file.size>limit)throw Error("size");await fn(await file.text());}catch(_){report("Could not import this file.","Не удалось импортировать файл.");}finally{input.remove();}},{once:true});
 input.addEventListener("cancel",()=>input.remove(),{once:true});input.click();
}
function importPlaylist(){
 if(busy)return;
 chooseFile(".m3u,.m3u8,.pls,.xspf,.asx,.wax,.wvx,text/plain,application/vnd.apple.mpegurl",8*1024*1024,text=>{
  if(/#EXT-X-(?:TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/i.test(text)){report("This is an HLS media manifest, not a channel list.","Это манифест HLS, а не список каналов.");return;}
  readGuideHeader(text);
  const rows=parsePlaylist(text);if(!rows.length){report("No compatible channel addresses in this playlist.","В списке нет совместимых адресов каналов.");return;}
  imported=[...new Map([...imported,...rows].map(x=>[x.url,x])).values()].slice(0,3000);
  if(!write(keys.playlist,imported))report("Playlist loaded for this session only.","Список загружен только для этого сеанса.");
  else report("Playlist imported.","Список импортирован.");clearWork();showAll();void enrichCatalog();
 });
}
function parseGuide(text){
  text=text.replace(/<!DOCTYPE\s+tv\s+SYSTEM\s+["\']xmltv\.dtd["\']\s*>/i,"");
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error("Invalid XML");
  const doc=new DOMParser().parseFromString(text,"application/xml");if(doc.querySelector("parsererror")||doc.documentElement.localName!=="tv")throw Error("Invalid guide");
  const names=new Map(),items=new Map();let count=0;
  for(const c of doc.querySelectorAll("channel")){
   const id=c.getAttribute("id");if(!id)continue;
   const cc=/\.([a-z]{2})(?:@.*)?$/i.exec(id)?.[1]?.toUpperCase();
   if(!cc)continue;
   for(const value of [id.replace(/\.[a-z]{2}(?:@.*)?$/i,""),...Array.from(c.querySelectorAll("display-name"),n=>n.textContent)]){
    const k=cc+":"+compact(value);
    if(names.has(k)&&names.get(k)!==id)names.set(k,null);else names.set(k,id);
   }
  }
  for(const p of doc.querySelectorAll("programme")){
   const id=p.getAttribute("channel"),start=parseDate(p.getAttribute("start")),end=parseDate(p.getAttribute("stop")),now=Date.now()/1000;
   if(!id||!start||end<=start||end<now-3600||start>now+48*3600)continue;
   if(++count>50000)break;const row={start,end,title:(p.querySelector("title")?.textContent||tr("Untitled programme","Без названия")).slice(0,250),desc:(p.querySelector("desc")?.textContent||"").slice(0,700)};
   if(!items.has(id))items.set(id,[]);items.get(id).push(row);
  }
  for(const rows of items.values())rows.sort((a,b)=>a.start-b.start);
  for(const [id,rows] of items)programs.set(id,rows);
  for(const [name,id] of names){if(xmlNames.has(name)&&xmlNames.get(name)!==id)xmlNames.set(name,null);else xmlNames.set(name,id);}
  while(programs.size>10000)programs.delete(programs.keys().next().value);
  saveGuideCache();void syncSeries();render();
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
 if(!active||guideLoading)return;
 const counts=new Map();for(const raw of [...imported,...directory,...saved]){const r=enriched(raw);if(r.country)counts.set(r.country,(counts.get(r.country)||0)+1);}
 const chosen=country||directoryCountry;
 const top=chosen?[chosen]:[...counts].sort((a,b)=>b[1]-a[1]).map(x=>x[0]).filter(x=>regionalGuides[x]).slice(0,3);
 const urls=[...new Set([...top.map(x=>regionalGuides[x]),...guideSources].filter(Boolean))].slice(0,3);
 if(!urls.length){if(force)report("Select a supported country or enter a free XMLTV guide URL.","Выберите поддерживаемую страну или введите адрес бесплатной телепрограммы.");return;}
 const rev=serial;for(const url of urls){if(!epoch(rev))break;await fetchGuide(url,force);}

}
async function remotePlaylist(value,worldMode,chosen=""){
 const url=validURL(value);if(!url||busy)return;
 const rev=serial;setBusy(true);report("Loading free channel directory…","Загрузка бесплатного списка каналов…");
 try{
  const data=await bridge.liveTvResource(url,"playlist");if(!epoch(rev))return;
  if(/#EXT-X-(?:TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/i.test(data.text)){setBusy(false);await play({kind:"url",url,name:new URL(url).hostname});return;}
  readGuideHeader(data.text);const rows=parsePlaylist(data.text,validURL(data.url)||url);
  if(!rows.length)throw Error("Empty playlist");
  if(worldMode){directory=rows.map(x=>chosen&&!x.country?{...x,country:chosen}:x);directoryCountry=chosen;mode="world";country=chosen;render();}
  else{imported=[...new Map([...imported,...rows].map(x=>[x.url,x])).values()].slice(0,3000);write(keys.playlist,imported);showAll();}
  report("Channels loaded: "+rows.length,"Каналов загружено: "+rows.length);void enrichCatalog();
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
 if(!directory.length&&!busy)load();else void enrichCatalog();
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
 const cat=el("select","dk-live-input"),lang=el("select","dk-live-input");filters={cat,lang};
 cat.setAttribute("aria-label",tr("Category","Категория"));lang.setAttribute("aria-label",tr("Language","Язык"));
 cat.addEventListener("change",()=>{categoryFilter=cat.value;render();});lang.addEventListener("change",()=>{languageFilter=lang.value;render();});
 const available=el("input");available.type="checkbox";const availabilityLabel=el("label","dk-live-small");availabilityLabel.append(available,el("span","",tr("Available only","Только доступные")));
 available.addEventListener("change",()=>{availableOnly=available.checked;render();});
 guideBar.append(heading,button("All Channels","Все каналы",()=>{clearWork();showAll();}),button("Recent Channels","Недавние каналы",()=>{clearWork();mode="recent";render();}),button("Recordings","Записи",()=>void showDVR()),button("Import TV Guide","Импорт телепрограммы",importGuide),button("Refresh Channels","Обновить каналы",()=>{if(!busy){checks.clear();const chosen=country||directoryCountry;void remotePlaylist("https://iptv-org.github.io/iptv/"+(chosen?"countries/"+chosen.toLowerCase()+".m3u":"index.m3u"),true,chosen);}}),cat,lang,availabilityLabel,search);
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
function open(){init();active=true;serial++;panel.hidden=false;panel.parentElement.classList.add("dk-live-active");syncTabs();render();void restoreGuide();void enrichCatalog();clearInterval(guideRefreshTimer);guideRefreshTimer=setInterval(()=>{if(active){render();void autoGuide();}},5*60*1000);}
function close(){if(!active)return;logoObserver?.disconnect();checkObserver?.disconnect();logoQueue=[];checkQueue=[];clearInterval(guideRefreshTimer);if(atscRunning){atscCancelled=true;void bridge.liveTvAtscCancel?.().catch(()=>{});}active=false;serial++;panel.hidden=true;panel.parentElement.classList.remove("dk-live-active");$("libraryLiveTV")?.setAttribute("aria-selected","false");}
window.DKLiveTV={open,close,syncTabs};
})();