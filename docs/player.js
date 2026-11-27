(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const media = byId("media");
  let translationRun=0,translationBusy=false,translationReady=false,translationOriginals=null;
  let translationSession=null;
  let resetVoiceover=()=>{},refreshVoiceover=()=>{},voiceoverOriginalFactor=()=>1,voiceoverCenterFactor=()=>null,updateVoiceoverGain=()=>{};
  let nextCountdown=null;
  let refreshSegmentSkip=()=>{};
  let deferStartup=Boolean(window.DKLibraryBridge?.internalPages&&new URLSearchParams(location.search).get("settingsOnly")==="1");
  let mkvAudio = null;
  let userMuted = false;
  const screen = byId("screen");
  const pgsCanvas = byId("pgsOverlay");
  const queueView = byId("queue");
  const store = {
    resume: "dkmedia.web.resume.v1",
    volume: "dkmedia.web.volume.v2",
    lastMedia: "dkmedia.web.last-media.v1",
    subtitlePreference: "dkmedia.web.subtitle-preference.v1",
    subtitleDelays: "dkmedia.web.subtitle-delays.v1",
    audioPreferences: "dkmedia.web.audio-preferences.v1",
    embeddedSubtitlePreferences: "dkmedia.web.mkv-subtitle-preferences.v1",
    folderName: "dkmedia.web.folder-name.v1",
    playbackSettings: "dkmedia.web.playback-settings.v1",
    queueOrder: "dk-kinehall.queue-order.v1",
    queueSequence: "dk-kinehall.queue-sequence.v1"
  };
  const read = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value === null ? fallback : value;
    } catch (_) { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (_) { /* Playback still works if storage is unavailable. */ }
  };
  const resumeData = read(store.resume, {});
  const state = {
    queue: [], current: -1,
    resume: resumeData && typeof resumeData === "object" && !Array.isArray(resumeData) ? resumeData : {},
    subtitleObject: null, subtitleNode: null, nativeSubtitle: null,
    lastResumeSave: 0,
    subtitleEpoch: 0, mkvSubtitleAbort: null, mkvSubtitlePending: false,
    activeEmbeddedTrack: null,
    activePgsTrack: null, pgsEvents: null, pgsLastFrame: null, subtitleRenderer: null,
    restoreHandle: null, pendingPickerMode: "open", stopped: false,
    folderHandle: null, folderScanVersion: 0, folderName: read("dkmedia.web.folder-name.v1", ""),
    audioPreferences: (() => {
      const saved = read(store.audioPreferences, {});
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    })(),
    embeddedSubtitlePreferences: (() => {
      const saved = read(store.embeddedSubtitlePreferences,{});
      return saved && typeof saved==="object" && !Array.isArray(saved)?saved:{};
    })(),
    subtitlePreference: (() => {
      const pref = read(store.subtitlePreference, {mode: "off"});
      return pref && pref.mode === "track" ? {
        mode: "track", label: String(pref.label || "").slice(0, 200),
        language: String(pref.language || "").slice(0, 32)
      } : {mode: "off"};
    })()
  };
  const validPlaybackFormats = ["auto","original","mp4","webm"];
  const savedPlayback = read(store.playbackSettings, {});
  const playbackSettings = {
    format: validPlaybackFormats.includes(savedPlayback?.format) ? savedPlayback.format : "auto",
    hardware: savedPlayback?.hardware !== false,
    remember: savedPlayback?.remember !== false,
    removeWatched: savedPlayback?.removeWatched !== false
  };
  const deinterlaceKey="dk-kinehall.deinterlace.v1";
  const standaloneDeinterlace=Boolean(window.DKLibraryBridge?.internalPages&&window.DKCodecBridge?.probe);
  const savedDeinterlace=standaloneDeinterlace?read(deinterlaceKey,"off"):"off";
  let deinterlacePreference=["off","auto","on"].includes(savedDeinterlace)?savedDeinterlace:"off";
  const smoothingKey="dk-kinehall.smoothing.v1";
  const savedSmoothing=standaloneDeinterlace?read(smoothingKey,"off"):"off";
  let smoothingPreference=["off","auto","60","120"].includes(savedSmoothing)?savedSmoothing:"off";
  let reapplyCurrentFormat = null, sharedSettingsEditing=false;
  const playbackFormatInput = byId("playbackFormat");
  if(window.DKCodecBridge?.exportVideo){
    const button=document.createElement("button");
    button.type="button";button.className="btn ghost";button.id="nativeExportVideo";
    const language=()=>byId("languageSelect").value==="ru"?"ru":"en";
    const refresh=()=>{button.textContent=window.DKLocale?.pair("Convert video…","Конвертировать видео…")||"Convert video…";};
    button.addEventListener("click",()=>{void window.DKCodecBridge.exportVideo(language()).catch(()=>{});});
    byId("playbackFormatNote").after(button);
    byId("languageSelect").addEventListener("change",()=>queueMicrotask(refresh));refresh();
  }
  const hardwareInput = byId("playbackHardware");
  const rememberInput = byId("playbackRemember");
  const removeWatchedInput = byId("removeWatched");
  playbackFormatInput.value = playbackSettings.format;
  hardwareInput.checked = playbackSettings.hardware;
  rememberInput.checked = playbackSettings.remember;
  removeWatchedInput.checked = playbackSettings.removeWatched;
  const updatePlaybackSettings = event => {
    const formatChanged = event?.target === playbackFormatInput;
    playbackSettings.format = playbackFormatInput.value;
    playbackSettings.hardware = hardwareInput.checked;
    playbackSettings.remember = rememberInput.checked;
    playbackSettings.removeWatched = removeWatchedInput.checked;
    try {
      if (playbackSettings.remember) write(store.playbackSettings, playbackSettings);
      else localStorage.removeItem(store.playbackSettings);
    } catch (_) {}
    byId("playbackFormatNote").textContent = playbackSettings.format === "original"
      ? "Original mode skips conversion and keeps the local source unchanged."
      : "Supported MKV files can be remuxed without re-encoding. Full transcoding and GPU switching are not installed.";
    if (formatChanged && reapplyCurrentFormat && !sharedSettingsEditing) reapplyCurrentFormat();
  };
  for (const control of [playbackFormatInput,hardwareInput,rememberInput,removeWatchedInput])
    control.addEventListener("change",updatePlaybackSettings);
  const current = () => state.queue[state.current] || null;
  const cancelNextCountdown=()=>{
    if(nextCountdown){clearInterval(nextCountdown.timer);nextCountdown=null;}
    const overlay=byId("dkNextCountdown");if(overlay)overlay.hidden=true;
  };
  const scheduleNextCountdown=item=>{
    if(!item)return;
    if(!window.DKLibraryBridge?.internalPages){load(state.queue.indexOf(item),true);return;}
    cancelNextCountdown();
    let overlay=byId("dkNextCountdown");
    if(!overlay){
      overlay=document.createElement("div");overlay.id="dkNextCountdown";overlay.className="dk-next-countdown";overlay.hidden=true;
      overlay.innerHTML='<div class="dk-next-card"><strong>Up Next</strong><span class="dk-next-title"></span><span class="dk-next-clock" role="status" aria-live="polite"></span><div class="dk-next-actions"><button type="button" class="btn primary" data-next-play>Play now</button><button type="button" class="btn" data-next-cancel>Cancel</button></div></div>';
      screen.append(overlay);
      overlay.querySelector("[data-next-play]").addEventListener("click",()=>{
        const pending=nextCountdown;if(!pending)return;
        cancelNextCountdown();const index=state.queue.indexOf(pending.item);if(index>=0)load(index,true);
      });
      overlay.querySelector("[data-next-cancel]").addEventListener("click",cancelNextCountdown);
      overlay.addEventListener("dblclick",e=>e.stopPropagation());
    }
    const parsed=window.DKMediaMetadata?.parseFilename(item.metadataFilename||item.name);
    overlay.querySelector(".dk-next-title").textContent=parsed?.type==="episode"?parsed.series+" · S"+String(parsed.season).padStart(2,"0")+"E"+String(parsed.episode).padStart(2,"0"):parsed?.title||item.name;
    const clock=overlay.querySelector(".dk-next-clock"),deadline=Date.now()+5000;
    const tick=()=>{
      if(!nextCountdown||nextCountdown.item!==item)return;
      const index=state.queue.indexOf(item);
      if(index<0){cancelNextCountdown();return;}
      const remaining=Math.max(0,Math.ceil((deadline-Date.now())/1000));
      if(!remaining){cancelNextCountdown();load(index,true);return;}
      clock.textContent=(window.DKLocale?.get()==="ru"?"Начало через ":"Starting in ")+remaining+(window.DKLocale?.get()==="ru"?" с":" s");
    };
    nextCountdown={item,timer:setInterval(tick,100)};
    overlay.hidden=false;tick();window.DKLocale?.apply();
  };
  const queueIdentity = item =>
    item.kind+"|"+String(item.path||item.name||"")+"|"+String(item.key||"");
  const rememberQueueSequence = () => {
    write(store.queueSequence,state.queue.slice(0,500).map(queueIdentity));
  };
  const restoreQueueSequence = () => {
    const saved=read(store.queueSequence,[]);
    if(!Array.isArray(saved)||!saved.length||playbackOrder.shuffle)return;
    const ranks=new Map(saved.slice(0,500)
      .filter(key=>typeof key==="string").map((key,index)=>[key,index]));
    const active=current();
    state.queue.sort((a,b)=>{
      const rankA=ranks.get(queueIdentity(a)),rankB=ranks.get(queueIdentity(b));
      return (rankA===undefined?Infinity:rankA)-
        (rankB===undefined?Infinity:rankB);
    });
    state.current=active?state.queue.indexOf(active):-1;
    renderQueue();
  };
  const savedOrder = read(store.queueOrder, {});
  const playbackOrder = {
    shuffle: savedOrder?.shuffle === true,
    loop: ["off","one","all"].includes(savedOrder?.loop) ? savedOrder.loop : "off"
  };
  const rememberOrder = () => write(store.queueOrder, playbackOrder);
  const shuffleUpcoming = () => {
    // Never disturb a video currently playing or previous entries.
    const start = Math.max(0, state.current + 1);
    for (let i = state.queue.length - 1; i > start; i--) {
      const other = start + Math.floor(Math.random() * (i - start + 1));
      [state.queue[i],state.queue[other]] = [state.queue[other],state.queue[i]];
    }
    rememberQueueSequence();
  };
  const updateOrderButtons = () => {
    const shuffle = byId("shuffleQueue"), loop = byId("loopQueue");
    shuffle.setAttribute("aria-pressed", String(playbackOrder.shuffle));
    shuffle.classList.toggle("order-active", playbackOrder.shuffle);
    const labels = {off:"Off",one:"One",all:"All"};
    loop.textContent = "Loop: " + labels[playbackOrder.loop];
    loop.setAttribute("aria-label", loop.textContent);
    loop.title = "Repeat mode: " + labels[playbackOrder.loop];
    loop.classList.toggle("order-active", playbackOrder.loop !== "off");
  };
  byId("shuffleQueue").addEventListener("click", () => {
    playbackOrder.shuffle = !playbackOrder.shuffle;
    if (playbackOrder.shuffle) shuffleUpcoming();
    rememberOrder();
    updateOrderButtons();
    renderQueue();
    status(playbackOrder.shuffle ? "Shuffle enabled." : "Shuffle disabled.", true);
  });
  byId("loopQueue").addEventListener("click", () => {
    const modes = ["off","one","all"];
    playbackOrder.loop = modes[(modes.indexOf(playbackOrder.loop) + 1) % modes.length];
    rememberOrder();
    updateOrderButtons();
    updateButtons();
    status("Repeat mode: " + ({off:"Off",one:"One",all:"All"}[playbackOrder.loop]), true);
  });
  updateOrderButtons();

  // FileSystemFileHandle objects can be structured-cloned into IndexedDB.
  // Only a reference to the user's chosen file is stored, never its contents.
  // Local playback remains possible even if IndexedDB is unavailable.
  const handleDb = "dkmedia.web.local-files.v1";
  const handleStore = "handles";
  const lastHandleKey = "lastPlayingFile";
  const folderHandleKey = "selectedMediaFolder";
  const openHandleDatabase = () => new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error("IndexedDB unavailable")); return; }
    const request = window.indexedDB.open(handleDb, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(handleStore)) {
        request.result.createObjectStore(handleStore);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open file storage"));
  });
  const storedHandle = async (operation, handle = null, key = lastHandleKey) => {
    const database = await openHandleDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(handleStore, operation === "read" ? "readonly" : "readwrite");
      const store = transaction.objectStore(handleStore);
      let result = null;
      const request = operation === "read" ? store.get(key) :
        operation === "save" ? store.put(handle, key) : store.delete(key);
      request.onsuccess = () => { result = request.result || null; };
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error || new Error("Unable to update file storage"));
      };
    });
  };
  let handleWrites = Promise.resolve();
  let nativeRestoreWrites=Promise.resolve(),restoreInFlight=null;
  const updateStoredHandle = handle => {
    // Serialize writes so the last media selection always wins.
    handleWrites = handleWrites.catch(() => {}).then(
      () => storedHandle(handle ? "save" : "delete", handle)
    );
    handleWrites.catch(() => { /* Browser storage can be disabled. */ });
  };
  const clearRememberedMedia = () => {
    try { localStorage.removeItem(store.lastMedia); } catch (_) {}
    updateStoredHandle(null);
    if(window.DKLibraryBridge?.forgetMedia)nativeRestoreWrites=nativeRestoreWrites.catch(()=>{}).then(()=>window.DKLibraryBridge.forgetMedia()).catch(()=>{});
    byId("restoreMedia").hidden = true;
    byId("restoreHint").hidden = true;
  };
  const rememberSelectedMedia = item => {
    if(item.file?.dvdToken||item.kind==="network")return; // Session-only sources do not replace the last local file.
    if (item.handle) {
      write(store.lastMedia, {kind: "file", name: item.name, key: item.key,libraryId:item.libraryId||null});
      updateStoredHandle(item.handle);
    } else {
      // Files selected via the legacy input or drag-and-drop are session-only.
      write(store.lastMedia, {kind: "temporary-file", name: item.name, key: item.key,libraryId:item.libraryId||null});
      updateStoredHandle(null);
    }
    if(window.DKLibraryBridge?.rememberMedia){
      const bridge=window.DKLibraryBridge;
      nativeRestoreWrites=nativeRestoreWrites.catch(()=>{}).then(async()=>{
        if(!item.file)return;
        const remembered=await bridge.rememberMedia(item.file,item.key).catch(()=>false);
        if(remembered)return;
        const resolved=await codecSource(item.file);
        if(resolved!==item.file)await bridge.rememberMedia({
          ...resolved,name:item.file.name,size:item.file.size,lastModified:item.file.lastModified
        },item.key);
      }).catch(()=>{});
    }
    byId("restoreMedia").hidden = true;
    byId("restoreHint").hidden = true;
  };
  let statusTimer=null;
  const status = (message, good = false) => {
    const node = byId("status");
    node.textContent = message;
    node.classList.toggle("good", good);
    if(window.DKLibraryBridge?.internalPages){
      clearTimeout(statusTimer);
      node.classList.toggle("dk-notice-visible",Boolean(message));
      if(message)statusTimer=setTimeout(()=>{
        node.classList.remove("dk-notice-visible");
      },5000);
    }
  };
  const time = seconds => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(s % 60).padStart(2, "0");
  };
  const fileIsMedia = file => !!file && (
    (typeof file.type === "string" && /^(video|audio)\//.test(file.type)) ||
    /\.(mp4|m4v|mov|mkv|avi|webm|ogg|ogv|mp3|m4a|aac|wav|flac|opus|ts|mts|m2ts|mpeg|mpg|m2v|mxf|vob|wmv|asf|flv|f4v|3gp|3g2|dv|divx|rm|rmvb|mpv|nut|mka|mp2|aiff?|ape|alac|wma|m4b|caf|dsf|dff|amr|ac3|dts)$/i.test(file.name)
  );
  const fileIsAudio = file => !!file && (
    file.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|flac|opus)$/i.test(file.name)
  );
  // FileSystemFileHandle.getFile() may produce a File without an Electron
  // native path. Recover only an unambiguous existing native catalog match;
  // the main process still validates the native ID and scope.
  const rawCodecBridge=window.DKCodecBridge;
  let codecCatalog=null;
  const codecSource=async file=>{
    if(file?.nativeVirtual||!file||!window.DKLibraryBridge?.internalPages)return file;
    const catalog=window.DKLibraryStore;
    if(!catalog?.entries)return file;
    if(!codecCatalog)codecCatalog=Promise.resolve(catalog.entries()).catch(()=>[]);
    const rows=await codecCatalog;
    const relative=String(file.webkitRelativePath||"").replace(/\\/g,"/");
    const matches=rows.filter(row=>row.source==="native"&&row.nativePath&&
      row.filename===file.name&&Number(row.size)===Number(file.size)&&
      Math.abs(Number(row.modified)-Number(file.lastModified))<=1&&
      (!relative||row.nativePath.endsWith("/"+relative)));
    if(matches.length!==1)return file;
    const row=matches[0];
    try{
      const opened=await window.DKLibraryBridge.nativeOpen(row.id,row.nativePath);
      if(Number(opened.size)!==Number(file.size)||
        Math.abs(Number(opened.modified)-Number(file.lastModified))>1)return file;
      return {nativeVirtual:true,nativeId:row.id,nativePath:row.nativePath};
    }catch(_){return file;}
  };
  window.DKLibraryBridge?.onScanState?.(scanning=>{if(!scanning)codecCatalog=null;});
  const codecCall=async(method,file,...args)=>{
    try{return await rawCodecBridge[method](file,...args);}
    catch(error){
      if(!/local file must be selected/i.test(String(error?.message||error)))throw error;
      const recovered=await codecSource(file);
      if(recovered===file)throw Error("Local file path unavailable. Scan Library or open the file from Library.");
      return rawCodecBridge[method](recovered,...args);
    }
  };
  const localCodecBridge=rawCodecBridge?{
    ...rawCodecBridge,
    probe:(file)=>codecCall("probe",file),
    adjacentFrame:typeof rawCodecBridge.adjacentFrame==="function"?(file,...args)=>codecCall("adjacentFrame",file,...args):null,
    start:(file,...args)=>codecCall("start",file,...args),
    recognizeSpeech:typeof rawCodecBridge.recognizeSpeech==="function"?(file,...args)=>codecCall("recognizeSpeech",file,...args):null,
    subtitleVtt:(file,...args)=>codecCall("subtitleVtt",file,...args)
  }:null;
  const codecPlayback = window.DKCodecPlayback?.attach({
    media,bridge:localCodecBridge,current,
    onStatus:(message,good)=>status(message,good),
    onClockChanged:()=>{updateTime();updateChapterMarkers();},
    onChaptersChanged:()=>updateChapterMarkers(),
    onTracksChanged:()=>updateSubtitleStatus(),
    onBeforeAutoplay:item=>isStream(item)&&primeStream(item,"startup"),
    hardwareEnabled:()=>playbackSettings.hardware,
    onOffsetChanged:(item,at)=>{
      const native=state.nativeSubtitle;
      if(native?.item===item)installSubtitleVTT(
        shiftedWebVtt(native.vtt,at),native.label,native.language,null,true);
    }
  }) || null;
  const playbackSeconds = () => codecPlayback ?
    codecPlayback.position(current()) : media.currentTime;
  const playbackDuration = () => codecPlayback ?
    codecPlayback.duration(current()) : media.duration;
  const setPlaybackPosition = seconds => {
    cancelNextCountdown();
    const item=current();
    if (!item) return;
    const value=Math.max(0,Number(seconds)||0);
    item.historyResumeTarget=0;
    if (codecPlayback?.isActive(item))void codecPlayback.seek(item,value);
    else media.currentTime=value;
  };
  // Accumulate actual advancing playback time, not seek position. Reset
  // samples at interruptions, and cap gaps so sleeping/buffering is not counted.
  let watchSample=null;
  const sampleWatchTime=()=>{
    const item=current(),now=performance.now(),position=playbackSeconds();
    if(!window.DKLibraryBridge?.internalPages||!item?.file||item.audio||item.file.dvdToken||
       state.stopped||!item.historyReady||media.paused||media.seeking||media.readyState<2||
       !Number.isFinite(position)){watchSample=null;return;}
    if(watchSample?.item===item){
      const elapsed=(now-watchSample.now)/1000,advance=position-watchSample.position;
      const rate=Math.max(0.1,Number(media.playbackRate)||1);
      if(elapsed>0&&elapsed<=2.5&&advance>0&&advance<=elapsed*rate+0.5)
        item.watchPending=Math.min(120,(item.watchPending||0)+Math.min(elapsed,advance/rate));
    }
    watchSample={item,now,position};
  };
  for(const event of ["seeking","pause","waiting","emptied","ratechange"])
    media.addEventListener(event,()=>{watchSample=null;});
  // Keep catalog writes ordered even if playback ends during identity recovery.
  const saveLibraryProgress=(item,position,duration,completed=false)=>{
    const catalog=window.DKLibraryStore;
    if(!catalog||!item)return;
    if(!window.DKLibraryBridge?.internalPages){
      if(item.libraryId)void catalog.updateProgress(item.libraryId,position,duration,completed).catch(()=>{});
      return;
    }
    if(!item.file||item.audio||item.file.dvdToken)return;
    const delta=item.watchPending||0,observedAt=Date.now();item.watchPending=0;
    item.historyWrites=(item.historyWrites||Promise.resolve()).catch(()=>{}).then(async()=>{
      const id=item.libraryId||item.file.nativeId;
      if(id&&await catalog.updateProgress(id,position,duration,completed,delta,observedAt)){
        item.libraryId=id;return;
      }
      // A scan may not have indexed this file yet. Retry periodically, not
      // on every clock tick, and always attempt a final completion write.
      const now=Date.now();
      if(!completed&&now-(item.historyLookupAt||0)<15000){item.watchPending=Math.min(120,(item.watchPending||0)+delta);return;}
      item.historyLookupAt=now;
      const row=await catalog.resolvePlaybackEntry(item.file,id);
      if(row&&await catalog.updateProgress(row.id,position,duration,completed,delta,observedAt)){
        item.libraryId=row.id;
      }else item.watchPending=Math.min(120,(item.watchPending||0)+delta);
    }).catch(()=>{item.watchPending=Math.min(120,(item.watchPending||0)+delta);});
  };
  const rememberPosition = () => {
    if(state.stopped)return;
    const item = current();
    const duration=playbackDuration(),position=playbackSeconds();
    if (!item || item.file?.dvdToken || item.kind==="network" || !Number.isFinite(duration) || duration <= 0) return;
    if(window.DKLibraryBridge?.internalPages){
      // Never overwrite saved progress with an initializing decoder clock.
      if(!item.historyReady||media.readyState<2||media.seeking||
         !Number.isFinite(position)||position<=2||item.deinterlacePending)return;
      if(item.historyResumeTarget>2&&position+1<item.historyResumeTarget)return;
      item.historyResumeTarget=0;
      if(media.ended)return;
      state.resume[item.key]=position;
    }else{
      if (position >= duration - 4) delete state.resume[item.key];
      else if (position > 2) state.resume[item.key] = position;
    }
    saveLibraryProgress(item,position,duration,false);
    const keys = Object.keys(state.resume);
    if (keys.length > 160) keys.slice(0, keys.length - 160).forEach(key => delete state.resume[key]);
    write(store.resume, state.resume);
  };
  // Only browser-exposed tracks can be enabled by HTMLMediaElement.
  const subtitleTracks = () => {
    try { return Array.from(media.textTracks || []).filter(track =>
      track.kind === "subtitles" || track.kind === "captions"); }
    catch (_) { return []; }
  };
  const normalizeSubtitleLanguage = value => {
    const lang = String(value || "").toLowerCase().split("-")[0];
    return {eng:"en",spa:"es",fre:"fr",fra:"fr",ger:"de",deu:"de",
      rus:"ru",ara:"ar",ita:"it",por:"pt",jpn:"ja"}[lang] || lang;
  };
  const sync = window.DKSubtitleSync;
  const savedDelays = read(store.subtitleDelays, {});
  const subtitleDelays = savedDelays && typeof savedDelays === "object" &&
    !Array.isArray(savedDelays) ? savedDelays : {};
  const subtitleDelayForCurrent = () => {
    const item = current();
    return item && sync ? sync.clampDelay(subtitleDelays[item.key] || 0) : 0;
  };
  const updateSubtitleDelayControls = () => {
    const enabled = !!current() && !!sync;
    const seconds = subtitleDelayForCurrent();
    for (const id of ["subtitleDelayEarlier","subtitleDelayLater","subtitleDelayReset"])
      byId(id).disabled = !enabled;
    byId("subtitleDelayEarlier").disabled ||= seconds <= -30;
    byId("subtitleDelayLater").disabled ||= seconds >= 30;
    byId("subtitleDelayReset").disabled ||= seconds === 0;
    byId("subtitleDelayValue").textContent = sync ?
      sync.displayDelay(seconds, document.documentElement.lang) : "0.00 s";
  };
  const applySubtitleDelayToText = () => {
    if (!sync) return;
    const delay = subtitleDelayForCurrent();
    for (const track of subtitleTracks()) sync.shiftTextTrack(track,delay);
  };
  const dvdSubOn=item=>!!item?.file?.dvdToken&&Number.isInteger(item.dvdSubtitleIndex)&&item.dvdSubtitleIndex>=0;
  const isDVDSubtitle=(item,track)=>!!item?.file?.dvdToken&&track?.codec==="dvd_subtitle";
  const subtitleIsOn = () => dvdSubOn(current()) || !!state.activePgsTrack ||
    state.activeEmbeddedTrack !== null || state.mkvSubtitlePending ||
    subtitleTracks().some(track => track.mode === "showing");
  const usableEmbeddedSubtitles = item => (item?.embeddedSubtitles || []).filter(track =>
    (window.DKMkvSubtitles && window.DKMkvSubtitles.canExtract(track.codec)) ||
    (window.DKPGS && window.DKPGS.canRender(track.codec)) ||
    (window.DKVobSub && window.DKVobSub.canRender(track.codec)));
  const isTextNativeSubtitle = track =>
    /^(subrip|ass|ssa|webvtt|mov_text|text|ttml|microdvd|sami|realtext)$/i
      .test(String(track?.codec||""));
  // Defined below with the existing subtitle-switching functions. The
  // status updater may run before menu initialization during startup.
  let refreshSubtitleTrackOptions = () => {};
  const updateSubtitleToggle = () => {
    const button = byId("subtitleToggle");
    const item = current();
    const on = subtitleIsOn();
    button.disabled = !item || (!on && !usableEmbeddedSubtitles(item).length &&
      !subtitleTracks().length &&
      !(codecPlayback?.isActive(item) &&
        (item.nativeSubtitleTracks||[]).some(track=>isTextNativeSubtitle(track)||isDVDSubtitle(item,track))));
    const label=button.querySelector(".subtitle-state");
    if(label)label.textContent=on?"On":"Off";
    else button.textContent=on?"On":"Off";
    button.setAttribute("aria-pressed",String(on));
    button.setAttribute("aria-label",on ? "Turn subtitles off" : "Turn subtitles on");
    button.title = on ? "Turn subtitles off" : "Turn subtitles on";
  };
  const updateSubtitleStatus = () => {
    const showing = subtitleTracks().find(track => track.mode === "showing");
    const item = current();
    const detected = item && item.embeddedSubtitles ? item.embeddedSubtitles.length : 0;
    byId("subtitleLabel").textContent = state.mkvSubtitlePending ?
      "Reading embedded MKV subtitles…" : dvdSubOn(item) ? "DVD subtitles on" : state.activePgsTrack ?
      "Subtitles: " + state.activePgsTrack.label + " · " +
        (state.activePgsTrack.codec || "PGS") : showing ?
      "Subtitles: " + (showing.label || showing.language || "On") :
      detected ? "Subtitles off · " + detected + " embedded MKV track" +
        (detected === 1 ? "" : "s") + " found" : "Subtitles off";
    updateSubtitleToggle();
    updateSubtitleDelayControls();
    refreshSubtitleTrackOptions();
    refreshTranslationControls();refreshVoiceover();
  };
  const applySubtitlePreference = () => {
    const tracks = subtitleTracks(), pref = state.subtitlePreference;
    const selection = pref.mode === "track" ?
      (tracks.find(t => pref.label && t.label === pref.label) ||
       tracks.find(t => pref.language && normalizeSubtitleLanguage(t.language) ===
         normalizeSubtitleLanguage(pref.language))) : null;
    tracks.forEach(track => {
      try { track.mode = track === selection ? "showing" : "disabled"; }
      catch (_) { /* Read-only subtitle tracks cannot be changed. */ }
    });
    applySubtitleDelayToText();
    updateSubtitleStatus();
  };
  const chooseSubtitleTrack = track => {
    resetTranslation();
    state.subtitlePreference = track ? {
      mode: "track", label: String(track.label || ""),
      language: String(track.language || "")
    } : {mode: "off"};
    write(store.subtitlePreference, state.subtitlePreference);
    applySubtitlePreference();
  };
  // PGS graphics occupy the actual picture rectangle, not the black bars.
  // Keep the image aligned on resize/fullscreen and when picture-fit changes.
  let pictureGeometry=null, setPictureFit=null, refreshPictureProfile=null, beginDefaultPicture=null, endDefaultPicture=null;
  const positionPgsOverlay = () => {
    if (!pgsCanvas || !media.videoWidth || !media.videoHeight) return;
    const box = media.getBoundingClientRect();
    const outer = screen.getBoundingClientRect();
    const ratio = media.videoWidth / media.videoHeight;
    if (!box.width || !box.height || !ratio) return;
    if(pictureGeometry){
      const {left,top,width,height,clip}=pictureGeometry;
      Object.assign(pgsCanvas.style,{left:left+"px",top:top+"px",width:width+"px",height:height+"px",clipPath:clip});
      return;
    }
    const cover = screen.classList.contains("fit-cover");
    const scale = cover ?
      Math.max(box.width / media.videoWidth,box.height / media.videoHeight) :
      Math.min(box.width / media.videoWidth,box.height / media.videoHeight);
    const width = media.videoWidth * scale, height = media.videoHeight * scale;
    const left = box.left - outer.left + (box.width - width) / 2;
    const top = box.top - outer.top + (box.height - height) / 2;
    pgsCanvas.style.left = left + "px";
    pgsCanvas.style.top = top + "px";
    pgsCanvas.style.width = width + "px";
    pgsCanvas.style.height = height + "px";
    if (cover) {
      const right = Math.max(0, left + width - outer.width);
      const bottom = Math.max(0, top + height - outer.height);
      pgsCanvas.style.clipPath = "inset(" + Math.max(0,-top) + "px " +
        right + "px " + bottom + "px " + Math.max(0,-left) + "px)";
    } else pgsCanvas.style.clipPath = "none";
  };
  const syncPgsOverlay = () => {
    const api = state.subtitleRenderer || window.DKPGS, events = state.pgsEvents;
    if (!pgsCanvas || !api || !state.activePgsTrack || !events ||
        !current() || state.stopped || screen.classList.contains("empty")) {
      if (pgsCanvas) pgsCanvas.hidden = true;
      return;
    }
    const frame = api.frameAt(events,playbackSeconds() - subtitleDelayForCurrent());
    if (!frame || (frame.regions && !frame.regions.length)) { pgsCanvas.hidden = true; return; }
    try {
      if (state.pgsLastFrame !== frame) {
        api.render(pgsCanvas,frame);
        state.pgsLastFrame = frame;
      }
      positionPgsOverlay();
      pgsCanvas.hidden = false;
    } catch (error) {
      pgsCanvas.hidden = true;
      status("Couldn't display PGS subtitles.");
    }
  };
  const clearSubtitles = (keepNative = false) => {
    resetTranslation();
    if (!keepNative)state.nativeSubtitle=null;
    // Invalidate pending reads when changing video, subtitle choice or closing.
    state.subtitleEpoch++;
    if (state.mkvSubtitleAbort) {
      state.mkvSubtitleAbort.abort();
      state.mkvSubtitleAbort = null;
    }
    state.mkvSubtitlePending = false;
    state.activeEmbeddedTrack = null;
    state.activePgsTrack = null;
    state.subtitleRenderer = null;
    state.pgsEvents = null;
    state.pgsLastFrame = null;
    if (pgsCanvas) {
      pgsCanvas.hidden = true;
      pgsCanvas.getContext("2d").clearRect(0,0,pgsCanvas.width,pgsCanvas.height);
    }
    if (state.subtitleNode) { state.subtitleNode.remove(); state.subtitleNode = null; }
    if (state.subtitleObject) { URL.revokeObjectURL(state.subtitleObject); state.subtitleObject = null; }
    updateSubtitleStatus();
  };
  const shiftedWebVtt = (raw,position) => {
    // FFmpeg returns captions timed to the original source. A restarted
    // native stream begins at zero, so subtract its source start offset.
    const seconds=Math.max(0,Number(position)||0);
    if(!seconds)return raw;
    const parse=stamp=>{
      const fields=stamp.trim().split(":");
      if(fields.length<2||fields.length>3)return NaN;
      const last=Number(fields.pop()),middle=Number(fields.pop());
      const hours=fields.length?Number(fields.pop()):0;
      return hours*3600+middle*60+last;
    };
    const format=value=>{
      const total=Math.max(0,Math.round(value*1000));
      const h=Math.floor(total/3600000);
      const m=Math.floor(total/60000)%60;
      const sec=Math.floor(total/1000)%60;
      const ms=total%1000;
      return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+
        ":"+String(sec).padStart(2,"0")+"."+String(ms).padStart(3,"0");
    };
    const sections=String(raw).replace(/\r\n/g,"\n").split(/\n{2,}/);
    const output=["WEBVTT",""];
    for(const part of sections.slice(1)){
      const lines=part.split("\n");
      const index=lines.findIndex(line=>line.includes("-->"));
      if(index<0)continue;
      const [startRaw,endAndSettings]=lines[index].split("-->");
      const endMatch=endAndSettings?.trim().match(/^(\S+)(.*)$/);
      if(!endMatch)continue;
      const start=parse(startRaw),end=parse(endMatch[1]);
      if(!Number.isFinite(start)||!Number.isFinite(end)||end<=seconds)continue;
      lines[index]=format(Math.max(0,start-seconds))+" --> "+
        format(Math.max(0.01,end-seconds))+endMatch[2];
      output.push(lines.join("\n"),"");
    }
    return output.join("\n");
  };
  const installSubtitleVTT = (vtt, label, language,
                              embeddedNumber = null, keepNative = false) => {
    clearSubtitles(keepNative);
    state.subtitleObject = URL.createObjectURL(new Blob([vtt], {type: "text/vtt"}));
    const node = document.createElement("track");
    node.kind = "subtitles";
    node.label = label;
    node.srclang = normalizeSubtitleLanguage(language) || "und";
    node.src = state.subtitleObject;
    node.default = false;
    // Install before applying preference so the browser has a TextTrack.
    media.append(node);
    state.subtitleNode = node;
    state.activeEmbeddedTrack = embeddedNumber;
    chooseSubtitleTrack({label, language: node.srclang});
    node.addEventListener("load", applySubtitlePreference, {once: true});
    node.addEventListener("error", () => status("This subtitle track could not be displayed."), {once: true});
    applySubtitlePreference();
  };
  const rememberEmbeddedSubtitle = track => {
    const item = current();
    if (!item || !track) return;
    state.embeddedSubtitlePreferences[item.key] = {number:track.number};
    const keys = Object.keys(state.embeddedSubtitlePreferences);
    if (keys.length > 120)
      keys.slice(0,keys.length-120).forEach(key =>
        delete state.embeddedSubtitlePreferences[key]);
    write(store.embeddedSubtitlePreferences,state.embeddedSubtitlePreferences);
  };
  const loadNativeSubtitle = async(item,track,index) => {
    if(!codecPlayback?.isActive(item) || !isTextNativeSubtitle(track) ||
       typeof window.DKCodecBridge?.subtitleVtt!=="function")return;
    const ticket=++state.subtitleEpoch;
    const label=track.title||track.language||"Subtitle "+(index+1);
    status("Reading embedded subtitles…");
    try{
      const vtt=await localCodecBridge.subtitleVtt(item.file,index);
      if(current()!==item||ticket!==state.subtitleEpoch||state.stopped)return;
      const saved={item,vtt,label,language:track.language||"und",index};
      state.nativeSubtitle=saved;
      installSubtitleVTT(shiftedWebVtt(vtt,codecPlayback.offset(item)),
        label,saved.language,null,true);
      status("Embedded subtitles loaded.",true);
    }catch(error){
      if(current()===item&&ticket===state.subtitleEpoch)
        status("Cannot read this subtitle track: "+String(error?.message||error));
    }
  };
  const loadEmbeddedTrack = async track => {
    const item = current();
    if (!item || !item.file || !window.DKMkvSubtitles ||
        !window.DKMkvSubtitles.canExtract(track.codec)) return;
    clearSubtitles();
    const epoch = state.subtitleEpoch;
    const controller = new AbortController();
    state.mkvSubtitleAbort = controller;
    state.mkvSubtitlePending = true;
    updateSubtitleStatus();
    status("Reading embedded MKV subtitles…");
    try {
      const result = await window.DKMkvSubtitles.extractTextTrack(item.file, track,
        {signal: controller.signal});
      if (controller.signal.aborted || epoch !== state.subtitleEpoch ||
          current() !== item) return;
      const label = (track.name || track.language || "Subtitle " + track.number) + " · MKV";
      installSubtitleVTT(result.vtt, label, track.language, track.number);
      rememberEmbeddedSubtitle(track);
      status("Embedded MKV text subtitles loaded.", true);
    } catch (error) {
      if (controller.signal.aborted || epoch !== state.subtitleEpoch ||
          current() !== item) return;
      state.mkvSubtitleAbort = null;
      state.mkvSubtitlePending = false;
      updateSubtitleStatus();
      status("Couldn't read embedded MKV subtitles: " +
        (error && error.message ? error.message : "Unknown format"));
    }
  };
  const loadPgsTrack = async track => {
    const item = current();
    if (!item || !item.file || !window.DKPGS ||
        !window.DKPGS.canRender(track.codec)) return;
    clearSubtitles();
    chooseSubtitleTrack(null);
    const epoch = state.subtitleEpoch;
    const controller = new AbortController();
    state.mkvSubtitleAbort = controller;
    state.mkvSubtitlePending = true;
    updateSubtitleStatus();
    status("Reading embedded PGS graphics…");
    try {
      const result = await window.DKPGS.extract(item.file,track,
        {signal:controller.signal});
      if (controller.signal.aborted || epoch !== state.subtitleEpoch ||
          current() !== item) return;
      state.mkvSubtitleAbort = null;
      state.mkvSubtitlePending = false;
      state.pgsEvents = result.events;
      state.subtitleRenderer = window.DKPGS;
      state.activePgsTrack = {
        number:track.number,label:track.name || track.language || "PGS",codec:"PGS"
      };
      state.pgsLastFrame = null;
      rememberEmbeddedSubtitle(track);
      updateSubtitleStatus();
      syncPgsOverlay();
      status("PGS subtitles loaded.",true);
    } catch (error) {
      if (controller.signal.aborted || epoch !== state.subtitleEpoch ||
          current() !== item) return;
      state.mkvSubtitleAbort = null;
      state.mkvSubtitlePending = false;
      updateSubtitleStatus();
      status("Couldn't read PGS subtitles: " +
        (error && error.message ? error.message : "Unknown format"));
    }
  };
  const loadVobSubTrack = async track => {
    const item = current();
    if (!item?.file || !window.DKVobSub?.canRender(track.codec)) return;
    clearSubtitles();
    chooseSubtitleTrack(null);
    const epoch = state.subtitleEpoch;
    const controller = new AbortController();
    state.mkvSubtitleAbort = controller;
    state.mkvSubtitlePending = true;
    updateSubtitleStatus();
    status("Reading embedded VobSub graphics…");
    try {
      const result = await window.DKVobSub.extract(item.file,track,
        {signal:controller.signal});
      if (controller.signal.aborted || epoch !== state.subtitleEpoch ||
          current() !== item) return;
      state.mkvSubtitleAbort = null;
      state.mkvSubtitlePending = false;
      state.pgsEvents = result.events;
      state.subtitleRenderer = window.DKVobSub;
      state.activePgsTrack = {
        number:track.number,label:track.name || track.language || "VobSub",
        codec:"VobSub"
      };
      state.pgsLastFrame = null;
      rememberEmbeddedSubtitle(track);
      updateSubtitleStatus();
      syncPgsOverlay();
      status("Embedded VobSub subtitles loaded locally.",true);
    } catch (error) {
      if (controller.signal.aborted || epoch !== state.subtitleEpoch ||
          current() !== item) return;
      state.mkvSubtitleAbort = null;
      state.mkvSubtitlePending = false;
      updateSubtitleStatus();
      status("Couldn't decode VobSub subtitles: " +
        (error?.message || "Unsupported packet"));
    }
  };
  const restoreEmbeddedSubtitlePreference = item => {
    if (!item || item !== current() || state.mkvSubtitlePending ||
        state.activePgsTrack || state.activeEmbeddedTrack !== null) return;
    const saved = state.embeddedSubtitlePreferences[item.key];
    if (!saved || !Number.isInteger(saved.number)) return;
    const track = (item.embeddedSubtitles || []).find(t => t.number === saved.number);
    if (!track) return;
    if (window.DKPGS?.canRender(track.codec)) void loadPgsTrack(track);
    else if (window.DKVobSub?.canRender(track.codec)) void loadVobSubTrack(track);
    else if (window.DKMkvSubtitles?.canExtract(track.codec))
      void loadEmbeddedTrack(track);
  };
  // Standalone transport artwork follows the approved six-button reference.
  // Keep the existing buttons, keyboard bindings and ten-second actions.
  const modernTransport=Boolean(window.DKLibraryBridge?.internalPages);
  const transportGlyphs={
    previous:'<path d="M5 5v14M19 5l-10 7 10 7z"/>',
    rewind10:'<path d="M11 7.5 4 12l7 4.5zM20 7.5 13 12l7 4.5z" fill="currentColor" stroke-linejoin="round"/>',
    play:'<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z" fill="currentColor" stroke="none"/>',
    pause:'<circle cx="12" cy="12" r="9"/><path d="M9 8v8m6-8v8" stroke-width="2.5"/>',
    forward10:'<path d="m4 7.5 7 4.5-7 4.5zM13 7.5 20 12l-7 4.5z" fill="currentColor" stroke-linejoin="round"/>',
    stop:'<rect x="4.5" y="4.5" width="15" height="15" rx="2"/>',
    next:'<path d="M19 5v14M5 5l10 7-10 7z"/>'
  };
  const setTransportGlyph=(id,name)=>{
    const button=byId(id);
    if(button.dataset.transportGlyph===name)return;
    button.innerHTML='<svg class="dk-transport-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+transportGlyphs[name]+'</svg>';
    button.dataset.transportGlyph=name;
  };
  if(modernTransport){
    for(const id of ["previous","rewind10","forward10","stop","next"])setTransportGlyph(id,id);
    setTransportGlyph("playPause","play");
  }
  const updateButtons = () => {
    const item = current();
    const isPlaying = !!item && (!media.paused&&!media.ended||item.kind==="network"&&item.autoplayRequested&&item.streamBuffering&&!state.stopped);
    if(modernTransport)setTransportGlyph("playPause",isPlaying?"pause":"play");
    else byId("playPause").textContent = isPlaying ? "⏸" : "▶";
    byId("playPause").setAttribute("aria-label", isPlaying ? "Pause" : "Play");
    byId("playPause").title = isPlaying ? "Pause" : "Play";
    ["playPause", "stop"].forEach(id => { byId(id).disabled = !item; });
    byId("previous").disabled = state.current < 0 ||
      (state.current === 0 && !(playbackOrder.loop === "all" && state.queue.length > 1));
    byId("next").disabled = state.current < 0 ||
      (state.current >= state.queue.length - 1 &&
       !(playbackOrder.loop === "all" && state.queue.length > 1));
    byId("clearQueue").disabled = state.current >= 0 ? state.current >= state.queue.length - 1 : state.queue.length === 0;
    byId("addSubtitles").disabled = !item;
    const muted = userMuted || volumePercent === 0;
    byId("mute").classList.toggle("is-muted", muted);
    byId("mute").setAttribute("aria-label", muted ? "Unmute" : "Mute");
    byId("mute").title = muted ? "Unmute" : "Mute";
    updateOrderButtons();
  };
  const updateTime = () => {
    const length = playbackDuration();
    const position = playbackSeconds();
    const seekable = Number.isFinite(length) && length > 0;
    byId("currentTime").textContent = time(position);
    byId("duration").textContent = seekable ? time(length) : "0:00";
    byId("seek").disabled = !current() || !seekable;
    byId("rewind10").disabled = !current() || !seekable || state.stopped;
    byId("forward10").disabled = !current() || !seekable || state.stopped;
    byId("seek").value = seekable ? String(Math.max(0, Math.min(1000, Math.round(1000 * position / length)))) : "0";
    refreshSegmentSkip();
  };
  const queueHover = window.DKQueueHover && window.DKQueueHover.create({
    makeVideo: () => document.createElement("video")
  });
  // Native chapter cues and embedded metadata take priority. The standalone
  // timeline divides videos without usable chapter boundaries into ten sections.
  const chapterPicker = byId("chapterPicker");
  // Fullscreen and float mode move only #screen; keep the visible chapter
  // selector inside that surface so it remains accessible in both modes.
  if (chapterPicker.parentElement !== screen) screen.append(chapterPicker);
  const chapterEntries = byId("chapterEntries");
  const standaloneChapters=Boolean(window.DKLibraryBridge?.internalPages);
  const chapterMarkers=document.createElement("div");
  chapterMarkers.className="dk-chapter-markers";
  chapterMarkers.setAttribute("role","group");
  chapterMarkers.setAttribute("aria-label",window.DKLocale?.t("Chapters")||"Chapters");
  let chapterMarkerSignature="",chapterMarkerItem=null;
  if(standaloneChapters){
    byId("chapters").remove();
    chapterPicker.remove();
    byId("seek").after(chapterMarkers);
    byId("languageSelect").addEventListener("change",()=>queueMicrotask(updateChapterMarkers));
  }
  const getChapterEntries = () => {
    const item = current();
    if (!item) return [];
    const entries = [...(Array.isArray(item.chapters) ? item.chapters : [])];
    try {
      for (const track of Array.from(media.textTracks || [])) {
        if (track.kind !== "chapters") continue;
        if (track.mode === "disabled") {
          try { track.mode = "hidden"; } catch (_) {}
        }
        for (const cue of Array.from(track.cues || []))
          entries.push({startTime:cue.startTime,text:cue.text || "Chapter"});
      }
    } catch (_) {}
    return entries.filter(ch=>Number.isFinite(ch.startTime) && ch.startTime >= 0)
      .sort((a,b)=>a.startTime-b.startTime)
      .filter((ch,i,list)=>i===0 || Math.abs(ch.startTime-list[i-1].startTime)>.01)
      .slice(0,500);
  };
  const updateChapterMarkers = () => {
    if(standaloneChapters){
      const item=current(),length=playbackDuration();
      const usable=Boolean(item&&!state.stopped&&Number.isFinite(length)&&length>0);
      let entries=usable?getChapterEntries().filter(ch=>ch.startTime>0&&ch.startTime<length):[];
      // Zero and the end of the video are implicit boundaries, not ticks.
      // Never persist synthetic chapters or mix them with embedded ones.
      if(usable&&!item.audio&&!item.file?.dvdToken&&!entries.length){
        entries=Array.from({length:9},(_,i)=>({
          startTime:length*(i+1)/10,text:"Virtual chapter",virtual:true,number:i+2
        }));
      }
      const signature=JSON.stringify([length,entries,window.DKLocale?.get()]);
      if(item===chapterMarkerItem&&signature===chapterMarkerSignature)return;
      chapterMarkerItem=item;chapterMarkerSignature=signature;
      chapterMarkers.replaceChildren();
      for(const chapter of entries){
        const marker=document.createElement("button");
        marker.type="button";marker.className="dk-chapter-marker";
        marker.style.left=(100*chapter.startTime/length)+"%";
        const raw=String(chapter.text||"Chapter");
        const label=chapter.virtual?
          (window.DKLocale?.t("Virtual chapter")||"Virtual chapter")+" "+chapter.number:
          raw.replace(/^Chapter(?=\s|$)/,window.DKLocale?.t("Chapter")||"Chapter");
        marker.title=label+" · "+time(chapter.startTime);
        marker.setAttribute("aria-label",marker.title);
        marker.addEventListener("pointerdown",event=>event.stopPropagation());
        marker.addEventListener("click",event=>{
          event.stopPropagation();
          if(current()===item&&!state.stopped){
            setPlaybackPosition(chapter.startTime);
            updateTime();
          }
        });
        chapterMarkers.append(marker);
      }
      return;
    }
    const available = getChapterEntries().length > 0 && !state.stopped;
    const button = byId("chapters");
    button.disabled = !available;
    button.title = available ? "Select chapters" : "No chapters available";
    if (!available) chapterPicker.hidden = true;
  };
  const showChapterPicker = () => {
    const chapters = getChapterEntries();
    if (!chapters.length) return;
    chapterEntries.replaceChildren();
    for (const chapter of chapters) {
      const button = document.createElement("button");
      button.type = "button";
      const timestamp = document.createElement("time");
      timestamp.textContent = time(chapter.startTime);
      const title = document.createElement("span");
      title.textContent = String(chapter.text || "Chapter").slice(0,200);
      button.append(timestamp,title);
      button.addEventListener("click",()=>{
        setPlaybackPosition(chapter.startTime);
        chapterPicker.hidden = true;
        updateTime();
      });
      chapterEntries.append(button);
    }
    chapterPicker.hidden = !chapterPicker.hidden;
    if (!chapterPicker.hidden) chapterEntries.querySelector("button")?.focus();
  };
  if(!standaloneChapters){
    byId("chapters").addEventListener("click",showChapterPicker);
    byId("closeChapters").addEventListener("click",()=>{chapterPicker.hidden=true;});
  }
  const mergeChapters=(item,entries)=>{
    if(!Array.isArray(entries)||!entries.length)return;
    item.chapters=[...entries,...(item.chapters||[])].filter(ch=>Number.isFinite(ch.startTime)&&ch.startTime>=0)
      .sort((a,b)=>a.startTime-b.startTime)
      .filter((ch,i,list)=>i===0||Math.abs(ch.startTime-list[i-1].startTime)>.01).slice(0,500);
    if(current()===item){updateChapterMarkers();refreshSegmentSkip();}
  };
  if(standaloneChapters&&window.DKSegmentSkip){
    const key="dk-kinehall.segment-skip.v1",stored=read(key,{});
    const options={enabled:stored?.enabled!==false,autoIntro:stored?.autoIntro===true,autoCredits:stored?.autoCredits===true,autoCommercial:stored?.autoCommercial===true};
    const commercialKey="dk-kinehall.commercial-markers.v1";let commercial=read(commercialKey,{});if(!commercial||Array.isArray(commercial)||typeof commercial!=="object")commercial={};
    const local=(en,ru)=>window.DKLocale?.pair(en,ru)??(document.documentElement.lang==="ru"?ru:en);
    const overlay=document.createElement("button");overlay.type="button";overlay.id="dkSegmentSkip";overlay.className="dk-segment-skip";overlay.hidden=true;screen.append(overlay);
    const section=document.createElement("section");section.className="player-settings-section";section.id="segmentSkipSettings";
    const heading=document.createElement("strong");heading.textContent=local("Intro and credits","Заставки и титры");section.append(heading);
    function setting(id,prop,en,ru){
      const label=document.createElement("label"),input=document.createElement("input"),text=document.createElement("span");
      input.type="checkbox";input.id=id;input.checked=options[prop];text.textContent=local(en,ru);label.append(input,text);section.append(label);
      input.addEventListener("change",()=>{options[prop]=input.checked;write(key,options);refreshSegmentSkip();});
      return input;
    }
    setting("showSegmentSkip","enabled","Show Skip Intro and Skip Credits buttons","Показывать кнопки пропуска заставки и титров");
    setting("autoSkipIntro","autoIntro","Automatically skip marked intros","Автоматически пропускать отмеченные заставки");
    setting("autoSkipCredits","autoCredits","Automatically skip bounded credits","Автоматически пропускать титры с известной границей");
    setting("autoSkipCommercial","autoCommercial","Automatically skip approved commercial breaks","Автоматически пропускать подтверждённую рекламу");
    const note=document.createElement("p");note.className="helper";note.textContent=local("Skipping is manual by default. Only named chapter boundaries are supported. Final credits are never skipped automatically.","По умолчанию пропуск выполняется вручную. Поддерживаются только именованные главы. Финальные титры не пропускаются автоматически.");
    section.append(note);byId("playerSettingsPanel").append(section);
    const scanAds=document.createElement("button"),adResults=document.createElement("div");scanAds.type="button";scanAds.className="btn small";scanAds.dataset.mediaOnly="true";adResults.dataset.mediaOnly="true";
    scanAds.textContent=local("Find possible commercial breaks","Найти возможные рекламные паузы");section.append(scanAds,adResults);
    let adBusy=false;
    scanAds.addEventListener("click",async()=>{
      const item=current();if(adBusy||!item?.file||item.file.dvdToken||item.audio||!window.DKCodecBridge?.commercialCandidates)return;
      adBusy=true;scanAds.disabled=true;adResults.textContent=local("Analyzing local video…","Анализ местного видео…");
      try{
        const rows=await window.DKCodecBridge.commercialCandidates(item.file);if(current()!==item)return;
        adResults.replaceChildren();const warning=document.createElement("p");warning.textContent=local("Possible breaks only. Preview and approve individually; false matches are possible.","Только возможные паузы. Просмотрите и подтвердите каждую; возможны ошибки.");adResults.append(warning);
        const clear=document.createElement("button");clear.type="button";clear.className="btn small";clear.textContent=local("Clear approved breaks","Удалить подтверждённые паузы");clear.addEventListener("click",()=>{delete commercial[item.key];write(commercialKey,commercial);refreshSegmentSkip();adResults.replaceChildren();});adResults.append(clear);
        for(const r of rows.slice(0,60)){
          const line=document.createElement("div"),label=document.createElement("span"),preview=document.createElement("button"),approve=document.createElement("button");
          label.textContent=time(r.start)+" – "+time(r.end);preview.type=approve.type="button";preview.className=approve.className="btn small";preview.textContent=local("Preview","Просмотр");approve.textContent=local("Approve","Подтвердить");
          preview.addEventListener("click",()=>{if(current()===item)setPlaybackPosition(r.start);});
          approve.addEventListener("click",()=>{if(current()!==item)return;const list=Array.isArray(commercial[item.key])?commercial[item.key]:[];if(!list.some(x=>x.start===r.start&&x.end===r.end))commercial[item.key]=[...list,r].slice(0,60);const keys=Object.keys(commercial);for(const k of keys.slice(0,Math.max(0,keys.length-200)))delete commercial[k];write(commercialKey,commercial);approve.disabled=true;refreshSegmentSkip();});
          line.append(label,preview,approve);adResults.append(line);
        }
      }catch(_){adResults.textContent=local("Commercial analysis unavailable.","Анализ рекламы недоступен.");}finally{adBusy=false;scanAds.disabled=false;}
    });
    let lastItem=null,lastEpoch=null,lastAt=NaN,shown=null,cachedRows=null,cachedLength=null,cachedSegments=[],cachedLanguage="",lastLabel="";
    const used=new Set();
    const hide=()=>{shown=null;overlay.hidden=true;};
    function refresh(){
      const item=current(),at=playbackSeconds(),length=playbackDuration();
      if(item!==lastItem||item?.playbackEpoch!==lastEpoch){
        lastItem=item;lastEpoch=item?.playbackEpoch;lastAt=NaN;used.clear();cachedRows=null;cachedLength=null;hide();
      }
      if(!item||item.audio||!item.file||item.file.dvdToken||state.stopped||!options.enabled||!Number.isFinite(at)||!Number.isFinite(length)||length<=0){lastAt=NaN;hide();return;}
      const rows=getChapterEntries();
      const signature=rows.map(c=>[c.startTime,c.endTime,c.text,c.virtual].join("\u0001")).join("\u0002");
      if(signature!==cachedRows||length!==cachedLength){cachedRows=signature;cachedLength=length;cachedSegments=window.DKSegmentSkip.identify(rows,length);}
      const approved=(Array.isArray(commercial[item.key])?commercial[item.key]:[]).filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start>=0&&s.end>s.start&&s.end<length-.5).map(s=>({...s,kind:"commercial",autoSafe:true}));
      const segment=[...cachedSegments,...approved].find(s=>at>=s.start&&at<s.end-.1);
      const prior=lastAt;lastAt=at;
      if(!segment){hide();return;}
      const tag=segment.kind+":"+segment.start+":"+segment.end;
      shown={item,epoch:item.playbackEpoch,tag,segment};
      const language=window.DKLocale?.get()||document.documentElement.lang;
      if(lastLabel!==segment.kind||cachedLanguage!==language){
        lastLabel=segment.kind;cachedLanguage=language;
        overlay.textContent=segment.kind==="intro"?local("Skip Intro","Пропустить заставку"):segment.kind==="commercial"?local("Skip Commercials","Пропустить рекламу"):local("Skip Credits","Пропустить титры");
      }
      overlay.hidden=false;
      const natural=Number.isFinite(prior)&&at>=prior&&at-prior<=2.5&&(prior<segment.start||segment.start===0&&prior===0&&at<=2.5);
      const automatic=segment.kind==="intro"?options.autoIntro:segment.kind==="commercial"?options.autoCommercial:options.autoCredits;
      if(automatic&&segment.autoSafe&&natural&&!media.paused&&!media.seeking&&!used.has(tag)){
        used.add(tag);hide();try{setPlaybackPosition(segment.end);}catch(_){}
      }
    }
    refreshSegmentSkip=refresh;
    overlay.addEventListener("pointerdown",e=>e.stopPropagation());
    overlay.addEventListener("dblclick",e=>e.stopPropagation());
    overlay.addEventListener("click",e=>{
      e.stopPropagation();const choice=shown;
      if(!choice||choice.item!==current()||choice.epoch!==current()?.playbackEpoch||state.stopped)return;
      const at=playbackSeconds();
      if(at<choice.segment.start||at>=choice.segment.end)return;
      used.add(choice.tag);hide();
      try{setPlaybackPosition(choice.segment.end);}catch(_){}
    });
    for(const event of ["loadedmetadata","loadeddata","seeked","seeking","emptied","ended","pause","play"])media.addEventListener(event,refresh);
    new MutationObserver(refresh).observe(document.documentElement,{attributes:true,attributeFilter:["lang"]});
  }
  let dragItem = null;
  const clearDropMarkers = () => {
    for (const li of queueView.children)
      li.classList.remove("queue-dragging","queue-drop-before","queue-drop-after");
  };
  const moveQueueItem = (source,target,after=false) => {
    const from=state.queue.indexOf(source);
    if (from<0 || !target || source===target) return false;
    const nowPlaying=current();
    state.queue.splice(from,1);
    const targetIndex=state.queue.indexOf(target);
    if (targetIndex<0) {state.queue.splice(from,0,source); return false;}
    state.queue.splice(targetIndex+(after?1:0),0,source);
    state.current=state.queue.indexOf(nowPlaying);
    rememberQueueSequence();
    renderQueue(); // Only queue DOM changes; media.src and playback remain intact.
    return true;
  };
  const renderQueue = () => {
    if (queueHover) queueHover.stop();
    const scrollPosition=queueView.scrollTop;
    queueView.replaceChildren();
    // Keep queued items in their selected order. Finished entries can be
    // automatically removed by the queue lifecycle preference.
    const pending = state.queue;
    byId("queueCount").textContent = pending.length ? pending.length + (pending.length === 1 ? " item" : " items") : "";
    pending.forEach((item, index) => {
      const li = document.createElement("li");
      // The artwork controller needs this precise local item to read optional
      // embedded covers or preview frames, never a file path or remote upload.
      li.dkQueueItem = item;
      li.dataset.queueKind = item.kind;
      li.dataset.queueAudio = item.audio ? "1" : "0";
      // The original filename remains attached for artwork and playback.
      const parsed = window.DKMediaMetadata?.parseFilename(item.metadataFilename||item.name);
      const isEpisode = parsed?.type === "episode";
      if (isEpisode) li.dataset.queueEpisode = "1";
      const episodeCode = isEpisode ? "S" + String(parsed.season).padStart(2,"0") +
        "E" + String(parsed.episode).padStart(2,"0") : "";
      const displayName = isEpisode ? parsed.series :
        parsed?.type === "movie" ? parsed.title +
          (parsed.year ? " (" + parsed.year + ")" : "") :
        item.name.replace(/\.[a-z0-9]{2,5}$/i,"").replace(/[._]+/g," ").trim();
      if (index === state.current) {
        li.classList.add("current");
        li.setAttribute("aria-current", "true");
      }
      const play = document.createElement("button");
      play.type = "button";
      play.className = "item-play";
      play.title = "Play " + displayName + (isEpisode ? " " + episodeCode : "");
      const artworkBox = document.createElement("span");
      artworkBox.className = "queue-artwork";
      artworkBox.setAttribute("aria-hidden", "true");
      const fallback = document.createElement("span");
      fallback.className = "queue-artwork-fallback";
      fallback.textContent = item.audio ? "♫" : "▶";
      artworkBox.append(fallback);
      if(item.kind==="network"&&item.channelArtwork){const image=document.createElement("img");image.alt="";image.loading="lazy";image.src=item.channelArtwork;image.className="dk-channel-queue-logo";fallback.hidden=true;image.addEventListener("error",()=>{image.remove();fallback.hidden=false;},{once:true});artworkBox.append(image);}
      if (queueHover&&!item.file?.dvdToken&&item.kind!=="network") queueHover.bind(play, item, artworkBox);
      const labels = document.createElement("span");
      labels.className = "queue-item-labels";
      const title = document.createElement("span");
      title.className = "item-title";
      title.textContent = displayName;
      labels.append(title);
      if (isEpisode) {
        const source = document.createElement("span");
        source.className = "item-meta";
        source.textContent = episodeCode;
        const episodeName = document.createElement("span");
        episodeName.className = "item-episode-name";
        const knownTitle = item.episodeTitle || parsed.episodeTitle || "";
        if (knownTitle) episodeName.textContent = " · " + knownTitle;
        source.append(episodeName);
        labels.append(source);
      }
      play.append(artworkBox, labels);
      play.addEventListener("click", () => load(index));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-btn remove";
      remove.textContent = "×";
      remove.title = "Remove from queue";
      remove.setAttribute("aria-label", "Remove " + item.name);
      remove.addEventListener("click", () => removeItem(index));
      const grip = document.createElement("button");
      grip.type = "button";
      grip.className = "queue-grip";
      grip.textContent = "⋮⋮";
      grip.title = "Drag to reorder";
      grip.setAttribute("aria-label","Move queued video");
      grip.draggable = true;
      grip.addEventListener("keydown",event=>{
        if (!["ArrowUp","ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const direction=event.key==="ArrowUp"?-1:1;
        const neighbour=state.queue[index+direction];
        if (!neighbour) return;
        if (moveQueueItem(item,neighbour,direction>0))
          queueView.children[index+direction]?.querySelector(".queue-grip")?.focus();
      });
      grip.addEventListener("dragstart",event=>{
        dragItem=item;
        event.dataTransfer.effectAllowed="move";
        event.dataTransfer.setData("text/plain","dk-kinehall-queue");
        li.classList.add("queue-dragging");
      });
      grip.addEventListener("dragend",()=>{
        dragItem=null;
        clearDropMarkers();
      });
      li.addEventListener("dragover",event=>{
        if (!dragItem || dragItem===item) return;
        event.preventDefault();
        event.dataTransfer.dropEffect="move";
        clearDropMarkers();
        const after=event.clientY>li.getBoundingClientRect().top+li.offsetHeight/2;
        li.classList.add(after?"queue-drop-after":"queue-drop-before");
      });
      li.addEventListener("drop",event=>{
        if (!dragItem) return;
        event.preventDefault();
        const source=dragItem;
        const after=event.clientY>li.getBoundingClientRect().top+li.offsetHeight/2;
        dragItem=null;
        clearDropMarkers();
        moveQueueItem(source,item,after);
      });
      // Touchscreen reordering uses pointer capture; native HTML5 dragging
      // is reserved for mouse users, keeping click-to-play independent.
      grip.addEventListener("pointerdown",event=>{
        if (event.pointerType==="mouse" || event.button!==0) return;
        event.preventDefault();
        const id=event.pointerId,fromY=event.clientY;
        let target=null,after=false,moved=false;
        grip.setPointerCapture(id);
        const move=e=>{
          if(e.pointerId!==id)return;
          e.preventDefault();
          if(Math.abs(e.clientY-fromY)>7)moved=true;
          if(!moved)return;
          const node=document.elementFromPoint(e.clientX,e.clientY)?.closest("li");
          clearDropMarkers();
          li.classList.add("queue-dragging");
          if(node?.dkQueueItem && node.dkQueueItem!==item){
            target=node.dkQueueItem;
            after=e.clientY>node.getBoundingClientRect().top+node.offsetHeight/2;
            node.classList.add(after?"queue-drop-after":"queue-drop-before");
          }
          const area=queueView.getBoundingClientRect();
          if(e.clientY<area.top+22)queueView.scrollTop-=12;
          else if(e.clientY>area.bottom-22)queueView.scrollTop+=12;
        };
        const end=e=>{
          if(e.pointerId!==id)return;
          grip.removeEventListener("pointermove",move);
          grip.removeEventListener("pointerup",end);
          grip.removeEventListener("pointercancel",end);
          if(grip.hasPointerCapture(id))grip.releasePointerCapture(id);
          clearDropMarkers();
          if(e.type==="pointerup"&&target)moveQueueItem(item,target,after);
        };
        grip.addEventListener("pointermove",move);
        grip.addEventListener("pointerup",end);
        grip.addEventListener("pointercancel",end);
      });
      li.append(grip,play,remove);
      queueView.append(li);
    });
    queueView.scrollTop=scrollPosition;
    updateButtons();
    updateChapterMarkers();
  };
  let networkRetryTimer=null;
  const streamBridge=window.DKLibraryBridge?.internalPages?window.DKLibraryBridge:null;
  const streamPrefsKey="dk-kinehall.stream-buffer.v1",storedStream=read(streamPrefsKey,{})||{};
  const streamPrefs={buffer:["auto","1","3","5","10","20","30"].includes(storedStream.buffer)?storedStream.buffer:"auto",quality:["auto","source","360","480","720","1080"].includes(storedStream.quality)?storedStream.quality:"auto",stats:storedStream.stats===true};
  const streamSay=(en,ru)=>window.DKLocale?.pair(en,ru)??(document.documentElement.lang==="ru"?ru:en);
  let bufferGate=null,stallSince=0,lastStreamTime=0,lastProgressAt=0,stableSince=0,lastStatsAt=0,statsPending=false,streamStats=null,statsNode=null;
  const isStream=item=>Boolean(streamBridge&&item?.kind==="network"&&!item.tvReplay);
  const bufferTarget=item=>streamPrefs.buffer==="auto"?Math.min(30,5+5*(item?.streamLevel||0)):Number(streamPrefs.buffer);
  function bufferedAhead(){
    try{const at=media.currentTime,rs=media.buffered;for(let i=0;i<rs.length;i++)if(rs.start(i)<=at+.1&&rs.end(i)>=at)return Math.max(0,rs.end(i)-at);}catch(_){}
    return 0;
  }
  function cancelBufferGate(){if(bufferGate?.item)bufferGate.item.streamBuffering=false;bufferGate=null;stallSince=0;stableSince=0;}
  const cancelNetworkRetry=()=>{if(networkRetryTimer!==null){clearTimeout(networkRetryTimer);networkRetryTimer=null;}cancelBufferGate();};
  function resetStreamClock(item){
    cancelBufferGate();lastStreamTime=Number(media.currentTime)||0;lastProgressAt=Date.now();stableSince=0;streamStats=null;lastStatsAt=0;
    if(item){item.streamPrimed=false;item.streamStalls=0;item.streamLevel=0;item.streamBuffering=false;item.streamLastStall=0;}
  }
  function primeStream(item,reason="startup"){
    if(!isStream(item)||state.stopped||!item.autoplayRequested||bufferGate||media.ended)return false;
    const target=bufferTarget(item);
    if(bufferedAhead()>=target&&media.readyState>=3){item.streamPrimed=true;return false;}
    bufferGate={item,epoch:item.playbackEpoch,src:media.getAttribute("src"),at:Date.now(),target,reason,peak:bufferedAhead(),progressAt:Date.now()};
    item.streamBuffering=true;media.preload="auto";media.pause();updateButtons();
    status(streamSay("Buffering network stream…","Буферизация сетевого потока…"));
    return true;
  }
  function resumeStream(item){
    if(current()!==item||state.stopped||!item.autoplayRequested)return;
    item.streamBuffering=false;item.streamPrimed=true;lastProgressAt=Date.now();stallSince=0;updateButtons();
    const play=media.play();if(play?.catch)play.catch(error=>{if(current()===item&&error?.name!=="AbortError")status(streamSay("Could not resume stream.","Не удалось продолжить поток."));});
  }
  if(streamBridge){
    statsNode=document.createElement("div");statsNode.className="dk-stream-statistics";statsNode.hidden=true;screen.append(statsNode);
    media.addEventListener("playing",()=>{
      const item=current();if(!isStream(item)||state.stopped||!item.autoplayRequested)return;
      stallSince=0;lastProgressAt=Date.now();if(!stableSince)stableSince=Date.now();
      if(!item.streamPrimed)primeStream(item);
    });
    for(const event of ["waiting","stalled"])media.addEventListener(event,()=>{
      const item=current();if(!isStream(item)||state.stopped||media.seeking||media.paused||!item.autoplayRequested||item.networkStarting||bufferGate||media.readyState>=3)return;
      if(!stallSince){stallSince=Date.now();stableSince=0;if(stallSince-(item.streamLastStall||0)>4000){item.streamLastStall=stallSince;item.streamStalls=(item.streamStalls||0)+1;if(streamPrefs.buffer==="auto")item.streamLevel=Math.min(5,(item.streamLevel||0)+1);}}
      if(bufferTarget(item)>1)primeStream(item,"stall");
    });
    media.addEventListener("emptied",()=>{if(!bufferGate||bufferGate.src!==media.getAttribute("src"))cancelBufferGate();lastProgressAt=Date.now();lastStreamTime=0;});
    setInterval(()=>{
      const item=current(),now=Date.now();
      if(!isStream(item)||state.stopped){if(statsNode)statsNode.hidden=true;return;}
      const ahead=bufferedAhead(),at=Number(media.currentTime)||0;
      if(Math.abs(at-lastStreamTime)>.05){lastStreamTime=at;lastProgressAt=now;if(!media.paused&&media.readyState>=3){if(!stableSince)stableSince=now;if(now-stableSince>60000){item.networkRetries=0;if(streamPrefs.buffer==="auto"&&(item.streamLevel||0)>0)item.streamLevel--;stableSince=now;}}}
      const gate=bufferGate;
      if(gate){
        if(ahead>gate.peak+.2){gate.peak=ahead;gate.progressAt=now;}
        if(gate.item!==item||gate.epoch!==item.playbackEpoch||!item.autoplayRequested||gate.src!==media.getAttribute("src"))cancelBufferGate();
        else if(media.error){cancelBufferGate();}
        else if(media.readyState>=2&&(ahead>=gate.target||ahead>=.75&&now-gate.progressAt>=3000&&now-gate.at>=5000||ahead>=.5&&now-gate.at>Math.max(12000,gate.target*1000+4000))){
          bufferGate=null;resumeStream(item);
        }else if(now-gate.at>Math.max(30000,gate.target*1000+15000)){
          // A browser may decline to fill while paused. Try normal playback
          // when a decodable frame exists instead of reopening a good source.
          bufferGate=null;item.streamBuffering=false;
          if(media.readyState>=2)resumeStream(item);
          else {item.streamPrimed=false;if(!recoverNetwork(item,true))status(networkErrorText(item));}
        }
      }else if(item.autoplayRequested&&!media.paused&&!media.seeking&&!item.networkStarting&&networkRetryTimer===null&&now-lastProgressAt>25000){
        lastProgressAt=now;item.streamLevel=Math.min(4,(item.streamLevel||0)+1);
        if(!recoverNetwork(item,true))status(networkErrorText(item));
      }
      if(!statsNode)return;statsNode.hidden=!streamPrefs.stats;
      if(!streamPrefs.stats)return;
      if(!statsPending&&now-lastStatsAt>=2500&&streamBridge.networkStreamStats){lastStatsAt=now;statsPending=true;Promise.all([streamBridge.networkStreamStats(item.networkToken),rawCodecBridge?.streamStatus?.(item.networkToken).catch(()=>null)]).then(([value,decoder])=>{if(current()===item)streamStats={...value,decoder};}).catch(()=>{}).finally(()=>statsPending=false);}
      const quality=media.getVideoPlaybackQuality?.(),bps=Number(streamStats?.measuredBps)||0,selected=Number(streamStats?.selectedBitrate)||0;
      statsNode.textContent=[streamSay("Buffer","Буфер")+": "+ahead.toFixed(1)+"/"+bufferTarget(item)+" "+streamSay("s","с"),media.videoWidth?media.videoWidth+"×"+media.videoHeight:"",bps?streamSay("Download","Загрузка")+": "+(bps/1e6).toFixed(2)+" "+streamSay("Mbps","Мбит/с"):"",selected?streamSay("Stream bitrate","Битрейт потока")+": "+(selected/1e6).toFixed(2)+" "+streamSay("Mbps","Мбит/с"):"",quality?streamSay("Dropped frames","Пропущено кадров")+": "+quality.droppedVideoFrames+"/"+quality.totalVideoFrames:"",streamSay("Stalls","Остановки")+": "+(item.streamStalls||0),streamStats?.segmentRetries?streamSay("Segment retries","Повторные запросы фрагментов")+": "+streamStats.segmentRetries:"",streamStats?.adaptiveActive?streamSay("In-play quality changes","Смены качества при воспроизведении")+": "+streamStats.adaptiveSwitches:"",streamStats?.datagramDrops?streamSay("Dropped datagrams","Отброшено пакетов")+": "+streamStats.datagramDrops:"",item.nativePassthrough?.video?streamSay("Video passthrough","Видео без перекодирования"):"",item.nativePassthrough?.audio?streamSay("Audio passthrough","Звук без перекодирования"):"",streamStats?.decoder?.hardware==="vaapi"?streamSay("Hardware decoding: VA-API","Аппаратное декодирование: VA-API"):streamStats?.decoder?.hardware==="vaapi-pending"?streamSay("Hardware initialization","Инициализация аппаратного декодера"):streamStats?.decoder?.hardwareFallback?streamSay("Software decoding (fallback)","Программное декодирование (резерв)"):streamStats?.decoder?.hardware==="software"?streamSay("Software decoding","Программное декодирование"):"",Number.isFinite(streamStats?.decoder?.speed)?streamSay("Decoder speed","Скорость декодирования")+": "+streamStats.decoder.speed.toFixed(2)+"×":""].filter(Boolean).join("\n");
    },250);
  }
  const idle = () => {
    cancelNetworkRetry();
    cancelNextCountdown();resetVoiceover();
    if (seekPreview) seekPreview.reset();
    state.current = -1;
    state.stopped = false;
    clearSubtitles();
    if (mkvAudio) mkvAudio.stop();
    media.pause();
    media.removeAttribute("src");
    media.load();
    screen.classList.add("empty");
    screen.classList.remove("audio", "stopped", "cursor-hidden", "ui-hidden");
    byId("emptyTitle").textContent = "Ready when you are";
    byId("emptyDescription").textContent = "Choose a video or music file from this device.";
    byId("nowTitle").textContent = "Nothing playing";
    byId("nowSource").textContent = "Select media to get started";
    byId("nowSource").hidden = false;
    byId("kindBadge").textContent = "Ready";
    byId("kindBadge").hidden = false;
    renderQueue();
    updateTime();
  };
  const seekPreview = window.DKSeekPreview && window.DKSeekPreview.attach({
    seek: byId("seek"), bubble: byId("seekPreview"), frame: byId("previewFrame"),
    label: byId("previewTime"), current, duration: playbackDuration,
    formatTime: time
  });
  const playCurrent = () => {
    cancelNextCountdown();
    if (!current()) { status("Open a video or music file first."); return; }
    if(current().kind==="network"&&current().networkStarting){current().autoplayRequested=true;return;}
    if (state.stopped) {
      state.stopped = false;
      current().historyResumeTarget=0;
      screen.classList.remove("empty", "stopped");
      updateChapterMarkers();
      syncPgsOverlay();
      screen.classList.toggle("audio", current().audio);
      if(current().codecRestart && codecPlayback) {
        current().codecRestart=false;
        current().codecAttempted=true;
        void codecPlayback.start(current(),0,true,
          ["mp4","webm"].includes(current().requestedFormat)?
          current().requestedFormat:"auto");
        return;
      }
      try { media.currentTime = 0; } catch (_) {}
      restoreAudioPreference();
    }
    current().autoplayRequested = true;
    if(current().file?.dvdToken&&!codecPlayback?.isActive(current())){
      const item=current();if(item.deinterlacePending)return;
      item.codecAttempted=false;item.deinterlacePending=true;
      void tryNativeCodec(item).finally(()=>{item.deinterlacePending=false;});return;
    }
    if(isStream(current())&&!current().streamPrimed&&primeStream(current()))return;
    const result = media.play();
    if (result && typeof result.catch === "function") result.catch(err => {
      if (err && err.name === "NotAllowedError") status("Tap Play to start playback on this device.");
      else if (err && err.name !== "AbortError") status("Couldn't start this media. Check its format or source.");
    });
  };
  // MKV headers are read only for the selected item, not the entire folder.
  // Keep one pipeline active and at most one waiting selection. Rapid skips
  // replace the waiting selection instead of accumulating pending file reads.
  let inspectionActive=null,inspectionNext=null;
  const inspectSelectedMkv=item=>{
    if(!item?.file||item.file.dvdToken||!/\.mkv$/i.test(item.name))return;
    const needsTracks=!!window.DKMatroska&&["not-mkv","deferred","pending"].includes(item.mkvInspection);
    const needsChapters=!!window.DKMkvChapters&&!item.chaptersInspected;
    if(!needsTracks&&!needsChapters)return;
    if(inspectionActive===item){ 
      if(inspectionNext&&inspectionNext!==item&&inspectionNext.mkvInspection==="pending")
        inspectionNext.mkvInspection="deferred";
      inspectionNext=null;
      return;
    }
    if(inspectionNext&&inspectionNext!==item&&inspectionNext.mkvInspection==="pending")
      inspectionNext.mkvInspection="deferred";
    if(needsTracks)item.mkvInspection="pending";
    inspectionNext=item;
    if(inspectionActive)return;
    const pump=async()=>{
      while(inspectionNext){
        const selected=inspectionNext;
        inspectionNext=null;
        if(!state.queue.includes(selected)||current()!==selected){
          if(selected.mkvInspection==="pending")selected.mkvInspection="deferred";
          continue;
        }
        inspectionActive=selected;
        try{
          if(selected.mkvInspection==="pending"&&window.DKMatroska){
            try{
              const result=await window.DKMatroska.inspectFile(selected.file);
              if(!state.queue.includes(selected))continue;
              selected.embeddedSubtitles=result.tracks||[];
              selected.embeddedAudio=result.audioTracks||[];
              selected.embeddedVideo=result.videoTracks||[];
              selected.mkvInspection=result.truncated?"partial":"complete";
            }catch(_){selected.mkvInspection="unavailable";}
            if(current()===selected&&!state.stopped){
              updateSubtitleStatus();
              restoreAudioPreference();
              restoreEmbeddedSubtitlePreference(selected);
              refreshOpenSubtitleMenu();
              if(selected.compatPending){
                selected.compatPending=false;
                const epoch=selected.playbackEpoch;
                void tryCompatibleFallback(selected).then(ok=>{
                  if(!ok&&current()===selected&&selected.playbackEpoch===epoch&&!state.stopped)
                    void tryNativeCodec(selected);
                }).catch(()=>{});
              }
            }
          }
          if(current()===selected&&state.queue.includes(selected)&&!state.stopped&&
             !selected.chaptersInspected&&window.DKMkvChapters){
            try{
              const chapters=await window.DKMkvChapters.inspectFile(selected.file);
              if(state.queue.includes(selected)){
                selected.chaptersInspected=true;
                mergeChapters(selected,chapters);
              }
            }catch(_){/* Optional chapter metadata may be unavailable. */}
          }
        }finally{inspectionActive=null;}
      }
    };
    void pump().catch(()=>{inspectionActive=null;});
  };
  const liveControlBridge=window.DKLibraryBridge;
  let liveControlBusy=false,livePanel=null;
  function resetTVBuffer(item){
    if(!item?.liveChannel)return;
    const token=item.tvOriginal?.token||item.networkToken;
    if(item.tvOriginal){item.networkToken=token;item.networkSource=Object.freeze({networkToken:token});item.src=item.tvOriginal.src;item.tvOriginal=null;}
    item.tvReplay=false;item.tvBuffer=false;item.tvPaused=false;
    void liveControlBridge?.liveTvBuffer?.("stop",token).catch(()=>{});
  }
  function returnToLive(item){
    if(!item?.tvOriginal)return;
    item.networkToken=item.tvOriginal.token;item.networkSource=Object.freeze({networkToken:item.networkToken});item.src=item.tvOriginal.src;item.tvOriginal=null;item.tvReplay=false;item.tvPaused=false;
    load(state.queue.indexOf(item),true);
  }
  function refreshLiveControls(){if(livePanel)livePanel.hidden=!current()?.liveChannel||state.stopped||["udp","rtp"].includes(current()?.networkTransport);}
  if(liveControlBridge?.liveTvBuffer){
    livePanel=document.createElement("div");livePanel.className="dk-live-player-tools";livePanel.hidden=true;screen.append(livePanel);
    const controls=[];
    const add=(en,ru,action)=>{const b=document.createElement("button");b.type="button";b.className="btn small";controls.push({b,en,ru});b.addEventListener("click",async e=>{
      e.stopPropagation();const item=current();if(!item?.liveChannel||state.stopped||liveControlBusy)return;
      liveControlBusy=true;try{await action(item);}catch(_){status(window.DKLocale?.pair("Live buffer not ready or unavailable.","Буфер эфира не готов или недоступен.")||"Live buffer not ready or unavailable.");}finally{liveControlBusy=false;}
    });livePanel.append(b);};
    const say=(en,ru)=>window.DKLocale?.pair(en,ru)||en;
    const enable=async item=>{const token=item.tvOriginal?.token||item.networkToken;await liveControlBridge.liveTvBuffer("start",token);if(current()!==item||state.stopped){void liveControlBridge.liveTvBuffer("stop",token);return false;}item.tvBuffer=true;return true;};
    add("Enable Replay","Включить повтор",async item=>{if(await enable(item))status(say("Live buffer recording; wait for completed segments.","Буфер эфира записывается; дождитесь готовых фрагментов."));});
    add("Pause Live","Пауза эфира",async item=>{if(item.tvReplay){media.pause();return;}if(await enable(item)){media.pause();item.tvPaused=true;status(say("Live paused. Use Replay to resume from the rolling buffer.","Эфир приостановлен. Для продолжения используйте повтор."));}});
    add("Replay Buffer","Повтор из буфера",async item=>{
      if(!item.tvBuffer){await enable(item);status(say("Wait for the live buffer to fill.","Дождитесь заполнения буфера."));return;}
      const source=item.tvOriginal||{token:item.networkToken,src:item.src};const grant=await liveControlBridge.liveTvBuffer("snapshot",source.token);if(current()!==item||state.stopped)return;
      item.tvOriginal=source;item.networkToken=grant.token;item.networkSource=Object.freeze({networkToken:grant.token});item.src=grant.src;item.tvReplay=true;item.tvPaused=false;load(state.queue.indexOf(item),true);
    });
    add("Go Live","К прямому эфиру",async item=>{if(item.tvOriginal)returnToLive(item);else{item.tvPaused=false;load(state.queue.indexOf(item),true);}});
    const translate=()=>{for(const {b,en,ru} of controls)b.textContent=say(en,ru);};translate();new MutationObserver(translate).observe(document.documentElement,{attributes:true,attributeFilter:["lang"]});
    livePanel.addEventListener("pointerdown",e=>e.stopPropagation());livePanel.addEventListener("dblclick",e=>e.stopPropagation());
  }
  const load = (index, autoplay = true) => {
    if (index < 0 || index >= state.queue.length) return;
    cancelNextCountdown();resetVoiceover();cancelNetworkRetry();
    const previous=current();
    if(previous&&previous!==state.queue[index])resetTVBuffer(previous);
    if(previous?.remuxAbort){
      previous.remuxAbort.abort();
      previous.remuxAbort=null;
    }
    if (seekPreview) seekPreview.reset();
    if (!state.stopped) rememberPosition();
    if(previous)previous.historyReady=false;
    if(codecPlayback?.isActive(previous)||previous?.networkStarting)void codecPlayback?.stop();
    if(previous)previous.networkStarting=false;
    state.stopped = false;
    clearSubtitles();
    if (mkvAudio) mkvAudio.stop();
    media.pause();
    state.current = index;
    const item = current();refreshLiveControls();
    refreshPictureProfile?.();
    // Restore this file’s remembered subtitle offset immediately, including
    // for non-MKV files before any subtitle track is loaded.
    updateSubtitleDelayControls();
    rememberSelectedMedia(item);
    item.autoplayRequested = autoplay;
    item.historyReady=false;
    item.historyResumeTarget=Number(state.resume[item.key])||0;
    // Reset stale conversion attempts when revisiting a file or selecting a
    // different format. An old asynchronous remux may not replace a new load.
    item.playbackEpoch = (item.playbackEpoch || 0) + 1;
    item.compatAttempted = false;
    item.codecAttempted = false;
    item.dvdSubtitleIndex=-1;
    item.sourceVideoExpected=false;
    item.networkStarting=false;item.networkRetries=0;item.networkResume=0;item.networkLastPosition=0;item.networkKnownDuration=0;item.networkError="";resetStreamClock(item.kind==="network"?item:null);
    item.nativeAlternateAttempted = false;
    item.codecActive = false;
    item.codecRestart = false;
    item.compatPending = false;
    inspectSelectedMkv(item);
    item.requestedFormat = item.file?.dvdToken||["udp","rtp"].includes(item.networkTransport)?"auto":playbackSettings.format;
    item.deinterlaceMode=item.kind!=="network"&&standaloneDeinterlace&&item.requestedFormat!=="original"?deinterlacePreference:"off";
    item.activeDeinterlace="off";
    item.smoothingMode=item.kind!=="network"&&standaloneDeinterlace&&item.requestedFormat!=="original"?smoothingPreference:"off";
    item.activeSmoothing=0;
    item.deinterlacePending=false;
    item.playbackMethod = (item.compatSrc && item.requestedFormat === "auto")
      ? "Cached lossless remux" : "Original source";
    const forcingContainer = item.requestedFormat === "mp4" || item.requestedFormat === "webm";
    if (item.compatSrc && (forcingContainer || item.requestedFormat === "original")) {
      URL.revokeObjectURL(item.compatSrc);
      item.compatSrc = null;
    }
    const directFormat = item.name.toLowerCase().endsWith("." + item.requestedFormat);
    const needsRemux = forcingContainer && !directFormat &&
      /\.mkv$/i.test(item.name) && !!item.file && !item.file.nativeVirtual;
    const cannotConvert = forcingContainer && !directFormat && !needsRemux;
    media.removeAttribute("crossorigin");
    if(item.kind==="network")media.crossOrigin="anonymous";
    if (item.file?.dvdToken || item.kind==="network"&&(forcingContainer||item.liveChannel&&item.requestedFormat!=="original"&&codecPlayback) || needsRemux || cannotConvert) {
      // Do not play an MKV under an MP4/WebM label before remuxing finishes.
      media.removeAttribute("src");
    } else {
      media.src = item.requestedFormat === "auto" ? (item.compatSrc || item.src) : item.src;
    }
    media.load();
    // Converted video blobs belong to the current playback, not the playlist.
    if(previous&&previous!==item)releaseCompatible(previous);
    screen.classList.remove("empty", "stopped");
    screen.classList.toggle("audio", item.audio);
    applySubtitlePreference();
    screen.classList.remove("ui-hidden", "cursor-hidden");
    chapterPicker.hidden = true;
    if(standaloneChapters){chapterMarkers.replaceChildren();chapterMarkerSignature="";}
    const titleInfo = window.DKMediaMetadata?.parseFilename(item.metadataFilename||item.name);
    const episode = titleInfo?.type === "episode";
    const displayName = episode ? titleInfo.series :
      titleInfo?.type === "movie" ? titleInfo.title +
        (titleInfo.year ? " (" + titleInfo.year + ")" : "") :
      item.name.replace(/\.[a-z0-9]{2,5}$/i,"").replace(/[._]+/g," ").trim();
    const episodeCode = episode ? "S" + String(titleInfo.season).padStart(2,"0") +
      "E" + String(titleInfo.episode).padStart(2,"0") : "";
    const episodeTitle = episode ? (item.episodeTitle || titleInfo.episodeTitle || "") : "";
    byId("nowTitle").textContent = displayName;
    byId("nowSource").textContent = episodeCode +
      (episodeTitle ? " · " + episodeTitle : "");
    byId("nowSource").hidden = !episode;
    // No redundant LOCAL badge or local-device label for selected files.
    byId("kindBadge").hidden = true;
    renderQueue();
    updateTime();
    status("");
    if (item.embeddedSubtitles?.length)
      queueMicrotask(() => restoreEmbeddedSubtitlePreference(item));
    if(item.file?.dvdToken){
      const epoch=item.playbackEpoch;
      item.deinterlacePending=true;
      void tryNativeCodec(item).then(ok=>{
        if(current()!==item||item.playbackEpoch!==epoch)return;
        item.deinterlacePending=false;
        if(!ok&&!state.stopped)status("DVD title could not be played.");
      });
      return;
    }
    if(item.kind==="network"){
      if(forcingContainer||item.liveChannel&&item.requestedFormat!=="original"&&codecPlayback){const epoch=item.playbackEpoch;void startNetworkDecoder(item,0).then(ok=>{if(!ok&&current()===item&&item.playbackEpoch===epoch&&!state.stopped){if(!recoverNetwork(item,true))status(networkErrorText(item));}});}
      else if(autoplay)playCurrent();
      return;
    }
    const proceedNormal=()=>{
    // Standalone only: a playable picture does not prove audio is decodable.
    // Probe before normal playback; the web edition has no native bridge.
    if (codecPlayback && window.DKCodecBridge?.probe && item.file &&
        item.requestedFormat === "auto") {
      const epoch=item.playbackEpoch;
      const stillCurrent=()=>current()===item && item.playbackEpoch===epoch && !state.stopped;
      void localCodecBridge.probe(item.file).then(async info=>{
        if(!stillCurrent())return;
        mergeChapters(item,info.chapters);
        const preferred=state.audioPreferences[item.key];
        const ordinal=preferred?.mode==="mkv"?
          (item.embeddedAudio||[]).findIndex(t=>t.number===preferred.number):0;
        const codec=info.audioTracks?.[Math.max(0,ordinal)]?.codec||info.audioCodec||"";
        item.sourceVideoExpected=info.hasVideo===true;
        if(item.sourceVideoExpected){item.audio=false;screen.classList.remove("audio");}
        else if(info.hasVideo===false&&info.hasAudio){item.audio=true;screen.classList.add("audio");}
        // Chromium can accept an audio track while ignoring an unsupported
        // picture track. Route known non-browser video codecs to FFmpeg.
        const videoCodec=String(info.videoCodec||"").toLowerCase();
        const nativeVideo=item.sourceVideoExpected&&videoCodec&&
          (!["h264","vp8","vp9","av1","theora"].includes(videoCodec)||
           videoCodec==="h264"&&info.videoPixelFormat&&!/^(yuv420p|yuvj420p)$/.test(info.videoPixelFormat));
        if(nativeVideo){
          item.codecAudioIndex=Math.max(0,ordinal);
          if(await tryNativeCodec(item))return;
          if(!stillCurrent())return;
          status("Included video decoder unavailable.");
        }
        if(/^(ac3|eac3|dts|truehd|mlp|wma\w*|ape|alac|atrac\w*|cook|amr_\w+|speex|tta|wavpack)$/i.test(codec)){
          item.codecAudioIndex=Math.max(0,ordinal);
          if(await tryNativeCodec(item))return;
          if(!stillCurrent())return;
          status("Included audio decoder unavailable.");
        }
        if(autoplay&&stillCurrent())playCurrent();
      }).catch(()=>{if(autoplay&&stillCurrent())playCurrent();});
      return;
    }
    if(standaloneChapters&&item.file&&window.DKCodecBridge?.probe){
      // Explicit Original/MP4/WebM selections also need embedded chapters.
      void localCodecBridge.probe(item.file).then(info=>{
        if(state.queue.includes(item))mergeChapters(item,info.chapters);
      }).catch(()=>{});
    }
    if (needsRemux) {
      item.playbackMethod = "Preparing " + item.requestedFormat.toUpperCase();
      if (item.mkvInspection === "pending") {
        item.compatPending = true;
        status("Checking MKV for the requested format…");
      } else void tryCompatibleFallback(item).then(ok=>{
        if(!ok)void tryNativeCodec(item);
      });
    } else if (cannotConvert) {
      if(codecPlayback && item.file) {
        item.playbackMethod="Preparing included codecs";
        void tryNativeCodec(item);
      }else{
        item.playbackMethod="Unsupported conversion";
        status("Requested format is not available for this file. It has not been converted.");
      }
    } else if (autoplay) {
      playCurrent();
    }
    };
    // Inspect field-order metadata before electing a native filtered stream.
    // Off and Original preserve the old path; Auto never transcodes solely
    // for progressive/unknown metadata. On explicitly forces the filter.
    if((item.deinterlaceMode!=="off"||item.smoothingMode!=="off")&&item.file&&codecPlayback){
      const epoch=item.playbackEpoch;
      const valid=()=>current()===item&&item.playbackEpoch===epoch&&!state.stopped;
      item.deinterlacePending=true;
      void (async()=>{
        let filtered=false;
        try{
          const info=await localCodecBridge.probe(item.file);
          if(!valid())return;
          mergeChapters(item,info.chapters);
          const deinterlaceNeeded=info.hasVideo&&(item.deinterlaceMode==="on"||
            item.deinterlaceMode==="auto"&&["tt","bb","tb","bt"].includes(info.fieldOrder));
          const target=item.smoothingMode==="auto"?(info.autoSmoothing?60:0):Number(item.smoothingMode)||0;
          const smoothingNeeded=info.hasVideo&&target>0&&info.sourceFps>0&&info.sourceFps<target-0.5;
          if(deinterlaceNeeded||smoothingNeeded){
            status(smoothingNeeded?"Preparing motion interpolation…":"Preparing deinterlaced video…");
            filtered=await tryNativeCodec(item);
            if(!filtered&&valid()&&smoothingNeeded&&deinterlaceNeeded){
              item.smoothingMode="off";item.codecAttempted=false;
              filtered=await tryNativeCodec(item);
            }
          }
        }catch(_){}
        if(!valid())return;
        item.deinterlacePending=false;
        if(filtered)return;
        // Failed/unsupported filter must not prevent ordinary playback.
        item.deinterlaceMode="off";
        item.smoothingMode="off";
        item.codecAttempted=false;
        proceedNormal();
      })();
    }else proceedNormal();
  };
  reapplyCurrentFormat = () => {
    if (!current()) return;
    const index = state.current;
    const autoplay = !media.paused && !media.ended && !state.stopped;
    load(index, autoplay);
  };
  // When Chromium rejects an MKV container, repackage compatible EBML
  // metadata as WebM without touching its compressed frames or sound.
  // This ONLY applies to VP8/VP9/AV1 plus WebM-permitted audio codecs.
  const retryAsWebM = async item => {
    if (!item || !item.file || item.compatAttempted ||
        !window.DKMkvWebM) return false;
    const info={videoTracks:item.embeddedVideo,
      audioTracks:item.embeddedAudio,tracks:item.embeddedSubtitles};
    const compatible=window.DKMkvWebM.eligible(info,item.file);
    if(!compatible || !media.canPlayType(compatible.mime)){
      if(item.requestedFormat==="webm" && current()===item)
        status("This video format is not supported by the current playback engine.");
      return false;
    }
    const epoch=item.playbackEpoch;
    item.compatAttempted=true;
    try {
      const output=await window.DKMkvWebM.wrap(item.file,info);
      if(!state.queue.includes(item) || current()!==item ||
         item.playbackEpoch!==epoch || state.stopped)return false;
      if(item.compatSrc)URL.revokeObjectURL(item.compatSrc);
      item.compatSrc=URL.createObjectURL(output.blob);
      item.playbackMethod="WebM lossless remux";
      // Another selected item must never inherit this source.
      // Do not interrupt a successfully playing native MKV.
      if(current()===item && !state.stopped &&
         (item.requestedFormat === "webm" ||
          (media.error && (media.error.code===3||media.error.code===4)))){
        media.src=item.compatSrc;
        media.load();
        if(item.autoplayRequested)playCurrent();
        status("Playing MKV using compatible WebM container.",true);
      }
      return true;
    } catch(error){
      if(current()===item && item.playbackEpoch===epoch)
        status("MKV container fallback failed: "+(error?.message||"invalid header"));
      return false;
    }
  };
  const compatibleInfo = item => ({
    videoTracks:item.embeddedVideo,
    audioTracks:item.embeddedAudio,tracks:item.embeddedSubtitles
  });
  const retryAsMP4 = async item => {
    if(!item?.file||item.compatAttempted||!window.DKMkvMP4 ||
       !window.DKMkvMP4.eligible(compatibleInfo(item),item.file))return false;
    const epoch=item.playbackEpoch;
    item.compatAttempted=true;
    const controller=new AbortController();
    item.remuxAbort=controller;
    status("Preparing H.264 and AAC video…");
    try{
      const output=await window.DKMkvMP4.remux(item.file,compatibleInfo(item),{
        signal:controller.signal,
        onProgress:percent=>{
          if(current()===item && item.playbackEpoch===epoch && !state.stopped)
            status("Preparing MP4: "+percent+"% scanned…");
        }
      });
      if(!state.queue.includes(item) || current()!==item ||
         item.playbackEpoch!==epoch || state.stopped)return false;
      if(!media.canPlayType(output.mime))
        throw Error("This H.264/AAC video profile is not supported by the playback engine");
      if(item.compatSrc)URL.revokeObjectURL(item.compatSrc);
      item.compatSrc=URL.createObjectURL(output.blob);
      item.playbackMethod="MP4 lossless remux";
      item.remuxTrackSummary={
        copiedAudioTrack:output.copiedAudioTrack||null,
        skippedTracks:output.skippedTrackCount||0
      };
      if(current()===item&&!state.stopped&&
        (item.requestedFormat === "mp4" ||
         (media.error && (media.error.code===3||media.error.code===4)))){
        media.src=item.compatSrc;media.load();
        if(item.autoplayRequested)playCurrent();
        status("Playing H.264/AAC MKV through an MP4 container.",true);
      }
      return true;
    }catch(error){
      if(error?.name==="AbortError")return false;
      if(current()===item && item.playbackEpoch===epoch) {
        item.playbackMethod="Unsupported conversion";
        status("H.264/AAC container fallback unavailable: "+
          (error?.message||"unsupported stream"));
      }
      return false;
    }finally{
      if(item.remuxAbort===controller)item.remuxAbort=null;
    }
  };
  const tryCompatibleFallback = async item => {
    // Electron-discovered media are not whole-memory Blobs. Their MKV
    // inspection uses range reads, while format changes use native FFmpeg.
    if(!item?.file || item.file.nativeVirtual ||
       item.requestedFormat === "original") return false;
    const info=compatibleInfo(item);
    if(item.requestedFormat === "mp4") {
      if(window.DKMkvMP4?.eligible(info,item.file)) return retryAsMP4(item);
      status("MP4 requires transcoding for this source; unavailable in this build.");
      return false;
    }
    if(item.requestedFormat === "webm") {
      if(window.DKMkvWebM?.eligible(info,item.file)) return retryAsWebM(item);
      status("WebM requires transcoding for this source; unavailable in this build.");
      return false;
    }
    if(window.DKMkvWebM?.eligible(info,item.file)) return retryAsWebM(item);
    if(window.DKMkvMP4?.eligible(info,item.file)) return retryAsMP4(item);
    return false;
  };
  const tryNativeCodec = async (item,overridePosition=null) => {
    if(!codecPlayback||!(item?.file||item?.networkSource)||item.codecAttempted ||
       item.requestedFormat==="original" ||
       current()!==item||state.stopped)return false;
    item.codecAttempted=true;
    // The previous MKV WebCodecs audio path must be shut down when the
    // complete native FFmpeg stream takes over video AND sound.
    if(mkvAudio) {
      mkvAudio.stop();
      applyVolume();
    }
    const resume=Number(state.resume[item.key]||0);
    const at=overridePosition!==null&&Number.isFinite(overridePosition)?Math.max(0,overridePosition):
      Number.isFinite(resume)&&resume>0?resume:
      (Number.isFinite(media.currentTime)?Math.max(0,media.currentTime):0);
    const preferred=state.audioPreferences[item.key];
    if(preferred?.mode==="mkv") {
      const ordinal=(item.embeddedAudio||[]).findIndex(t=>t.number===preferred.number);
      if(ordinal>=0)item.codecAudioIndex=ordinal;
    }
    if(isStream(item)){try{await streamBridge.networkStreamPolicy?.(item.networkToken,{quality:streamPrefs.quality,level:item.streamLevel||0});}catch(_){}if(current()!==item||state.stopped)return false;item.streamPrimed=false;lastProgressAt=Date.now();}
    return codecPlayback.start(item,at,Boolean(item.autoplayRequested),
      ["mp4","webm"].includes(item.requestedFormat)?
          item.requestedFormat:"auto");
  };
  const startNetworkDecoder=async(item,at)=>{
    if(item.networkStarting||current()!==item||state.stopped)return false;
    const epoch=item.playbackEpoch;
    item.networkStarting=true;
    try{return await tryNativeCodec(item,at);}
    finally{if(item.playbackEpoch===epoch)item.networkStarting=false;}
  };
  const networkErrorText=item=>{const raw=String(item?.networkError||"");const pairs=[["TV stream denied by broadcaster","Телеканал отклонил запрос"],["TV stream no longer available","Телеканал больше недоступен"],["TV broadcaster returned an error","Ошибка на стороне телеканала"],["Unsupported TV stream format","Неподдерживаемый формат телеканала"],["Unsupported HLS manifest","Неподдерживаемый манифест HLS"],["TV stream destination rejected","Адрес телеканала отклонён"],["TV stream timed out","Время ожидания телеканала истекло"],["TV stream connection failed","Не удалось подключиться к телеканалу"],["Bundled decoder lacks HLS support","Встроенный декодер не поддерживает HLS"],["Bundled decoder lacks HTTP support","Встроенный декодер не поддерживает HTTP"],["Bundled FFmpeg/FFprobe are missing","Встроенные декодеры отсутствуют"],["TV stream could not be decoded","Не удалось декодировать телеканал"]];const pair=pairs.find(([en])=>raw.includes(en))||["Network stream unavailable or unsupported.","Сетевой поток недоступен или не поддерживается."];return window.DKLocale?.pair(...pair)||pair[0];};
  const recoverNetwork=(item,forceNative=false)=>{
    if(item.kind!=="network"||item.networkStarting||state.stopped||!item.autoplayRequested||networkRetryTimer!==null)return false;
    if(item.networkRetries>=5){cancelBufferGate();item.streamBuffering=false;item.autoplayRequested=false;media.pause();updateButtons();return false;}
    const epoch=item.playbackEpoch,at=item.liveChannel&&!item.tvReplay?0:Math.max(0,Number(item.networkLastPosition)||0);
    const native=forceNative||codecPlayback?.isActive(item)||["mp4","webm"].includes(item.requestedFormat);
    cancelBufferGate();item.networkRetries++;item.streamPrimed=false;item.streamBuffering=true;item.streamLevel=Math.min(5,Math.max(item.streamLevel||0,item.networkRetries-1));updateButtons();
    status(streamSay("Reconnecting to network media…","Повторное подключение к сетевому потоку…"));
    networkRetryTimer=setTimeout(async()=>{
      networkRetryTimer=null;
      if(current()!==item||item.playbackEpoch!==epoch||state.stopped||!item.autoplayRequested){item.streamBuffering=false;return;}
      if(native&&item.requestedFormat!=="original"&&codecPlayback){
        if(item.liveChannel&&!item.tvReplay&&(item.networkRetries>=3||/denied|no longer available/i.test(item.networkError||""))){
          const alternate=await window.DKLibraryBridge?.liveTvAlternate?.(item.networkToken).catch(()=>false);
          if(current()!==item||item.playbackEpoch!==epoch||state.stopped||!item.autoplayRequested){item.streamBuffering=false;return;}
          if(alternate){item.networkError="";status(window.DKLocale?.pair("Trying another channel source…","Подключение к другому источнику телеканала…")||"Trying another channel source…");}
        }
        item.codecAttempted=false;
        const ok=await startNetworkDecoder(item,at);
        if(!ok&&current()===item&&item.playbackEpoch===epoch&&!state.stopped){
          if(!recoverNetwork(item,true))status(networkErrorText(item));
        }
      }else{
        item.networkResume=at;
        media.pause();media.crossOrigin="anonymous";media.preload="auto";media.src=item.src;media.load();
        if(isStream(item)&&primeStream(item,"reconnect"))return;
        const play=media.play();
        if(play?.catch)play.catch(()=>{if(current()===item&&item.playbackEpoch===epoch&&!state.stopped&&!media.error)status(networkErrorText(item));});
      }
    },Math.min(12000,1000*2**(item.networkRetries-1)));
    return true;
  };
  const releaseCompatible = item => {
    if(item?.remuxAbort){
      item.remuxAbort.abort();
      item.remuxAbort=null;
    }
    if(item?.compatSrc){
      try{URL.revokeObjectURL(item.compatSrc);}catch(_){}
      item.compatSrc=null;
    }
  };
  const releaseNetwork=item=>{if(item?.liveChannel)resetTVBuffer(item);if(item?.networkToken)void window.DKLibraryBridge?.networkRelease(item.networkToken).catch(()=>{});};
  const releaseArtwork = item => {
    if(item?.folderArtworkSrc){
      try{URL.revokeObjectURL(item.folderArtworkSrc);}catch(_){}
      item.folderArtworkSrc=null;
    }
    if(item?.thumbnailBlob && item.thumbnail){
      try { URL.revokeObjectURL(item.thumbnail); } catch (_) {}
      item.thumbnail=null;item.thumbnailBlob=false;
    }
  };
  const removeItem = index => {
    if (index < 0 || index >= state.queue.length) return;
    if(nextCountdown?.item===state.queue[index]||state.current===index)cancelNextCountdown();
    const wasCurrent = state.current === index;
    if (wasCurrent) rememberPosition();
    const old = state.queue.splice(index, 1)[0];
    if (wasCurrent) {
      if (state.queue.length) { state.current = -1; load(Math.min(index, state.queue.length - 1), false); }
      else { idle(); if(old.kind!=="network"&&!old.file?.dvdToken)clearRememberedMedia(); }
    } else {
      if (index < state.current) state.current--;
      renderQueue();
    }
    releaseArtwork(old);
    releaseNetwork(old);
    releaseCompatible(old);
    if (old.kind === "file") URL.revokeObjectURL(old.src);
    rememberQueueSequence();
  };
  // Open files selects a movie to watch now unless another is playing.
  // The Up Next button queues without ever interrupting current playback.
  // Restore reopens the previous file paused at its remembered position.
  const addFiles = (files, handles = [], mode = "open", artData = null) => {
    const posterMap = artData && window.DKLocalArtwork
      ? window.DKLocalArtwork.match(artData.media, artData.artwork) : new Map();
    const accepted = Array.from(files || []).map((file, index) => ({
      file, handle: handles[index] || null,
      path: artData?.media?.[index]?.path || file.webkitRelativePath || file.name
    })).filter(entry => !!entry.file);
    // User-selected files are handed to the decoder regardless of suffix;
    // container recognition and successful playback are separate questions.
    if (!accepted.length) { status("No supported media file selected. Choose a video or audio file."); return; }
    const playing = Boolean(current()) && !state.stopped && !media.paused && !media.ended;
    const plan = window.DKQueueAutoplay.plan(mode, state.current, state.queue.length, playing);
    const newItems = [];
    for (const {file, handle, path} of accepted) {
      const item = {kind: "file", name: file.name, audio: fileIsAudio(file), chapters:[],
        libraryId:artData?.libraryId||(window.DKLibraryBridge?.internalPages&&
          String(file.nativeId||"").startsWith("native:")?file.nativeId:null),
        episodeTitle:artData?.episodeTitle||"",
        // Metadata-only name for Show/Season 1/01 - Title layouts.
        // The actual media file, handle, MIME and decoder path are unchanged.
        metadataFilename:artData?.metadataFilename||file.name,
        file, src:file.nativeVirtual&&artData?.nativeSrc?
          artData.nativeSrc:URL.createObjectURL(file), handle,
        path, folderArtwork: posterMap.get(path) || null,
        size: file.size, mime: file.type || "",
        key: file.dvdToken||("file:" + file.name + ":" + file.size + ":" + file.lastModified),
        embeddedSubtitles: [], embeddedAudio: [], embeddedVideo: [], mkvInspection: "not-mkv"};
      newItems.push(item);
      if(artData?.libraryHistoryReset){delete state.resume[item.key];write(store.resume,state.resume);}
      if(item.libraryId&&Number(artData?.libraryPosition)>2 &&
         !Number.isFinite(Number(state.resume[item.key])))
        state.resume[item.key]=Number(artData.libraryPosition);
      else if(item.libraryId&&Number(artData?.libraryPosition)>2 &&
              !Number(state.resume[item.key]))
        state.resume[item.key]=Number(artData.libraryPosition);

    }
    // Put an explicitly opened movie ahead of pending entries, retaining
    // existing queue order. Multi-selection starts only the first new file.
    state.queue.splice(plan.insertAt, 0, ...newItems);
    if (playbackOrder.shuffle) {
      if (plan.activate) {
        // Keep the newly opened selection first, shuffle only its successors.
        const active=state.queue[plan.insertAt];
        state.current=plan.insertAt;
        shuffleUpcoming();
        state.current=-1;
        if (state.queue[plan.insertAt]!==active)
          throw new Error("Shuffle changed the activated item");
      } else shuffleUpcoming();
    }
    if (plan.activate) load(plan.insertAt, plan.autoplay);
    else renderQueue();
    status("Added " + accepted.length + (accepted.length === 1 ? " file" : " files") + " to the queue.", true);
  };

  // Folder selection is permission-scoped. Chromium and standalone Kinehall
  // store the approved directory handle, never the media bytes themselves.
  const folderLabel = byId("folderStatus");
  const folderReconnectButton = byId("reopenFolder");
  const folderForgetButton = byId("forgetFolder");
  const folderInput = byId("folderFallback");
  const folderLimit = window.DKFolderAccess.MAX_FILES;
  const mediaKeyFor = file => "file:" + file.name + ":" + file.size + ":" + file.lastModified;
  const updateFolderUI = (message = null) => {
    const standaloneFolders=Boolean(window.DKLibraryBridge?.internalPages);
    folderReconnectButton.hidden = !standaloneFolders && !state.folderName;
    folderForgetButton.hidden = !standaloneFolders && !state.folderName;
    folderReconnectButton.disabled = standaloneFolders && !state.folderName;
    folderForgetButton.disabled = standaloneFolders && !state.folderName;
    folderLabel.textContent = message ||
      (state.folderName ? "Saved folder: " + state.folderName : "No folder selected");
  };
  updateFolderUI();
  const collectFolder = async (handle, reason) => {
    const epoch = ++state.folderScanVersion;
    folderLabel.textContent = "Scanning folder: " + handle.name;
    try {
      const result = await window.DKFolderAccess.scan(handle, {maxFiles:folderLimit});
      if (epoch !== state.folderScanVersion) return;
      const known = new Set(state.queue.map(item => item.key));
      const selections = [];
      for (const item of result.files) {
        const key = mediaKeyFor(item.file);
        if (!known.has(key)) {
          known.add(key);
          selections.push(item);
        }
      }
      if (selections.length) addFiles(selections.map(e => e.file),
        selections.map(e => e.handle), "queue",
        {media:selections,artwork:result.artwork});
      // Opening a folder can also supply artwork for a movie that was
      // already opened manually before the folder was selected.
      if (window.DKLocalArtwork && result.artwork?.length) {
        const posters=window.DKLocalArtwork.match(result.files,result.artwork);
        let updated=false;
        for(const entry of result.files){
          const existing=state.queue.find(item=>item.key===mediaKeyFor(entry.file));
          if(existing&&!existing.folderArtwork&&posters.has(entry.path)){
            existing.folderArtwork=posters.get(entry.path);
            updated=true;
          }
        }
        if(updated)renderQueue();
      }
      // A previously watched file can be recovered through a still-approved
      // directory handle even if its individual file handle expired.
      if (reason === "startup" && !current()) {
        restoreQueueSequence();
        const saved = read(store.lastMedia, null);
        const previous = saved ? state.queue.findIndex(item =>
          saved.key ? item.key === saved.key : item.name === saved.name) : -1;
        if (previous >= 0) load(previous, false);
      }
      const count = result.files.length;
      updateFolderUI("Folder: " + handle.name);
      if (!count) status("Folder contains no supported media files.");
      else if (result.truncated)
        status("Folder scan limited to " + folderLimit + " files.", true);
      else if (selections.length)
        status("Added " + selections.length + " files from folder.", true);
      else if (reason !== "startup") status("Folder is already in Up Next.", true);
    } catch (_) {
      if (epoch !== state.folderScanVersion) return;
      updateFolderUI("Saved folder: " + handle.name);
      status("Folder access failed. Choose or reconnect the folder.");
    }
  };
  const chooseFolder = async () => {
    if (typeof window.showDirectoryPicker !== "function") {
      // Chromium fallback offers a one-session folder selection.
      folderInput.click();
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({
        id: "dk-kinehall-media-folder", mode: "read"
      });
      if (!handle || handle.kind !== "directory") return;
      ++state.folderScanVersion;
      state.folderHandle = handle;
      state.folderName = handle.name;
      write(store.folderName, handle.name);
      updateFolderUI();
      try {
        await storedHandle("save", handle, folderHandleKey);
      } catch (_) {
        status("Folder available for this session. Choose it again next time.");
      }
      await collectFolder(handle, "selection");
    } catch (error) {
      if (error?.name !== "AbortError")
        status("Folder access failed. Choose or reconnect the folder.");
    }
  };
  const reopenFolder = async () => {
    let handle = state.folderHandle;
    if (!handle) {
      try { handle = await storedHandle("read", null, folderHandleKey); }
      catch (_) {}
    }
    if (!handle || handle.kind !== "directory") {
      await chooseFolder();
      return;
    }
    try {
      let permission = typeof handle.queryPermission === "function" ?
        await handle.queryPermission({mode:"read"}) : "prompt";
      if (permission !== "granted" && typeof handle.requestPermission === "function")
        permission = await handle.requestPermission({mode:"read"});
      if (permission !== "granted") {
        updateFolderUI("Saved folder: " + handle.name);
        status("Folder access needs permission. Reopen to grant access.");
        return;
      }
      state.folderHandle = handle;
      state.folderName = handle.name;
      updateFolderUI();
      await collectFolder(handle, "reopen");
    } catch (_) {
      status("Folder access failed. Choose or reconnect the folder.");
    }
  };
  const forgetFolder = async () => {
    ++state.folderScanVersion;
    state.folderHandle = null;
    state.folderName = "";
    try {
      localStorage.removeItem(store.folderName);
      localStorage.removeItem(store.queueSequence);
    } catch (_) {}
    try { await storedHandle("delete", null, folderHandleKey); } catch (_) {}
    updateFolderUI();
    status("Folder forgotten. Queued movies remain available this session.", true);
  };
  const restoreSavedFolder = async () => {
    if (!state.folderName) return;
    updateFolderUI();
    try {
      const handle = await storedHandle("read", null, folderHandleKey);
      if (!handle || handle.kind !== "directory") {
        status("Folder access needs permission. Reopen to grant access.");
        return;
      }
      state.folderHandle = handle;
      const permission = typeof handle.queryPermission === "function" ?
        await handle.queryPermission({mode:"read"}) : "prompt";
      if (permission === "granted") await collectFolder(handle, "startup");
      else status("Folder access needs permission. Reopen to grant access.");
    } catch (_) {
      status("Folder access needs permission. Reopen to grant access.");
    }
  };
  byId("selectFolder").addEventListener("click", () => { void chooseFolder(); });
  folderReconnectButton.addEventListener("click", () => { void reopenFolder(); });
  folderForgetButton.addEventListener("click", () => { void forgetFolder(); });
  folderInput.addEventListener("change", event => {
    const entries=Array.from(event.target.files||[]);
    event.target.value="";
    if(!entries.length)return;
    const name=String(entries[0].webkitRelativePath||"").split("/")[0];
    if(name)updateFolderUI("Session folder: "+name);
    const mediaFiles=entries.filter(fileIsMedia).slice(0,folderLimit);
    const artwork=entries.filter(file=>/\.(?:jpe?g|png|webp)$/i.test(file.name))
      .slice(0,1000).map(file=>({file,path:file.webkitRelativePath||file.name}));
    addFiles(mediaFiles,[],"queue",{
      media:mediaFiles.map(file=>({file,path:file.webkitRelativePath||file.name})),
      artwork
    });
    status("Folder available for this session. Choose it again next time.", true);
  });

  // Chromium's File System Access picker provides permissioned file handles.
  // If the picker API is unavailable in the current Chromium context, use
  // a temporary file input without persistent-file permissions.
  const openLocalFiles = async (mode = "open") => {
    state.pendingPickerMode = mode;
    if(window.DKLibraryBridge?.internalPages){
      // Native Chromium file inputs preserve the selected disk path for
      // Electron webUtils; File System Access handles may not.
      byId("filePicker").click();return;
    }
    if (typeof window.showOpenFilePicker !== "function") {
      byId("filePicker").click();
      return;
    }
    try {
      const handles = await window.showOpenFilePicker({id: "dk-media-player", multiple: true});
      const selected = [];
      for (const handle of handles) {
        try {
          const file = await handle.getFile();
          // Explicitly selected files are probed by the playback engine;
          // never reject an unusual codec solely by its filename extension.
          selected.push({file, handle});
        } catch (_) { /* Continue opening remaining files. */ }
      }
      if (selected.length) addFiles(selected.map(item => item.file),
                                    selected.map(item => item.handle), mode);
      else status("No readable video or audio file was selected.");
    } catch (error) {
      if (error && error.name === "AbortError") return;
      status("The file picker could not open. Try dragging a file onto the player.");
    }
  };

  const showRestoreChoice = (saved, hint) => {
    const button = byId("restoreMedia");
    button.textContent = "Restore " + (saved.name || "last file");
    button.hidden = false;
    byId("restoreHint").textContent = hint;
    byId("restoreHint").hidden = false;
  };
  const sameSavedFile=(saved,file)=>Boolean(file&&saved.key===
    "file:"+file.name+":"+file.size+":"+file.lastModified);
  const findSavedCatalogRow=async saved=>{
    const rows=await window.DKLibraryStore?.entries?.()||[];
    // Older temporary-file records lack a native path. Use the complete
    // stored fingerprint, not merely a filename or a fuzzy title.
    const matches=rows.filter(row=>row.source==="native"&&!row.missing&&
      row.filename===saved.name&&(
        saved.key==="file:"+row.filename+":"+row.size+":"+row.modified||
        saved.key==="file:"+row.filename+":"+row.size+":"+Math.trunc(row.modified)
      )&&(!saved.libraryId||row.id===saved.libraryId));
    return matches.length===1?matches[0]:null;
  };
  const restoreStandalone=async(saved,allowPermission=false)=>{
    if(restoreInFlight)return restoreInFlight;
    restoreInFlight=(async()=>{
      const bridge=window.DKLibraryBridge;
      if(!saved?.key||!bridge?.internalPages)return false;
      await nativeRestoreWrites;
      if(read(store.lastMedia,null)?.key!==saved.key)return false;
      const existing=state.queue.map((item,index)=>({item,index})).filter(({item})=>
        item.key===saved.key&&(!saved.libraryId||item.libraryId===saved.libraryId));
      if(existing.length===1){
        if(existing[0].index!==state.current||state.stopped)load(existing[0].index,false);
        status("Last file restored. Press Play to resume.",true);
        return true;
      }
      if(existing.length>1)return false;
      // If a previously saved native grant is invalid, fail rather than
      // guessing a different file with the same name.
      let nativeSelection;
      try{nativeSelection=await bridge.restoreMedia?.(saved.key);}
      catch(_){return false;}
      let catalogRow=null;
      if(!nativeSelection){
        try{
          catalogRow=await findSavedCatalogRow(saved);
          if(catalogRow)nativeSelection={row:catalogRow,opened:
            await bridge.nativeOpen(catalogRow.id,catalogRow.nativePath)};
        }catch(_){catalogRow=null;}
      }
      if(nativeSelection){
        const selected=window.DKNativeFile.create(nativeSelection.row,nativeSelection.opened,bridge);
        if(!sameSavedFile(saved,selected.file)){
          // Chromium File timestamps use integer milliseconds; catalog
          // filesystem timestamps may retain the fractional part.
          const rounded="file:"+selected.file.name+":"+selected.file.size+":"+Math.trunc(selected.file.lastModified);
          if(!catalogRow||rounded!==saved.key)return false;
          if(Number(state.resume[saved.key])>0)
            state.resume["file:"+selected.file.name+":"+selected.file.size+":"+selected.file.lastModified]=state.resume[saved.key];
        }
        if(read(store.lastMedia,null)?.key!==saved.key||current())return false;
        if(!catalogRow)catalogRow=await window.DKLibraryStore?.resolvePlaybackEntry?.(
          selected.file,saved.libraryId).catch(()=>null);
        if(read(store.lastMedia,null)?.key!==saved.key||current())return false;
        addFiles([selected.file],[],"restore",{
          nativeSrc:selected.src,libraryId:catalogRow?.id||saved.libraryId||null,
          libraryPosition:catalogRow?.position||0,episodeTitle:catalogRow?.episodeTitle||""
        });
        status("Last file restored. Press Play to resume.",true);
        return true;
      }
      // Retain valid historical FileSystem handles, including explicit
      // permission prompts on a Restore click, without opening a picker.
      if(saved.kind==="file"){
        try{
          await handleWrites;
          const handle=await storedHandle("read");
          if(!handle?.getFile)return false;
          let permission=await handle.queryPermission?.({mode:"read"});
          if(permission!=="granted"&&allowPermission)
            permission=await handle.requestPermission?.({mode:"read"});
          if(permission!=="granted")return false;
          const file=await handle.getFile();
          if(!sameSavedFile(saved,file)||current()||read(store.lastMedia,null)?.key!==saved.key)return false;
          addFiles([file],[handle],"restore",{libraryId:saved.libraryId||null});
          status("Last file restored. Press Play to resume.",true);
          return true;
        }catch(_){}
      }
      return false;
    })().catch(()=>false).finally(()=>{restoreInFlight=null;});
    return restoreInFlight;
  };
  const restoreLastMedia = async () => {
    const saved = read(store.lastMedia, null);
    if (!saved || state.queue.length) return;
    if (saved.kind === "url") {
      // Do not reopen links remembered by an older release.
      try { localStorage.removeItem(store.lastMedia); } catch (_) {}
      return;
    }
    if (saved.kind !== "file" && saved.kind !== "temporary-file") return;
    if(window.DKLibraryBridge?.internalPages){
      showRestoreChoice(saved,"Restore the previously selected file.");
      if(!await restoreStandalone(saved))
        showRestoreChoice(saved,"Saved file unavailable. Reconnect its drive or scan Library.");
      return;
    }
    // Permission can expire, and temporary inputs cannot reopen a file
    // silently. Offer the user a Chromium reselect/permission workflow.
    showRestoreChoice(saved, "Choose the same file again to resume where you stopped.");
    if (saved.kind === "temporary-file") return;
    try {
      await handleWrites;
      const handle = await storedHandle("read");
      if (!handle || typeof handle.getFile !== "function" || state.queue.length) return;
      state.restoreHandle = handle;
      const permission = typeof handle.queryPermission === "function" ?
        await handle.queryPermission({mode: "read"}) : "prompt";
      if (state.queue.length) return;
      if (permission === "granted") {
        const file = await handle.getFile();
        if (state.queue.length) return;
        addFiles([file], [handle], "restore");
        status("Last file restored. Press Play to resume.", true);
      } else {
        showRestoreChoice(saved, "Allow access or select the same file again to resume.");
      }
    } catch (_) {
      showRestoreChoice(saved, "The saved file could not be reopened. Select it again.");
    }
  };
  byId("restoreMedia").addEventListener("click", async () => {
    if(window.DKLibraryBridge?.internalPages){
      const saved=read(store.lastMedia,null);
      if(!await restoreStandalone(saved,true))status("Saved file unavailable. Reconnect its drive or scan Library.");
      return;
    }
    if (state.queue.length) return;
    const handle = state.restoreHandle;
    if (handle) {
      try {
        const permission = typeof handle.requestPermission === "function" ?
          await handle.requestPermission({mode: "read"}) : "prompt";
        if (permission === "granted") {
          const file = await handle.getFile();
          if (state.queue.length) return;
          addFiles([file], [handle], "restore");
          status("File restored. Press Play to resume.", true);
          return;
        }
      } catch (_) { /* Fall back to the normal file picker below. */ }
    }
    status("Choose your previously opened file to restore its saved position.");
    await openLocalFiles("restore");
  });
  byId("openEmpty").addEventListener("click", () => { void openLocalFiles("open"); });
  if(window.DKLibraryBridge?.nativeLibrary&&window.DKLibraryBridge?.showLibrary){
    const button=byId("returnToLibrary");
    button.classList.remove("ghost");button.classList.add("primary","dk-window-nav");
    button.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5v15M9 5v15M14 5v15M18 5l3 14"/></svg><span>Library</span>';
  }
  if(window.DKLibraryBridge?.internalPages){
    document.documentElement.classList.add("dk-standalone");
    const footer=document.querySelector(".footer");
    if(footer&&window.DKLibraryBridge.openACP){
      footer.classList.add("dk-branded-footer");
      const brand=document.createElement("span"),link=document.createElement("a");
      brand.textContent="DK Kinehall ☭ DK Softworks";
      link.href="https://acp.us/";link.textContent="ACP";
      link.addEventListener("click",event=>{
        event.preventDefault();
        void window.DKLibraryBridge.openACP().catch(()=>status("Could not open external website."));
      });
      footer.replaceChildren(brand,link);
    }
    const button=document.createElement("button");
    button.id="playerScanLibrary";button.type="button";button.className="btn dk-scan";
    let scanning=false;
    const label=()=>{button.textContent=window.DKLocale?.t(scanning?"Stop Scan":"Scan Library")||(scanning?"Stop Scan":"Scan Library");};
    label();
    byId("forgetFolder").after(button);
    button.addEventListener("click",()=>void window.DKLibraryBridge.requestScan().catch(()=>status("Library scan failed.")));
    window.DKLibraryBridge.onScanState(value=>{scanning=Boolean(value);button.setAttribute("aria-pressed",String(scanning));label();});
    byId("languageSelect").addEventListener("change",()=>queueMicrotask(label));
    const bridge=window.DKLibraryBridge;
    if(bridge.requestMaintenance){
      const trash=document.createElement("button"),refresh=document.createElement("button");
      trash.id="playerEmptyTrash";refresh.id="playerRefreshMetadata";
      for(const control of [trash,refresh]){control.type="button";control.className="btn";}
      button.after(trash,refresh);
      let busy=false,refreshing=false;
      const tr=value=>window.DKLocale?.t(value)||value;
      const refreshLabels=()=>{
        trash.textContent=tr("Empty Trash");
        refresh.textContent=tr(refreshing?"Stop Refresh":"Refresh Metadata");
        trash.disabled=busy||scanning;
        refresh.disabled=scanning||(busy&&!refreshing);
        refresh.setAttribute("aria-pressed",String(refreshing));
      };
      refreshLabels();
      bridge.onScanState(value=>{scanning=Boolean(value);refreshLabels();});
      const request=action=>void bridge.requestMaintenance(action,window.DKLocale?.get()||"en")
        .catch(()=>status("Library maintenance failed."));
      trash.addEventListener("click",()=>request("trash"));
      refresh.addEventListener("click",()=>request("refresh"));
      bridge.onMaintenanceStatus(value=>{
        busy=Boolean(value.busy);refreshing=busy&&value.action==="refresh";
        refreshLabels();
        if(value.failed)status("Library maintenance failed.");
        else if(refreshing)status(tr("Refreshing metadata: ")+value.done+" / "+value.total,true);
        else if(!busy&&value.action==="trash")status(tr("Unavailable records removed: ")+value.removed,true);
        else if(!busy&&value.action==="refresh"&&value.total>0)status(value.cancelled?"Metadata refresh stopped.":"Metadata refresh finished.",true);
      });
      byId("languageSelect").addEventListener("change",()=>queueMicrotask(refreshLabels));
    }
    document.addEventListener("auxclick",event=>{
      if(event.button!==3&&event.button!==4)return;
      event.preventDefault();event.stopPropagation();
      void bridge.navigateHistory?.(event.button===3?-1:1).catch(()=>{});
    },true);
  }
  byId("returnToLibrary").addEventListener("click",()=>{
    if(window.DKLibraryBridge?.showLibrary) {
      void window.DKLibraryBridge.showLibrary();
    }else if(window.opener&&!window.opener.closed) {
      window.opener.focus();
    }else{
      const home=window.open("./library.html","dk-kinehall-library");
      if(!home)window.location.assign("./library.html");
    }
  });
  byId("addQueueFiles").addEventListener("click", () => { void openLocalFiles("queue"); });
  // Local playlist controls are standalone-only; the web edition is unchanged.
  if(window.DKLibraryBridge?.importLocalPlaylist){
    const buttons=[];
    let importing=false;
    const importPlaylist=async mode=>{
      if(importing)return;
      importing=true;buttons.forEach(button=>button.disabled=true);
      try{
        const result=await window.DKLibraryBridge.importLocalPlaylist(document.documentElement.lang);
        if(result?.cancelled)return;
        const selected=[];
        let skipped=Number(result?.skipped)||0;
        for(const {row,opened} of result?.rows||[]){
          try{selected.push(window.DKNativeFile.create(row,opened,window.DKLibraryBridge));}
          catch(_){skipped++;}
        }
        if(!selected.length){
          status(streamSay("No accessible local videos in this playlist.","В списке нет доступных местных видео."));return;
        }
        // Each native file has its own source URL; preserve the playlist order.
        // Opening starts only the first item if idle; queue mode never interrupts.
        selected.forEach((item,index)=>addFiles([item.file],[],index===0?mode:"queue",{nativeSrc:item.src}));
        status(streamSay("Playlist imported. Added: "+selected.length+". Skipped: "+skipped+".",
          "Список импортирован. Добавлено: "+selected.length+". Пропущено: "+skipped+"."),true);
      }catch(_){
        status(streamSay("Cannot import this local playlist. Use a supported UTF-8 video list with up to 256 entries.",
          "Не удалось импортировать список. Выберите список видео в кодировке ЮТФ-8 с числом записей не более 256."));
      }finally{importing=false;buttons.forEach(button=>button.disabled=false);}
    };
    for(const [anchor,mode] of [["openEmpty","open"],["addQueueFiles","queue"]]){
      const button=document.createElement("button");
      button.type="button";button.className="btn ghost";
      button.textContent=mode==="queue"?"+ Playlist":"Import local playlist…";
      if(mode==="queue"){button.id="addQueuePlaylist";button.title=streamSay("Import local playlist…","Импорт списка воспроизведения…");}
      button.addEventListener("click",()=>void importPlaylist(mode));
      byId(anchor).after(button);buttons.push(button);
    }
    window.DKLocale?.apply();
  }
  byId("filePicker").addEventListener("change", event => {
    const mode = state.pendingPickerMode;
    state.pendingPickerMode = "open";
    if (event.target.files && event.target.files.length)
      addFiles(event.target.files, [], mode);
    event.target.value = "";
  });
  for (const eventName of ["dragenter", "dragover"]) screen.addEventListener(eventName, event => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    screen.classList.add("dragging");
  });
  for (const eventName of ["dragleave", "drop"]) screen.addEventListener(eventName, event => {
    event.preventDefault();
    screen.classList.remove("dragging");
  });
  screen.addEventListener("drop", event => {
    const files = event.dataTransfer && event.dataTransfer.files;
    if (!files || !files.length) return;
    // Only one drop target: the picture itself. Start playback when empty;
    // otherwise add all dropped media to Up Next without interrupting
    // the movie, even if it is paused or stopped.
    addFiles(files, [], current() ? "queue" : "open");
  });
  byId("clearQueue").addEventListener("click", () => {
    cancelNextCountdown();
    // Clearing Up Next should not interrupt the episode currently on screen.
    const old = state.queue.splice(state.current + 1);
    old.forEach(item => {
      releaseArtwork(item);
      releaseNetwork(item);
      releaseCompatible(item);
      if (item.kind === "file") URL.revokeObjectURL(item.src);
    });
    rememberQueueSequence();
    renderQueue();
    status("Up Next cleared.", true);
  });
  const togglePlayback = () => {
    const item=current();if(!item)return;
    if(isStream(item)&&!state.stopped){
      if(bufferGate||networkRetryTimer!==null||(!media.paused&&!media.ended)||item.networkStarting){item.autoplayRequested=false;cancelNetworkRetry();item.streamBuffering=false;media.pause();updateButtons();status("");return;}
      item.autoplayRequested=true;item.streamPrimed=false;
      if(item.networkStarting)return;
      if(media.error||media.ended||item.networkRetries>=5||!media.getAttribute("src")){item.networkRetries=0;item.codecAttempted=false;if(item.requestedFormat!=="original"&&codecPlayback){void startNetworkDecoder(item,item.liveChannel?0:Math.max(0,Number(item.networkLastPosition)||0)).then(ok=>{if(!ok&&current()===item&&!state.stopped&&!recoverNetwork(item,true))status(networkErrorText(item));});}else recoverNetwork(item,false);return;}
    }
    if (media.paused || media.ended) playCurrent();
    else media.pause();
  };
  // On-picture controls are visible while paused, when focused, or while the
  // user interacts; they fade during uninterrupted playback.
  const controls = byId("screenControls");
  const contextMenu = byId("playerContextMenu");
  const infoPanel = byId("mediaInfo");
  const settingsDetails = document.querySelector(".player-bar-settings");
  let openPictureAdjustments=null;
  if(window.DKLibraryBridge?.internalPages && settingsDetails){
    const close=document.createElement("button");
    close.type="button";close.id="closePlayerSettings";close.className="dk-settings-close";
    close.textContent="×";
    const label=()=>{const text=window.DKLocale?.pair("Close settings","Закрыть настройки")||"Close settings";close.title=text;close.setAttribute("aria-label",text);};
    label();
    byId("languageSelect").addEventListener("change",()=>queueMicrotask(label));
    byId("playerSettingsPanel").prepend(close);
    close.addEventListener("click",()=>{settingsDetails.open=false;settingsDetails.querySelector("summary")?.focus();});
  }
  // Standalone picture enhancements only. CSS and local SVG filters operate
  // on the existing video element; no decoding, canvas copies or file writes.
  if(window.DKLibraryBridge?.internalPages&&settingsDetails){
    const key="dk-kinehall.picture.v1";
    const specs=[
      {id:"brightness",label:"Brightness",min:0,max:200,step:1,neutral:100,unit:"%"},
      {id:"contrast",label:"Contrast",min:0,max:200,step:1,neutral:100,unit:"%"},
      {id:"saturation",label:"Saturation",min:0,max:200,step:1,neutral:100,unit:"%"},
      {id:"hue",label:"Hue",min:-180,max:180,step:1,neutral:0,unit:"°"},
      {id:"gamma",label:"Gamma",min:0.25,max:3,step:0.05,neutral:1,unit:""},
      {id:"sharpness",label:"Sharpness",min:0,max:100,step:1,neutral:0,unit:"%"}
    ];
    const saved=read(key,{})||{},values={},controls=new Map();
    const presetKey="dk-kinehall.picture-presets.v1",perMediaKey="dk-kinehall.picture-per-media.v1";
    const builtins={
      original:[100,100,100,0,1,0],
      dark:[115,100,100,0,1.35,0],
      veryDark:[130,95,100,0,1.55,0],
      bright:[85,105,100,0,.85,0],
      classic:[105,110,85,0,1.1,0],
      animation:[105,110,125,0,1.05,10],
      soft:[100,90,95,0,1,0],
      monochrome:[100,110,0,0,1,0]
    };
    const names={original:"Original",dark:"Dark cinema",veryDark:"Very dark scenes",bright:"Overexposed picture",classic:"Classic films",animation:"Vivid animation",soft:"Soft picture",monochrome:"Black and white"};
    let custom=read(presetKey,null);const perMedia=read(perMediaKey,{})||{};
    const validValues=source=>Object.fromEntries(specs.map((spec,i)=>{
      const value=Array.isArray(source)?source[i]:source?.[spec.id];
      return [spec.id,value!=null&&Number.isFinite(Number(value))?Math.min(spec.max,Math.max(spec.min,Number(value))):spec.neutral];
    }));
    let defaultValues=validValues(saved),pictureScope="default";
    const mediaProfileKey=scope=>{
      const item=current();if(!item||item.kind!=="file"||item.file?.dvdToken)return null;
      if(scope==="series"){
        const parsed=window.DKMediaMetadata?.parseFilename(item.metadataFilename||item.name);
        return parsed?.type==="episode"?"series:"+String(parsed.series).toLowerCase():null;
      }
      return "video:"+(item.libraryId||item.key);
    };
    const persistPicture=()=>{
      const id=sharedSettingsEditing||pictureScope==="default"?null:mediaProfileKey(pictureScope);
      if(id){perMedia[id]={...values};const ids=Object.keys(perMedia);if(ids.length>500)ids.slice(0,ids.length-500).forEach(k=>delete perMedia[k]);write(perMediaKey,perMedia);}
      else {defaultValues={...values};write(key,defaultValues);}
    };
    for(const spec of specs){
      const n=Number(saved[spec.id]);
      values[spec.id]=saved[spec.id]!=null&&Number.isFinite(n)?
        Math.min(spec.max,Math.max(spec.min,n)):spec.neutral;
    }
    const ns="http://www.w3.org/2000/svg";
    const svgNode=(tag,attrs={})=>{
      const node=document.createElementNS(ns,tag);
      for(const [name,value] of Object.entries(attrs))node.setAttribute(name,String(value));
      return node;
    };
    const svg=svgNode("svg",{width:0,height:0,"aria-hidden":"true",focusable:"false",class:"dk-picture-filter-defs"});
    const defs=svgNode("defs");
    const gammaFilter=svgNode("filter",{id:"dk-picture-gamma",x:0,y:0,width:"100%",height:"100%","color-interpolation-filters":"sRGB"});
    const transfer=svgNode("feComponentTransfer");
    const gammaChannels=["R","G","B"].map(channel=>svgNode("feFunc"+channel,{type:"gamma",amplitude:1,exponent:1,offset:0}));
    transfer.append(...gammaChannels);gammaFilter.append(transfer);
    const sharpFilter=svgNode("filter",{id:"dk-picture-sharpness",x:0,y:0,width:"100%",height:"100%","color-interpolation-filters":"sRGB"});
    const convolution=svgNode("feConvolveMatrix",{order:3,kernelMatrix:"0 0 0 0 1 0 0 0 0",divisor:1,bias:0,edgeMode:"duplicate",preserveAlpha:"true"});
    sharpFilter.append(convolution);defs.append(gammaFilter,sharpFilter);svg.append(defs);
    document.body.append(svg);
    const section=document.createElement("section");
    section.id="pictureEnhancements";section.className="player-settings-section dk-picture-settings";
    const title=document.createElement("strong");title.textContent="Picture enhancements";section.append(title);
    const presetLabel=document.createElement("label");presetLabel.htmlFor="picturePreset";presetLabel.textContent="Picture preset";
    const preset=document.createElement("select");preset.id="picturePreset";
    const refreshPreset=()=>{
      const choices=[...Object.entries(names),...(Array.isArray(custom)?[["saved","My custom preset"]]:[]),["custom","Custom"]];
      const signature=JSON.stringify(choices);
      if(preset.dataset.signature!==signature){
        preset.replaceChildren(...choices.map(([id,name])=>{const o=document.createElement("option");o.value=id;o.textContent=window.DKLocale?.t(name)||name;return o;}));
        preset.dataset.signature=signature;
      }
      const match=Object.entries(builtins).find(([,entry])=>specs.every((spec,i)=>Math.abs(values[spec.id]-entry[i])<0.001));
      const savedMatch=Array.isArray(custom)&&specs.every((spec,i)=>Math.abs(values[spec.id]-custom[i])<0.001);
      preset.value=match?.[0]||(savedMatch?"saved":"custom");
    };
    const saveCustom=document.createElement("button");saveCustom.type="button";saveCustom.className="btn small";saveCustom.textContent="Save custom picture preset";
    saveCustom.id="saveCustomPicture";
    const profileActions=document.createElement("div");profileActions.className="dk-picture-profile-actions";profileActions.dataset.mediaOnly="true";
    const scopeLabel=document.createElement("label");scopeLabel.htmlFor="pictureScope";scopeLabel.textContent="Apply picture settings to";
    const scopeSelect=document.createElement("select");scopeSelect.id="pictureScope";
    for(const [value,label] of [["default","All videos (default)"],["video","This video only"],["series","This TV series"]]){
      const option=document.createElement("option");option.value=value;option.textContent=window.DKLocale?.t(label)||label;scopeSelect.append(option);
    }
    scopeSelect.addEventListener("change",()=>{
      pictureScope=scopeSelect.value;
      const id=pictureScope==="default"?null:mediaProfileKey(pictureScope);
      const source=id&&(perMedia[id]||(pictureScope==="video"&&perMedia[mediaProfileKey("series")]));
      Object.assign(values,source?validValues(source):defaultValues);applyPicture();
    });
    profileActions.append(scopeLabel,scopeSelect);
    const clearProfile=document.createElement("button");clearProfile.type="button";clearProfile.className="btn small";clearProfile.textContent="Remove selected picture override";
    clearProfile.addEventListener("click",()=>{
      const id=pictureScope==="default"?null:mediaProfileKey(pictureScope);if(!id)return;
      delete perMedia[id];write(perMediaKey,perMedia);applyMediaProfile();
    });
    profileActions.append(clearProfile);
    section.append(profileActions,presetLabel,preset,saveCustom);
    const applyPicture=()=>{
      const filters=[];
      if(values.brightness!==100)filters.push("brightness("+values.brightness+"%)");
      if(values.contrast!==100)filters.push("contrast("+values.contrast+"%)");
      if(values.saturation!==100)filters.push("saturate("+values.saturation+"%)");
      if(values.hue!==0)filters.push("hue-rotate("+values.hue+"deg)");
      if(values.gamma!==1){
        for(const channel of gammaChannels)channel.setAttribute("exponent",String(1/values.gamma));
        filters.push("url(#dk-picture-gamma)");
      }
      if(values.sharpness!==0){
        const amount=values.sharpness/200;
        convolution.setAttribute("kernelMatrix",[0,-amount,0,-amount,1+4*amount,-amount,0,-amount,0].join(" "));
        filters.push("url(#dk-picture-sharpness)");
      }
      // A neutral picture uses no filter at all. Do not alter overlays,
      // controls or artwork, and do not force CPU copies of each video frame.
      media.style.filter=filters.length?filters.join(" "):"";
      refreshPreset();scopeSelect.value=pictureScope;
      scopeSelect.options[1].disabled=!mediaProfileKey("video");scopeSelect.options[2].disabled=!mediaProfileKey("series");
      clearProfile.disabled=pictureScope==="default"||!perMedia[mediaProfileKey(pictureScope)];
      for(const spec of specs){
        const entry=controls.get(spec.id);
        if(!entry)continue;
        entry.input.value=String(values[spec.id]);
        entry.output.textContent=(spec.id==="gamma"?values[spec.id].toFixed(2):String(Math.round(values[spec.id])))+spec.unit;
      }
    };
    for(const spec of specs){
      const row=document.createElement("div");row.className="dk-picture-adjustment";
      const label=document.createElement("label"),input=document.createElement("input"),output=document.createElement("output");
      input.id="picture-"+spec.id;input.type="range";input.min=String(spec.min);input.max=String(spec.max);input.step=String(spec.step);
      label.htmlFor=input.id;label.textContent=spec.label;
      output.htmlFor=input.id;controls.set(spec.id,{input,output});
      input.addEventListener("input",()=>{
        values[spec.id]=Math.min(spec.max,Math.max(spec.min,Number(input.value)));
        applyPicture();
      });
      input.addEventListener("change",()=>{persistPicture();applyPicture();});
      row.append(label,output,input);section.append(row);
    }
    const reset=document.createElement("button");
    reset.type="button";reset.className="btn small dk-picture-reset";reset.textContent="Reset picture";
    reset.addEventListener("click",()=>{
      for(const spec of specs)values[spec.id]=spec.neutral;
      persistPicture();applyPicture();
    });
    const note=document.createElement("p");note.className="helper";
    note.textContent="Picture adjustments affect playback only, not the original video or exported file.";
    preset.addEventListener("change",()=>{
      const next=preset.value==="saved"?custom:builtins[preset.value];if(!next)return;
      Object.assign(values,validValues(next));applyPicture();persistPicture();
    });
    saveCustom.addEventListener("click",()=>{
      const entry=specs.map(spec=>values[spec.id]);
      if(Array.isArray(custom))custom.splice(0,custom.length,...entry);
      else custom=entry;
      write(presetKey,entry);refreshPreset();preset.value="saved";status("Picture preset saved.",true);
    });
    const applyMediaProfile=()=>{
      const video=perMedia[mediaProfileKey("video")],series=perMedia[mediaProfileKey("series")];
      const row=video||series;pictureScope=video?"video":series?"series":"default";Object.assign(values,row?validValues(row):defaultValues);applyPicture();
    };
    section.append(reset,note);
    byId("playerSettingsPanel").append(section);
    refreshPictureProfile=applyMediaProfile;
    beginDefaultPicture=()=>{Object.assign(values,defaultValues);applyPicture();};
    endDefaultPicture=applyMediaProfile;
    byId("languageSelect").addEventListener("change",()=>{delete preset.dataset.signature;queueMicrotask(()=>{refreshPreset();["All videos (default)","This video only","This TV series"].forEach((label,i)=>scopeSelect.options[i].textContent=window.DKLocale?.t(label)||label);});});
    applyPicture();
    window.DKLocale?.apply();
  }
  // Standalone geometry controls act on the existing picture, not its
  // container. Controls and seek previews retain their original geometry.
  if(window.DKLibraryBridge?.internalPages&&settingsDetails){
    const key="dk-kinehall.picture-geometry.v1";
    const saved=read(key,{})||{};
    const ratios={source:0,"4:3":4/3,"16:9":16/9,"1:1":1,"21:9":21/9,"2.35:1":2.35};
    const bound=(value,min,max,fallback)=>Number.isFinite(Number(value))&&value!=null?Math.max(min,Math.min(max,Number(value))):fallback;
    const prefs={fit:saved.fit==="fill"?"fill":"fit",
      aspect:Object.hasOwn(ratios,saved.aspect)?saved.aspect:"source",
      zoom:bound(saved.zoom,50,300,100),x:bound(saved.x,-100,100,0),y:bound(saved.y,-100,100,0)};
    const section=document.createElement("section");
    section.className="player-settings-section dk-picture-settings";
    const title=document.createElement("strong");title.textContent="Zoom and cropping";section.append(title);
    const select=(id,labelText,options)=>{
      const label=document.createElement("label");label.htmlFor=id;label.textContent=labelText;
      const node=document.createElement("select");node.id=id;
      for(const [value,name] of options){const option=document.createElement("option");option.value=value;option.textContent=name;node.append(option);}
      section.append(label,node);return node;
    };
    const fit=select("picture-fit","Picture fit",[["fit","Fit full picture"],["fill","Fill frame (crop edges)"]]);
    const aspect=select("picture-aspect","Aspect ratio",[["source","Original aspect ratio"],...Object.keys(ratios).filter(x=>x!=="source").map(x=>[x,x])]);
    const preset=select("picture-zoom-preset","Zoom preset",[["50","50%"],["100","100%"],["150","150%"],["200","200%"],["custom","Custom zoom"]]);
    const ranges={};
    for(const [id,labelText,min,max] of [["zoom","Custom zoom",50,300],["x","Horizontal pan",-100,100],["y","Vertical pan",-100,100]]){
      const row=document.createElement("div");row.className="dk-picture-adjustment";
      const label=document.createElement("label"),input=document.createElement("input"),output=document.createElement("output");
      input.id="picture-geometry-"+id;input.type="range";input.min=min;input.max=max;input.step=1;
      label.htmlFor=input.id;label.textContent=labelText;output.htmlFor=input.id;
      ranges[id]={input,output};row.append(label,output,input);section.append(row);
      input.addEventListener("input",()=>{prefs[id]=Number(input.value);applyGeometry();});
      input.addEventListener("change",()=>write(key,prefs));
    }
    const applyGeometry=()=>{
      fit.value=prefs.fit;aspect.value=prefs.aspect;
      preset.value=[50,100,150,200].includes(prefs.zoom)?String(prefs.zoom):"custom";
      for(const [id,entry] of Object.entries(ranges)){
        entry.input.value=String(prefs[id]);entry.output.textContent=prefs[id]+"%";
      }
      screen.classList.toggle("fit-cover",prefs.fit==="fill");
      const active=Boolean(media.videoWidth&&media.videoHeight&&current()&&!current().audio&&!state.stopped);
      const custom=prefs.aspect!=="source"||prefs.zoom!==100||prefs.x!==0||prefs.y!==0;
      if(!active||!custom||screen.clientWidth<=0||screen.clientHeight<=0){
        pictureGeometry=null;screen.classList.remove("dk-custom-picture");
        for(const prop of ["--dk-picture-left","--dk-picture-top","--dk-picture-width","--dk-picture-height","--dk-picture-clip"])media.style.removeProperty(prop);
        ranges.x.input.disabled=ranges.y.input.disabled=true;
        syncPgsOverlay();return;
      }
      const W=screen.clientWidth,H=screen.clientHeight,ratio=ratios[prefs.aspect]||media.videoWidth/media.videoHeight;
      const fitWidth=prefs.fit==="fill"?Math.max(W,H*ratio):Math.min(W,H*ratio);
      const width=fitWidth*prefs.zoom/100,height=width/ratio;
      const xOverflow=Math.max(0,width-W)/2,yOverflow=Math.max(0,height-H)/2;
      const left=(W-width)/2+prefs.x*xOverflow/100,top=(H-height)/2+prefs.y*yOverflow/100;
      const clip="inset("+Math.max(0,-top)+"px "+Math.max(0,left+width-W)+"px "+Math.max(0,top+height-H)+"px "+Math.max(0,-left)+"px)";
      pictureGeometry={left,top,width,height,clip};
      for(const [prop,value] of Object.entries({left:left+"px",top:top+"px",width:width+"px",height:height+"px",clip}))
        media.style.setProperty("--dk-picture-"+prop,value);
      screen.classList.add("dk-custom-picture");
      ranges.x.input.disabled=xOverflow<=0;ranges.y.input.disabled=yOverflow<=0;
      syncPgsOverlay();
    };
    setPictureFit=value=>{prefs.fit=value==="fill"?"fill":"fit";applyGeometry();write(key,prefs);};
    fit.addEventListener("change",()=>setPictureFit(fit.value));
    aspect.addEventListener("change",()=>{prefs.aspect=aspect.value;applyGeometry();write(key,prefs);});
    preset.addEventListener("change",()=>{
      if(preset.value==="custom"){ranges.zoom.input.focus();return;}
      prefs.zoom=Number(preset.value);applyGeometry();write(key,prefs);
    });
    const reset=document.createElement("button");reset.type="button";reset.className="btn small dk-picture-reset";reset.textContent="Reset zoom and cropping";
    reset.addEventListener("click",()=>{Object.assign(prefs,{fit:"fit",aspect:"source",zoom:100,x:0,y:0});applyGeometry();write(key,prefs);});
    const note=document.createElement("p");note.className="helper";note.textContent="Zoom and pan affect the picture only. Aspect ratio overrides may stretch the image.";
    section.append(reset,note);
    byId("pictureEnhancements")?.after(section);
    if(!section.isConnected)byId("playerSettingsPanel").append(section);
    for(const event of ["loadedmetadata","loadeddata","emptied","resize"])media.addEventListener(event,applyGeometry);
    byId("stop").addEventListener("click",()=>queueMicrotask(applyGeometry));
    window.addEventListener("resize",applyGeometry);
    document.addEventListener("fullscreenchange",()=>requestAnimationFrame(applyGeometry));
    if(typeof ResizeObserver==="function")new ResizeObserver(applyGeometry).observe(screen);
    applyGeometry();window.DKLocale?.apply();
  }
  if(standaloneDeinterlace&&settingsDetails){
    const section=document.createElement("section");
    section.className="player-settings-section dk-picture-settings";
    const title=document.createElement("strong");title.textContent="Deinterlacing";
    const label=document.createElement("label");label.htmlFor="deinterlaceMode";label.textContent="Deinterlacing mode";
    const select=document.createElement("select");select.id="deinterlaceMode";
    for(const [value,text] of [["off","Off"],["auto","Automatic"],["on","On"]]){
      const option=document.createElement("option");option.value=value;option.textContent=text;select.append(option);
    }
    select.value=deinterlacePreference;
    select.addEventListener("change",()=>{
      deinterlacePreference=select.value;write(deinterlaceKey,deinterlacePreference);
      status("Deinterlacing preference applies the next time a video opens.",true);
    });
    const note=document.createElement("p");note.className="helper";
    note.textContent="Automatic uses interlaced stream metadata. On forces native deinterlacing. Original playback format bypasses conversion. Changes apply when a video next opens.";
    section.append(title,label,select,note);
    byId("playerSettingsPanel").append(section);
    window.DKLocale?.apply();
  }
  if(standaloneDeinterlace&&settingsDetails){
    const section=document.createElement("section");section.className="player-settings-section dk-picture-settings";
    const title=document.createElement("strong");title.textContent="Video smoothing";
    const label=document.createElement("label");label.htmlFor="smoothingMode";label.textContent="Motion interpolation";
    const select=document.createElement("select");select.id="smoothingMode";
    for(const [value,text] of [["off","Off"],["auto","Automatic"],["60","60 FPS"],["120","120 FPS"]]){
      const option=document.createElement("option");option.value=value;option.textContent=text;select.append(option);
    }
    select.value=smoothingPreference;
    select.addEventListener("change",()=>{
      smoothingPreference=select.value;write(smoothingKey,smoothingPreference);
      status("Video smoothing preference applies the next time a video opens.",true);
    });
    const note=document.createElement("p");note.className="helper";
    note.textContent="Automatic uses conservative hardware and video limits. 60 and 120 FPS can be demanding. Original playback bypasses interpolation. Changes apply when a video next opens.";
    section.append(title,label,select,note);
    byId("playerSettingsPanel").append(section);window.DKLocale?.apply();
  }
  if(window.DKLibraryBridge?.internalPages&&window.DKCodecBridge?.selectDVD&&settingsDetails){
    const section=document.createElement("section");section.id="dvdSettings";section.className="player-settings-section dk-picture-settings";
    const title=document.createElement("strong");title.textContent="DVD playback";
    const numberField=(id,text,max)=>{
      const label=document.createElement("label");label.htmlFor=id;label.textContent=text;
      const select=document.createElement("select");select.id=id;
      for(let value=1;value<=max;value++){
        const option=document.createElement("option");option.value=String(value);option.textContent=String(value);select.append(option);
      }
      section.append(label,select);return select;
    };
    section.append(title);
    const titleNumber=numberField("dvdTitleNumber","DVD title",99);
    const chapterNumber=numberField("dvdChapterNumber","Start chapter",999);
    const angleNumber=numberField("dvdAngleNumber","DVD angle",9);
    const dvdDialog=document.createElement("dialog");dvdDialog.className="dk-dvd-dialog";
    const discInfo=document.createElement("p");discInfo.className="helper";section.append(discInfo);
    let knownTitles=[];
    const fillNumbers=(select,max,selected)=>{
      const options=[];
      for(let i=1;i<=max;i++){const option=document.createElement("option");option.value=String(i);option.textContent=String(i);options.push(option);}
      select.replaceChildren(...options);select.value=String(Math.max(1,Math.min(max,Number(selected)||1)));
    };
    const updateDiscFields=(chapter=1,angle=1)=>{
      const entry=knownTitles.find(row=>row.title===Number(titleNumber.value));
      fillNumbers(chapterNumber,entry?.chapters||999,chapter);
      fillNumbers(angleNumber,entry?.angles||9,angle);
    };
    titleNumber.addEventListener("change",()=>updateDiscFields());

    const buttons=[];let choosing=false;
    const openDiscResult=result=>{
      if(!result?.id||typeof result.name!=="string")return false;
      const file=Object.freeze({nativeVirtual:true,dvdToken:result.id,dvdTitle:result.title,
        dvdChapter:result.chapter,dvdAngle:result.angle,dvdTitles:Array.isArray(result.titles)?result.titles:[],name:result.name,
        size:0,lastModified:0,type:"video/mpeg",webkitRelativePath:""});
      addFiles([file],[],"open",{nativeSrc:"about:blank"});
      const index=state.queue.findIndex(item=>item.key===result.id);
      if(index>=0&&index!==state.current)load(index,true);
      settingsDetails.open=false;if(dvdDialog.open)dvdDialog.close();
      return true;
    };
    const change=document.createElement("button");change.type="button";change.className="btn small";
    change.textContent="Play selected title on current disc";change.hidden=true;
    buttons.push(change);section.append(change);
    change.addEventListener("click",async()=>{
      const item=current();
      if(choosing||!item?.file?.dvdToken||!window.DKCodecBridge.changeDVD)return;
      choosing=true;buttons.forEach(b=>b.disabled=true);
      try{
        status("Checking DVD support and selected title…");
        const result=await window.DKCodecBridge.changeDVD(item.file.dvdToken,Number(titleNumber.value),
          Number(chapterNumber.value),Number(angleNumber.value));
        if(current()===item)openDiscResult(result);
      }catch(_){status("Cannot open this DVD title. Check the disc, title, chapter and angle.");}
      finally{choosing=false;buttons.forEach(b=>b.disabled=false);}
    });
    for(const [kind,text] of [["drive","Open DVD drive…"],["iso","Open DVD image…"],["folder","Open DVD folder…"]]){
      const button=document.createElement("button");button.type="button";button.className="btn small";button.textContent=text;
      buttons.push(button);section.append(button);
      button.addEventListener("click",async()=>{
        if(choosing)return;
        choosing=true;buttons.forEach(b=>b.disabled=true);
        try{
          status("Checking DVD support and selected title…");
          const result=await window.DKCodecBridge.selectDVD(kind,Number(titleNumber.value),
            Number(chapterNumber.value),Number(angleNumber.value),window.DKLocale?.get()==="ru"?"ru":"en");
          if(!result){status("");return;}
          if(result.unavailable){status("DVD playback backend is unavailable in this installation.");return;}
          if(result.noDrive){status("No optical DVD drive found.");return;}
          openDiscResult(result);
        }catch(_){status("Cannot open this DVD title. Check the disc, title, chapter and angle.");}
        finally{choosing=false;buttons.forEach(b=>b.disabled=false);}
      });
    }
    const note=document.createElement("p");note.className="helper";
    note.textContent="DVD titles use automatic native decoding. A compatible decoder is required. Bitmap subtitles are experimental. Original interactive menus are not supported yet. Disc selections are session-only.";
    section.append(note);byId("playerSettingsPanel").append(section);
    // The playback bar is hidden when idle, so make DVD opening reachable
    // without first playing an unrelated file. Reuse the same controls.
    const closeDVD=document.createElement("button");closeDVD.type="button";closeDVD.className="btn";closeDVD.textContent="Cancel";
    const openDVD=document.createElement("button");openDVD.type="button";openDVD.className="btn ghost";openDVD.textContent="Open DVD…";
    dvdDialog.append(closeDVD);document.body.append(dvdDialog);
    byId("openEmpty").after(openDVD);
    window.DKLibraryBridge.onOpenMediaTool?.(kind=>{if(kind==="disc"){deferStartup=false;settingsDetails.open=false;openDVD.click();}});
    openDVD.addEventListener("click",()=>{
      if(dvdDialog.open)return;
      const file=current()?.file;
      change.hidden=!file?.dvdToken||!window.DKCodecBridge.changeDVD;
      knownTitles=Array.isArray(file?.dvdTitles)?file.dvdTitles:[];
      fillNumbers(titleNumber,knownTitles.length||99,file?.dvdTitle||1);
      updateDiscFields(file?.dvdChapter||1,file?.dvdAngle||1);
      discInfo.textContent=knownTitles.length?(window.DKLocale?.get()==="ru"?"Разделов на диске: ":"Disc titles: ")+knownTitles.length:"";
      window.DKLocale?.apply();
      section.hidden=false;dvdDialog.prepend(section);dvdDialog.showModal();
    });
    closeDVD.addEventListener("click",()=>{if(!choosing)dvdDialog.close();});
    dvdDialog.addEventListener("cancel",event=>{if(choosing)event.preventDefault();});
    dvdDialog.addEventListener("close",()=>{section.hidden=true;byId("playerSettingsPanel").append(section);});
    window.DKLocale?.apply();
  }
  if(window.DKLibraryBridge?.internalPages&&window.DKLibraryBridge?.networkDiscover&&settingsDetails){
    const bridge=window.DKLibraryBridge;
    const dlg=document.createElement("dialog");dlg.className="dk-dvd-dialog dk-network-dialog";
    const translate=value=>window.DKLocale?.t(value)||value;
    const makeButton=(label,action)=>{
      const button=document.createElement("button");button.type="button";button.className="btn small";
      button.textContent=label;button.addEventListener("click",action);return button;
    };
    const heading=document.createElement("strong");heading.textContent="Network media";
    const note=document.createElement("p");note.className="helper";
    note.textContent="Browse DLNA media servers or enter a private IPv4 HTTP media URL. Compatible streams only.";
    const message=document.createElement("p");message.className="helper";message.setAttribute("role","status");
    const results=document.createElement("div");results.className="dk-network-results";
    const url=document.createElement("input");url.type="text";url.placeholder="http://192.168.1.10/video.mp4";url.setAttribute("aria-label","Network media URL");
    const serverURL=document.createElement("input");serverURL.type="url";serverURL.placeholder="http://192.168.1.10:8200/rootDesc.xml";serverURL.setAttribute("aria-label","Media server description URL");
    const queueLabel=document.createElement("label"),queueOnly=document.createElement("input");
    const queueText=document.createElement("span");queueText.textContent="Add to queue only";
    queueOnly.type="checkbox";queueLabel.append(queueOnly,queueText);
    let generation=0,opening=false;
    const say=value=>{message.textContent=value;window.DKLocale?.apply();};
    const parse=value=>{
      if(typeof value!=="string"||/<!DOCTYPE|<!ENTITY/i.test(value))throw Error("Invalid XML");
      const doc=new DOMParser().parseFromString(value,"application/xml");
      if(doc.getElementsByTagName("parsererror").length)throw Error("Invalid XML");
      return doc;
    };
    const nodes=(root,name)=>Array.from(root.getElementsByTagNameNS("*",name));
    const first=(root,name)=>nodes(root,name)[0]?.textContent?.trim()||"";
    const makeNetworkItem=(grant,name,audio)=>({kind:"network",networkToken:grant.token,networkSource:Object.freeze({networkToken:grant.token}),key:"network:"+grant.token,
      name:String(name||"Network media").slice(0,250),audio,src:grant.src,networkTransport:grant.transport||"http",
      embeddedSubtitles:[],embeddedAudio:[],embeddedVideo:[],chapters:[],mkvInspection:"not-mkv"});
    bridge.onLiveTvPlay?.(payload=>{
      const grant=payload?.grant;
      if(!grant?.token||!grant?.src)return;
      deferStartup=false;settingsDetails.open=false;
      const item=makeNetworkItem(grant,payload.name||"Live TV",false);
      item.channelArtwork=typeof payload.artwork==="string"?payload.artwork:"";item.liveChannel=true;
      const index=state.current<0?state.queue.length:state.current+1;
      state.queue.splice(index,0,item);load(index,true);
    });
    const queuePage=async(serverId,entries)=>{
      if(opening||!entries.length)return;
      opening=true;const epoch=generation,staged=[];
      const valid=()=>dlg.open&&epoch===generation;
      try{
        say("Adding network media to queue…");
        for(const entry of entries){
          if(!valid())return;
          const grant=await bridge.networkGrant(serverId,entry.address);
          staged.push(makeNetworkItem(grant,entry.name,entry.audio));
          if(!valid())return;
        }
        // Publish only after every grant succeeded; partial failures or
        // navigation cancel the entire batch and release staged grants.
        const firstIndex=state.queue.length;
        state.queue.push(...staged);
        staged.length=0;
        if(state.current<0)load(firstIndex,false);else{renderQueue();updateButtons();}
        settingsDetails.open=false;dlg.close();
      }catch(_){if(valid())say("Cannot add this page to the queue.");}
      finally{
        for(const item of staged)void bridge.networkRelease(item.networkToken).catch(()=>{});
        opening=false;
      }
    };
    const addNetwork=async(serverId,address,name,audio=false,datagram=false)=>{
      if(opening)return;opening=true;const epoch=generation;
      try{
        say("Opening network media…");
        const grant=datagram?await bridge.networkDatagramGrant(address):await bridge.networkGrant(serverId,address);
        if(!dlg.open||epoch!==generation){void bridge.networkRelease(grant.token).catch(()=>{});return;}
        const item=makeNetworkItem(grant,name,audio);if(datagram)item.liveChannel=true;
        if(queueOnly.checked){
          state.queue.push(item);
          if(state.current<0)load(state.queue.length-1,false);else{renderQueue();updateButtons();}
        }
        else{
          const index=state.current<0?state.queue.length:state.current+1;
          state.queue.splice(index,0,item);load(index,true);
        }
        settingsDetails.open=false;dlg.close();
      }catch(_){if(dlg.open&&epoch===generation)say("Cannot open network media.");}
      finally{opening=false;}
    };
    const showServers=async()=>{
      const epoch=++generation;results.replaceChildren();say("Searching for media servers…");
      try{
        const servers=await bridge.networkDiscover();
        if(!dlg.open||epoch!==generation)return;
        say(servers.length?"Choose a media server.":"No DLNA media servers found.");
        for(const server of servers){
          let label;try{label=new URL(server.location).host;}catch(_){continue;}
          const button=makeButton(label,()=>void openServer(server));
          results.append(button);
        }
        // Fetch display names in bounded parallel groups, never delaying
        // the initial clickable addresses.
        const buttons=Array.from(results.children);
        for(let start=0;start<servers.length;start+=3){
          if(!dlg.open||epoch!==generation)break;
          await Promise.all(servers.slice(start,start+3).map(async(server,i)=>{
            try{
              const info=await bridge.networkDescription(server.id);
              const name=first(parse(info.xml),"friendlyName");
              const button=buttons[start+i];
              if(name&&button&&dlg.open&&epoch===generation)button.textContent=name.slice(0,180)+" ("+new URL(server.location).host+")";
            }catch(_){}
          }));
        }
      }catch(_){if(dlg.open&&epoch===generation)say("Network discovery failed.");}
    };
    const openServer=async (server,provided=null)=>{
      const epoch=++generation;results.replaceChildren();say("Reading media server…");
      try{
        const info=provided||await bridge.networkDescription(server.id);
        if(!dlg.open||epoch!==generation)return;
        const description=parse(info.xml);
        const service=nodes(description,"service").find(s=>/^urn:schemas-upnp-org:service:ContentDirectory:[1-4]$/.test(first(s,"serviceType")));
        if(!service)throw Error("ContentDirectory unavailable");
        const base=first(description,"URLBase")||info.location;
        const control=new URL(first(service,"controlURL"),base).href;
        const ctx={id:server.id,control,type:first(service,"serviceType"),base,name:first(description,"friendlyName")||new URL(info.location).host};
        await browse(ctx,[{id:"0",name:ctx.name}],0);
      }catch(_){if(dlg.open&&epoch===generation){say("Cannot read this media server.");results.append(makeButton("Back to servers",()=>void showServers()));}}
    };
    const browse=async(ctx,trail,start,query=null,previousOffsets=[])=>{
      const epoch=++generation;results.replaceChildren();say("Loading media folder…");
      const folder=trail[trail.length-1];
      try{
        const soap=parse(await bridge.networkBrowse(ctx.id,ctx.control,ctx.type,folder.id,start,query));
        const result=first(soap,"Result");
        const doc=parse(result);
        if(!dlg.open||epoch!==generation)return;
        say(folder.name);
        const searchBox=document.createElement("input");searchBox.type="search";searchBox.maxLength=150;
        searchBox.value=query||"";searchBox.placeholder=translate("Search media titles");
        searchBox.setAttribute("aria-label",translate("Search media titles"));
        const search=()=>{const value=searchBox.value.trim();if(value)void browse(ctx,trail,0,value);};
        searchBox.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();search();}});
        results.append(searchBox,makeButton("Search media titles",search));
        if(query!==null)results.append(makeButton("Clear search",()=>void browse(ctx,trail,0)));
        results.append(makeButton(trail.length>1?"Parent folder":"Back to servers",()=>trail.length>1?void browse(ctx,trail.slice(0,-1),0):void showServers()));
        const page=[],seenAddresses=new Set();
        for(const element of Array.from(doc.documentElement.children).slice(0,100)){
          const id=element.getAttribute("id"),name=first(element,"title").slice(0,250)||translate("Untitled");
          if(element.localName==="container"&&id!==null){
            results.append(makeButton("▸ "+name,()=>void browse(ctx,[...trail,{id,name}],0)));continue;
          }
          if(element.localName!=="item")continue;
          const cls=first(element,"class");
          if(!/^object\.item\.(videoItem|audioItem)/i.test(cls))continue;
          // DLNA items may offer several renditions. Prefer a resource
          // Chromium reports as playable, never cross the server host.
          const resources=nodes(element,"res").flatMap(r=>{
            const match=/^http-get:[^:]*:((?:video\/|audio\/|application\/octet-stream)[^:]*):/i.exec(r.getAttribute("protocolInfo")||"");
            if(!match||!r.textContent.trim())return [];
            try{
              const url=new URL(r.textContent.trim(),ctx.base);
              if(!["http:","https:"].includes(url.protocol)||url.hostname!==new URL(ctx.control).hostname||url.username||url.password||url.hash)return [];
              const support=media.canPlayType(match[1]);
              return [{address:url.href,rank:support==="probably"?2:support==="maybe"?1:0}];
            }catch(_){return [];}
          }).sort((a,b)=>b.rank-a.rank);
          if(!resources.length)continue;
          const address=resources[0].address,audio=/audioItem/i.test(cls);
          if(!seenAddresses.has(address)){page.push({address,name,audio});seenAddresses.add(address);}
          results.append(makeButton("▶ "+name,()=>void addNetwork(ctx.id,address,name,audio)));
        }
        if(page.length)results.prepend(makeButton("Add this page to queue",()=>void queuePage(ctx.id,page)));
        const count=Number(first(soap,"NumberReturned")),total=Number(first(soap,"TotalMatches"));
        if(start>0)results.append(makeButton("Previous page",()=>void browse(ctx,trail,previousOffsets.at(-1)??0,query,previousOffsets.slice(0,-1))));
        if(Number.isInteger(count)&&count>0&&count<=100&&Number.isFinite(total)&&start+count<total)results.append(makeButton("Next page",()=>void browse(ctx,trail,start+count,query,[...previousOffsets,start])));
      }catch(_){if(dlg.open&&epoch===generation){say(query===null?"Cannot read this media folder.":"This server could not search media titles.");if(query!==null)results.append(makeButton("Clear search",()=>void browse(ctx,trail,0)));results.append(makeButton("Back to servers",()=>void showServers()));}}
    };
    const direct=makeButton("Open network URL",()=>{
      try{
        const value=url.value.trim();
        if(/^(udp|rtp):\/\//i.test(value)){
          if(!bridge.networkDatagramGrant)throw Error("Receiver unavailable");
          void addNetwork(null,value,value.slice(0,100),false,true);return;
        }
        const address=new URL(value);
        if(!["http:","https:"].includes(address.protocol)||address.username||address.password||address.hash)throw Error("Unsupported address");
        const name=decodeURIComponent(address.pathname.split("/").filter(Boolean).pop()||address.host);
        void addNetwork(null,address.href,name,/\.(mp3|flac|wav|m4a|aac|opus|ogg)$/i.test(name));
      }catch(_){say("Enter a valid network media URL.");}
    });
    const manual=makeButton("Connect to media server",async()=>{
      if(!bridge.networkRegister)return;
      const epoch=++generation;results.replaceChildren();say("Reading media server…");
      try{
        const server=await bridge.networkRegister(serverURL.value.trim());
        if(dlg.open&&epoch===generation)await openServer(server,server);
      }catch(_){if(dlg.open&&epoch===generation)say("Cannot read this media server.");}
    });
    const discover=makeButton("Find DLNA servers",()=>void showServers());
    const close=makeButton("Close",()=>dlg.close());
    dlg.append(heading,note,discover);
    if(bridge.networkRegister)dlg.append(serverURL,manual);
    dlg.append(url,direct,queueLabel,message,results,close);
    document.body.append(dlg);
    const open=()=>{if(!dlg.open){results.replaceChildren();say("");dlg.showModal();window.DKLocale?.apply();}};
    dlg.addEventListener("close",()=>{generation++;results.replaceChildren();});
    byId("openEmpty").after(makeButton("Network media…",open));
    const section=document.createElement("section");section.className="player-settings-section dk-picture-settings";
    section.id="networkSettings";
    section.append(makeButton("Network media…",open));
    const bufferLabel=document.createElement("label"),bufferText=document.createElement("span"),bufferSelect=document.createElement("select");
    bufferSelect.id="networkBufferMode";bufferLabel.append(bufferText,bufferSelect);
    const qualityLabel=document.createElement("label"),qualityText=document.createElement("span"),qualitySelect=document.createElement("select");
    qualitySelect.id="networkStreamQuality";qualityLabel.append(qualityText,qualitySelect);
    const statsLabel=document.createElement("label"),statsCheck=document.createElement("input"),statsText=document.createElement("span");statsCheck.type="checkbox";statsCheck.id="networkStreamStats";statsCheck.checked=streamPrefs.stats;statsLabel.append(statsCheck,statsText);
    const bufferOptions=[["auto","Automatic (adaptive)","Автоматически (адаптивно)"],["1","1 s · Low latency","1 с · Малая задержка"],["3","3 s","3 с"],["5","5 s · Balanced","5 с · Сбалансировано"],["10","10 s · Stable","10 с · Стабильно"],["20","20 s","20 с"],["30","30 s · Unstable connection","30 с · Нестабильное соединение"]];
    const qualityOptions=[["auto","Automatic (HLS)","Автоматически"],["source","Original quality","Исходное качество"],["360","Up to 360p","До 360"],["480","Up to 480p","До 480"],["720","Up to 720p","До 720"],["1080","Up to 1080p","До 1080"]];
    const bufferNote=document.createElement("p");bufferNote.className="helper";
    const translateStream=()=>{
      bufferText.textContent=streamSay("Network buffer","Сетевой буфер");qualityText.textContent=streamSay("Stream quality","Качество потока");statsText.textContent=streamSay("Show streaming statistics","Показывать статистику потока");
      const options=(node,rows,value)=>{node.replaceChildren(...rows.map(([key,en,ru])=>{const o=document.createElement("option");o.value=key;o.textContent=streamSay(en,ru);return o;}));node.value=value;};
      options(bufferSelect,bufferOptions,streamPrefs.buffer);options(qualitySelect,qualityOptions,streamPrefs.quality);
      bufferNote.textContent=streamSay("Buffer targets depend on the source. Automatic quality can switch during compatible HLS playback; manual quality takes effect on reconnect.","Размер буфера зависит от источника. Автоматическое качество может меняться во время совместимого воспроизведения; ручной выбор применяется при повторном подключении.");
    };
    bufferSelect.addEventListener("change",()=>{streamPrefs.buffer=bufferSelect.value;write(streamPrefsKey,streamPrefs);if(bufferGate)bufferGate.target=bufferTarget(current());});
    qualitySelect.addEventListener("change",()=>{streamPrefs.quality=qualitySelect.value;write(streamPrefsKey,streamPrefs);});
    statsCheck.addEventListener("change",()=>{streamPrefs.stats=statsCheck.checked;write(streamPrefsKey,streamPrefs);if(statsNode&&!streamPrefs.stats)statsNode.hidden=true;});
    translateStream();new MutationObserver(translateStream).observe(document.documentElement,{attributes:true,attributeFilter:["lang"]});
    section.append(bufferLabel,qualityLabel,statsLabel,bufferNote);byId("playerSettingsPanel").append(section);
    window.DKLibraryBridge.onOpenMediaTool?.(kind=>{if(kind==="network"){deferStartup=false;settingsDetails.open=false;open();}});
    if(bridge.liveTvLineup&&bridge.liveTvGrant){
      const tv=document.createElement("dialog");tv.className="dk-dvd-dialog dk-network-dialog dk-live-tv-dialog";
      const title=document.createElement("strong");title.textContent="Live TV";
      const hint=document.createElement("p");hint.className="helper";hint.textContent="Enter the local IPv4 address of your HDHomeRun tuner.";
      const host=document.createElement("input");host.type="text";host.placeholder="192.168.1.10";host.setAttribute("aria-label","Tuner address");
      const status=document.createElement("p");status.className="helper";status.setAttribute("role","status");
      const channels=document.createElement("div");channels.className="dk-network-results";
      let revision=0,busy=false;
      const report=msg=>{status.textContent=msg;window.DKLocale?.apply();};
      const scan=makeButton("Load channels",async()=>{
        if(busy)return;busy=true;scan.disabled=true;channels.replaceChildren();
        const epoch=++revision;filter.value="";report("Loading channels…");
        try{
          const rows=await bridge.liveTvLineup(host.value.trim());
          if(!tv.open||epoch!==revision)return;
          report(rows.length?"Choose a channel.":"No compatible channels found.");
          for(const row of rows){
            const b=makeButton(row.number+" "+row.name,async()=>{
              if(busy)return;busy=true;scan.disabled=true;report("Opening channel…");
              const selected=revision;let grant=null;
              try{
                grant=await bridge.liveTvGrant(row.id);
                if(!tv.open||selected!==revision)return;
                const item=makeNetworkItem(grant,row.number+" "+row.name,false);
                const index=state.current<0?state.queue.length:state.current+1;
                state.queue.splice(index,0,item);grant=null;load(index,true);tv.close();
              }catch(_){if(tv.open&&selected===revision)report("Cannot open channel.");}
              finally{if(grant)void bridge.networkRelease(grant.token).catch(()=>{});busy=false;scan.disabled=false;}
            });
            channels.append(b);
          }
        }catch(_){if(tv.open&&epoch===revision)report("Cannot load tuner channels.");}
        finally{busy=false;scan.disabled=false;}
      });
      const devices=document.createElement("div");devices.className="dk-network-results";
      const discover=makeButton("Find TV tuners",async()=>{
        if(busy)return;busy=true;scan.disabled=true;discover.disabled=true;
        const epoch=++revision;devices.replaceChildren();channels.replaceChildren();report("Searching for TV tuners…");
        try{
          const rows=await bridge.liveTvDiscover();
          if(!tv.open||epoch!==revision)return;
          report(rows.length?"Choose a TV tuner.":"No TV tuners found. Enter the address manually.");
          for(const row of rows){
            devices.append(makeButton("HDHomeRun "+row.id+" ("+row.host+")",()=>{
              if(busy)return;host.value=row.host;scan.click();
            }));
          }
        }catch(_){if(tv.open&&epoch===revision)report("Tuner discovery failed.");}
        finally{busy=false;scan.disabled=false;discover.disabled=false;}
      });
      discover.hidden=!bridge.liveTvDiscover;
      const filter=document.createElement("input");filter.type="search";filter.setAttribute("aria-label","Search channels");filter.placeholder="Search channels";
      filter.addEventListener("input",()=>{
        const query=filter.value.trim().toLocaleLowerCase();
        for(const button of channels.children)button.hidden=!button.textContent.toLocaleLowerCase().includes(query);
      });
      const localDevices=document.createElement("div");localDevices.className="dk-network-results";
      const local=makeButton("Find USB and internal TV tuners",async()=>{
        if(busy)return;busy=true;local.disabled=true;localDevices.replaceChildren();
        const epoch=revision;report("Checking local TV tuners…");
        try{
          const rows=await bridge.liveTvLocalTuners();
          if(!tv.open||epoch!==revision)return;
          report(rows.length?"Local TV tuners found. Channel scanning is not yet available.":"No local TV tuners found.");
          for(const row of rows){
            const p=document.createElement("p");
            p.textContent=(row.name||"DVB")+" "+row.adapter+":"+row.frontend+" · "+translate(row.accessible?"Device accessible":"Device permission required");
            localDevices.append(p);
          }
        }catch(_){if(tv.open&&epoch===revision)report("Cannot inspect local TV tuners.");}
        finally{busy=false;local.disabled=false;}
      });
      local.hidden=!bridge.liveTvLocalTuners;
      const close=makeButton("Close",()=>tv.close());
      for(const [button,action] of [[discover,"discover"],[scan,"load"],[local,"local"],[close,"close"]])button.dataset.liveAction=action;
      tv.append(title,hint,discover,devices,host,scan,local,localDevices,status,filter,channels,close);
      document.body.append(tv);
      tv.addEventListener("close",()=>{revision++;channels.replaceChildren();devices.replaceChildren();localDevices.replaceChildren();filter.value="";});
      bridge.onOpenMediaTool?.(kind=>{
        if(kind!=="live-tv")return;
        deferStartup=false;settingsDetails.open=false;
        if(!tv.open){report("");tv.showModal();window.DKLocale?.apply();}
      });
    }
    window.DKLocale?.apply();
  }
  // Frame stepping uses actual source presentation timestamps. Pause before
  // seeking; do not substitute guessed 24/30-fps offsets when unavailable.
  let stepFrame=null;
  if(window.DKLibraryBridge?.internalPages&&settingsDetails){
    const section=document.createElement("section");
    section.className="player-settings-section dk-frame-settings";
    const title=document.createElement("strong");title.textContent="Frame navigation";
    const row=document.createElement("div");row.className="dk-frame-buttons";
    const previous=document.createElement("button"),next=document.createElement("button");
    previous.type=next.type="button";
    previous.className=next.className="btn small";
    previous.textContent="Previous frame";next.textContent="Next frame";
    row.append(previous,next);
    const note=document.createElement("p");note.className="helper";
    note.textContent="Frame navigation pauses playback and uses source frame timestamps. Decoder support is required.";
    section.append(title,row,note);
    const picture=byId("pictureEnhancements");
    if(picture)picture.after(section);else byId("playerSettingsPanel").append(section);
    let busy=false;
    const refresh=()=>{
      const item=current();
      previous.disabled=next.disabled=busy||!localCodecBridge?.adjacentFrame||!item?.file||item.file.dvdToken||item.audio||
        state.stopped||!Number.isFinite(playbackDuration())||playbackDuration()<=0||!media.videoWidth;
    };
    stepFrame=async direction=>{
      refresh();
      if(previous.disabled||busy)return;
      const item=current(),epoch=item.playbackEpoch;
      media.pause();
      keepControlsVisible();
      const at=playbackSeconds(),source=media.currentSrc;
      busy=true;refresh();
      try{
        const result=await localCodecBridge.adjacentFrame(item.file,at,direction);
        if(current()!==item||item.playbackEpoch!==epoch||state.stopped||
           !media.paused||media.currentSrc!==source||Math.abs(playbackSeconds()-at)>0.001)return;
        if(!result||!Number.isFinite(result.target)||!Number.isFinite(result.sample)){
          status("No adjacent frame found.");return;
        }
        const target=Math.max(0,result.target);
        if(codecPlayback?.isActive(item)){
          const started=await codecPlayback.seek(item,target,{frameStep:true});
          if(!started||current()!==item||state.stopped)return;
        }else{
          // Land just inside the chosen presentation interval rather than
          // on a rounding-sensitive boundary.
          media.currentTime=Math.min(result.sample,Math.max(0,playbackDuration()-0.000001));
        }
        if(current()===item&&!state.stopped){updateTime();revealControls();}
      }catch(_){
        if(current()===item&&!state.stopped)status("Frame navigation unavailable for this video.");
      }finally{busy=false;refresh();}
    };
    previous.addEventListener("click",()=>void stepFrame(-1));
    next.addEventListener("click",()=>void stepFrame(1));
    for(const event of ["loadedmetadata","loadeddata","emptied","durationchange","seeked","playing","pause","error"])
      media.addEventListener(event,refresh);
    settingsDetails.addEventListener("toggle",refresh);
    byId("stop").addEventListener("click",()=>queueMicrotask(refresh));
    refresh();
    window.DKLocale?.apply();
  }
  let hideControlsTimer = null;
  let menuOpen = false;
  let cursorIdleTimer = null;
  let controlPointer=null,keyboardControlFocus=false;
  // Standalone: a paused picture is still a displayed movie. Mouse focus
  // left on a button after a click is not an active control interaction.
  const idleEligible=()=>Boolean(current()&&!state.stopped&&!media.ended&&
    !screen.classList.contains("empty"));
  const idleBlocked=()=>menuOpen||settingsDetails?.open||!infoPanel.hidden||
    (!standaloneChapters&&!chapterPicker.hidden)||controlPointer!==null||
    (keyboardControlFocus&&controls.contains(document.activeElement));
  const revealControls = () => {
    screen.classList.remove("ui-hidden");
    clearTimeout(hideControlsTimer);
    if(standaloneChapters){
      clearTimeout(cursorIdleTimer);
      screen.classList.remove("cursor-hidden");
      if(!idleEligible()||idleBlocked())return;
      hideControlsTimer=setTimeout(()=>{
        if(!idleEligible()||idleBlocked())return;
        screen.classList.add("ui-hidden");
        if(screen.matches(":hover"))screen.classList.add("cursor-hidden");
      },3000);
      return;
    }
    // Retain the hosted edition's original playback-only policy.
    if (!media.paused && current() && !menuOpen &&
        !settingsDetails?.open) {
      hideControlsTimer = setTimeout(() => {
        if (controls.matches(":hover") || controls.contains(document.activeElement) ||
            !infoPanel.hidden || menuOpen || settingsDetails?.open ||
            media.paused) {
          revealControls();
          return;
        }
        screen.classList.add("ui-hidden");
      },2700);
    }
  };
  const keepControlsVisible = () => {
    clearTimeout(hideControlsTimer);
    screen.classList.remove("ui-hidden");
    if(standaloneChapters){
      clearTimeout(cursorIdleTimer);
      screen.classList.remove("cursor-hidden");
    }
  };
  settingsDetails?.addEventListener("toggle",()=>{
    if(settingsDetails.open)keepControlsVisible();
    else revealControls();
  });
  screen.addEventListener("pointermove", revealControls);
  screen.addEventListener("pointerleave", () => {
    if(standaloneChapters){
      screen.classList.remove("cursor-hidden");
      revealControls();
    }else if (!media.paused && current() && !menuOpen) revealControls();
  });
  // The standalone edition shares one inactivity timer for both layers.
  // Hosted cursor behavior remains unchanged.
  const showCursor = () => {
    if(standaloneChapters){revealControls();return;}
    screen.classList.remove("cursor-hidden");
    clearTimeout(cursorIdleTimer);
    if (!current() || menuOpen || !infoPanel.hidden) return;
    cursorIdleTimer = setTimeout(() => {
      if (!current() || menuOpen || !infoPanel.hidden ||
          !screen.matches(":hover") || controls.matches(":hover") ||
          controls.contains(document.activeElement)) return;
      screen.classList.add("cursor-hidden");
    }, 3000);
  };
  if(standaloneChapters){
    screen.addEventListener("pointerenter",revealControls);
    document.addEventListener("pointerdown",event=>{
      keyboardControlFocus=false;
      if(controls.contains(event.target))controlPointer=event.pointerId;
      if(screen.contains(event.target))revealControls();
    },true);
    const releaseControl=event=>{
      if(controlPointer!==event.pointerId)return;
      controlPointer=null;
      revealControls();
    };
    window.addEventListener("pointerup",releaseControl,true);
    window.addEventListener("pointercancel",releaseControl,true);
    window.addEventListener("blur",()=>{
      controlPointer=null;keyboardControlFocus=false;revealControls();
    });
    document.addEventListener("keydown",event=>{
      if(event.key==="Tab"||controls.contains(event.target)){
        keyboardControlFocus=true;revealControls();
      }
    },true);
    controls.addEventListener("focusin",revealControls);
    controls.addEventListener("focusout",()=>queueMicrotask(revealControls));
    media.addEventListener("loadeddata",revealControls);
  }else{
    screen.addEventListener("pointermove", showCursor);
    screen.addEventListener("pointerenter", showCursor);
    screen.addEventListener("pointerdown", showCursor);
    screen.addEventListener("pointerleave", () => {
      clearTimeout(cursorIdleTimer);
      screen.classList.remove("cursor-hidden");
    });
    controls.addEventListener("focusin", keepControlsVisible);
    controls.addEventListener("focusout", revealControls);
  }
  document.addEventListener("fullscreenchange", showCursor);
  media.addEventListener("pause",()=>{if(window.DKLibraryBridge?.internalPages)rememberPosition();});
  for (const eventName of ["play", "pause", "ended", "emptied"]) {
    media.addEventListener(eventName, () => {
      if(standaloneChapters){
        if(eventName==="ended"||eventName==="emptied"||!idleEligible())keepControlsVisible();
        else revealControls();
      }else if (media.paused || media.ended || !current()) keepControlsVisible();
      else revealControls();
    });
  }
  byId("playPause").addEventListener("click", togglePlayback);
  // Wait briefly before treating a video click as play/pause. Otherwise the
  // first click of a double-click pauses the film just before fullscreen.
  let pendingVideoClick = null;
  const cancelVideoClick = () => {
    if (pendingVideoClick !== null) {
      clearTimeout(pendingVideoClick);
      pendingVideoClick = null;
    }
  };
  media.addEventListener("click", event => {
    if (!current()) return;
    revealControls();
    if (event.detail > 1) { cancelVideoClick(); return; }
    cancelVideoClick();
    pendingVideoClick = setTimeout(() => {
      pendingVideoClick = null;
      togglePlayback();
    }, 330);
  });
  const stopCurrent = () => {
    cancelNextCountdown();resetVoiceover();cancelNetworkRetry();
    if (seekPreview) seekPreview.reset();
    const item = current();
    if (!item) return;
    cancelVideoClick();
    const preserveLibraryPosition=Boolean(window.DKLibraryBridge?.internalPages);
    if(preserveLibraryPosition)rememberPosition();
    state.stopped = true;
    resetTVBuffer(item);refreshLiveControls();
    resetTranslation();
    media.pause();
    if(codecPlayback?.isActive(item)||item.networkStarting) {
      item.networkStarting=false;
      item.codecRestart=true;
      void codecPlayback.stop();
    }
    if(item.remuxAbort){
      item.remuxAbort.abort();
      item.remuxAbort=null;
    }
    if (mkvAudio) mkvAudio.stop();
    if(!preserveLibraryPosition){
      delete state.resume[item.key];
      write(store.resume,state.resume);
      if(item.libraryId&&window.DKLibraryStore)
        void window.DKLibraryStore.updateProgress(item.libraryId,0,playbackDuration(),false).catch(()=>{});
    }
    try { media.currentTime = 0; } catch (_) {}
    screen.classList.add("empty", "stopped");
    syncPgsOverlay();
    screen.classList.remove("audio", "ui-hidden", "cursor-hidden");
    byId("emptyTitle").textContent = "Stopped";
    byId("emptyDescription").textContent = "Press the red Play button to restart this movie.";
    updateChapterMarkers();
    keepControlsVisible();
    updateButtons();
    updateTime();
  };
  byId("stop").addEventListener("click", stopCurrent);
  byId("previous").addEventListener("click", () => {
    if (state.current<0) return;
    const previous = state.current===0 && playbackOrder.loop==="all"
      ? state.queue.length-1 : state.current-1;
    load(previous);
  });
  byId("next").addEventListener("click", () => {
    if (state.current<0) return;
    const next = state.current===state.queue.length-1 && playbackOrder.loop==="all"
      ? 0 : state.current+1;
    load(next);
  });
  const skipTen = delta => {
    const length=playbackDuration();
    if(!current()||state.stopped||!Number.isFinite(length)||length<=0)return;
    setPlaybackPosition(Math.max(0,Math.min(length,playbackSeconds()+delta)));
    updateTime();
  };
  byId("rewind10").addEventListener("click", () => skipTen(-10));
  byId("forward10").addEventListener("click", () => skipTen(10));
  byId("seek").addEventListener("input", event => {
    const length=playbackDuration();
    if(!Number.isFinite(length)||length<=0)return;
    if(!codecPlayback?.isActive(current()))
      setPlaybackPosition(length*Number(event.target.value)/1000);
    else byId("currentTime").textContent=
      time(length*Number(event.target.value)/1000);
  });
  // Restart a native-transcoded stream only after the user releases the
  // seek bar, not continuously for each thumb movement.
  byId("seek").addEventListener("change",event=>{
    if(codecPlayback?.isActive(current())){
      const length=playbackDuration();
      if(Number.isFinite(length)&&length>0)
        setPlaybackPosition(length*Number(event.target.value)/1000);
    }
  });
  media.addEventListener("loadedmetadata", () => {
    const item = current();
    if (!item) return;
    applySubtitlePreference();
    restoreAudioPreference();
    if (state.stopped) { updateTime(); return; }
    item.historyReady=true;
    if(item.kind==="network"&&item.networkResume>0&&!codecPlayback?.isActive(item)){
      const at=item.networkResume;item.networkResume=0;
      if(Number.isFinite(media.duration)&&at<media.duration){try{media.currentTime=at;}catch(_){}}
    }
    if(codecPlayback?.isActive(item)) {
      // The stream has already been started at the original source time.
      updateTime();updateChapterMarkers();return;
    }
    const position = Number(state.resume[item.key] || 0);
    if (position > 2 && Number.isFinite(media.duration) && position < media.duration - 4) {
      try { media.currentTime = position; } catch (_) {}
    }
    updateTime();
    updateChapterMarkers();
  });
  media.addEventListener("timeupdate", () => {
    sampleWatchTime();
    const item=current();
    if(item?.kind==="network"&&!state.stopped&&!media.seeking&&media.readyState>=2){
      const at=playbackSeconds(),duration=playbackDuration();
      if(Number.isFinite(at))item.networkLastPosition=at;
      if(Number.isFinite(duration)&&duration>0)item.networkKnownDuration=duration;
    }
    if(item?.sourceVideoExpected&&item.file&&item.requestedFormat==="auto"&&
       !state.stopped&&!media.paused&&!media.seeking&&!item.codecAttempted&&
       !item.deinterlacePending&&!codecPlayback?.isActive(item)&&
       media.readyState>=2&&media.currentTime>1&&!media.videoWidth){
      // Audio-only success never fires the media error handler.
      const at=media.currentTime;
      void tryNativeCodec(item,at).then(ok=>{if(!ok&&current()===item)status("Video decoder unavailable for this file.");});
      return;
    }
    updateTime();
    syncPgsOverlay();
    const now = Date.now();
    if (now - state.lastResumeSave > 5000) {
      state.lastResumeSave = now;
      rememberPosition();
    }
  });
  for (const eventName of ["play", "pause", "ended", "emptied"]) media.addEventListener(eventName, updateButtons);
  media.addEventListener("durationchange",()=>{updateTime();updateChapterMarkers();});
  media.addEventListener("loadeddata", updateChapterMarkers);
  if(media.textTracks && typeof media.textTracks.addEventListener==="function")
    media.textTracks.addEventListener("addtrack",()=>setTimeout(updateChapterMarkers,0));
  media.addEventListener("loadeddata", applySubtitlePreference);
  // Register lazily: restoreAudioPreference is defined later in this module.
  media.addEventListener("loadeddata", () => restoreAudioPreference());
  // Stop old buffered audio during a seek. Re-prime after the media
  // element reaches its final destination, avoiding repeated decode
  // restarts while the user drags the timeline.
  media.addEventListener("seeking", () => { if (mkvAudio) mkvAudio.hold(); });
  media.addEventListener("seeked", () => { if (mkvAudio) mkvAudio.restart(); });
  media.addEventListener("ratechange", () => { if (mkvAudio) mkvAudio.restart(); });
  if (media.audioTracks && typeof media.audioTracks.addEventListener === "function") {
    // Audio tracks can become available after the metadata event.
    media.audioTracks.addEventListener("addtrack", () => setTimeout(restoreAudioPreference,0));
  }
  for (const event of ["seeked","loadedmetadata","resize"])
    media.addEventListener(event,syncPgsOverlay);
  window.addEventListener("resize",syncPgsOverlay);
  // Same media element and controls in both docked and movable modes.
  const playerWindow = window.DKPlayerWindow?.attach({
    screen,button:byId("floatPlayer"),onResize:syncPgsOverlay
  });
  if (media.textTracks && typeof media.textTracks.addEventListener === "function") {
    media.textTracks.addEventListener("addtrack", () => setTimeout(applySubtitlePreference, 0));
    media.textTracks.addEventListener("removetrack", () => setTimeout(applySubtitlePreference, 0));
  }
  media.addEventListener("playing",()=>{const item=current();if(item?.liveChannel&&!["udp","rtp"].includes(item.networkTransport)&&!item.tvReplay&&!item.tvConfirmed&&!item.streamBuffering){item.tvConfirmed=true;void window.DKLibraryBridge?.liveTvPlayed?.(item.networkToken).catch(()=>{});}});
  media.addEventListener("ended", () => {
    const completed = current();
    if (!completed) return;
    if(completed.liveChannel){if(completed.tvReplay){returnToLive(completed);return;}if(!recoverNetwork(completed,true))status(networkErrorText(completed));return;}
    if(completed.kind==="network"&&completed.networkKnownDuration>0&&playbackSeconds()+5<completed.networkKnownDuration){
      if(!recoverNetwork(completed))status("Network stream ended unexpectedly.");
      return;
    }
    rememberPosition();
    // A completed movie has no unfinished position to resume.
    saveLibraryProgress(completed,playbackDuration(),playbackDuration(),true);
    delete state.resume[completed.key];
    write(store.resume, state.resume);
    if (playbackOrder.loop === "one") {
      state.stopped = false;
      if(codecPlayback?.isActive(completed)) {
        void codecPlayback.start(completed,0,true,
          ["mp4","webm"].includes(completed.requestedFormat)?
          completed.requestedFormat:"auto",
          completed.codecAudioIndex||0);
      }else{
        try { media.currentTime = 0; } catch (_) {}
        const restarted = media.play();
        if (restarted?.catch) restarted.catch(()=>status("Couldn't restart video."));
      }
    } else if (playbackOrder.loop === "all") {
      const next=state.queue[(state.current+1)%state.queue.length];
      if(next===completed)load(state.current,true);else scheduleNextCountdown(next);
    } else if (playbackSettings.removeWatched) {
      const previousIndex = state.current;
      state.queue.splice(previousIndex, 1);
      // Detach the completed source before revoking the old object URL.
      // Preserve the order of remaining movies; never replay past items.
      const next=state.queue[previousIndex];
      if(window.DKLibraryBridge?.internalPages){
        if(codecPlayback?.isActive(completed))void codecPlayback.stop();
        state.current=-1;idle();
        if(next)scheduleNextCountdown(next);
      }else{
        state.current=-1;
        if(next)load(previousIndex,true);else idle();
      }
      releaseArtwork(completed);
      releaseCompatible(completed);
      releaseNetwork(completed);
      if (completed.kind === "file") URL.revokeObjectURL(completed.src);
    } else if (state.current < state.queue.length - 1) {
      scheduleNextCountdown(state.queue[state.current+1]);
    } else {
      updateButtons();
      renderQueue();
    }
  });
  media.addEventListener("error", () => {
    if (!current() || !media.error || state.stopped) return;
    const code = media.error.code;
    const item=current();
    if(item.kind==="network"){
      if(item.networkStarting||networkRetryTimer!==null)return;
      if(!codecPlayback?.isActive(item)&&!item.codecAttempted&&item.requestedFormat!=="original"&&codecPlayback&&[3,4].includes(code)){
        const epoch=item.playbackEpoch;
        void startNetworkDecoder(item,Math.max(0,Number(item.networkLastPosition)||0)).then(ok=>{
          if(!ok&&current()===item&&item.playbackEpoch===epoch&&!state.stopped){
            if(!recoverNetwork(item,true))status(networkErrorText(item));
          }
        });
      }else if(!recoverNetwork(item))status(networkErrorText(item));
      updateButtons();return;
    }
    if(item.deinterlacePending&&!codecPlayback?.isActive(item))return;
    if(codecPlayback?.isActive(item)){
      if(dvdSubOn(item)){
        const at=playbackSeconds();
        item.dvdSubtitleIndex=-1;
        void codecPlayback.start(item,at,Boolean(item.autoplayRequested),item.nativeOutputFormat||"auto",item.codecAudioIndex||0).then(ok=>{
          if(current()===item){updateSubtitleStatus();status(ok?"DVD subtitles unavailable; restored playback without subtitles.":"Included decoder output could not be played.");}
        });
        return;
      }
      if(item.activeSmoothing&&item.smoothingMode!=="off"){
        const at=playbackSeconds();
        item.smoothingMode="off";item.activeSmoothing=0;
        const epoch=item.playbackEpoch;
        void codecPlayback.start(item,at,Boolean(item.autoplayRequested),
          ["mp4","webm"].includes(item.requestedFormat)?item.requestedFormat:"auto",
          item.codecAudioIndex||0).then(ok=>{
          if(!ok&&current()===item&&item.playbackEpoch===epoch)
            status("Included decoder output could not be played.");
        });
        return;
      }
      if(!item.nativeAlternateAttempted&&item.requestedFormat==="auto"){
        void codecPlayback.retryAlternate(item).then(ok=>{if(!ok&&current()===item)status("Included decoder output could not be played.");});
      }else status("Included decoder output could not be played.");
      return;
    }
    if((code===3||code===4)&&item?.file && /\.mkv$/i.test(item.name) &&
       !item.compatAttempted && item.requestedFormat !== "original" &&
       (window.DKMkvWebM||window.DKMkvMP4)){
      if(item.mkvInspection==="pending"){
        item.compatPending=true;
        status("Checking MKV container compatibility…");
        return;
      }
      if(item.requestedFormat === "mp4" || item.requestedFormat === "webm" ||
         window.DKMkvWebM?.eligible(compatibleInfo(item),item.file) ||
         window.DKMkvMP4?.eligible(compatibleInfo(item),item.file)){
        void tryCompatibleFallback(item).then(ok=>{
          if(!ok && current()===item)void tryNativeCodec(item);
        });
        return;
      }
    }
    if((code===3||code===4)&&!item.codecAttempted&&codecPlayback&&
       item.file&&item.requestedFormat!=="original") {
      void tryNativeCodec(item);
      return;
    }
    const mkvVideo = current().embeddedVideo?.[0]?.codec || null;
    const message = code === 4 && mkvVideo ?
      "This MKV video codec is not supported: " + mkvVideo + "." :
      code === 4 ? "This media format could not be decoded." :
      code === 2 ? "The media file couldn't be read." :
      code === 3 ? "This media format could not be decoded." :
      "Unable to play this media source.";
    status(message);
    updateButtons();
  });
  let volumeOverlayTimer = null;
  // Approved standalone range: 0–200%. Do not reduce this without user approval.
  // Hosted web playback retains its original 0–100% behavior.
  const desktopVolume=Boolean(window.DKLibraryBridge?.internalPages||
    typeof window.DKStandalone?.setFullscreen==="function");
  const AudioContextType=window.AudioContext||window.webkitAudioContext;
  const supportsVolumeBoost=desktopVolume&&typeof AudioContextType==="function";
  let volumeLimit=supportsVolumeBoost?200:100;
  const volumeSlider=byId("volume");
  volumeSlider.max=String(volumeLimit);
  // The media element and separately decoded MKV audio use the same EQ
  // topology and preferences. Neutral/bypassed settings retain the original
  // signal path and never impose a stereo downmix merely by enabling EQ.
  const outputKey="dk-kinehall.audio-output.v1";
  const outputModes=["auto","headphones","stereo","surround"];
  const outputStored=desktopVolume?read(outputKey,{}):{};
  const outputPrefs={mode:outputModes.includes(outputStored?.mode)?outputStored.mode:"auto",protect:outputStored?.protect!==false,levels:{}};
  for(const mode of outputModes){const n=outputStored?.levels?.[mode];if(typeof n==="number"&&Number.isFinite(n))outputPrefs.levels[mode]=Math.max(0,Math.min(200,Math.round(n)));}
  const createAudioOutput=(context,gain)=>window.DKAudioOutput?.create(context,gain,()=>outputPrefs);
  const explicitStereo=()=>outputPrefs.mode==="headphones"||outputPrefs.mode==="stereo";
  const eqKey="dk-kinehall.audio-enhancements.v1";
  const eqFrequencies=[31,62,125,250,500,1000,2000,4000,8000,16000];
  const eqPresets={
    flat:[0,0,0,0,0,0,0,0,0,0],
    cinema:[4,3,1,-1,0,2,3,2,1,0],
    speech:[-6,-4,-2,0,2,4,5,3,0,-2],
    rock:[4,3,1,-1,-2,0,2,3,4,3],
    classical:[2,1,0,0,-1,-1,0,1,2,2],
    jazz:[3,2,1,1,0,1,2,1,2,2],
    bass:[6,5,3,1,0,0,0,0,0,0],
    treble:[0,0,0,0,0,1,2,3,4,5],
    headphones:[0,1,0,-1,-1,0,1,1,-1,-2]
  };
  const savedEQ=desktopVolume?(read(eqKey,{})||{}):{};
  const eqClamp=(value,min,max)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Math.round(Number(value)))):0;
  const eq={enabled:desktopVolume&&savedEQ.enabled===true,
    bands:eqFrequencies.map((_,index)=>eqClamp(savedEQ.bands?.[index],-12,12)),
    bass:eqClamp(savedEQ.bass,-12,12),treble:eqClamp(savedEQ.treble,-12,12),
    balance:eqClamp(savedEQ.balance,-100,100),headroom:savedEQ.headroom!==false,
    leveling:desktopVolume&&savedEQ.leveling===true,levelStrength:savedEQ.levelStrength==null?50:eqClamp(savedEQ.levelStrength,0,100),
    dialogue:desktopVolume&&savedEQ.dialogue===true,dialogueStrength:savedEQ.dialogueStrength==null?50:eqClamp(savedEQ.dialogueStrength,0,100)};
  const eqActive=()=>eq.enabled&&(eq.bands.some(Boolean)||eq.bass!==0||eq.treble!==0||eq.balance!==0);
  const dynamicsActive=()=>Boolean(eq.leveling&&eq.levelStrength||eq.dialogue&&eq.dialogueStrength);
  const audioEffectsActive=()=>eqActive()||dynamicsActive();
  const createAudioEffects=(context,input,output=context.destination)=>{
    // Allocate filters lazily, keep the normal gain stage for 0–200%
    // independent, and use a direct connection for neutral settings.
    let filters=null,headroom=null,panner=null,compressor=null,makeup=null,voiceFilters=null,route="";
    const nodes=()=>{
      if(filters)return;
      const make=(type,frequency)=>{
        const node=context.createBiquadFilter();node.type=type;
        node.frequency.value=Math.min(frequency,context.sampleRate*.49);
        return node;
      };
      const bass=make("lowshelf",100),treble=make("highshelf",10000);
      const bands=eqFrequencies.map(frequency=>{
        const node=make("peaking",frequency);node.Q.value=1.4;return node;
      });
      const compensation=context.createGain();
      const stereo=typeof context.createStereoPanner==="function"?context.createStereoPanner():null;
      filters=[bass,...bands,treble];headroom=compensation;panner=stereo;
    };
    const dynamicsNodes=()=>{
      if(eq.leveling&&eq.levelStrength&&!compressor){compressor=context.createDynamicsCompressor();makeup=context.createGain();}
      if(eq.dialogue&&eq.dialogueStrength&&!voiceFilters){
        const low=context.createBiquadFilter();low.type="lowshelf";low.frequency.value=180;
        const presence=context.createBiquadFilter();presence.type="peaking";presence.frequency.value=2200;presence.Q.value=.8;
        const clarity=context.createBiquadFilter();clarity.type="peaking";clarity.frequency.value=3800;clarity.Q.value=1.2;
        voiceFilters=[low,presence,clarity];
      }
    };
    const reconnect=next=>{
      if(next===route)return;
      input.disconnect();
      for(const node of [...(filters||[]),headroom,panner,...(voiceFilters||[]),compressor,makeup])if(node)node.disconnect();
      let tail=input;
      const append=node=>{tail.connect(node);tail=node;};
      if(eqActive()){
        for(const node of filters)append(node);
        append(headroom);
      }
      if(eq.dialogue&&eq.dialogueStrength)for(const node of voiceFilters)append(node);
      if(eq.leveling&&eq.levelStrength){append(compressor);append(makeup);}
      if(eqActive()&&eq.balance!==0&&panner)append(panner);
      tail.connect(output);route=next;
    };
    const apply=()=>{
      window.DKAudioOutput?.setChannels(input,outputPrefs.mode);
      if(!audioEffectsActive()){reconnect("direct");return;}
      dynamicsNodes();
      if(eqActive()){
      nodes();
      const gains=[eq.bass,...eq.bands,eq.treble];
      filters.forEach((node,i)=>{node.gain.value=gains[i];});
      if(panner)panner.pan.value=eq.balance/100;
      // Estimate peak boost of the combined filter response across the
      // audible spectrum. This is optional headroom, not a peak limiter.
      let boost=1;
      if(eq.headroom&&gains.some(value=>value>0)){
        const count=128,frequencies=new Float32Array(count),magnitude=new Float32Array(count),phase=new Float32Array(count),combined=new Float32Array(count).fill(1);
        const high=Math.min(22000,context.sampleRate*.49);
        for(let i=0;i<count;i++)frequencies[i]=20*Math.pow(high/20,i/(count-1));
        for(const node of filters){
          node.getFrequencyResponse(frequencies,magnitude,phase);
          for(let i=0;i<count;i++)if(Number.isFinite(magnitude[i]))combined[i]*=magnitude[i];
        }
        for(const value of combined)if(Number.isFinite(value))boost=Math.max(boost,value);
      }
      headroom.gain.value=1/boost;
      }
      if(eq.dialogue&&eq.dialogueStrength){
        const strength=eq.dialogueStrength/100;
        voiceFilters[0].gain.value=-4*strength;
        voiceFilters[1].gain.value=5*strength;
        voiceFilters[2].gain.value=2*strength;
      }
      if(eq.leveling&&eq.levelStrength){
        const strength=eq.levelStrength/100;
        compressor.threshold.value=-12-20*strength;
        compressor.knee.value=18;
        compressor.ratio.value=1+4*strength;
        compressor.attack.value=.012;
        compressor.release.value=.35;
        // Conservative makeup; master gain is downstream. This is dynamic
        // range compression, not measured integrated loudness normalization.
        makeup.gain.value=Math.pow(10,2*strength/20);
      }
      reconnect([eqActive()?"eq":"",eqActive()&&eq.balance!==0&&panner?"stereo":"",eq.dialogue&&eq.dialogueStrength?"voice":"",eq.leveling&&eq.levelStrength?"level":""].join(":"));
    };
    try{apply();}catch(error){
      try{input.disconnect();input.connect(output);route="direct";}catch(_){}
      throw error;
    }
    return {apply};
  };
  let volumeAudioGraph=null;
  const resumeBoost=()=>{
    if(volumeAudioGraph?.context.state==="suspended")
      void volumeAudioGraph.context.resume().catch(()=>{});
  };
  const ensureVolumeBoost=()=>{
    if(volumeAudioGraph)return true;
    if(!supportsVolumeBoost)return false;
    let context=null;
    try{
      context=new AudioContextType();
      const gain=context.createGain();
      const input=context.createGain();
      const output=desktopVolume?createAudioOutput(context,gain):null;
      if(!output)gain.connect(context.destination);
      // Set up output before binding the media source (binding is one-time).
      let effects=null;
      if(desktopVolume){
        try{effects=createAudioEffects(context,input,gain);}catch(_){input.disconnect();input.connect(gain);}
      }else input.connect(gain);
      const source=context.createMediaElementSource(media);
      source.connect(input);
      volumeAudioGraph={context,gain,effects,source,input,output,center:null};
      media.addEventListener("play",resumeBoost);
      resumeBoost();
      return true;
    }catch(_){
      if(context)void context.close().catch(()=>{});
      status("200% volume isn't available with this audio output.");
      return false;
    }
  };
  // Optional stereo mid/side matrix. Side signal is retained; mid gain
  // is reduced. This is NOT a learned dialogue/background separator.
  const setVoiceCenter=factor=>{
    const graph=volumeAudioGraph;
    if(!graph)return false;
    const {context,source,input}=graph;
    if(factor!==null&&!graph.center){
      let direct=null,splitter=null;
      const nodes=[];
      try{
        direct=context.createGain();direct.gain.value=1;
        splitter=context.createChannelSplitter(2);
        // Explicit speakers downmix to stereo only in this optional path.
        const stereo=context.createGain();stereo.channelCount=2;stereo.channelCountMode="explicit";stereo.channelInterpretation="speakers";
        const merger=context.createChannelMerger(2),wet=context.createGain();
        wet.gain.value=0;
        nodes.push(direct,splitter,stereo,merger,wet);
        const gains=[0,1,2,3].map(()=>context.createGain());nodes.push(...gains);
        gains.forEach((g,i)=>{splitter.connect(g,i<2?0:1);g.connect(merger,0,i%2);});
        stereo.connect(splitter);merger.connect(wet);wet.connect(input);direct.connect(input);
        source.connect(direct);source.connect(stereo);source.disconnect(input);
        graph.center={direct,wet,gains,factor:null,active:false};
      }catch(_){
        for(const node of nodes)try{node.disconnect();}catch(_){}
        try{if(direct)source.disconnect(direct);}catch(_){}
        try{source.disconnect();source.connect(input);}catch(_){}
        return false;
      }
    }
    const route=graph.center;
    if(!route)return false;
    const active=factor!==null;
    const value=active?Math.max(0,Math.min(1,factor)):1;
    if(route.active!==active||route.factor!==value){
      const t=context.currentTime;
      const ramp=(node,target)=>{node.gain.cancelScheduledValues(t);node.gain.setTargetAtTime(target,t,.025);};
      const same=(1+value)/2,cross=(value-1)/2;
      [same,cross,cross,same].forEach((v,i)=>ramp(route.gains[i],v));
      ramp(route.direct,active?0:1);ramp(route.wet,active?1:0);
      route.active=active;route.factor=value;
    }
    return active;
  };
  const savedVolumeV2=read(store.volume,null);
  const legacyVolume=Number(read("dkmedia.web.volume.v1",1));
  let volumePercent=savedVolumeV2===null?
    Math.round(legacyVolume*100):Number(savedVolumeV2);
  if(!Number.isFinite(volumePercent))volumePercent=100;
  volumePercent=Math.max(0,Math.min(volumeLimit,Math.round(volumePercent)));
  if(desktopVolume&&Object.hasOwn(outputPrefs.levels,outputPrefs.mode))volumePercent=Math.min(volumeLimit,outputPrefs.levels[outputPrefs.mode]);
  const saveOutputVolume=()=>{if(desktopVolume){outputPrefs.levels[outputPrefs.mode]=volumePercent;write(outputKey,outputPrefs);}};
  const applyVolume = () => {
    const separateAudio=Boolean(mkvAudio?.active());
    if(!separateAudio&&(volumePercent>100||((audioEffectsActive()||explicitStereo())&&current()&&!state.stopped))){
      if(!ensureVolumeBoost()&&volumePercent>100)volumePercent=100;
    }
    const center=setVoiceCenter(separateAudio?null:voiceoverCenterFactor());
    const originalLevel=volumePercent/100*(center?1:voiceoverOriginalFactor());
    media.volume=volumeAudioGraph?1:Math.min(1,originalLevel);
    if(volumeAudioGraph)volumeAudioGraph.gain.gain.value=userMuted||separateAudio?0:originalLevel;
    media.muted=separateAudio||userMuted;
    resumeBoost();
    if(mkvAudio)mkvAudio.setVolume(userMuted?0:originalLevel);
    updateVoiceoverGain();
    volumeSlider.value=String(volumePercent);
    byId("volumeValue").textContent=(userMuted?0:volumePercent)+"%";
    updateButtons();
  };
  const showVolumeOverlay = () => {
    const overlay = byId("volumeOverlay");
    overlay.textContent = "Volume " + (userMuted ? 0 : volumePercent) + "%";
    overlay.classList.add("visible");
    clearTimeout(volumeOverlayTimer);
    volumeOverlayTimer = setTimeout(() => overlay.classList.remove("visible"), 950);
  };
  const setVolume = percent => {
    const next=Math.max(0,Math.min(volumeLimit,Math.round(Number(percent))));
    if (!Number.isFinite(next)) return;
    volumePercent=next;
    userMuted = false;
    applyVolume();
    resumeBoost();
    write(store.volume, volumePercent);saveOutputVolume();
    showVolumeOverlay();
  };
  screen.addEventListener("wheel", event => {
    if (!current() || !event.deltaY || event.defaultPrevented || event.ctrlKey) return;
    // Menus and settings live inside the video screen. Leave their native
    // scrolling alone, including at the top and bottom of a scroll panel.
    if (menuOpen || !contextMenu.hidden || !infoPanel.hidden ||
        settingsDetails?.open || (chapterPicker && !chapterPicker.hidden)) return;
    const target = event.target;
    // Only the actual media surface (including audio art and subtitles)
    // owns the volume gesture; interactive controls and overlays do not.
    if (target !== media && target !== screen &&
        !target?.closest?.(".audio-art,.mkv-pgs-overlay")) return;
    event.preventDefault();
    setVolume(volumePercent + (event.deltaY < 0 ? 5 : -5));
  }, {passive: false});

  // Audio controls remain in the player-bar settings gear, not a new bar.
  if(desktopVolume&&settingsDetails){
    const section=document.createElement("section");
    section.className="player-settings-section dk-audio-settings";
    const local=(en,ru)=>window.DKLocale?.pair(en,ru)??(document.documentElement.lang==="ru"?ru:en);
    const outputTitle=document.createElement("strong");outputTitle.textContent=local("Audio output","Вывод звука");section.append(outputTitle);
    const modeLabel=document.createElement("label");modeLabel.htmlFor="audioOutputMode";modeLabel.textContent=local("Output mode","Режим вывода");
    const modeSelect=document.createElement("select");modeSelect.id="audioOutputMode";
    for(const [value,en,ru] of [["auto","Automatic (system)","Автоматически (система)"],["headphones","Headphones (stereo)","Наушники (стерео)"],["stereo","Stereo speakers","Стереодинамики"],["surround","Surround (system channels)","Объёмный звук (каналы системы)"]]){
      const option=document.createElement("option");option.value=value;option.textContent=local(en,ru);modeSelect.append(option);
    }
    const protect=document.createElement("input");protect.type="checkbox";protect.id="audioPeakProtection";
    const protectLabel=document.createElement("label"),protectText=document.createElement("span");
    protectText.textContent=local("Peak protection for boosted or processed audio","Защита от пиков при усилении или обработке звука");protectLabel.append(protect,protectText);
    const outputNote=document.createElement("p");outputNote.className="helper";
    outputNote.textContent=local("Choose a mode manually. Headphones and stereo speakers use stereo downmixing. Other modes follow system routing. Volume is remembered for each mode. Peak protection reduces clipping inside the player, not hardware distortion.","Выберите режим вручную. Наушники и стереодинамики используют стереосведение. Другие режимы используют системный вывод. Громкость запоминается для каждого режима. Защита уменьшает перегрузку в проигрывателе, но не искажения оборудования.");
    section.append(modeLabel,modeSelect,protectLabel,outputNote);
    const title=document.createElement("strong");title.textContent="Audio enhancements";section.append(title);
    const enable=document.createElement("input");enable.type="checkbox";enable.id="audioEnhancementsEnabled";
    const enabledLabel=document.createElement("label");enabledLabel.append(enable,document.createTextNode("Enable audio enhancements"));section.append(enabledLabel);
    const presetLabel=document.createElement("label");presetLabel.htmlFor="audioEQPreset";presetLabel.textContent="Equalizer preset";
    const preset=document.createElement("select");preset.id="audioEQPreset";
    for(const [value,label] of Object.entries({flat:"Flat",cinema:"Cinema",speech:"Speech",rock:"Rock",classical:"Classical",jazz:"Jazz",bass:"Bass boost",treble:"Treble boost",headphones:local("Headphones","Наушники"),custom:"Custom equalizer"})){
      const option=document.createElement("option");option.value=value;option.textContent=label;preset.append(option);
    }
    section.append(presetLabel,preset);
    const bands=document.createElement("div");bands.className="dk-eq-bands";bands.setAttribute("role","group");bands.setAttribute("aria-label","Ten-band equalizer");
    const entries=[];
    for(const [index,frequency] of eqFrequencies.entries()){
      const cell=document.createElement("div");cell.className="dk-eq-band";
      const input=document.createElement("input");input.id="audioEQBand"+index;input.type="range";input.min="-12";input.max="12";input.step="1";
      const label=document.createElement("label");label.htmlFor=input.id;label.textContent=frequency>=1000?frequency/1000+"k":String(frequency);
      input.setAttribute("aria-label",frequency>=1000?frequency/1000+" kHz":frequency+" Hz");
      const output=document.createElement("output");output.htmlFor=input.id;
      cell.append(output,input,label);bands.append(cell);entries.push({input,output});
      input.addEventListener("input",()=>{eq.bands[index]=eqClamp(input.value,-12,12);eq.enabled=true;applyAudioSettings();});
      input.addEventListener("change",()=>write(eqKey,eq));
    }
    section.append(bands);
    const extras={};
    for(const [id,labelText,min,max] of [["bass","Bass",-12,12],["treble","Treble",-12,12],["balance","Stereo balance",-100,100]]){
      const row=document.createElement("div");row.className="dk-picture-adjustment";
      const label=document.createElement("label"),input=document.createElement("input"),output=document.createElement("output");
      input.id="audioEQ-"+id;input.type="range";input.min=String(min);input.max=String(max);input.step="1";
      label.htmlFor=input.id;label.textContent=labelText;output.htmlFor=input.id;extras[id]={input,output};
      row.append(label,output,input);section.append(row);
      input.addEventListener("input",()=>{eq[id]=eqClamp(input.value,min,max);eq.enabled=true;applyAudioSettings();});
      input.addEventListener("change",()=>write(eqKey,eq));
    }
    const headroom=document.createElement("input");headroom.type="checkbox";
    const headroomLabel=document.createElement("label");headroomLabel.append(headroom,document.createTextNode("Automatic EQ headroom"));section.append(headroomLabel);
    const dynamicsTitle=document.createElement("strong");dynamicsTitle.textContent="Volume leveling and dialogue";section.append(dynamicsTitle);
    const dynamicsControls=[];
    for(const [flag,strength,labelText,strengthText] of [
      ["leveling","levelStrength","Automatic volume leveling","Leveling strength"],
      ["dialogue","dialogueStrength","Dialogue enhancement","Dialogue strength"]
    ]){
      const toggle=document.createElement("input");toggle.type="checkbox";
      const toggleLabel=document.createElement("label");toggleLabel.append(toggle,document.createTextNode(labelText));section.append(toggleLabel);
      const row=document.createElement("div");row.className="dk-picture-adjustment";
      const label=document.createElement("label"),input=document.createElement("input"),output=document.createElement("output");
      input.type="range";input.id="audioDynamics-"+strength;input.min="0";input.max="100";input.step="5";
      label.htmlFor=input.id;label.textContent=strengthText;output.htmlFor=input.id;
      row.append(label,output,input);section.append(row);
      dynamicsControls.push({flag,strength,toggle,input,output});
      toggle.addEventListener("change",()=>{eq[flag]=toggle.checked;applyAudioSettings();write(eqKey,eq);});
      input.addEventListener("input",()=>{eq[strength]=eqClamp(input.value,0,100);applyAudioSettings();});
      input.addEventListener("change",()=>write(eqKey,eq));
    }
    const dynamicsNote=document.createElement("p");dynamicsNote.className="helper";
    dynamicsNote.textContent="Leveling reduces loud-to-quiet differences. Dialogue enhancement emphasizes speech frequencies, not isolated voices. Leveling may downmix surround audio.";
    section.append(dynamicsNote);
    const reset=document.createElement("button");reset.type="button";reset.className="btn small dk-picture-reset";reset.textContent="Reset audio enhancements";
    const note=document.createElement("p");note.className="helper";note.textContent="Equalizer affects playback only. Stereo balance may downmix surround audio. Headroom reduces estimated filter boost, not all clipping.";
    section.append(reset,note);
    const applyAudioSettings=()=>{
      modeSelect.value=outputPrefs.mode;protect.checked=outputPrefs.protect;
      enable.checked=eq.enabled;headroom.checked=eq.headroom;
      for(const c of dynamicsControls){c.toggle.checked=eq[c.flag];c.input.value=String(eq[c.strength]);c.input.disabled=!eq[c.flag]||!supportsVolumeBoost;c.output.textContent=eq[c.strength]+"%";}
      const matching=Object.keys(eqPresets).find(name=>eqPresets[name].every((value,index)=>value===eq.bands[index]));
      preset.value=matching||"custom";
      const db=value=>(value>0?"+":"")+value+" "+(window.DKLocale?.get()==="ru"?"дБ":"dB");
      const ru=window.DKLocale?.get()==="ru";
      for(const [index,entry] of entries.entries()){
        const hz=eqFrequencies[index];
        entry.input.value=String(eq.bands[index]);entry.output.textContent=db(eq.bands[index]);
        entry.input.setAttribute("aria-label",hz>=1000?hz/1000+(ru?" кГц":" kHz"):hz+(ru?" Гц":" Hz"));
        entry.input.parentElement.querySelector("label").textContent=hz>=1000?hz/1000+(ru?"к":"k"):String(hz);
      }
      for(const [id,entry] of Object.entries(extras)){entry.input.value=String(eq[id]);entry.output.textContent=id==="balance"?String(eq[id])+"%":db(eq[id]);}
      applyVolume();
      try{
        volumeAudioGraph?.effects?.apply();volumeAudioGraph?.output?.apply();mkvAudio?.applyEffects?.();
        if(audioEffectsActive()&&current()&&!state.stopped&&!mkvAudio?.active()&&!volumeAudioGraph?.effects)
          status("Audio enhancements unavailable for this output.");
      }catch(_){status("Audio enhancements unavailable for this output.");}
    };
    modeSelect.addEventListener("change",()=>{
      const mode=modeSelect.value;if(!outputModes.includes(mode)||mode===outputPrefs.mode)return;
      const previous=volumePercent;saveOutputVolume();outputPrefs.mode=mode;
      // New modes never raise volume. Switching to a remembered mode restores
      // its explicit user setting, capped at the supported master range.
      volumePercent=Math.min(volumeLimit,Object.hasOwn(outputPrefs.levels,mode)?outputPrefs.levels[mode]:Math.min(previous,70));
      applyAudioSettings();saveOutputVolume();write(store.volume,volumePercent);
    });
    protect.addEventListener("change",()=>{outputPrefs.protect=protect.checked;write(outputKey,outputPrefs);applyAudioSettings();});
    enable.addEventListener("change",()=>{eq.enabled=enable.checked;applyAudioSettings();write(eqKey,eq);});
    preset.addEventListener("change",()=>{
      if(!eqPresets[preset.value])return;
      eq.bands=[...eqPresets[preset.value]];eq.enabled=true;applyAudioSettings();write(eqKey,eq);
    });
    headroom.addEventListener("change",()=>{eq.headroom=headroom.checked;applyAudioSettings();write(eqKey,eq);});
    reset.addEventListener("click",()=>{
      Object.assign(eq,{enabled:false,bands:[...eqPresets.flat],bass:0,treble:0,balance:0,headroom:true,leveling:false,levelStrength:50,dialogue:false,dialogueStrength:50});
      applyAudioSettings();write(eqKey,eq);
    });
    byId("playerSettingsPanel").append(section);
    byId("languageSelect").addEventListener("change",()=>queueMicrotask(applyAudioSettings));
    media.addEventListener("loadedmetadata",()=>{if(audioEffectsActive()||explicitStereo()||volumeAudioGraph)applyAudioSettings();});
    if(!supportsVolumeBoost){for(const control of section.querySelectorAll("input,select,button"))control.disabled=true;}
    // Existing preferences can be shown before a file is selected.
    applyAudioSettings();window.DKLocale?.apply();
  }
  applyVolume();
  if(supportsVolumeBoost){
    document.addEventListener("pointerdown",resumeBoost,{passive:true});
    document.addEventListener("keydown",resumeBoost);
  }
  byId("volume").addEventListener("input", event => setVolume(event.target.value));
  byId("mute").addEventListener("click", () => {
    userMuted = !userMuted;
    applyVolume();
    showVolumeOverlay();
  });
  byId("rate").addEventListener("change", event => { media.playbackRate = Number(event.target.value); });
  if (!document.pictureInPictureEnabled || typeof media.requestPictureInPicture !== "function") {
    byId("pip").disabled = true;
    byId("pip").title = "Picture in picture isn't available for this video or player.";
  }
  byId("pip").addEventListener("click", async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (current()) await media.requestPictureInPicture();
    } catch (_) { status("Picture in picture isn't available for this video or player."); }
  });
  // The website uses the browser Fullscreen API. The standalone app must also
  // fullscreen its NATIVE window, not merely resize a video within that window.
  const desktopFullscreen = window.DKLibraryBridge?.internalPages ? window.DKLibraryBridge :
    (window.DKStandalone && typeof window.DKStandalone.setFullscreen === "function" ? window.DKStandalone : null);
  const isFullscreen = () => document.fullscreenElement === screen ||
    screen.classList.contains("desktop-fullscreen");
  const updateFullscreenButton = () => {
    const fullscreen = isFullscreen();
    const button = byId("fullscreen");
    button.setAttribute("aria-label", fullscreen ? "Exit fullscreen" : "Fullscreen");
    button.title = fullscreen ? "Exit fullscreen" : "Fullscreen";
    button.setAttribute("aria-pressed", String(fullscreen));
  };
  const applyDesktopFullscreen = fullscreen => {
    const wasFullscreen=screen.classList.contains("desktop-fullscreen");
    screen.classList.toggle("desktop-fullscreen", !!fullscreen);
    document.documentElement.classList.toggle("dk-desktop-fullscreen", !!fullscreen);
    if(wasFullscreen&&!fullscreen&&window.DKLibraryBridge?.internalPages)playerWindow?.reset();
    updateFullscreenButton();
    requestAnimationFrame(syncPgsOverlay);
    revealControls();
  };
  if (desktopFullscreen && typeof desktopFullscreen.onFullscreenChanged === "function") {
    desktopFullscreen.onFullscreenChanged(applyDesktopFullscreen);
  }
  const toggleFullscreen = async () => {
    if (desktopFullscreen) {
      try {
        // Electron controls the actual OS window. Its event also handles
        // exit via OS/window-manager controls, so both stay synchronized.
        applyDesktopFullscreen(await desktopFullscreen.setFullscreen(!isFullscreen()));
      } catch (_) {
        status("Fullscreen isn't available for this window.");
      }
      return;
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (typeof screen.requestFullscreen === "function") {
        await screen.requestFullscreen();
      } else if (typeof screen.webkitRequestFullscreen === "function") {
        await screen.webkitRequestFullscreen();
      } else {
        status("Fullscreen isn't available in this player.");
      }
    } catch (_) {
      status("Fullscreen isn't available for this video.");
    }
    updateFullscreenButton();
  };
  byId("fullscreen").addEventListener("click", () => { void toggleFullscreen(); });
  // Double-click anywhere on the picture, even before opening a file.
  screen.addEventListener("dblclick", event => {
    if (event.target.closest && event.target.closest(
        "button,input,select,.player-context-menu,.media-info")) return;
    event.preventDefault();
    cancelVideoClick();
    void toggleFullscreen();
  });
  // Video context menu works in normal and fullscreen mode because it lives
  // inside the fullscreen player surface, not the document body.
  const closeContextMenu = () => {
    contextMenu.hidden = true;
    contextMenu.replaceChildren();
    menuOpen = false;
    revealControls();
  };
  let activeMenuSection = contextMenu;
  let contextAnchor = {x:8, y:8};
  // The main menu stays compact: expand one group at a time. This makes
  // Subtitles visible immediately instead of burying it after six speeds.
  const fitContextMenu = () => {
    if (contextMenu.hidden) return;
    const bounds = screen.getBoundingClientRect();
    const rect = contextMenu.getBoundingClientRect();
    contextMenu.style.left = Math.max(8, Math.min(bounds.width - rect.width - 8, contextAnchor.x)) + "px";
    contextMenu.style.top = Math.max(8, Math.min(bounds.height - rect.height - 8, contextAnchor.y)) + "px";
  };
  const addMenuHeading = label => {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "context-section-toggle";
    toggle.setAttribute("role", "menuitem");
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = label;
    // Stable internal section name, unaffected by Russian UI translations.
    toggle.dataset.menuSection = label;
    const group = document.createElement("div");
    group.className = "context-section-items";
    group.hidden = true;
    toggle.addEventListener("click", event => {
      event.stopPropagation();
      const expand = group.hidden;
      contextMenu.querySelectorAll(".context-section-items").forEach(section => {
        section.hidden = true;
        const heading = section.previousElementSibling;
        if (heading) heading.setAttribute("aria-expanded", "false");
      });
      group.hidden = !expand;
      toggle.setAttribute("aria-expanded", String(expand));
      fitContextMenu();
      toggle.focus();
    });
    contextMenu.append(toggle, group);
    activeMenuSection = group;
  };
  const addMenuSubheading = label => {
    const heading = document.createElement("div");
    heading.className = "context-group-caption";
    heading.textContent = label;
    activeMenuSection.append(heading);
  };
  const addMenuItem = (label, action, options = {}) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "context-item";
    button.textContent = label;
    button.setAttribute("role", options.checked === undefined ? "menuitem" : "menuitemradio");
    if (options.checked !== undefined)
      button.setAttribute("aria-checked", String(Boolean(options.checked)));
    button.disabled = Boolean(options.disabled);
    if (options.disabled) button.title = options.reason || "Not available for this media";
    button.addEventListener("click", event => {
      event.stopPropagation();
      closeContextMenu();
      if (!button.disabled) action();
    });
    activeMenuSection.append(button);
    return button;
  };
  const availableTracks = () => {
    try { return Array.from(media.textTracks || []); }
    catch (_) { return []; }
  };
  const audioApi = window.DKAudioTracks;
  mkvAudio = window.DKMkvAudio ? window.DKMkvAudio.create({
    media, isMuted: () => userMuted,
    createEffects:desktopVolume?createAudioEffects:null,
    createOutput:desktopVolume?createAudioOutput:null,
    onError: err => {
      applyVolume();
      status("MKV audio decoding stopped: " +
        (err && err.message ? err.message : "Unsupported codec"));
    }
  }) : null;
  const audioTracks = () => audioApi ? audioApi.nativeTracks(media) : [];
  const chooseEmbeddedAudio = async (item,track,remember = true) => {
    if (!item || !item.file) return;
    if (codecPlayback?.isActive(item)) {
      const ordinal=(item.embeddedAudio || []).findIndex(t=>t.number===track.number);
      if (ordinal<0 || item.codecAudioIndex===ordinal) return;
      item.codecAudioIndex=ordinal;
      if (remember) {
        state.audioPreferences[item.key]={mode:"mkv",number:track.number};
        write(store.audioPreferences,state.audioPreferences);
      }
      void codecPlayback.start(item,playbackSeconds(),!media.paused,
        ["mp4","webm"].includes(item.requestedFormat)?
          item.requestedFormat:"auto",ordinal);
      return;
    }
    if (!mkvAudio || !mkvAudio.canAttempt(track)) return;
    if (mkvAudio.selectedNumber() === track.number && current() === item) return;
    status("Opening embedded MKV audio…");
    try {
      const started = await mkvAudio.start(item.file,track);
      if (!started || current() !== item || state.stopped) return;
      if (remember) {
        state.audioPreferences[item.key] = {mode:"mkv",number:track.number};
        write(store.audioPreferences,state.audioPreferences);
      }
      applyVolume();
      status("MKV audio decoder started: " +
        (audioApi ? audioApi.labelEmbedded(track) : track.codec),true);
    } catch (err) {
      if (current() !== item) return;
      applyVolume();
      status("Cannot play this MKV audio track: " +
        (err && err.message ? err.message : "Unsupported encoding"));
    }
  };
  const restoreOriginalAudio = () => {
    if (mkvAudio) mkvAudio.stop();
    const item = current();
    if (item) {
      delete state.audioPreferences[item.key];
      write(store.audioPreferences,state.audioPreferences);
    }
    applyVolume();
    status("Using original audio track.",true);
  };
  const rememberAudioPreference = (item, track, index) => {
    if (!item || !audioApi) return;
    state.audioPreferences[item.key] = audioApi.preferenceFor(track,index);
    const keys = Object.keys(state.audioPreferences);
    if (keys.length > 120)
      keys.slice(0,keys.length-120).forEach(key => delete state.audioPreferences[key]);
    write(store.audioPreferences,state.audioPreferences);
  };
  const selectAudioTrack = (index, remember = true) => {
    if (!audioApi) return false;
    const item = current();
    if (mkvAudio) mkvAudio.stop();
    applyVolume();
    const result = audioApi.selectNative(media,index);
    if (!result.ok) {
      if (remember) status(result.reason);
      return false;
    }
    if (remember) {
      const tracks = audioTracks();
      rememberAudioPreference(item,tracks[index],index);
      status("Audio track selected: " + result.label,true);
    }
    return true;
  };
  const restoreAudioPreference = () => {
    const item = current(), tracks = audioTracks();
    if (!item || state.stopped || codecPlayback?.isActive(item)) return;
    const saved = state.audioPreferences[item.key];
    if (!saved) return;
    if (saved.mode === "mkv") {
      const track = (item.embeddedAudio || []).find(t => t.number === saved.number);
      if (track && mkvAudio) void chooseEmbeddedAudio(item,track,false);
      return;
    }
    if (!audioApi || !tracks.length) return;
    const target = audioApi.preferredIndex(tracks,saved);
    if (target >= 0 && !tracks[target].enabled)
      selectAudioTrack(target,false);
  };
  const changeDVDSubtitle=async(item,index)=>{
    if(!item?.file?.dvdToken||!codecPlayback?.isActive(item)||item.dvdSubtitleBusy||state.stopped)return;
    if(index!==-1&&!isDVDSubtitle(item,item.nativeSubtitleTracks?.[index]))return;
    const at=playbackSeconds(),playing=!media.paused,epoch=item.playbackEpoch;
    item.dvdSubtitleBusy=true;
    try{
      if(index>=0){
        clearSubtitles();
        for(const track of subtitleTracks())track.mode="disabled";
        item.lastSubtitleChoice="native:"+index;
      }
      item.dvdSubtitleIndex=index;
      const ok=await codecPlayback.start(item,at,playing,item.nativeOutputFormat||"auto",item.codecAudioIndex||0);
      if(!ok&&current()===item&&item.playbackEpoch===epoch){
        item.dvdSubtitleIndex=-1;
        await codecPlayback.start(item,at,playing,item.nativeOutputFormat||"auto",item.codecAudioIndex||0);
        status("DVD subtitles unavailable; restored playback without subtitles.");
      }
    }finally{item.dvdSubtitleBusy=false;if(current()===item)updateSubtitleStatus();}
  };
  const switchSubtitles = index => {
    const item = current();
    if(dvdSubOn(item)){void changeDVDSubtitle(item,-1);if(index<0)return;}
    if(index<0&&item&&subtitleIsOn()){
      const choice=byId("subtitleTrackSelect").value;
      if(choice&&choice!=="off")item.lastSubtitleChoice=choice;
    }
    if (item && state.embeddedSubtitlePreferences[item.key]) {
      delete state.embeddedSubtitlePreferences[item.key];
      write(store.embeddedSubtitlePreferences,state.embeddedSubtitlePreferences);
    }
    const selected = index >= 0 ? subtitleTracks()[index] || null : null;
    // Leave manually loaded SRT/VTT and native text tracks available when
    // switching Off. Their modes are disabled, not their files discarded.
    // Embedded bitmap/MKV extraction is still cancelled/cleared normally.
    if (state.mkvSubtitlePending || state.activePgsTrack ||
        (state.subtitleNode &&
          ((state.activeEmbeddedTrack!==null &&
            (!selected || selected!==state.subtitleNode.track)) ||
           (selected && selected!==state.subtitleNode.track))))
      clearSubtitles();
    chooseSubtitleTrack(selected);
  };
  const subtitleTrackSelect=byId("subtitleTrackSelect");
  refreshSubtitleTrackOptions=()=>{
    if(!subtitleTrackSelect)return;
    const tr=text=>window.DKLocale?.t(text)||text;
    const item=current();
    const visible=subtitleTracks();
    const options=[{value:"off",label:tr("Subtitles off"),disabled:false}];
    visible.forEach((track,index)=>options.push({
      value:"browser:"+index,
      label:track.label||track.language||tr("Subtitle track")+" "+(index+1),
      disabled:false
    }));
    if(item&&codecPlayback?.isActive(item)){
      (item.nativeSubtitleTracks||[]).forEach((track,index)=>{
        const supported=isDVDSubtitle(item,track)||isTextNativeSubtitle(track)&&
          typeof window.DKCodecBridge?.subtitleVtt==="function";
        options.push({
          value:"native:"+index,
          label:(track.title||track.language||tr("Subtitle track")+" "+(index+1))+
            (track.codec?" · "+track.codec:""),
          disabled:!supported
        });
      });
    }
    if(item){
      (item.embeddedSubtitles||[]).forEach(track=>{
        const supported=Boolean(
          window.DKMkvSubtitles?.canExtract(track.codec)||
          window.DKPGS?.canRender(track.codec)||
          window.DKVobSub?.canRender(track.codec));
        options.push({
          value:"mkv:"+track.number,
          label:(track.name||track.language||tr("Subtitle track")+" "+track.number)+
            (track.codec?" · "+track.codec:""),
          disabled:!supported
        });
      });
      if(item.mkvInspection==="pending"&&
         !(item.embeddedSubtitles||[]).length)
        options.push({value:"pending",label:tr("Checking MKV subtitle tracks…"),
          disabled:true});
    }
    const signature=JSON.stringify(options);
    if(subtitleTrackSelect.dataset.choiceSignature!==signature){
      subtitleTrackSelect.replaceChildren(...options.map(choice=>{
        const option=document.createElement("option");
        option.value=choice.value;
        option.textContent=choice.label;
        option.disabled=choice.disabled;
        return option;
      }));
      subtitleTrackSelect.dataset.choiceSignature=signature;
      if(window.DKLocale)window.DKLocale.apply();
    }
    subtitleTrackSelect.disabled=!item;
    let choice="off";
    const activeNative=state.nativeSubtitle;
    if(dvdSubOn(item))choice="native:"+item.dvdSubtitleIndex;
    else if(subtitleIsOn()&&activeNative?.item===item&&Number.isInteger(activeNative.index))
      choice="native:"+activeNative.index;
    else if(state.activePgsTrack)
      choice="mkv:"+state.activePgsTrack.number;
    else if(state.activeEmbeddedTrack!==null)
      choice="mkv:"+state.activeEmbeddedTrack;
    else {
      const index=visible.findIndex(track=>track.mode==="showing");
      if(index>=0)choice="browser:"+index;
    }
    if(!options.some(option=>option.value===choice&&!option.disabled))
      choice="off";
    subtitleTrackSelect.value=choice;
  };
  // Native <option> labels are intentionally not altered by the global
  // text-node translator, so update the playback format options explicitly
  // when switching between the English and fully Cyrillic Russian UI.
  const translateGearOptions=()=>{
    const format=byId("playbackFormat");
    for(const option of format.options){
      if(!option.dataset.englishLabel)
        option.dataset.englishLabel=option.textContent;
      option.textContent=window.DKLocale?.t(option.dataset.englishLabel)||
        option.dataset.englishLabel;
    }
    subtitleTrackSelect.dataset.choiceSignature="";
    refreshSubtitleTrackOptions();
  };
  byId("languageSelect").addEventListener("change",()=>{
    queueMicrotask(translateGearOptions);
  });
  translateGearOptions();
  subtitleTrackSelect.addEventListener("change",event=>{
    const item=current();
    if(!item)return;
    const value=event.target.value;
    if(value==="off"){switchSubtitles(-1);return;}
    item.lastSubtitleChoice=value;
    const [kind,index]=value.split(":");
    const number=Number(index);
    if(!Number.isSafeInteger(number)||number<0)return;
    if(kind==="browser"){switchSubtitles(number);return;}
    if(kind==="native"){
      const track=item.nativeSubtitleTracks?.[number];
      if(isDVDSubtitle(item,track))void changeDVDSubtitle(item,number);
      else if(track&&isTextNativeSubtitle(track))
        void loadNativeSubtitle(item,track,number);
      return;
    }
    if(kind==="mkv"){
      const track=(item.embeddedSubtitles||[]).find(x=>x.number===number);
      if(!track)return;
      if(window.DKPGS?.canRender(track.codec))void loadPgsTrack(track);
      else if(window.DKVobSub?.canRender(track.codec))
        void loadVobSubTrack(track);
      else if(window.DKMkvSubtitles?.canExtract(track.codec))
        void loadEmbeddedTrack(track);
    }
  });
  const buildContextMenu = () => {
    contextMenu.replaceChildren();
    activeMenuSection = contextMenu;
    addMenuHeading("Playback");
    addMenuItem(media.paused ? "▶  Play" : "⏸  Pause", togglePlayback);
    addMenuItem("⏹  Stop", () => byId("stop").click());
    addMenuItem("⏮  Previous", () => byId("previous").click(), {disabled: state.current <= 0});
    addMenuItem("⏭  Next", () => byId("next").click(), {disabled: state.current >= state.queue.length - 1});
    addMenuItem("↶  Back 10 seconds", () => skipTen(-10),
      {disabled: !current() || !Number.isFinite(media.duration) || state.stopped});
    addMenuItem("↷  Forward 10 seconds", () => skipTen(10),
      {disabled: !current() || !Number.isFinite(media.duration) || state.stopped});

    addMenuHeading("Playback format");
    for (const [value,label] of [["auto","Automatic"],["original","Original (no conversion)"],
      ["mp4","MP4 (H.264/AAC)"],["webm","WebM (VP9/Opus)"]]) {
      addMenuItem(label, () => {
        if(playbackFormatInput.value===value)return;
        playbackFormatInput.value=value;
        playbackFormatInput.dispatchEvent(new Event("change",{bubbles:true}));
      }, {checked: playbackSettings.format===value});
    }

    addMenuHeading("Subtitles");
    const tracks = subtitleTracks();
    addMenuItem("Subtitles off", () => switchSubtitles(-1),
      {checked: !dvdSubOn(current()) && !state.activePgsTrack && state.activeEmbeddedTrack === null &&
        !state.mkvSubtitlePending &&
        tracks.every(track => track.mode !== "showing")});
    tracks.forEach((track, index) => addMenuItem(
      track.label || track.language || "Subtitle track " + (index + 1),
      () => switchSubtitles(index), {checked: track.mode === "showing"}));
    const item = current();
    if(codecPlayback?.isActive(item)) {
      const nativeTracks=item.nativeSubtitleTracks||[];
      if(nativeTracks.length) {
        addMenuSubheading("Included subtitle tracks");
        nativeTracks.forEach((track,index)=>{
          const bitmap=isDVDSubtitle(item,track);
          const supported=bitmap||isTextNativeSubtitle(track) &&
            typeof window.DKCodecBridge?.subtitleVtt==="function";
          addMenuItem((track.title||track.language||"Subtitle "+(index+1))+
            (track.codec?" · "+track.codec:""),
            ()=>{if(bitmap)void changeDVDSubtitle(item,index);else if(supported)void loadNativeSubtitle(item,track,index);},
            {checked:bitmap?item.dvdSubtitleIndex===index:supported?state.nativeSubtitle?.item===item &&
              state.nativeSubtitle.index===index:undefined,
              disabled:!supported,
              reason:"This graphical subtitle track needs a separate decoder."});
        });
      }
    }
    if (item && item.mkvInspection && item.mkvInspection !== "not-mkv") {
      const embedded = item.embeddedSubtitles || [];
      if (embedded.length) {
        addMenuSubheading("MKV embedded subtitles");
        embedded.forEach(track => {
          const name = track.name || track.language || "Subtitle " + track.number;
          const text = !!(window.DKMkvSubtitles &&
            window.DKMkvSubtitles.canExtract(track.codec));
          const pgs = !!(window.DKPGS && window.DKPGS.canRender(track.codec));
          const vobsub = !!(window.DKVobSub && window.DKVobSub.canRender(track.codec));
          const supported = text || pgs || vobsub;
          const selected = state.activePgsTrack ?
            state.activePgsTrack.number === track.number :
            state.activeEmbeddedTrack === track.number &&
            tracks.some(t => t.mode === "showing" && state.subtitleNode &&
              t === state.subtitleNode.track);
          addMenuItem(name + " · " + track.codec +
            (supported ? "" : " · Codec unsupported"),
            () => { if (pgs) void loadPgsTrack(track);
              else if (vobsub) void loadVobSubTrack(track);
              else void loadEmbeddedTrack(track); },
            {checked: supported ? selected : undefined, disabled: !supported,
              reason: "This subtitle codec is not yet supported by the player."});
        });
      } else if (item.mkvInspection === "pending") {
        addMenuItem("Checking MKV subtitle tracks…", () => {}, {disabled: true});
      } else {
        addMenuItem(item.mkvInspection === "unavailable" ?
          "Could not inspect embedded MKV tracks" :
          "No embedded subtitle tracks found", () => {}, {disabled: true});
      }
    }
    addMenuItem("＋ Load SRT / VTT…", () => byId("subtitlePicker").click());

    addMenuHeading("Audio tracks");
    if (codecPlayback?.isActive(current())) {
      const item=current();
      const nativeTracks=item.nativeAudioTracks||[];
      if(nativeTracks.length) {
        addMenuSubheading("Included audio tracks");
        nativeTracks.forEach((track,index)=>addMenuItem(
          (track.title||track.language||"Audio track "+(index+1))+
            (track.codec?" · "+track.codec:""),
          ()=>{
            item.codecAudioIndex=index;
            const info=(item.embeddedAudio||[])[index];
            if(info){
              state.audioPreferences[item.key]={mode:"mkv",number:info.number};
              write(store.audioPreferences,state.audioPreferences);
            }
            void codecPlayback.start(item,playbackSeconds(),!media.paused,
              ["mp4","webm"].includes(item.requestedFormat)?
          item.requestedFormat:"auto",index);
          },
          {checked:(item.codecAudioIndex||0)===index}
        ));
      }
    }
    if (mkvAudio && mkvAudio.selectedNumber() !== null)
      addMenuItem("Use original audio",restoreOriginalAudio);
    const audios = audioTracks();
    if (audios.length) {
      addMenuSubheading("Player audio tracks");
      audios.forEach((track,index) => addMenuItem(
        audioApi.labelNative(track,index),
        () => selectAudioTrack(index), {checked: Boolean(track.enabled)}));
    } else if (!codecPlayback?.isActive(current())) {
      addMenuItem("Audio-track switching unavailable", () => {},
        {disabled: true,reason: "This playback engine does not expose switchable audio streams."});
    }
    if (item && item.mkvInspection !== "not-mkv") {
      if (item.embeddedAudio && item.embeddedAudio.length) {
        addMenuSubheading("Embedded MKV audio · WebCodecs");
        item.embeddedAudio.forEach(track => {
          const usingNative=!!codecPlayback?.isActive(item);
          const possible = usingNative || !!(mkvAudio && mkvAudio.canAttempt(track));
          const selected=usingNative?
            (item.embeddedAudio||[]).findIndex(t=>t.number===track.number) ===
              (item.codecAudioIndex||0) :
            !!(mkvAudio && mkvAudio.selectedNumber()===track.number);
          addMenuItem(audioApi ? audioApi.labelEmbedded(track) :
            (track.name || track.language || track.codec),
            () => { if (possible) void chooseEmbeddedAudio(item,track); },
            {checked:possible ? selected : undefined,
              disabled:!possible,
              reason:"This audio format is not supported by the current decoder."});
        });
      } else if (item.mkvInspection === "pending") {
        addMenuItem("Checking MKV audio tracks…", () => {}, {disabled:true});
      }
    }

    addMenuHeading("Speed");
    for (const speed of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
      addMenuItem(speed + "×", () => {
        media.playbackRate = speed;
        byId("rate").value = String(speed);
      }, {checked: Math.abs(media.playbackRate - speed) < 0.01});
    }
    const cues = getChapterEntries();
    if (cues.length) {
      addMenuHeading("Chapters");
      for (const cue of cues) addMenuItem(
        time(cue.startTime) + "  " + (cue.text || "Chapter"),
        () => { setPlaybackPosition(cue.startTime); });
    }

    // Standalone: one entry opens the real picture settings category.
    // Preserve the hosted menu and all of its original shortcuts.
    if(openPictureAdjustments){
      activeMenuSection=contextMenu;
      addMenuItem("Picture Settings",()=>openPictureAdjustments(),
        {disabled:!current()||current().audio||state.stopped}).classList.add("dk-menu-picture-adjustments");
    }else{
      addMenuHeading("Picture");
      addMenuItem("Fit full picture", () => {
        if(setPictureFit)setPictureFit("fit");else{screen.classList.remove("fit-cover");syncPgsOverlay();}
      }, {checked: !screen.classList.contains("fit-cover")});
      addMenuItem("Fill frame (crop edges)", () => {
        if(setPictureFit)setPictureFit("fill");else{screen.classList.add("fit-cover");syncPgsOverlay();}
      }, {checked: screen.classList.contains("fit-cover")});
      addMenuItem(document.fullscreenElement ? "Exit fullscreen" : "Fullscreen",
        () => { void toggleFullscreen(); });
      addMenuItem("Picture in picture", () => byId("pip").click(),
        {disabled: byId("pip").hidden});
    }
    activeMenuSection=contextMenu;
    addMenuItem("Media information", openMediaInfo).classList.add("dk-menu-information");
  };
  // If Matroska inspection finishes while the Subtitles section is open,
  // replace its temporary "Checking..." row with the actual embedded tracks.
  // Keep the section expanded and never launch the external file chooser.
  const refreshOpenSubtitleMenu = () => {
    if (!menuOpen || contextMenu.hidden) return;
    const existing = contextMenu.querySelector(
      '.context-section-toggle[data-menu-section="Subtitles"]');
    if (!existing || existing.getAttribute("aria-expanded") !== "true") return;
    const scrollTop = contextMenu.scrollTop;
    buildContextMenu();
    if (window.DKLocale) window.DKLocale.apply();
    const section = contextMenu.querySelector(
      '.context-section-toggle[data-menu-section="Subtitles"]');
    if (section) section.click();
    contextMenu.scrollTop = scrollTop;
    fitContextMenu();
  };
  const openMediaInfo = () => {
    const item = current();
    if (!item) return;
    const info = byId("mediaInfoDetails");
    info.replaceChildren();
    const addDetail = (label, value) => {
      const key = document.createElement("dt");
      key.textContent = label;
      const data = document.createElement("dd");
      data.textContent = String(value);
      info.append(key, data);
    };
    addDetail("Title", item.name);
    if (item.kind !== "file") addDetail("Source", "Direct stream URL");
    addDetail("Requested playback format",item.requestedFormat || "auto");
    addDetail("Actual playback method",item.playbackMethod || "Original source");
    addDetail("Hardware acceleration preference",playbackSettings.hardware
      ? "Enabled (GPU availability depends on the playback engine)" : "Disabled (GPU availability depends on the playback engine)");
    if (item.size !== undefined) addDetail("Size", (item.size / 1048576).toFixed(1) + " MiB");
    if (item.mime) addDetail("Format", item.mime);
    if (media.videoWidth && media.videoHeight)
      addDetail("Resolution", media.videoWidth + " × " + media.videoHeight);
    addDetail("Duration", Number.isFinite(playbackDuration()) ?
      time(playbackDuration()) : "Live / unknown");
    addDetail("Speed", media.playbackRate + "×");
    if (item.embeddedVideo && item.embeddedVideo.length)
      addDetail("Detected MKV video codec",item.embeddedVideo.map(t =>
        t.codec+(t.width&&t.height?" · "+t.width+" × "+t.height:"")).join("; "));
    if(item.playbackMethod==="MP4 lossless remux"&&item.remuxTrackSummary){
      addDetail("MP4 included audio track",item.remuxTrackSummary.copiedAudioTrack
        ? "Original MKV track "+item.remuxTrackSummary.copiedAudioTrack : "No soundtrack");
      addDetail("Original-only MKV tracks",item.remuxTrackSummary.skippedTracks);
      addDetail("Embedded MKV subtitles","Available from original file, not copied into MP4");
    }
    addDetail("Player subtitle tracks", subtitleTracks().length);
    addDetail("Player audio tracks", audioTracks().length);
    if (item.embeddedAudio && item.embeddedAudio.length)
      addDetail("Detected MKV audio tracks",item.embeddedAudio.map(
        t => audioApi ? audioApi.labelEmbedded(t) :
          (t.name || t.language || t.codec)).join("; "));
    if (state.activePgsTrack)
      addDetail("PGS bitmap subtitle track",state.activePgsTrack.label);
    if (item.mkvInspection && item.mkvInspection !== "not-mkv")
      addDetail("Detected MKV subtitle tracks", item.embeddedSubtitles.length ?
        item.embeddedSubtitles.map(t => (t.name || t.language || "Subtitle") + " (" + t.codec + ")").join(", ") :
        item.mkvInspection === "pending" ? "Scanning…" : "None in inspected header");
    infoPanel.hidden = false;
    keepControlsVisible();
    byId("closeMediaInfo").focus();
  };
  byId("closeMediaInfo").addEventListener("click", () => {
    infoPanel.hidden = true;
    revealControls();
  });
  screen.addEventListener("contextmenu", event => {
    if (!current() || (event.target.closest && event.target.closest(".player-context-menu,.media-info"))) return;
    event.preventDefault();
    cancelVideoClick();
    buildContextMenu();
    // Translate before measuring the menu so longer Russian labels fit.
    if (window.DKLocale) window.DKLocale.apply();
    contextMenu.hidden = false;
    menuOpen = true;
    keepControlsVisible();
    const bounds = screen.getBoundingClientRect();
    contextAnchor = {x:event.clientX - bounds.left, y:event.clientY - bounds.top};
    fitContextMenu();
    const first = contextMenu.querySelector("button:not(:disabled)");
    if (first) first.focus();
  });
  document.addEventListener("pointerdown", event => {
    if (menuOpen && !contextMenu.contains(event.target)) closeContextMenu();
  });
  contextMenu.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); closeContextMenu(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const options = Array.from(contextMenu.querySelectorAll("button:not(:disabled)")).filter(button => !button.closest("[hidden]"));
    const index = options.indexOf(document.activeElement);
    const next = (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    if (options[next]) { event.preventDefault(); options[next].focus(); }
  });
  let browserWasFullscreen=Boolean(document.fullscreenElement);
  document.addEventListener("fullscreenchange",()=>{
    const fullscreen=Boolean(document.fullscreenElement);
    if(browserWasFullscreen&&!fullscreen&&window.DKLibraryBridge?.internalPages)playerWindow?.reset();
    browserWasFullscreen=fullscreen;
    updateFullscreenButton();
  });
  document.addEventListener("fullscreenchange", () => requestAnimationFrame(syncPgsOverlay));
  updateFullscreenButton();
  // Subtitle tracks and delay live in the gear menu. An external SRT/VTT
  // is a direct file picker, without opening a second nested settings menu.
  byId("addSubtitles").addEventListener("click", () => {
    if (!current()) return;
    byId("subtitlePicker").click();
  });
  // Shift playback subtitle timing without changing video/audio or media files.
  const setSubtitleDelay = seconds => {
    const item = current();
    if (!item || !sync) return;
    const next = sync.clampDelay(seconds);
    if (next) subtitleDelays[item.key] = next;
    else delete subtitleDelays[item.key];
    const keys = Object.keys(subtitleDelays);
    if (keys.length > 160) keys.slice(0, keys.length - 160)
      .forEach(key => delete subtitleDelays[key]);
    write(store.subtitleDelays, subtitleDelays);
    applySubtitleDelayToText();
    state.pgsLastFrame = null;
    syncPgsOverlay();
    updateSubtitleDelayControls();
  };
  byId("subtitleDelayEarlier").addEventListener("click",
    () => setSubtitleDelay(subtitleDelayForCurrent() - 0.25));
  byId("subtitleDelayLater").addEventListener("click",
    () => setSubtitleDelay(subtitleDelayForCurrent() + 0.25));
  byId("subtitleDelayReset").addEventListener("click",
    () => setSubtitleDelay(0));

  // One-click embedded subtitles. Never invokes the external SRT picker.
  byId("subtitleToggle").addEventListener("click", () => {
    const item = current();
    if (!item) return;
    if (subtitleIsOn()) {
      switchSubtitles(-1);
      status("Subtitles turned off.",true);
      return;
    }
    // The quick CC button restores the last explicitly chosen track
    // (including native, MKV and external captions) when still available.
    const previous=item.lastSubtitleChoice;
    const selector=byId("subtitleTrackSelect");
    if(previous&&previous!=="off"&&
       Array.from(selector.options).some(o=>o.value===previous&&!o.disabled)){
      selector.value=previous;
      selector.dispatchEvent(new Event("change",{bubbles:true}));
      return;
    }
    const available = usableEmbeddedSubtitles(item);
    const selected = available.find(track => track.default || track.flagDefault) ||
      available.find(track => /^(en|eng)$/i.test(String(track.language || ""))) ||
      available[0];
    if (selected) {
      if (window.DKPGS?.canRender(selected.codec)) void loadPgsTrack(selected);
      else if (window.DKVobSub?.canRender(selected.codec)) void loadVobSubTrack(selected);
      else void loadEmbeddedTrack(selected);
    } else {
      const nativeTrack=codecPlayback?.isActive(item)?
        (item.nativeSubtitleTracks||[]).findIndex(track=>isDVDSubtitle(item,track)||isTextNativeSubtitle(track)):-1;
      if(nativeTrack>=0) {
        const track=item.nativeSubtitleTracks[nativeTrack];
        if(isDVDSubtitle(item,track))void changeDVDSubtitle(item,nativeTrack);else void loadNativeSubtitle(item,track,nativeTrack);
      }else {
        const native=subtitleTracks()[0];
        if(native)chooseSubtitleTrack(native);
        else status("No supported embedded subtitles were detected.");
      }
    }
  });
  byId("subtitlePicker").addEventListener("change", async event => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    const selectedItem = current();
    if (!file || !selectedItem) return;
    if (!/\.(srt|vtt)$/i.test(file.name)) { status("Choose a .vtt or .srt subtitle file."); return; }
    try {
      if (!window.DKSubtitleText) throw new Error("Subtitle conversion unavailable");
      const body = window.DKSubtitleText.toWebVTT(await file.text(), file.name);
      if (current() !== selectedItem) return; // Media changed while reading.
      installSubtitleVTT(body, file.name, "und");
      status("Subtitle track loaded.", true);
    } catch (_) { status("Couldn't read that subtitle file."); }
  });
  document.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") {
      if(window.DKLibraryBridge?.internalPages){
        // Native modal dialogs retain their own Escape/cancel behavior.
        if(document.querySelector("dialog[open]"))return;
        event.preventDefault();
        if(!standaloneChapters&&!chapterPicker.hidden)chapterPicker.hidden=true;
        if(menuOpen)closeContextMenu();
        if(!infoPanel.hidden)infoPanel.hidden=true;
        if(settingsDetails?.open)settingsDetails.open=false;
        playerWindow?.reset();
        if(desktopFullscreen&&screen.classList.contains("desktop-fullscreen")){
          void desktopFullscreen.setFullscreen(false).then(applyDesktopFullscreen).catch(()=>status("Fullscreen isn't available for this window."));
        }else if(document.fullscreenElement){
          void document.exitFullscreen().catch(()=>{});
        }
        revealControls();
        return;
      }
      if (!standaloneChapters&&!chapterPicker.hidden) { event.preventDefault(); chapterPicker.hidden = true; }
      else if (menuOpen) { event.preventDefault(); closeContextMenu(); }
      else if (!infoPanel.hidden) { infoPanel.hidden = true; revealControls(); }
      else if (settingsDetails?.open) { event.preventDefault(); settingsDetails.open=false; settingsDetails.querySelector("summary")?.focus(); }
      else if (desktopFullscreen && screen.classList.contains("desktop-fullscreen")) {
        event.preventDefault();
        void desktopFullscreen.setFullscreen(false);
      }
      return;
    }
    const tag = event.target && event.target.tagName;
    const key = event.key.toLowerCase();
    const arrowSeek=key==="arrowleft"||key==="arrowright";
    if(stepFrame&&event.shiftKey&&arrowSeek&&!menuOpen&&!settingsDetails?.open&&infoPanel.hidden&&
       !["INPUT","TEXTAREA","SELECT"].includes(tag)&&!event.target?.isContentEditable&&current()){
      event.preventDefault();void stepFrame(key==="arrowleft"?-1:1);return;
    }
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)||event.target?.isContentEditable) return;
    // Keep native form/menu navigation intact, but a focused queue or
    // transport button must not swallow the standalone seek shortcut.
    if(tag==="BUTTON"&&!(standaloneChapters&&arrowSeek))return;
    if(standaloneChapters&&arrowSeek){
      if(menuOpen||settingsDetails?.open||!infoPanel.hidden||
         event.target?.closest?.('[role="dialog"],dialog,[role="menu"]'))return;
      if(!current()||state.stopped)return;
      const length=playbackDuration();
      if(!Number.isFinite(length)||length<=0)return;
      event.preventDefault();
      revealControls();
      skipTen(key==="arrowleft"?-10:10);
      return;
    }
    // Fullscreen is a window command, not a media-decoder command: F works
    // even on the welcome screen before the first file is selected.
    if (key === "f") {
      event.preventDefault();
      void toggleFullscreen();
      return;
    }
    if (!current()) return;
    if ([" ", "k", "arrowleft", "arrowright", "arrowup", "arrowdown", "m"].includes(key)) event.preventDefault();
    if (key === " " || key === "k") byId("playPause").click();
    if (key === "m") byId("mute").click();
    if (key === "arrowup") setVolume(volumePercent + 5);
    if (key === "arrowdown") setVolume(volumePercent - 5);
    if (key === "arrowleft" && Number.isFinite(playbackDuration()))
      setPlaybackPosition(Math.max(0,playbackSeconds()-5));
    if (key === "arrowright" && Number.isFinite(playbackDuration()))
      setPlaybackPosition(Math.min(playbackDuration(),playbackSeconds()+5));
  });
  window.addEventListener("pagehide", () => {
    cancelNextCountdown();resetVoiceover();
    cancelVideoClick();
    if (mkvAudio) mkvAudio.stop();
    clearTimeout(hideControlsTimer);
    clearTimeout(cursorIdleTimer);
    rememberPosition();
    if(codecPlayback)void codecPlayback.stop();
    clearSubtitles();
    state.queue.forEach(item => { releaseArtwork(item); releaseNetwork(item); releaseCompatible(item); if (item.kind === "file") URL.revokeObjectURL(item.src); });
  });
  idle();
  // Library selections launch in this original player window, not a new
  // playback implementation. Their durable ID resolves to the user's own
  // permissioned file, while the database stores no duplicated movie bytes.
  let externalChain=Promise.resolve();
  const acceptExternal=()=>{
    if(!window.DKLibraryBridge?.externalSelection)return Promise.resolve(false);
    externalChain=externalChain.catch(()=>{}).then(async()=>{
      const rows=await window.DKLibraryBridge.externalSelection();
      const selected=[];
      for(const {row,opened} of rows||[]){
        try{selected.push(window.DKNativeFile.create(row,opened,window.DKLibraryBridge));}
        catch(_){}
      }
      // One Open action lets the existing queue policy start only if idle.
      // Remaining files join Up Next without disturbing the current movie.
      if(selected.length){
        addFiles([selected[0].file],[],"open",{nativeSrc:selected[0].src});
        for(const item of selected.slice(1))
          addFiles([item.file],[],"queue",{nativeSrc:item.src});
      }
      return selected.length>0;
    }).catch(()=>{status("Cannot open the selected local video.");return false;});
    return externalChain;
  };
  window.DKLibraryBridge?.onExternalReady?.(()=>{deferStartup=false;void acceptExternal();});
  // Match durable identity first. A file opened by the OS can already have
  // a native file ID/path even if the library ID was not set at that time.
  function existingLibraryIndex(row){
    const matches=state.queue.map((item,index)=>({item,index})).filter(({item})=>
      item.kind==="file"&&(item.libraryId===row.id||item.file?.nativeId===row.id||
        (row.nativePath&&item.file?.nativePath===row.nativePath)));
    if(matches.length){
      return matches.find(entry=>entry.index===state.current)?.index??matches[0].index;
    }
    // Only reuse an unambiguous manually opened file with no known
    // conflicting library identity or native path.
    const key="file:"+row.filename+":"+row.size+":"+row.modified;
    const candidates=state.queue.map((item,index)=>({item,index})).filter(({item})=>
      item.kind==="file"&&item.key===key&&!item.libraryId&&!item.file?.nativeId&&!item.file?.nativePath);
    return candidates.length===1?candidates[0].index:-1;
  }
  const openFromLibrary = async (selectionId=null) => {
    const params=new URLSearchParams(window.location.search);
    const external=params.get("externalItem");
    if(!selectionId&&external&&window.DKLibraryBridge?.externalSelection){
      await acceptExternal();return true;
    }
    const id=selectionId||params.get("libraryItem");
    if(!id)return false;
    if(!window.DKLibraryStore){
      status("The local library is unavailable.");return true;
    }
    try{
      const row=await window.DKLibraryStore.item(id);
      if(!row)throw new Error("The library item was not found");
      const metadataFilename=row.kind==="tv"&&
        window.DKMediaMetadata?.parseFilename(row.filename)?.type!=="episode"?
        row.series+".S"+String(row.season).padStart(2,"0")+
          "E"+String(row.episode).padStart(2,"0")+
          row.filename.slice(row.filename.lastIndexOf(".")):
        row.filename;
      if(window.DKLibraryBridge?.internalPages){
        const index=existingLibraryIndex(row);
        if(index>=0){
          const item=state.queue[index];
          item.libraryId=id;
          item.episodeTitle=row.episodeTitle||item.episodeTitle||"";
          item.metadataFilename=metadataFilename;
          if(row.completed||row.watchResetAt){
            if(row.position>2&&!row.completed)state.resume[item.key]=Number(row.position);
            else delete state.resume[item.key];
            item.watchPending=0;write(store.resume,state.resume);
          }else if(!(Number(state.resume[item.key])>2)&&Number(row.position)>2)
            state.resume[item.key]=Number(row.position);
          if(index===state.current&&!state.stopped){
            if(media.paused)playCurrent();
          }else load(index,true);
          return true;
        }
      }
      const selected=row.source==="native"?
        window.DKNativeFile.create(row,
          await window.DKLibraryBridge.nativeOpen(row.id,row.nativePath),
          window.DKLibraryBridge):
        await window.DKLibraryStore.openFile(row,{requestPermission:true});

      addFiles([selected.file],[selected.handle],"open",{
        libraryId:id,libraryPosition:row.position||0,libraryHistoryReset:!!(row.completed||row.watchResetAt),
        episodeTitle:row.episodeTitle||"",metadataFilename,
        nativeSrc:selected.src||null
      });
      if(window.DKLibraryBridge?.internalPages){
        const index=existingLibraryIndex(row);
        if(index>=0&&index!==state.current)load(index,true);
      }
      return true;
    }catch(error){
      status("Cannot open this library video. Reconnect its folder or grant permission.");
      return true;
    }
  };
  // Progressive translation prioritizes cues near and ahead of the playhead.
  // Original text remains visible until each complete cue is translated.
  function refreshTranslationControls(){
    const start=byId("dkTranslateStart");if(!start)return;
    const track=subtitleTracks().find(t=>t.mode==="showing");
    start.disabled=!translationReady||translationBusy||!current()||state.stopped||
      !!state.activePgsTrack||!track?.cues?.length||!!translationOriginals;
    byId("dkTranslateCancel").disabled=!translationBusy;
    byId("dkTranslateRestore").disabled=!translationOriginals;
    byId("dkTranslateDirection").disabled=translationBusy;
    byId("dkTranslateExport").disabled=!translationSession?.complete||translationBusy||!window.DKLibraryBridge?.exportTranslatedSRT;
  }
  function resetTranslation(){
    translationRun++;
    if(translationBusy)void window.DKLibraryBridge?.cancelTranslation?.().catch(()=>{});
    if(translationOriginals){
      for(const {cue,text} of translationOriginals)try{cue.text=text;}catch(_){}
      translationOriginals=null;
    }
    translationSession=null;
    const progress=byId("dkTranslateProgress");
    if(progress)progress.textContent="";
    const label=byId("dkTranslateStatus");
    if(label)label.textContent=translationReady?"Select a text subtitle track":"Offline language model not installed";
    refreshTranslationControls();
  }
  function setupTranslation(){
    const bridge=window.DKLibraryBridge;
    if(!bridge?.internalPages||!bridge.translateSubtitles)return;
    const section=byId("subtitleTrackSelect")?.closest(".player-settings-section");
    if(!section)return;
    const group=document.createElement("div");
    group.className="player-settings-section dk-translation";
    group.innerHTML='<strong>Offline subtitle translation</strong><label for="dkTranslateDirection">Translation direction</label><select id="dkTranslateDirection"><option value="en-ru">English → Russian</option><option value="ru-en">Russian → English</option><option value="en-ar">English → Arabic</option><option value="ar-en">Arabic → English</option><option value="ru-ar">Russian → Arabic</option><option value="ar-ru">Arabic → Russian</option></select><label><input type="checkbox" id="dkTranslateBilingual"> Show original and translated subtitles</label><label><input type="checkbox" id="dkTranslateAuto"> Automatically translate selected text subtitles</label><button type="button" class="btn ghost small" id="dkTranslateStart">Translate selected subtitles</button><button type="button" class="btn ghost small" id="dkTranslateCancel" disabled>Cancel translation</button><button type="button" class="btn ghost small" id="dkTranslateRestore" disabled>Restore original subtitles</button><button type="button" class="btn ghost small" id="dkTranslateExport" disabled>Export translated SRT</button><span class="helper" id="dkTranslateStatus" role="status" aria-live="polite"></span><output id="dkTranslateProgress" aria-live="polite"></output>';
    section.after(group);
    const direction=byId("dkTranslateDirection"),label=byId("dkTranslateStatus"),progress=byId("dkTranslateProgress");
    const bilingual=byId("dkTranslateBilingual"),auto=byId("dkTranslateAuto");
    const key="dk-kinehall.subtitle-translation.v1",saved=read(key,{})||{};
    direction.value=["en-ru","ru-en","en-ar","ar-en","ru-ar","ar-ru"].includes(saved.direction)?saved.direction:"en-ru";
    bilingual.checked=saved.bilingual===true;auto.checked=saved.auto===true;
    const persist=()=>write(key,{direction:direction.value,bilingual:bilingual.checked,auto:auto.checked});
    const refreshLanguage=()=>{
      const tr=t=>window.DKLocale?.t(t)||t;
      const names={"en-ru":"English → Russian","ru-en":"Russian → English","en-ar":"English → Arabic","ar-en":"Arabic → English","ru-ar":"Russian → Arabic","ar-ru":"Arabic → Russian"};
      for(const option of direction.options)option.textContent=tr(names[option.value]);
    };
    const escapeText=value=>String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const valid=session=>session&&session.ticket===translationRun&&current()===session.item&&!state.stopped&&session.track.mode==="showing"&&!state.activePgsTrack;
    const applyCue=(session,row)=>{
      if(!row.pieces.every(p=>p.index===undefined||typeof session.result[p.index]==="string"))return;
      const text=row.pieces.map(p=>p.index===undefined?p.blank:session.result[p.index]).join("\n");
      row.translated=text;
      row.cue.text=bilingual.checked?escapeText(row.plain)+"\n"+escapeText(text):escapeText(text);
    };
    // Avoid retry storms: only auto-start once per selected track/direction
    // until a new selection, direction change or explicit user action.
    const attempted=new WeakMap();
    let statusTicket=0;
    const maybeAuto=()=>{
      if(!auto.checked||!translationReady||translationBusy||translationOriginals||!current()||state.stopped||state.activePgsTrack)return;
      const track=subtitleTracks().find(t=>t.mode==="showing");
      if(!track?.cues?.length||attempted.get(track)===direction.value)return;
      const source=normalizeSubtitleLanguage(track.language);
      // Automatically translate only known matching source languages.
      if(source!==direction.value.split("-")[0])return;
      attempted.set(track,direction.value);
      void startTranslation();
    };
    const check=async()=>{
      const ticket=++statusTicket;translationReady=false;refreshTranslationControls();
      label.textContent="Checking offline translation model…";
      const ready=await bridge.translationStatus(direction.value).catch(()=>false);
      if(ticket!==statusTicket)return;
      translationReady=ready;
      label.textContent=ready?"Select a text subtitle track":"Offline language model not installed";
      refreshTranslationControls();maybeAuto();
    };
    direction.addEventListener("change",()=>{persist();resetTranslation();void check();});
    bilingual.addEventListener("change",()=>{persist();if(valid(translationSession))for(const row of translationSession.rows)if(row.translated!==undefined)applyCue(translationSession,row);});
    auto.addEventListener("change",()=>{persist();maybeAuto();});
    byId("languageSelect")?.addEventListener("change",refreshLanguage);
    refreshLanguage();
    byId("dkTranslateCancel").addEventListener("click",resetTranslation);
    byId("dkTranslateRestore").addEventListener("click",resetTranslation);
    bridge.onTranslationProgress?.(data=>{
      const session=translationSession;
      if(!valid(session)||data.ticket!==session.ticket||!translationBusy||!Array.isArray(data.batch))return;
      for(let i=0;i<data.batch.length;i++)session.result[data.start+i]=data.batch[i];
      // The worker sends contiguous batches; touch only affected cues.
      const affected=new Set();
      for(let i=0;i<data.batch.length;i++){const row=session.owners[data.start+i];if(row)affected.add(row);}
      for(const row of affected)applyCue(session,row);
      if(data.total>0)progress.textContent=Math.min(100,Math.floor(data.done*100/data.total))+"%";
    });
    async function startTranslation(){
      if(translationBusy||!translationReady||translationOriginals)return;
      const item=current(),track=subtitleTracks().find(t=>t.mode==="showing");
      if(!item||state.stopped||!track?.cues?.length||state.activePgsTrack)return;
      attempted.set(track,direction.value);
      const originals=[],lines=[],owners=[],now=Number(media.currentTime)||0;
      const cues=Array.from(track.cues).filter(c=>typeof c.text==="string");
      // Current/future cues first, earlier cues afterward for seeking/export.
      cues.sort((a,b)=>Number(a.endTime<now)-Number(b.endTime<now)||a.startTime-b.startTime);
      for(const cue of cues){
        let plain=cue.text;
        try{plain=cue.getCueAsHTML().textContent;}catch(_){}
        const row={cue,text:cue.text,plain,pieces:[],translated:undefined};
        row.pieces=plain.split(/\r?\n/).map(part=>{
          if(!part.trim())return {blank:part};
          const index=lines.length;lines.push(part);owners.push(row);return {index};
        });
        if(row.pieces.some(p=>p.index!==undefined))originals.push(row);
      }
      if(!lines.length){label.textContent="No readable text subtitles";return;}
      const ticket=++translationRun;translationBusy=true;
      const session={ticket,item,track,rows:originals,owners,result:[],complete:false};
      translationSession=session;translationOriginals=originals;
      label.textContent="Translating subtitles locally…";progress.textContent="0%";refreshTranslationControls();
      try{
        const translated=await bridge.translateSubtitles(direction.value,lines,ticket);
        if(!valid(session))return;
        session.result=translated;
        for(const row of originals)applyCue(session,row);
        session.complete=true;
        label.textContent="Translated subtitles ready";progress.textContent="100%";
      }catch(_){
        if(valid(session)){
          for(const row of originals)try{row.cue.text=row.text;}catch(_){}
          translationOriginals=null;translationSession=null;
          label.textContent="Translation failed; original subtitles kept";progress.textContent="";
        }
      }finally{
        translationBusy=false;
        if(translationSession===session&&!valid(session))resetTranslation();
        refreshTranslationControls();
      }
    }
    byId("dkTranslateStart").addEventListener("click",()=>void startTranslation());
    byId("dkTranslateExport").addEventListener("click",async()=>{
      const session=translationSession;
      if(!valid(session)||!session.complete||!bridge.exportTranslatedSRT)return;
      const stamp=seconds=>{
        const ms=Math.max(0,Math.round(seconds*1000));
        return [Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60].map(n=>String(n).padStart(2,"0")).join(":")+","+String(ms%1000).padStart(3,"0");
      };
      // Export the actual source timeline, including native stream offset
      // and the current subtitle delay, not the loopback stream clock.
      const offset=codecPlayback?.isActive(session.item)?codecPlayback.offset(session.item):0;
      const rows=session.rows.filter(r=>r.translated!==undefined).sort((a,b)=>a.cue.startTime-b.cue.startTime);
      const content=rows.map((r,i)=>(i+1)+"\n"+stamp(r.cue.startTime+offset)+" --> "+stamp(r.cue.endTime+offset)+"\n"+r.translated.replace(/\r/g,"").replace(/\n{2,}/g,"\n")).join("\n\n")+"\n";
      try{if(await bridge.exportTranslatedSRT(content,window.DKLocale?.get()))status("Translated subtitles exported.",true);}
      catch(_){status("Could not save translated subtitles. Choose a new file name.");}
    });
    media.textTracks?.addEventListener("change",()=>{refreshTranslationControls();maybeAuto();});
    media.addEventListener("loadeddata",()=>{refreshTranslationControls();maybeAuto();});
    media.addEventListener("timeupdate",()=>{if(!translationBusy){refreshTranslationControls();maybeAuto();}});
    settingsDetails?.addEventListener("toggle",()=>{if(settingsDetails.open&&!translationReady&&!translationBusy)void check();});
    void check();
  }
  setupTranslation();
  // Pre-generated timed speech mixed with the original soundtrack. Speech recognition remains pending.
  function setupVoiceover(){
    const bridge=window.DKLibraryBridge;
    if(!bridge?.internalPages||!bridge.generateVoiceover)return;
    const group=document.createElement("div");
    group.className="player-settings-section dk-voiceover";group.id="voiceoverSettings";
    group.innerHTML='<strong>DK Voiceover</strong><p class="helper">Generate translated speech from original text subtitles or recognize dialogue from the movie locally.</p><label for="dkVoiceDirection">Translation direction</label><select id="dkVoiceDirection"><option value="en-ru">English → Russian</option><option value="ru-en">Russian → English</option><option value="en-ar">English → Arabic</option><option value="ar-en">Arabic → English</option><option value="ru-ar">Russian → Arabic</option><option value="ar-ru">Arabic → Russian</option><option value="auto">Detect source (English, Russian or Arabic)</option><option value="auto-en">Detect source → English</option><option value="auto-ru">Detect source → Russian</option><option value="auto-ar">Detect source → Arabic</option></select><label for="dkVoiceProfile">Voice profile</label><select id="dkVoiceProfile"><option value="default">Default voice</option><option value="male">Male voice (optional model)</option><option value="female">Female voice (optional model)</option><option value="speakers">Speaker-aware voices (optional models)</option></select><div class="dk-voiceover-cache" id="dkSpeakerSettings" hidden><p class="helper">Identify speakers in films up to three hours. Review anonymous voice assignments; uncertain speech uses the default voice.</p><button class="btn small" type="button" id="dkIdentifySpeakers" disabled>Identify speakers</button><span class="helper" id="dkSpeakerStatus" role="status" aria-live="polite"></span><div id="dkSpeakerAssignments"></div></div><span class="helper" id="dkVoiceDetected" role="status" aria-live="polite"></span><button class="btn small" type="button" id="dkSpeechGenerate" disabled>Generate subtitles from audio</button><button class="btn small" type="button" id="dkSpeechExport" disabled>Save generated subtitles</button><label><input type="checkbox" id="dkVoiceProgressive"> Play generated audio while synthesis continues</label><p class="helper">Current playback and nearby segments are generated first. Unfinished audio uses the original soundtrack.</p><button class="btn small" type="button" id="dkVoiceGenerate" disabled>Generate voiceover</button><button class="btn small" type="button" id="dkVoiceCancel" disabled>Cancel voiceover</button><label><input type="checkbox" id="dkVoiceEnabled" disabled> Enable voiceover</label><label for="dkVoiceOriginal">Original audio level</label><input type="range" id="dkVoiceOriginal" min="0" max="100" step="5" value="35"><output id="dkVoiceOriginalValue">35%</output><label for="dkVoiceLevel">Voiceover volume</label><input type="range" id="dkVoiceLevel" min="0" max="100" step="5" value="100"><output id="dkVoiceLevelValue">100%</output><label><input type="checkbox" id="dkVoiceSpeechDuck"> Reduce original audio only while translated speech is audible</label><label><input type="checkbox" id="dkVoiceCenter"> Reduce centered sound (stereo approximation)</label><p class="helper">Stereo center reduction can also reduce centered music and effects. It is not true dialogue separation.</p><button class="btn small" type="button" id="dkVoiceExport" disabled>Export voiceover audio</button><span class="helper" id="dkVoiceStatus" role="status" aria-live="polite"></span><progress id="dkVoiceProgress" max="100" value="0"></progress><output id="dkVoicePercent">0%</output>';
    byId("playerSettingsPanel").append(group);
    // Cache management remains usable even without installed speech models.
    const cacheControls=document.createElement("div");
    cacheControls.className="dk-voiceover-cache";
    cacheControls.innerHTML='<strong>Voiceover cache</strong><span class="helper">Saved soundtracks: <output id="dkVoiceCacheCount">—</output></span><span class="helper">Stored audio size (MiB): <output id="dkVoiceCacheSize">—</output></span><button type="button" class="btn small" id="dkVoiceCacheClear" disabled>Clear voiceover cache</button><span class="helper" id="dkVoiceCacheStatus" role="status" aria-live="polite"></span>';
    if(bridge.voiceoverCacheStats&&bridge.clearVoiceoverCache)group.append(cacheControls);
    const cacheCount=cacheControls.querySelector("#dkVoiceCacheCount"),cacheSize=cacheControls.querySelector("#dkVoiceCacheSize");
    const cacheClear=cacheControls.querySelector("#dkVoiceCacheClear"),cacheStatus=cacheControls.querySelector("#dkVoiceCacheStatus");
    let cacheBusy=false,cacheEntries=0,cacheEpoch=0;
    const cacheMessage=value=>{cacheStatus.textContent=value;window.DKLocale?.apply();};
    const updateCacheButton=()=>{cacheClear.disabled=cacheBusy||busy||exporting||cacheEntries<=0;};
    const refreshCache=async()=>{
      if(!bridge.voiceoverCacheStats)return;
      const epoch=++cacheEpoch;
      try{
        const info=await bridge.voiceoverCacheStats();
        if(epoch!==cacheEpoch)return;
        cacheEntries=Number.isSafeInteger(info.count)&&info.count>=0?info.count:0;
        const size=Number.isFinite(info.bytes)&&info.bytes>=0?info.bytes:0;
        const locale=window.DKLocale?.get()==="ru"?"ru-RU":"en-US";
        cacheCount.value=new Intl.NumberFormat(locale).format(cacheEntries);
        cacheSize.value=new Intl.NumberFormat(locale,{maximumFractionDigits:1}).format(size/1048576);
      }catch(_){
        if(epoch!==cacheEpoch)return;
        cacheEntries=0;cacheCount.value="—";cacheSize.value="—";cacheMessage("Could not read voiceover cache.");
      }finally{if(epoch===cacheEpoch)updateCacheButton();}
    };
    cacheClear.addEventListener("click",async()=>{
      if(cacheClear.disabled)return;
      cacheBusy=true;updateCacheButton();refreshVoiceover();
      try{
        const info=await bridge.clearVoiceoverCache(window.DKLocale?.get());
        if(!info.cancelled)cacheMessage(info.failed||info.count?"Some saved soundtracks could not be removed.":"Voiceover cache cleared.");
      }catch(_){cacheMessage("Could not clear voiceover cache.");}
      finally{cacheBusy=false;await refreshCache();refreshVoiceover();}
    });

    const direction=byId("dkVoiceDirection"),profile=byId("dkVoiceProfile"),generate=byId("dkVoiceGenerate"),cancel=byId("dkVoiceCancel"),exportButton=byId("dkVoiceExport");
    const label=byId("dkVoiceStatus"),progress=byId("dkVoiceProgress"),percent=byId("dkVoicePercent");
    let ready=false,busy=false,ticket=0,checkTicket=0,result=null,exporting=false;
    let speechReady=false,generated=null,recognizing=false,jobAudio=null;
    let availablePairs=new Set(),speakerReady=false,speakerState=null,analyzing=false;
    let voiceGain=null,voicePlaying=false,videoWaiting=false,voiceEpoch=0,playPending=false;
    let voiceAnalyser=null,voiceSamples=null,duckTimer=null,speechActive=false,lastSpeech=0;
    let sourceEpoch=0,loadedSegment=null,pendingSegment=null,segmentOffset=0,graphReady=false,lastPriority=-1;
    const voice=new Audio();voice.crossOrigin="anonymous";voice.preload="metadata";
    const enabled=byId("dkVoiceEnabled"),original=byId("dkVoiceOriginal"),level=byId("dkVoiceLevel"),progressive=byId("dkVoiceProgressive");
    const progressiveKey="dk-kinehall.voiceover-progressive.v1";
    progressive.checked=read(progressiveKey,false)===true;
    progressive.addEventListener("change",()=>write(progressiveKey,progressive.checked));
    const speechDuck=byId("dkVoiceSpeechDuck"),centerMode=byId("dkVoiceCenter");
    const mixKey="dk-kinehall.voiceover-mix.v1",mix=read(mixKey,{})||{};
    speechDuck.checked=mix.speechDuck!==false;centerMode.checked=mix.center===true;
    const percentValue=(value,fallback)=>Number.isFinite(Number(value))&&value!=null?Math.max(0,Math.min(100,Number(value))):fallback;
    original.value=String(percentValue(mix.original,35));level.value=String(percentValue(mix.level,100));
    const key="dk-kinehall.voiceover-direction.v1";
    const savedDirection=read(key,"en-ru");
    const pairs=["en-ru","ru-en","en-ar","ar-en","ru-ar","ar-ru"],directionNames={...{"en-ru":"English → Russian","ru-en":"Russian → English","en-ar":"English → Arabic","ar-en":"Arabic → English","ru-ar":"Russian → Arabic","ar-ru":"Arabic → Russian"},auto:"Detect source (English, Russian or Arabic)","auto-en":"Detect source → English","auto-ru":"Detect source → Russian","auto-ar":"Detect source → Arabic"};
    direction.value=Object.hasOwn(directionNames,savedDirection)?savedDirection:"en-ru";
    const profileKey="dk-kinehall.voiceover-profile.v1",savedProfile=read(profileKey,"default");
    profile.value=["default","male","female","speakers"].includes(savedProfile)?savedProfile:"default";
    const setStatus=value=>{label.textContent=window.DKLocale?.t(value)||value;};
    const setProgress=value=>{progress.value=value;percent.textContent=Math.floor(value)+"%";};
    const track=()=>subtitleTracks().find(t=>t.mode==="showing");
    const mixActive=()=>enabled.checked&&voicePlaying&&result?.item===current()&&!media.paused&&!media.ended&&!state.stopped&&
      voiceGain&&volumeAudioGraph?.context.state==="running"&&Number(level.value)>0;
    const duckActive=()=>mixActive()&&(!speechDuck.checked||!voiceAnalyser||speechActive);
    voiceoverOriginalFactor=()=>duckActive()?Number(original.value)/100:1;
    voiceoverCenterFactor=()=>duckActive()&&centerMode.checked?Number(original.value)/100:null;
    updateVoiceoverGain=()=>{
      if(voiceGain)voiceGain.gain.value=mixActive()&&!userMuted?volumePercent/100*Number(level.value)/100:0;
    };
    const updateMix=()=>{
      byId("dkVoiceOriginalValue").textContent=original.value+"%";
      byId("dkVoiceLevelValue").textContent=level.value+"%";
      write(mixKey,{original:Number(original.value),level:Number(level.value),speechDuck:speechDuck.checked,center:centerMode.checked});
      applyVolume();
    };
    const stopVoice=(clear=false)=>{
      voiceEpoch++;playPending=false;voicePlaying=false;speechActive=false;lastSpeech=0;voice.pause();
      if(clear){if(duckTimer!==null){clearInterval(duckTimer);duckTimer=null;}enabled.checked=false;sourceEpoch++;loadedSegment=null;pendingSegment=null;segmentOffset=0;graphReady=false;voice.removeAttribute("src");voice.load();}
      applyVolume();
    };
    const fallback=()=>{
      stopVoice(true);setStatus("Voiceover playback failed; original audio restored.");refreshVoiceover();
    };
    const selectSegment=position=>{
      if(!result)return null;
      if(result.complete)return {key:"full",index:null,offset:0};
      const index=Math.floor(position/30),duration=result.chunks?.get(index);
      if(!Number.isFinite(duration)||position>=index*30+duration)return null;
      return {key:"chunk-"+index,index,offset:index*30};
    };
    const loadVoiceSegment=async(segment)=>{
      const selected=result,epoch=++sourceEpoch;
      stopVoice();pendingSegment=segment.key;loadedSegment=null;
      voice.removeAttribute("src");voice.load();
      try{
        const src=await bridge.voiceoverSource(selected.ticket,segment.index);
        if(epoch!==sourceEpoch||result!==selected||!enabled.checked)return;
        pendingSegment=null;loadedSegment=segment.key;segmentOffset=segment.offset;
        voice.src=src;voice.load();syncVoice(true);
      }catch(_){
        if(epoch!==sourceEpoch)return;
        pendingSegment=null;loadedSegment=null;
        // A revoked/failed partial segment must not interrupt original playback.
        fallback();
      }
    };
    const syncVoice=(force=false)=>{
      if(!enabled.checked||!graphReady||!result||result.item!==current()||state.stopped||media.paused||media.ended||media.seeking||videoWaiting){
        if(voicePlaying||playPending||!voice.paused)stopVoice();
        return;
      }
      const position=Number(playbackSeconds());
      if(!Number.isFinite(position)||position<0)return;
      const segment=selectSegment(position);
      if(!segment){
        if(voicePlaying||playPending||!voice.paused)stopVoice();
        if(pendingSegment!==null){sourceEpoch++;pendingSegment=null;}
        return;
      }
      if(loadedSegment!==segment.key){
        if(pendingSegment!==segment.key)void loadVoiceSegment(segment);
        return;
      }
      if(voice.readyState<1)return;
      const relative=position-segmentOffset;
      if(!Number.isFinite(voice.duration)||relative<0||relative>=voice.duration){
        if(voicePlaying||playPending||!voice.paused)stopVoice();
        return;
      }
      try{
        if(force||Math.abs(voice.currentTime-relative)>.35)voice.currentTime=Math.max(0,relative);
        voice.playbackRate=media.playbackRate;
      }catch(_){fallback();return;}
      if(voice.paused&&!playPending){
        const epoch=voiceEpoch;playPending=true;
        voice.play().then(()=>{
          if(epoch!==voiceEpoch)return;
          playPending=false;voicePlaying=!voice.paused;applyVolume();
        }).catch(()=>{if(epoch===voiceEpoch){playPending=false;fallback();}});
      }
    };
    enabled.addEventListener("change",async()=>{
      if(!enabled.checked){stopVoice(true);return;}
      if(!result||!bridge.voiceoverSource||!ensureVolumeBoost()){fallback();return;}
      const selected=result,epoch=++sourceEpoch;
      try{
        const context=volumeAudioGraph.context;
        if(!voiceGain){
          voiceGain=context.createGain();voiceGain.gain.value=0;
          const source=context.createMediaElementSource(voice);
          source.connect(voiceGain);voiceGain.connect(volumeAudioGraph.output?.bus||context.destination);
          try{
            voiceAnalyser=context.createAnalyser();voiceAnalyser.fftSize=512;
            voiceSamples=new Float32Array(voiceAnalyser.fftSize);
            source.connect(voiceAnalyser);
            // Keep the analyser in an active render graph without audible
            // duplicate output.
            const silent=context.createGain();silent.gain.value=0;
            voiceAnalyser.connect(silent);silent.connect(context.destination);
          }catch(_){voiceAnalyser=null;voiceSamples=null;}
        }
        await context.resume();
        if(epoch!==sourceEpoch||result!==selected||!enabled.checked)return;
        graphReady=true;
        if(duckTimer===null)duckTimer=setInterval(()=>{
          if(!enabled.checked||!voiceAnalyser||!voiceSamples)return;
          let active=false;
          if(mixActive()){
            voiceAnalyser.getFloatTimeDomainData(voiceSamples);
            let power=0;for(const sample of voiceSamples)power+=sample*sample;
            const now=performance.now();
            if(Math.sqrt(power/voiceSamples.length)>.008)lastSpeech=now;
            active=lastSpeech>0&&now-lastSpeech<250;
          }
          if(active!==speechActive){speechActive=active;applyVolume();}
        },60);
        syncVoice(true);
      }catch(_){if(epoch===sourceEpoch)fallback();}
    });
    original.addEventListener("input",updateMix);level.addEventListener("input",updateMix);
    speechDuck.addEventListener("change",updateMix);centerMode.addEventListener("change",updateMix);
    for(const event of ["pause","seeking","ended","emptied","waiting","stalled"]){
      media.addEventListener(event,()=>{
        if(event==="waiting"||event==="stalled"||event==="emptied")videoWaiting=true;
        if(voicePlaying||playPending||!voice.paused)stopVoice();
      });
    }
    for(const event of ["playing","canplay","seeked","loadeddata"]){
      media.addEventListener(event,()=>{videoWaiting=false;syncVoice(true);});
    }
    const prioritize=()=>{
      if(!busy||!result||result.complete||!bridge.prioritizeVoiceover)return;
      const position=Math.max(0,Math.min(10800,Number(playbackSeconds())||0));
      const index=Math.floor(position/30);
      if(index===lastPriority)return;
      lastPriority=index;
      void bridge.prioritizeVoiceover(result.ticket,position).catch(()=>{});
    };
    media.addEventListener("timeupdate",()=>{prioritize();syncVoice();});
    media.addEventListener("seeked",prioritize);
    media.addEventListener("ratechange",()=>syncVoice(true));
    voice.addEventListener("loadedmetadata",()=>syncVoice(true));
    voice.addEventListener("playing",()=>{const segment=selectSegment(Number(playbackSeconds()));if(enabled.checked&&segment?.key===loadedSegment&&!media.paused&&!media.seeking&&!videoWaiting){voicePlaying=true;applyVolume();}else voice.pause();});
    voice.addEventListener("waiting",()=>{voicePlaying=false;applyVolume();});
    voice.addEventListener("pause",()=>{voicePlaying=false;applyVolume();});
    voice.addEventListener("ended",()=>{voicePlaying=false;applyVolume();});
    voice.addEventListener("error",()=>{if(enabled.checked&&loadedSegment!==null&&voice.getAttribute("src"))fallback();});
    updateMix();
    const speechButton=byId("dkSpeechGenerate"),speechExport=byId("dkSpeechExport");
    const localMovie=()=>{const item=current();return !!(item?.file&&item.kind==="file"&&!item.audio&&!item.file.dvdToken&&!state.stopped);};
    const audioOrdinal=()=>{
      const item=current();
      if(codecPlayback?.isActive(item))return item.codecAudioIndex||0;
      const selected=mkvAudio?.selectedNumber();
      if(selected!=null){const index=(item?.embeddedAudio||[]).findIndex(t=>t.number===selected);if(index>=0)return index;}
      const index=audioTracks().findIndex(t=>t.enabled);
      return Math.max(0,index);
    };
    const speakerSettings=byId("dkSpeakerSettings"),speakerButton=byId("dkIdentifySpeakers"),speakerStatus=byId("dkSpeakerStatus"),speakerAssignments=byId("dkSpeakerAssignments");
    const speakerNames={default:"Default voice",male:"Male voice (optional model)",female:"Female voice (optional model)"};
    const validSpeakers=()=>speakerState&&speakerState.item===current()&&speakerState.audio===audioOrdinal();
    const speakerMessage=value=>{speakerStatus.textContent=value;window.DKLocale?.apply();};
    const renderSpeakers=()=>{
      speakerAssignments.replaceChildren();
      if(!validSpeakers())return;
      for(let i=0;i<speakerState.count;i++){
        const label=document.createElement("label"),number=document.createElement("span"),select=document.createElement("select");
        label.htmlFor="dkSpeakerVoice"+i;label.append(document.createTextNode("Speaker "),number);
        number.textContent=String(i+1);select.id=label.htmlFor;
        for(const [value,name] of Object.entries(speakerNames)){
          const option=document.createElement("option");option.value=value;option.textContent=name;select.append(option);
        }
        select.value=speakerState.voices[i];
        select.addEventListener("change",()=>{
          if(!validSpeakers()||busy||exporting)return;
          speakerState.voices[i]=select.value;
          if(result){
            stopVoice(true);ticket++;result=null;
            void bridge.discardVoiceover().catch(()=>{});
            setProgress(0);setStatus("Voice assignment changed; generate voiceover again.");
          }
          refreshVoiceover();
        });
        speakerAssignments.append(label,select);
      }
      window.DKLocale?.apply();
    };
    const assignVoices=rows=>{
      if(!validSpeakers())throw Error("Speaker analysis missing");
      const segments=speakerState.segments;
      let cursor=0;
      return rows.map(row=>{
        while(cursor<segments.length&&segments[cursor].end<=row.start)cursor++;
        const scores=new Map();
        for(let i=cursor;i<segments.length&&segments[i].start<row.end;i++){
          const seg=segments[i],seconds=Math.max(0,Math.min(row.end,seg.end)-Math.max(row.start,seg.start));
          if(seconds>0)scores.set(seg.speaker,(scores.get(seg.speaker)||0)+seconds);
        }
        const ranked=[...scores].sort((a,b)=>b[1]-a[1]);
        const first=ranked[0],second=ranked[1];
        const clear=first&&first[1]>=Math.min(.25,(row.end-row.start)*.5)&&(!second||first[1]>second[1]+.1);
        return {...row,voice:clear?speakerState.voices[first[0]]||"default":"default"};
      });
    };
    speakerButton.addEventListener("click",async()=>{
      if(speakerButton.disabled)return;
      const item=current(),audio=audioOrdinal(),job=++ticket;
      if(result){stopVoice(true);result=null;await bridge.discardVoiceover().catch(()=>{});}
      jobAudio=audio;speakerState=null;renderSpeakers();busy=true;analyzing=true;setProgress(0);
      speakerMessage("Identifying speakers locally…");refreshVoiceover();
      try{
        const data=await localCodecBridge.identifySpeakers(item.file,audio,job);
        if(job!==ticket||item!==current()||audio!==audioOrdinal())return;
        if(!Number.isInteger(data?.count)||data.count<1||data.count>32||!Array.isArray(data.segments)||!data.segments.length)throw Error("No speakers");
        speakerState={item,audio,count:data.count,segments:data.segments,voices:Array.from({length:data.count},(_,i)=>i%2?"female":"male")};
        renderSpeakers();setProgress(100);speakerMessage(data.unassigned>0?"Speakers detected. Uncertain speech will use the default voice.":"Speakers detected. Review their voice assignments.");
      }catch(_){if(job===ticket){setProgress(0);speakerMessage("Speaker analysis failed or exceeds the three-hour limit.");}}
      finally{analyzing=false;busy=false;refreshVoiceover();}
    });
    const sourceLang=()=>direction.value.split("-")[0];
    const validGenerated=()=>generated&&generated.item===current()&&generated.requested===sourceLang()&&generated.audio===audioOrdinal();
    const detectedLabel=byId("dkVoiceDetected");
    const refreshDetected=()=>{
      detectedLabel.textContent=sourceLang()==="auto"&&validGenerated()?
        ({en:"Detected spoken language: English",ru:"Detected spoken language: Russian",ar:"Detected spoken language: Arabic"}[generated.language]||""):"";
      window.DKLocale?.apply();
    };
    const resolvedPair=()=>{
      if(sourceLang()!=="auto")return direction.value;
      if(!validGenerated())return null;
      const target=direction.value==="auto"?(generated.language==="en"?"ru":"en"):direction.value.split("-")[1];
      return generated.language+"-"+target;
    };
    const compatibleTrack=()=>{
      // Auto means inspect the selected audio, not trust subtitle metadata.
      if(sourceLang()==="auto")return null;
      const source=track();
      if(!source?.cues?.length||state.activePgsTrack||translationOriginals||translationBusy||
         (codecPlayback?.isActive(current())&&codecPlayback.offset(current())>0))return null;
      const language=normalizeSubtitleLanguage(source.language);
      return !language||language==="und"||language===sourceLang()?source:null;
    };
    const textRows=()=>{
      if(validGenerated())return generated.rows;
      const source=compatibleTrack();if(!source)return [];
      return Array.from(source.cues).flatMap(cue=>{
        let plain=cue.text;
        try{plain=cue.getCueAsHTML().textContent;}catch(_){}
        if(typeof plain!=="string"||!plain.trim()||!Number.isFinite(cue.startTime)||!Number.isFinite(cue.endTime))return [];
        return [{start:Math.max(0,cue.startTime),end:cue.endTime,text:plain.trim().replace(/\s+/g," ")}];
      }).filter(r=>r.end>r.start).sort((a,b)=>a.start-b.start);
    };
    refreshVoiceover=()=>{
      const currentAudio=audioOrdinal();
      if(jobAudio!==null&&jobAudio!==currentAudio&&(busy||result||generated||speakerState)){resetVoiceover();return;}
      const candidate=localMovie(),speech=!!(speechReady&&localCodecBridge?.recognizeSpeech);
      const pair=resolvedPair(),pairReady=pair?availablePairs.has(pair):ready;
      generate.disabled=!pairReady||busy||exporting||!candidate||(!speech&&!validGenerated()&&!compatibleTrack())||(profile.value==="speakers"&&!validSpeakers());
      speakerSettings.hidden=profile.value!=="speakers";
      const duration=playbackDuration();
      speakerButton.disabled=!speakerReady||!localCodecBridge?.identifySpeakers||busy||exporting||cacheBusy||!candidate||!(duration>0&&duration<=10800);
      for(const select of speakerAssignments.querySelectorAll("select"))select.disabled=busy||exporting||cacheBusy;
      speechButton.disabled=!speech||busy||exporting||!candidate;
      speechExport.disabled=!validGenerated()||busy||exporting;
      cancel.disabled=!busy;
      exportButton.disabled=!result||busy||exporting||result.item!==current();
      direction.disabled=busy||exporting||cacheBusy;profile.disabled=direction.disabled;progressive.disabled=direction.disabled;
      if(cacheBusy){generate.disabled=true;speechButton.disabled=true;speechExport.disabled=true;exportButton.disabled=true;}
      updateCacheButton();
      enabled.disabled=!result||exporting||result.item!==current()||!bridge.voiceoverSource||(!result.complete&&!result.chunks?.size);
    };
    resetVoiceover=()=>{
      stopVoice(true);videoWaiting=false;generated=null;speakerState=null;jobAudio=null;refreshDetected();renderSpeakers();speakerMessage("");
      if(busy||result){ticket++;result=null;void bridge.cancelSpeech?.().catch(()=>{});void bridge.discardVoiceover().catch(()=>{});}
      setProgress(0);setStatus(ready?"Choose original subtitles or generate them from audio.":"Offline voiceover runtime or voice model not installed.");
      refreshVoiceover();
    };
    const check=async()=>{
      const id=++checkTicket;ready=false;refreshVoiceover();
      setStatus("Checking offline voiceover runtime…");
      const [availability,asr,speakers]=await Promise.all([Promise.all(pairs.map(pair=>bridge.voiceoverStatus(pair,profile.value).catch(()=>false))),bridge.speechStatus?.().catch(()=>false),bridge.speakerStatus?.().catch(()=>false)]);
      if(id!==checkTicket)return;
      availablePairs=new Set(pairs.filter((pair,i)=>availability[i]));
      const target=direction.value.split("-")[1];
      ready=sourceLang()==="auto"?pairs.some(pair=>availablePairs.has(pair)&&(!target||pair.endsWith("-"+target))):availablePairs.has(direction.value);
      speechReady=!!asr;speakerReady=!!speakers;
      setStatus(ready?"Choose original subtitles or generate them from audio.":speechReady?"Speech recognition ready; voice models not installed.":"Offline voiceover runtime or voice model not installed.");
      refreshVoiceover();
    };
    direction.addEventListener("change",()=>{write(key,direction.value);resetVoiceover();void check();});
    profile.addEventListener("change",()=>{write(profileKey,profile.value);resetVoiceover();void check();});
    cancel.addEventListener("click",resetVoiceover);
    bridge.onSpeechProgress?.(data=>{
      if(!busy||(!recognizing&&!analyzing)||data.ticket!==ticket)return;
      setProgress(data.percent);
      if(analyzing){speakerMessage(data.stage==="speaker-extract"?"Extracting movie audio…":"Identifying speakers locally…");return;}
      setStatus(data.stage==="extract"?"Extracting movie audio…":data.stage==="cached"?"Using saved subtitles.":data.stage==="detect"?"Detecting spoken language locally…":"Recognizing dialogue locally…");
    });
    bridge.onVoiceoverProgress?.(data=>{
      if(!busy||recognizing||data.ticket!==ticket)return;
      if(data.stage==="chunk"){
        if(result?.ticket===ticket&&!result.complete&&Number.isInteger(data.index)&&data.index>=0&&data.index<360&&Number.isFinite(data.duration)&&data.duration>0&&data.duration<=30){
          result.chunks.set(data.index,data.duration);refreshVoiceover();syncVoice();
        }
        return;
      }
      if(!data.total)return;
      const fraction=data.done/data.total;
      setProgress(Math.min(99,data.stage==="complete"?99:fraction*99));
      setStatus("Translating and generating speech…");
    });
    const obtainSpeech=async(item,job,audio)=>{
      if(!speechReady||!localCodecBridge?.recognizeSpeech)throw Error("Speech runtime unavailable");
      recognizing=true;setProgress(0);setStatus("Extracting movie audio…");
      try{
        const data=await localCodecBridge.recognizeSpeech(item.file,sourceLang(),audio,job);
        if(job!==ticket||current()!==item||audioOrdinal()!==audio)throw Error("Speech request expired");
        if(!Array.isArray(data?.rows)||!data.rows.length||typeof data.srt!=="string")throw Error("No speech recognized");
        const requested=sourceLang(),language=data.language||(requested==="auto"?null:requested);
        if(!["en","ru","ar"].includes(language)||(requested!=="auto"&&language!==requested))throw Error("Unsupported speech language");
        generated={item,requested,language,audio,rows:data.rows,srt:data.srt};refreshDetected();
        return data.rows;
      }finally{recognizing=false;}
    };
    const showGenerated=()=>{
      if(!validGenerated())return;
      const vtt="WEBVTT\n\n"+generated.rows.map((row,i)=>{
        const stamp=n=>{const ms=Math.max(0,Math.round(n*1000));return [Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60].map(v=>String(v).padStart(2,"0")).join(":")+"."+String(ms%1000).padStart(3,"0");};
        const plain=String(row.text).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
        return (i+1)+"\n"+stamp(row.start)+" --> "+stamp(row.end)+"\n"+plain;
      }).join("\n\n");
      const saved={item:current(),vtt,label:"Generated subtitles",language:generated.language};
      state.nativeSubtitle=saved;
      installSubtitleVTT(shiftedWebVtt(vtt,codecPlayback?.isActive(saved.item)?codecPlayback.offset(saved.item):0),saved.label,saved.language,null,true);
    };
    speechButton.addEventListener("click",async()=>{
      if(speechButton.disabled)return;
      const item=current(),job=++ticket,audio=audioOrdinal();jobAudio=audio;busy=true;refreshVoiceover();
      try{
        await obtainSpeech(item,job,audio);
        if(job!==ticket||current()!==item)return;
        showGenerated();setProgress(100);setStatus("Generated subtitles ready.");
      }catch(_){if(job===ticket){setProgress(0);setStatus(sourceLang()==="auto"?"Automatic detection or transcription failed; select the original language manually.":"Could not generate subtitles from audio.");}}
      finally{busy=false;refreshVoiceover();}
    });
    speechExport.addEventListener("click",async()=>{
      if(speechExport.disabled||!validGenerated())return;
      exporting=true;refreshVoiceover();
      try{if(await bridge.exportGeneratedSRT(generated.srt,window.DKLocale?.get()))setStatus("Generated subtitles saved.");}
      catch(_){setStatus("Could not save generated subtitles.");}
      finally{exporting=false;refreshVoiceover();}
    });
    generate.addEventListener("click",async()=>{
      if(generate.disabled)return;
      const item=current(),audio=audioOrdinal();let rows=textRows();
      stopVoice(true);
      const job=++ticket;jobAudio=audio;result=null;busy=true;setProgress(0);refreshVoiceover();
      try{
        if(!rows.length)rows=await obtainSpeech(item,job,audio);
        if(job!==ticket||current()!==item||audioOrdinal()!==audio)return;
        const pair=resolvedPair();
        if(pair&&pair.split("-")[0]===pair.split("-")[1]){setStatus("The original and target languages match. Choose another target.");setProgress(0);return;}
        if(!pair||!availablePairs.has(pair)){setStatus("The detected translation direction is not installed.");setProgress(0);return;}
        setProgress(0);setStatus("Translating dialogue…");
        const prepared=profile.value==="speakers"?assignVoices(rows):rows;
        const incremental=progressive.checked;
        if(incremental)result={item,ticket:job,complete:false,chunks:new Map()};
        const position=Math.max(0,Math.min(10800,Number(playbackSeconds())||0));
        lastPriority=Math.floor(position/30);
        const info=await bridge.generateVoiceover(pair,prepared,job,profile.value,incremental,position);
        if(job!==ticket||current()!==item){await bridge.discardVoiceover();return;}
        if(result?.ticket===job){result.complete=true;syncVoice(true);}
        else result={item,ticket:job,complete:true,chunks:new Map()};
        setProgress(100);
        setStatus(info.cached?(info.skipped?"Cached voiceover ready; some lines could not fit their timing.":"Cached voiceover audio ready."):(info.skipped?"Voiceover ready; some lines could not fit their timing.":"Voiceover audio ready."));
      }catch(_){if(job===ticket){stopVoice(true);result=null;setStatus("Voiceover generation failed; original playback unchanged.");setProgress(0);}}
      finally{busy=false;refreshVoiceover();void refreshCache();}
    });
    exportButton.addEventListener("click",async()=>{
      if(exportButton.disabled||!result)return;
      exporting=true;refreshVoiceover();
      try{if(await bridge.exportVoiceover(result.ticket,window.DKLocale?.get()))setStatus("Voiceover audio exported.");}
      catch(_){setStatus("Could not save voiceover. Choose a new file name.");}
      finally{exporting=false;refreshVoiceover();}
    });
    const localize=()=>{const tr=value=>window.DKLocale?.t(value)||value;for(const option of direction.options)option.textContent=tr(directionNames[option.value]);const names={default:"Default voice",male:"Male voice (optional model)",female:"Female voice (optional model)",speakers:"Speaker-aware voices (optional models)"};for(const option of profile.options)option.textContent=tr(names[option.value]);refreshDetected();};
    byId("languageSelect")?.addEventListener("change",()=>{localize();void refreshCache();});localize();
    media.addEventListener("timeupdate",refreshVoiceover);
    media.addEventListener("loadeddata",refreshVoiceover);
    media.textTracks?.addEventListener("change",refreshVoiceover);
    settingsDetails?.addEventListener("toggle",()=>{if(settingsDetails.open){if(!ready&&!busy)void check();void refreshCache();}});
    void check();void refreshCache();
  }
  setupVoiceover();
  if(window.DKLibraryBridge?.internalPages){
    // This is a live projection of the real controls, not a second settings
    // store. Exclude actions that depend on a selected movie or open files.
    const panel=byId("playerSettingsPanel");
    const globalSubtitles=document.createElement("section");
    globalSubtitles.className="player-settings-section";
    globalSubtitles.id="globalSubtitleSettings";
    const subtitleHeading=document.createElement("strong");subtitleHeading.textContent="Default text subtitles";
    const subtitleLabel=document.createElement("label");subtitleLabel.htmlFor="defaultSubtitleLanguage";subtitleLabel.textContent="Preferred text subtitle language";
    const subtitleChoice=document.createElement("select");subtitleChoice.id="defaultSubtitleLanguage";
    for(const [value,label] of [["remembered","Remembered track"],["off","Subtitles off"],["en","English"],["ru","Russian"],["ar","Arabic"]]){
      const option=document.createElement("option");option.value=value;option.textContent=label;subtitleChoice.append(option);
    }
    const subtitleNote=document.createElement("p");subtitleNote.className="helper";
    subtitleNote.textContent="Applies to matching text tracks. Per-file embedded subtitle choices are preserved.";
    const syncSubtitleDefault=()=>{
      const pref=state.subtitlePreference;
      subtitleChoice.value=pref.mode!=="track"?"off":!pref.label&&["en","ru","ar"].includes(normalizeSubtitleLanguage(pref.language))?normalizeSubtitleLanguage(pref.language):"remembered";
      subtitleChoice.options[0].disabled=subtitleChoice.value!=="remembered";
    };
    subtitleChoice.addEventListener("change",()=>{
      if(subtitleChoice.value==="remembered")return;
      state.subtitlePreference=subtitleChoice.value==="off"?{mode:"off"}:{mode:"track",label:"",language:subtitleChoice.value};
      write(store.subtitlePreference,state.subtitlePreference);syncSubtitleDefault();
      if(!sharedSettingsEditing&&current()&&!state.stopped)applySubtitlePreference();
    });
    globalSubtitles.append(subtitleHeading,subtitleLabel,subtitleChoice,subtitleNote);panel.append(globalSubtitles);
    syncSubtitleDefault();
    const allowedSections=()=>[
      byId("playbackFormat")?.closest(".player-settings-section"),
      byId("segmentSkipSettings"),
      globalSubtitles,
      byId("pictureEnhancements"),
      byId("picture-fit")?.closest(".player-settings-section"),
      byId("deinterlaceMode")?.closest(".player-settings-section"),
      byId("smoothingMode")?.closest(".player-settings-section"),
      byId("audioEnhancementsEnabled")?.closest(".player-settings-section")
    ].filter(Boolean);
    // Window actions from the old Picture context menu belong here too.
    // They are local player actions, not global Library preferences.
    const pictureDisplay=document.createElement("section");
    pictureDisplay.className="player-settings-section dk-picture-settings";
    pictureDisplay.id="pictureDisplayActions";
    const displayTitle=document.createElement("strong");
    displayTitle.textContent="Display mode";
    const fullAction=document.createElement("button"),pipAction=document.createElement("button");
    fullAction.type=pipAction.type="button";fullAction.className=pipAction.className="btn small";
    const syncDisplayActions=()=>{
      fullAction.textContent=isFullscreen()?"Exit fullscreen":"Fullscreen";
      pipAction.textContent="Picture in picture";
      pipAction.disabled=byId("pip").hidden||byId("pip").disabled;
      window.DKLocale?.apply();
    };
    fullAction.addEventListener("click",()=>{settingsDetails.open=false;void toggleFullscreen();});
    pipAction.addEventListener("click",()=>{settingsDetails.open=false;byId("pip").click();});
    pictureDisplay.append(displayTitle,fullAction,pipAction);panel.append(pictureDisplay);
    settingsDetails.addEventListener("toggle",()=>{if(settingsDetails.open)syncDisplayActions();});
    document.addEventListener("fullscreenchange",syncDisplayActions);
    syncDisplayActions();
    const categoryFor=section=>section.id==="voiceoverSettings"?"voiceover":section.id==="networkSettings"?"network":section.id==="dvdSettings"?"disc":section===globalSubtitles||section.classList.contains("dk-translation")||section.contains(byId("subtitleTrackSelect"))?"subtitles":section.classList.contains("dk-audio-settings")?"audio":section.contains(byId("playbackFormat"))?"playback":section.classList.contains("dk-picture-settings")?"picture":"general";
    const categories=[["playback","Playback"],["picture","Picture Settings"],["audio","Audio"],["subtitles","Subtitles"],["voiceover","Voiceover"],["disc","DVD & Disc"],["network","Network"],["general","General"]];
    const nav=document.createElement("div");nav.className="dk-settings-category-nav";
    const heading=document.createElement("strong");heading.textContent="Settings";nav.append(heading);
    const sections=Array.from(panel.querySelectorAll(":scope > .player-settings-section"));
    let selectedCategory=null;
    const chooseCategory=category=>{
      selectedCategory=category;
      for(const section of sections)section.hidden=categoryFor(section)!==category;
      for(const button of nav.querySelectorAll("button[data-category]"))button.hidden=!!category;
      back.hidden=!category;heading.textContent=categories.find(([id])=>id===category)?.[1]||"Settings";
      panel.scrollTop=0;window.DKLocale?.apply();
      panel.dispatchEvent(new Event("dk-settings-layout"));
    };
    openPictureAdjustments=()=>{
      if(!current()||current().audio||state.stopped)return;
      chooseCategory("picture");
      settingsDetails.open=true;
      keepControlsVisible();
      // Wait until the existing popover has entered the top layer.
      requestAnimationFrame(()=>{if(settingsDetails.open)byId("picturePreset")?.focus({preventScroll:true});});
    };
    const back=document.createElement("button");back.type="button";back.className="btn small";back.textContent="Back to settings";back.addEventListener("click",()=>chooseCategory(null));nav.append(back);
    for(const [id,label] of categories){if(!sections.some(section=>categoryFor(section)===id))continue;const button=document.createElement("button");button.type="button";button.className="btn";button.dataset.category=id;button.textContent=label;button.addEventListener("click",()=>chooseCategory(id));nav.append(button);}
    byId("closePlayerSettings")?.after(nav);chooseCategory(null);
    settingsDetails.addEventListener("toggle",()=>{if(!settingsDetails.open)chooseCategory(null);});
    const controlMap=new Map();
    const exclude=new Set(["rate","nativeExportVideo"]);
    let sequence=0;
    const controlId=node=>{
      if(!node.dataset.sharedSetting)node.dataset.sharedSetting="shared-"+(++sequence);
      controlMap.set(node.dataset.sharedSetting,node);return node.dataset.sharedSetting;
    };
    const available=node=>!exclude.has(node.id)&&!node.closest("[data-media-only]")&&!(node.id==="picture-geometry-x"||node.id==="picture-geometry-y");
    const snapshot=()=>{
      syncSubtitleDefault();controlMap.clear();beginDefaultPicture?.();
      try{return allowedSections().map(section=>{
        const clone=section.cloneNode(true);window.DKLocale?.restoreClone(section,clone);clone.hidden=false;clone.dataset.settingsCategory=categoryFor(section);
        const live=Array.from(section.querySelectorAll("input,select,button"));
        const copies=Array.from(clone.querySelectorAll("input,select,button"));
        live.forEach((node,i)=>{
          const copy=copies[i];
          if(!available(node)){
            if(node.id==="picture-geometry-x"||node.id==="picture-geometry-y")copy.closest(".dk-picture-adjustment")?.remove();
            else {clone.querySelector('label[for="'+node.id+'"]')?.remove();copy.remove();}
            return;
          }
          copy.dataset.sharedSetting=controlId(node);
          if(node.tagName==="SELECT"){
            Array.from(copy.options).forEach((option,j)=>{
              option.toggleAttribute("selected",node.options[j].selected);
            });
          }else if(node.tagName==="INPUT"){
            if(node.type==="checkbox")copy.toggleAttribute("checked",node.checked);
            else copy.setAttribute("value",node.value);
          }
          copy.toggleAttribute("disabled",node.disabled);
        });
        clone.querySelectorAll(".dk-picture-profile-actions").forEach(node=>node.remove());
        return clone.outerHTML;
      });}finally{endDefaultPicture?.();}
    };
    window.DKSharedSettings=Object.freeze({snapshot,change:(id,action,value)=>{
      const node=controlMap.get(id);
      if(!node||node.disabled||!node.isConnected||!available(node))throw Error("Shared setting unavailable");
      sharedSettingsEditing=true;
      const pictureChange=byId("pictureEnhancements")?.contains(node);if(pictureChange)beginDefaultPicture?.();
      try{
        if(action==="click"&&node.tagName==="BUTTON"){node.click();}
        else if(action==="change"&&(node.tagName==="SELECT"||node.tagName==="INPUT")){
          if(node.type==="checkbox"){if(typeof value!=="boolean")throw Error("Invalid setting");node.checked=value;}
          else if(node.tagName==="SELECT"){
            if(!Array.from(node.options).some(o=>o.value===value&&!o.disabled))throw Error("Invalid option");
            node.value=value;
          }else if(node.type==="range"){
            const n=Number(value);if(!Number.isFinite(n)||n<Number(node.min)||n>Number(node.max))throw Error("Invalid range");
            node.value=String(n);node.dispatchEvent(new Event("input",{bubbles:true}));
          }else throw Error("Unsupported setting");
          node.dispatchEvent(new Event("change",{bubbles:true}));
        }else throw Error("Unsupported setting action");
      }finally{sharedSettingsEditing=false;if(pictureChange)endDefaultPicture?.();}
      return snapshot();
    }});
  }
  let librarySelectionChain=Promise.resolve();
  window.DKLibraryBridge?.onLibrarySelection?.(id=>{
    deferStartup=false;
    librarySelectionChain=librarySelectionChain.catch(()=>{}).then(()=>openFromLibrary(id));
  });
  window.DKLibraryBridge?.onActivatePlayer?.(()=>{
    if(!deferStartup)return;deferStartup=false;
    librarySelectionChain=librarySelectionChain.catch(()=>{}).then(async()=>{
      if(!state.queue.length&&!await acceptExternal()){await restoreLastMedia();await restoreSavedFolder();}
    });
  });
  // Restore plain file selection only when this is not a library launch.
  librarySelectionChain=librarySelectionChain.catch(()=>{}).then(async()=>{
    if(deferStartup)return;
    const selected=await openFromLibrary();
    if(!selected&&!await acceptExternal()){
      await restoreLastMedia();
      await restoreSavedFolder();
    }
  });
})();