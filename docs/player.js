(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const media = byId("media");
  let translationRun=0,translationBusy=false,translationReady=false,translationOriginals=null;
  let translationSession=null;
  let resetVoiceover=()=>{},refreshVoiceover=()=>{},voiceoverOriginalFactor=()=>1,updateVoiceoverGain=()=>{};
  let nextCountdown=null;
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
  // Keep catalog writes ordered even if playback ends during identity recovery.
  const saveLibraryProgress=(item,position,duration,completed=false)=>{
    const catalog=window.DKLibraryStore;
    if(!catalog||!item)return;
    if(!window.DKLibraryBridge?.internalPages){
      if(item.libraryId)void catalog.updateProgress(item.libraryId,position,duration,completed).catch(()=>{});
      return;
    }
    if(!item.file||item.audio||item.file.dvdToken)return;
    item.historyWrites=(item.historyWrites||Promise.resolve()).catch(()=>{}).then(async()=>{
      const id=item.libraryId||item.file.nativeId;
      if(id&&await catalog.updateProgress(id,position,duration,completed)){
        item.libraryId=id;return;
      }
      // A scan may not have indexed this file yet. Retry periodically, not
      // on every clock tick, and always attempt a final completion write.
      const now=Date.now();
      if(!completed&&now-(item.historyLookupAt||0)<15000)return;
      item.historyLookupAt=now;
      const row=await catalog.resolvePlaybackEntry(item.file,id);
      if(!row)return;
      if(await catalog.updateProgress(row.id,position,duration,completed)){
        item.libraryId=row.id;
      }
    }).catch(()=>{});
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
      rus:"ru",ita:"it",por:"pt",jpn:"ja"}[lang] || lang;
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
  const subtitleIsOn = () => !!state.activePgsTrack ||
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
        (item.nativeSubtitleTracks||[]).some(isTextNativeSubtitle)));
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
      "Reading embedded MKV subtitles…" : state.activePgsTrack ?
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
    const isPlaying = !!item && !media.paused && !media.ended;
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
    if(current()===item)updateChapterMarkers();
  };
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
  const idle = () => {
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
    const result = media.play();
    if (result && typeof result.catch === "function") result.catch(err => {
      if (err && err.name === "NotAllowedError") status("Tap Play to start playback on this device.");
      else if (err && err.name !== "AbortError") status("Couldn't start this media. Check its format or source.");
    });
  };
  const load = (index, autoplay = true) => {
    if (index < 0 || index >= state.queue.length) return;
    cancelNextCountdown();resetVoiceover();
    const previous=current();
    if(previous?.remuxAbort){
      previous.remuxAbort.abort();
      previous.remuxAbort=null;
    }
    if (seekPreview) seekPreview.reset();
    if (!state.stopped) rememberPosition();
    if(previous)previous.historyReady=false;
    if(codecPlayback?.isActive(previous))void codecPlayback.stop();
    state.stopped = false;
    clearSubtitles();
    if (mkvAudio) mkvAudio.stop();
    media.pause();
    state.current = index;
    const item = current();
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
    item.nativeAlternateAttempted = false;
    item.codecActive = false;
    item.codecRestart = false;
    item.compatPending = false;
    item.requestedFormat = item.kind==="network"?"original":item.file?.dvdToken?"auto":playbackSettings.format;
    item.deinterlaceMode=standaloneDeinterlace&&item.requestedFormat!=="original"?deinterlacePreference:"off";
    item.activeDeinterlace="off";
    item.smoothingMode=standaloneDeinterlace&&item.requestedFormat!=="original"?smoothingPreference:"off";
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
    if (item.file?.dvdToken || needsRemux || cannotConvert) {
      // Do not play an MKV under an MP4/WebM label before remuxing finishes.
      media.removeAttribute("src");
    } else {
      media.src = item.requestedFormat === "auto" ? (item.compatSrc || item.src) : item.src;
    }
    media.load();
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
        if(info.hasVideo===false&&info.hasAudio){item.audio=true;screen.classList.add("audio");}
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
  const tryNativeCodec = async item => {
    if(!codecPlayback||!item?.file||item.codecAttempted ||
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
    const at=Number.isFinite(resume)&&resume>0?resume:
      (Number.isFinite(media.currentTime)?Math.max(0,media.currentTime):0);
    const preferred=state.audioPreferences[item.key];
    if(preferred?.mode==="mkv") {
      const ordinal=(item.embeddedAudio||[]).findIndex(t=>t.number===preferred.number);
      if(ordinal>=0)item.codecAudioIndex=ordinal;
    }
    return codecPlayback.start(item,at,Boolean(item.autoplayRequested),
      ["mp4","webm"].includes(item.requestedFormat)?
          item.requestedFormat:"auto");
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
  const releaseNetwork=item=>{if(item?.networkToken)void window.DKLibraryBridge?.networkRelease(item.networkToken).catch(()=>{});};
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
      if(item.libraryId&&Number(artData?.libraryPosition)>2 &&
         !Number.isFinite(Number(state.resume[item.key])))
        state.resume[item.key]=Number(artData.libraryPosition);
      else if(item.libraryId&&Number(artData?.libraryPosition)>2 &&
              !Number(state.resume[item.key]))
        state.resume[item.key]=Number(artData.libraryPosition);
      if (!file.dvdToken&&/\.mkv$/i.test(file.name) && window.DKMkvChapters) {
        void window.DKMkvChapters.inspectFile(file).then(chapters=>{
          if (!state.queue.includes(item)) return;
          mergeChapters(item,chapters);
        }).catch(()=>{});
      }
      if (!file.dvdToken&&/\.mkv$/i.test(file.name) && window.DKMatroska) {
        item.mkvInspection = "pending";
        void window.DKMatroska.inspectFile(file).then(result => {
          if (!state.queue.includes(item)) return;
          item.embeddedSubtitles = result.tracks || [];
          item.embeddedAudio = result.audioTracks || [];
          item.embeddedVideo = result.videoTracks || [];
          item.mkvInspection = result.truncated ? "partial" : "complete";
          if (current() === item) {
            updateSubtitleStatus(); restoreAudioPreference(); restoreEmbeddedSubtitlePreference(item);
            refreshOpenSubtitleMenu();
            if(item.compatPending){
              item.compatPending=false;
              void tryCompatibleFallback(item).then(ok=>{
                if(!ok && current()===item)void tryNativeCodec(item);
              });
            }
          }
        }).catch(() => {
          item.mkvInspection = "unavailable";
          if (current() === item) {
            updateSubtitleStatus();
            refreshOpenSubtitleMenu();
            if(item.compatPending){
              item.compatPending=false;
              void tryNativeCodec(item);
            }
          }
        });
      }
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
    if (!current()) return;
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
    const buttons=[];let choosing=false;
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
          if(!result.id||typeof result.name!=="string")return;
          const file=Object.freeze({nativeVirtual:true,dvdToken:result.id,name:result.name,
            size:0,lastModified:0,type:"video/mpeg",webkitRelativePath:""});
          // Same queue and video element; the placeholder is never loaded as a URL.
          addFiles([file],[],"open",{nativeSrc:"about:blank"});
          const index=state.queue.findIndex(item=>item.key===result.id);
          if(index>=0&&index!==state.current)load(index,true);
          settingsDetails.open=false;if(dvdDialog.open)dvdDialog.close();
        }catch(_){status("Cannot open this DVD title. Check the disc, title, chapter and angle.");}
        finally{choosing=false;buttons.forEach(b=>b.disabled=false);}
      });
    }
    const note=document.createElement("p");note.className="helper";
    note.textContent="DVD titles use automatic native decoding. A compatible decoder is required. Menus and disc subtitles are not supported yet. Disc selections are session-only.";
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
    const url=document.createElement("input");url.type="url";url.placeholder="http://192.168.1.10/video.mp4";url.setAttribute("aria-label","Network media URL");
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
    const addNetwork=async(serverId,address,name,audio=false)=>{
      if(opening)return;opening=true;const epoch=generation;
      try{
        say("Opening network media…");
        const grant=await bridge.networkGrant(serverId,address);
        if(!dlg.open||epoch!==generation){void bridge.networkRelease(grant.token).catch(()=>{});return;}
        const item={kind:"network",networkToken:grant.token,key:"network:"+grant.token,
          name:String(name||"Network media").slice(0,250),audio,src:grant.src,
          embeddedSubtitles:[],embeddedAudio:[],embeddedVideo:[],chapters:[],mkvInspection:"not-mkv"};
        if(queueOnly.checked&&state.queue.length){state.queue.push(item);renderQueue();}
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
      }catch(_){if(dlg.open&&epoch===generation)say("Network discovery failed.");}
    };
    const openServer=async server=>{
      const epoch=++generation;results.replaceChildren();say("Reading media server…");
      try{
        const info=await bridge.networkDescription(server.id);
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
    const browse=async(ctx,trail,start)=>{
      const epoch=++generation;results.replaceChildren();say("Loading media folder…");
      const folder=trail[trail.length-1];
      try{
        const soap=parse(await bridge.networkBrowse(ctx.id,ctx.control,ctx.type,folder.id,start));
        const result=first(soap,"Result");
        const doc=parse(result);
        if(!dlg.open||epoch!==generation)return;
        say(folder.name);
        results.append(makeButton(trail.length>1?"Parent folder":"Back to servers",()=>trail.length>1?void browse(ctx,trail.slice(0,-1),0):void showServers()));
        for(const element of Array.from(doc.documentElement.children).slice(0,100)){
          const id=element.getAttribute("id"),name=first(element,"title").slice(0,250)||translate("Untitled");
          if(element.localName==="container"&&id!==null){
            results.append(makeButton("▸ "+name,()=>void browse(ctx,[...trail,{id,name}],0)));continue;
          }
          if(element.localName!=="item")continue;
          const cls=first(element,"class");
          const resource=nodes(element,"res").find(r=>/^http-get:[^:]*:(video\/|audio\/|application\/octet-stream)/i.test(r.getAttribute("protocolInfo")||"")&&r.textContent.trim());
          if(!resource||!/^object\.item\.(videoItem|audioItem)/i.test(cls))continue;
          let address;try{address=new URL(resource.textContent.trim(),ctx.base).href;}catch(_){continue;}
          results.append(makeButton("▶ "+name,()=>void addNetwork(ctx.id,address,name,/audioItem/i.test(cls))));
        }
        const count=Number(first(soap,"NumberReturned")),total=Number(first(soap,"TotalMatches"));
        if(start>0)results.append(makeButton("Previous page",()=>void browse(ctx,trail,Math.max(0,start-100))));
        if(count>0&&Number.isFinite(total)&&start+count<total)results.append(makeButton("Next page",()=>void browse(ctx,trail,start+count)));
      }catch(_){if(dlg.open&&epoch===generation){say("Cannot read this media folder.");results.append(makeButton("Back to servers",()=>void showServers()));}}
    };
    const direct=makeButton("Open network URL",()=>{
      try{
        const address=new URL(url.value.trim());
        const name=decodeURIComponent(address.pathname.split("/").filter(Boolean).pop()||address.host);
        void addNetwork(null,address.href,name,/\.(mp3|flac|wav|m4a|aac|opus|ogg)$/i.test(name));
      }catch(_){say("Enter a valid network media URL.");}
    });
    const discover=makeButton("Find DLNA servers",()=>void showServers());
    const close=makeButton("Close",()=>dlg.close());
    dlg.append(heading,note,discover,url,direct,queueLabel,message,results,close);
    document.body.append(dlg);
    const open=()=>{if(!dlg.open){results.replaceChildren();say("");dlg.showModal();window.DKLocale?.apply();}};
    dlg.addEventListener("close",()=>{generation++;results.replaceChildren();});
    byId("openEmpty").after(makeButton("Network media…",open));
    const section=document.createElement("section");section.className="player-settings-section dk-picture-settings";
    section.id="networkSettings";
    section.append(makeButton("Network media…",open));byId("playerSettingsPanel").append(section);
    window.DKLibraryBridge.onOpenMediaTool?.(kind=>{if(kind==="network"){deferStartup=false;settingsDetails.open=false;open();}});
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
        if(current()===item&&!state.stopped){updateTime();keepControlsVisible();}
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
  const revealControls = () => {
    screen.classList.remove("ui-hidden");
    clearTimeout(hideControlsTimer);
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
      }, standaloneChapters?3000:2700);
    }
  };
  const keepControlsVisible = () => {
    clearTimeout(hideControlsTimer);
    screen.classList.remove("ui-hidden");
  };
  settingsDetails?.addEventListener("toggle",()=>{
    if(settingsDetails.open)keepControlsVisible();
    else revealControls();
  });
  screen.addEventListener("pointermove", revealControls);
  screen.addEventListener("pointerleave", () => {
    if (!media.paused && current() && !menuOpen) revealControls();
  });
  // Cursor auto-hide works with fullscreen and normal player dimensions.
  let cursorIdleTimer = null;
  const showCursor = () => {
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
  screen.addEventListener("pointermove", showCursor);
  screen.addEventListener("pointerenter", showCursor);
  screen.addEventListener("pointerdown", showCursor);
  screen.addEventListener("pointerleave", () => {
    clearTimeout(cursorIdleTimer);
    screen.classList.remove("cursor-hidden");
  });
  document.addEventListener("fullscreenchange", showCursor);
  controls.addEventListener("focusin", keepControlsVisible);
  controls.addEventListener("focusout", revealControls);
  media.addEventListener("pause",()=>{if(window.DKLibraryBridge?.internalPages)rememberPosition();});
  for (const eventName of ["play", "pause", "ended", "emptied"]) {
    media.addEventListener(eventName, () => {
      if (media.paused || media.ended || !current()) keepControlsVisible();
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
    cancelNextCountdown();resetVoiceover();
    if (seekPreview) seekPreview.reset();
    const item = current();
    if (!item) return;
    cancelVideoClick();
    const preserveLibraryPosition=Boolean(window.DKLibraryBridge?.internalPages);
    if(preserveLibraryPosition)rememberPosition();
    state.stopped = true;
    resetTranslation();
    media.pause();
    if(codecPlayback?.isActive(item)) {
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
  media.addEventListener("ended", () => {
    const completed = current();
    if (!completed) return;
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
    if(item.kind==="network"){status("Network stream unavailable or unsupported.");updateButtons();return;}
    if(item.deinterlacePending&&!codecPlayback?.isActive(item))return;
    if(codecPlayback?.isActive(item)){
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
    treble:[0,0,0,0,0,1,2,3,4,5]
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
      const input=context.createGain();gain.connect(context.destination);
      // Set up output before binding the media source (binding is one-time).
      let effects=null;
      if(desktopVolume){
        try{effects=createAudioEffects(context,input,gain);}catch(_){input.disconnect();input.connect(gain);}
      }else input.connect(gain);
      const source=context.createMediaElementSource(media);
      source.connect(input);
      volumeAudioGraph={context,gain,effects};
      media.addEventListener("play",resumeBoost);
      resumeBoost();
      return true;
    }catch(_){
      if(context)void context.close().catch(()=>{});
      status("200% volume isn't available with this audio output.");
      return false;
    }
  };
  const savedVolumeV2=read(store.volume,null);
  const legacyVolume=Number(read("dkmedia.web.volume.v1",1));
  let volumePercent=savedVolumeV2===null?
    Math.round(legacyVolume*100):Number(savedVolumeV2);
  if(!Number.isFinite(volumePercent))volumePercent=100;
  volumePercent=Math.max(0,Math.min(volumeLimit,Math.round(volumePercent)));
  const applyVolume = () => {
    const separateAudio=Boolean(mkvAudio?.active());
    if(!separateAudio&&(volumePercent>100||(audioEffectsActive()&&current()&&!state.stopped))){
      if(!ensureVolumeBoost()&&volumePercent>100)volumePercent=100;
    }
    const originalLevel=volumePercent/100*voiceoverOriginalFactor();
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
    write(store.volume, volumePercent);
    showVolumeOverlay();
  };
  screen.addEventListener("wheel", event => {
    if (!current() || !event.deltaY) return;
    event.preventDefault();
    setVolume(volumePercent + (event.deltaY < 0 ? 5 : -5));
  }, {passive: false});

  // Audio controls remain in the player-bar settings gear, not a new bar.
  if(desktopVolume&&settingsDetails){
    const section=document.createElement("section");
    section.className="player-settings-section dk-audio-settings";
    const title=document.createElement("strong");title.textContent="Audio enhancements";section.append(title);
    const enable=document.createElement("input");enable.type="checkbox";enable.id="audioEnhancementsEnabled";
    const enabledLabel=document.createElement("label");enabledLabel.append(enable,document.createTextNode("Enable audio enhancements"));section.append(enabledLabel);
    const presetLabel=document.createElement("label");presetLabel.htmlFor="audioEQPreset";presetLabel.textContent="Equalizer preset";
    const preset=document.createElement("select");preset.id="audioEQPreset";
    for(const [value,label] of Object.entries({flat:"Flat",cinema:"Cinema",speech:"Speech",rock:"Rock",classical:"Classical",jazz:"Jazz",bass:"Bass boost",treble:"Treble boost",custom:"Custom equalizer"})){
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
        volumeAudioGraph?.effects?.apply();mkvAudio?.applyEffects?.();
        if(audioEffectsActive()&&current()&&!state.stopped&&!mkvAudio?.active()&&!volumeAudioGraph?.effects)
          status("Audio enhancements unavailable for this output.");
      }catch(_){status("Audio enhancements unavailable for this output.");}
    };
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
    media.addEventListener("loadedmetadata",()=>{if(audioEffectsActive())applyAudioSettings();});
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
  const switchSubtitles = index => {
    const item = current();
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
        const supported=isTextNativeSubtitle(track)&&
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
    if(subtitleIsOn()&&activeNative?.item===item&&Number.isInteger(activeNative.index))
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
      if(track&&isTextNativeSubtitle(track))
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
      {checked: !state.activePgsTrack && state.activeEmbeddedTrack === null &&
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
          const supported=isTextNativeSubtitle(track) &&
            typeof window.DKCodecBridge?.subtitleVtt==="function";
          addMenuItem((track.title||track.language||"Subtitle "+(index+1))+
            (track.codec?" · "+track.codec:""),
            ()=>{if(supported)void loadNativeSubtitle(item,track,index);},
            {checked:supported?state.nativeSubtitle?.item===item &&
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

    // Direct actions, not deeply nested rows. Reuse the actual settings
    // category so picture presets, scopes and slider values stay in sync.
    activeMenuSection = contextMenu;
    if(openPictureAdjustments){
      addMenuItem("Picture adjustments",()=>openPictureAdjustments(),{disabled:!current()||current().audio||state.stopped}).classList.add("dk-menu-picture-adjustments");
    }
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
        (item.nativeSubtitleTracks||[]).findIndex(isTextNativeSubtitle):-1;
      if(nativeTrack>=0) {
        void loadNativeSubtitle(item,item.nativeSubtitleTracks[nativeTrack],nativeTrack);
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
          if(!(Number(state.resume[item.key])>2)&&Number(row.position)>2)
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
        libraryId:id,libraryPosition:row.position||0,
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
    group.innerHTML='<strong>Offline subtitle translation</strong><label for="dkTranslateDirection">Translation direction</label><select id="dkTranslateDirection"><option value="en-ru">English → Russian</option><option value="ru-en">Russian → English</option></select><label><input type="checkbox" id="dkTranslateBilingual"> Show original and translated subtitles</label><label><input type="checkbox" id="dkTranslateAuto"> Automatically translate selected text subtitles</label><button type="button" class="btn ghost small" id="dkTranslateStart">Translate selected subtitles</button><button type="button" class="btn ghost small" id="dkTranslateCancel" disabled>Cancel translation</button><button type="button" class="btn ghost small" id="dkTranslateRestore" disabled>Restore original subtitles</button><button type="button" class="btn ghost small" id="dkTranslateExport" disabled>Export translated SRT</button><span class="helper" id="dkTranslateStatus" role="status" aria-live="polite"></span><output id="dkTranslateProgress" aria-live="polite"></output>';
    section.after(group);
    const direction=byId("dkTranslateDirection"),label=byId("dkTranslateStatus"),progress=byId("dkTranslateProgress");
    const bilingual=byId("dkTranslateBilingual"),auto=byId("dkTranslateAuto");
    const key="dk-kinehall.subtitle-translation.v1",saved=read(key,{})||{};
    direction.value=saved.direction==="ru-en"?"ru-en":"en-ru";
    bilingual.checked=saved.bilingual===true;auto.checked=saved.auto===true;
    const persist=()=>write(key,{direction:direction.value,bilingual:bilingual.checked,auto:auto.checked});
    const refreshLanguage=()=>{
      const tr=t=>window.DKLocale?.t(t)||t;
      direction.options[0].textContent=tr("English → Russian");
      direction.options[1].textContent=tr("Russian → English");
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
    group.innerHTML='<strong>DK Voiceover</strong><p class="helper">Generate translated speech from original text subtitles or recognize dialogue from the movie locally.</p><label for="dkVoiceDirection">Translation direction</label><select id="dkVoiceDirection"><option value="en-ru">English → Russian</option><option value="ru-en">Russian → English</option></select><button class="btn small" type="button" id="dkSpeechGenerate" disabled>Generate subtitles from audio</button><button class="btn small" type="button" id="dkSpeechExport" disabled>Save generated subtitles</button><button class="btn small" type="button" id="dkVoiceGenerate" disabled>Generate voiceover</button><button class="btn small" type="button" id="dkVoiceCancel" disabled>Cancel voiceover</button><label><input type="checkbox" id="dkVoiceEnabled" disabled> Enable voiceover</label><label for="dkVoiceOriginal">Original audio level</label><input type="range" id="dkVoiceOriginal" min="0" max="100" step="5" value="35"><output id="dkVoiceOriginalValue">35%</output><label for="dkVoiceLevel">Voiceover volume</label><input type="range" id="dkVoiceLevel" min="0" max="100" step="5" value="100"><output id="dkVoiceLevelValue">100%</output><p class="helper">Original audio is reduced, not separated from the music and effects.</p><button class="btn small" type="button" id="dkVoiceExport" disabled>Export voiceover audio</button><span class="helper" id="dkVoiceStatus" role="status" aria-live="polite"></span><progress id="dkVoiceProgress" max="100" value="0"></progress><output id="dkVoicePercent">0%</output>';
    byId("playerSettingsPanel").append(group);
    const direction=byId("dkVoiceDirection"),generate=byId("dkVoiceGenerate"),cancel=byId("dkVoiceCancel"),exportButton=byId("dkVoiceExport");
    const label=byId("dkVoiceStatus"),progress=byId("dkVoiceProgress"),percent=byId("dkVoicePercent");
    let ready=false,busy=false,ticket=0,checkTicket=0,result=null,exporting=false;
    let speechReady=false,generated=null,recognizing=false,jobAudio=null;
    let voiceGain=null,voicePlaying=false,videoWaiting=false,voiceEpoch=0,playPending=false;
    const voice=new Audio();voice.crossOrigin="anonymous";voice.preload="metadata";
    const enabled=byId("dkVoiceEnabled"),original=byId("dkVoiceOriginal"),level=byId("dkVoiceLevel");
    const mixKey="dk-kinehall.voiceover-mix.v1",mix=read(mixKey,{})||{};
    const percentValue=(value,fallback)=>Number.isFinite(Number(value))&&value!=null?Math.max(0,Math.min(100,Number(value))):fallback;
    original.value=String(percentValue(mix.original,35));level.value=String(percentValue(mix.level,100));
    const key="dk-kinehall.voiceover-direction.v1";
    direction.value=read(key,"en-ru")==="ru-en"?"ru-en":"en-ru";
    const setStatus=value=>{label.textContent=window.DKLocale?.t(value)||value;};
    const setProgress=value=>{progress.value=value;percent.textContent=Math.floor(value)+"%";};
    const track=()=>subtitleTracks().find(t=>t.mode==="showing");
    const mixActive=()=>enabled.checked&&voicePlaying&&result?.item===current()&&!media.paused&&!media.ended&&!state.stopped&&
      voiceGain&&volumeAudioGraph?.context.state==="running"&&Number(level.value)>0;
    voiceoverOriginalFactor=()=>mixActive()?Number(original.value)/100:1;
    updateVoiceoverGain=()=>{
      if(voiceGain)voiceGain.gain.value=mixActive()&&!userMuted?volumePercent/100*Number(level.value)/100:0;
    };
    const updateMix=()=>{
      byId("dkVoiceOriginalValue").textContent=original.value+"%";
      byId("dkVoiceLevelValue").textContent=level.value+"%";
      write(mixKey,{original:Number(original.value),level:Number(level.value)});
      applyVolume();
    };
    const stopVoice=(clear=false)=>{
      voiceEpoch++;playPending=false;voicePlaying=false;voice.pause();
      if(clear){enabled.checked=false;voice.removeAttribute("src");voice.load();}
      applyVolume();
    };
    const fallback=()=>{
      stopVoice(true);setStatus("Voiceover playback failed; original audio restored.");refreshVoiceover();
    };
    const syncVoice=(force=false)=>{
      if(!enabled.checked||!result||result.item!==current()||state.stopped||media.paused||media.ended||media.seeking||videoWaiting){
        if(voicePlaying||playPending||!voice.paused)stopVoice();
        return;
      }
      const position=Number(playbackSeconds());
      if(!Number.isFinite(position)||voice.readyState<1)return;
      if(!Number.isFinite(voice.duration)||position>=voice.duration){
        if(voicePlaying||playPending||!voice.paused)stopVoice();
        return;
      }
      try{
        if(force||Math.abs(voice.currentTime-position)>.35)voice.currentTime=Math.max(0,position);
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
      const selected=result,epoch=++voiceEpoch;
      try{
        const context=volumeAudioGraph.context;
        if(!voiceGain){
          voiceGain=context.createGain();voiceGain.gain.value=0;
          const source=context.createMediaElementSource(voice);
          source.connect(voiceGain);voiceGain.connect(context.destination);
        }
        await context.resume();
        const src=await bridge.voiceoverSource(selected.ticket);
        if(epoch!==voiceEpoch||result!==selected||!enabled.checked)return;
        voice.src=src;voice.load();syncVoice(true);
      }catch(_){if(epoch===voiceEpoch)fallback();}
    });
    original.addEventListener("input",updateMix);level.addEventListener("input",updateMix);
    for(const event of ["pause","seeking","ended","emptied","waiting","stalled"]){
      media.addEventListener(event,()=>{
        if(event==="waiting"||event==="stalled"||event==="emptied")videoWaiting=true;
        if(voicePlaying||playPending||!voice.paused)stopVoice();
      });
    }
    for(const event of ["playing","canplay","seeked","loadeddata"]){
      media.addEventListener(event,()=>{videoWaiting=false;syncVoice(true);});
    }
    media.addEventListener("timeupdate",()=>syncVoice());
    media.addEventListener("ratechange",()=>syncVoice(true));
    voice.addEventListener("loadedmetadata",()=>syncVoice(true));
    voice.addEventListener("playing",()=>{if(enabled.checked&&!media.paused&&!media.seeking&&!videoWaiting){voicePlaying=true;applyVolume();}else voice.pause();});
    voice.addEventListener("waiting",()=>{voicePlaying=false;applyVolume();});
    voice.addEventListener("pause",()=>{voicePlaying=false;applyVolume();});
    voice.addEventListener("ended",()=>{voicePlaying=false;applyVolume();});
    voice.addEventListener("error",()=>{if(enabled.checked)fallback();});
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
    const sourceLang=()=>direction.value.split("-")[0];
    const validGenerated=()=>generated&&generated.item===current()&&generated.language===sourceLang()&&generated.audio===audioOrdinal();
    const compatibleTrack=()=>{
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
      if(jobAudio!==null&&jobAudio!==currentAudio&&(busy||result||generated)){resetVoiceover();return;}
      const candidate=localMovie(),speech=!!(speechReady&&localCodecBridge?.recognizeSpeech);
      generate.disabled=!ready||busy||exporting||!candidate||(!speech&&!validGenerated()&&!compatibleTrack());
      speechButton.disabled=!speech||busy||exporting||!candidate;
      speechExport.disabled=!validGenerated()||busy||exporting;
      cancel.disabled=!busy;
      exportButton.disabled=!result||busy||exporting||result.item!==current();
      direction.disabled=busy||exporting;
      enabled.disabled=!result||busy||exporting||result.item!==current()||!bridge.voiceoverSource;
    };
    resetVoiceover=()=>{
      stopVoice(true);videoWaiting=false;generated=null;jobAudio=null;
      if(busy||result){ticket++;result=null;void bridge.cancelSpeech?.().catch(()=>{});void bridge.discardVoiceover().catch(()=>{});}
      setProgress(0);setStatus(ready?"Choose original subtitles or generate them from audio.":"Offline voiceover runtime or voice model not installed.");
      refreshVoiceover();
    };
    const check=async()=>{
      const id=++checkTicket;ready=false;refreshVoiceover();
      setStatus("Checking offline voiceover runtime…");
      const [available,asr]=await Promise.all([bridge.voiceoverStatus(direction.value).catch(()=>false),bridge.speechStatus?.().catch(()=>false)]);
      if(id!==checkTicket)return;ready=available;speechReady=!!asr;
      setStatus(ready?"Choose original subtitles or generate them from audio.":speechReady?"Speech recognition ready; voice models not installed.":"Offline voiceover runtime or voice model not installed.");
      refreshVoiceover();
    };
    direction.addEventListener("change",()=>{write(key,direction.value);resetVoiceover();void check();});
    cancel.addEventListener("click",resetVoiceover);
    bridge.onSpeechProgress?.(data=>{
      if(!busy||!recognizing||data.ticket!==ticket)return;
      setProgress(data.percent);
      setStatus(data.stage==="extract"?"Extracting movie audio…":data.stage==="cached"?"Using saved subtitles.":"Recognizing dialogue locally…");
    });
    bridge.onVoiceoverProgress?.(data=>{
      if(!busy||recognizing||data.ticket!==ticket||!data.total)return;
      const fraction=data.done/data.total;
      setProgress(Math.min(100,data.stage==="translation"?fraction*35:data.stage==="complete"?100:35+fraction*65));
      setStatus(data.stage==="translation"?"Translating dialogue…":"Generating speech…");
    });
    const obtainSpeech=async(item,job,audio)=>{
      if(!speechReady||!localCodecBridge?.recognizeSpeech)throw Error("Speech runtime unavailable");
      recognizing=true;setProgress(0);setStatus("Extracting movie audio…");
      try{
        const data=await localCodecBridge.recognizeSpeech(item.file,sourceLang(),audio,job);
        if(job!==ticket||current()!==item||audioOrdinal()!==audio)throw Error("Speech request expired");
        if(!Array.isArray(data?.rows)||!data.rows.length||typeof data.srt!=="string")throw Error("No speech recognized");
        generated={item,language:sourceLang(),audio,rows:data.rows,srt:data.srt};
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
      }catch(_){if(job===ticket){setProgress(0);setStatus("Could not generate subtitles from audio.");}}
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
        setProgress(0);setStatus("Translating dialogue…");
        const info=await bridge.generateVoiceover(direction.value,rows,job);
        if(job!==ticket||current()!==item){await bridge.discardVoiceover();return;}
        result={item,ticket:job};setProgress(100);
        setStatus(info.skipped?"Voiceover ready; some lines could not fit their timing.":"Voiceover audio ready.");
      }catch(_){if(job===ticket){setStatus("Voiceover generation failed; original playback unchanged.");setProgress(0);}}
      finally{busy=false;refreshVoiceover();}
    });
    exportButton.addEventListener("click",async()=>{
      if(exportButton.disabled||!result)return;
      exporting=true;refreshVoiceover();
      try{if(await bridge.exportVoiceover(result.ticket,window.DKLocale?.get()))setStatus("Voiceover audio exported.");}
      catch(_){setStatus("Could not save voiceover. Choose a new file name.");}
      finally{exporting=false;refreshVoiceover();}
    });
    const localize=()=>{direction.options[0].textContent=window.DKLocale?.t("English → Russian")||"English → Russian";direction.options[1].textContent=window.DKLocale?.t("Russian → English")||"Russian → English";};
    byId("languageSelect")?.addEventListener("change",localize);localize();
    media.addEventListener("timeupdate",refreshVoiceover);
    media.addEventListener("loadeddata",refreshVoiceover);
    media.textTracks?.addEventListener("change",refreshVoiceover);
    settingsDetails?.addEventListener("toggle",()=>{if(settingsDetails.open&&!ready&&!busy)void check();});
    void check();
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
    for(const [value,label] of [["remembered","Remembered track"],["off","Subtitles off"],["en","English"],["ru","Russian"]]){
      const option=document.createElement("option");option.value=value;option.textContent=label;subtitleChoice.append(option);
    }
    const subtitleNote=document.createElement("p");subtitleNote.className="helper";
    subtitleNote.textContent="Applies to matching text tracks. Per-file embedded subtitle choices are preserved.";
    const syncSubtitleDefault=()=>{
      const pref=state.subtitlePreference;
      subtitleChoice.value=pref.mode!=="track"?"off":!pref.label&&["en","ru"].includes(normalizeSubtitleLanguage(pref.language))?normalizeSubtitleLanguage(pref.language):"remembered";
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
      globalSubtitles,
      byId("pictureEnhancements"),
      byId("picture-fit")?.closest(".player-settings-section"),
      byId("deinterlaceMode")?.closest(".player-settings-section"),
      byId("smoothingMode")?.closest(".player-settings-section"),
      byId("audioEnhancementsEnabled")?.closest(".player-settings-section")
    ].filter(Boolean);
    const categoryFor=section=>section.id==="voiceoverSettings"?"voiceover":section.id==="networkSettings"?"network":section.id==="dvdSettings"?"disc":section===globalSubtitles||section.classList.contains("dk-translation")||section.contains(byId("subtitleTrackSelect"))?"subtitles":section.classList.contains("dk-audio-settings")?"audio":section.contains(byId("playbackFormat"))?"playback":section.classList.contains("dk-picture-settings")?"picture":"general";
    const categories=[["playback","Playback"],["picture","Picture"],["audio","Audio"],["subtitles","Subtitles"],["voiceover","Voiceover"],["disc","DVD & Disc"],["network","Network"],["general","General"]];
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