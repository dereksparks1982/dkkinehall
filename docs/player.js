(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const media = byId("media");
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
  let reapplyCurrentFormat = null;
  const playbackFormatInput = byId("playbackFormat");
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
    if (formatChanged && reapplyCurrentFormat) reapplyCurrentFormat();
  };
  for (const control of [playbackFormatInput,hardwareInput,rememberInput,removeWatchedInput])
    control.addEventListener("change",updatePlaybackSettings);
  const current = () => state.queue[state.current] || null;
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
    byId("restoreMedia").hidden = true;
    byId("restoreHint").hidden = true;
  };
  const rememberSelectedMedia = item => {
    if (item.handle) {
      write(store.lastMedia, {kind: "file", name: item.name, key: item.key});
      updateStoredHandle(item.handle);
    } else {
      // Files selected via the legacy input or drag-and-drop are session-only.
      write(store.lastMedia, {kind: "temporary-file", name: item.name, key: item.key});
      updateStoredHandle(null);
    }
    byId("restoreMedia").hidden = true;
    byId("restoreHint").hidden = true;
  };
  const status = (message, good = false) => {
    const node = byId("status");
    node.textContent = message;
    node.classList.toggle("good", good);
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
  const codecPlayback = window.DKCodecPlayback?.attach({
    media,bridge:window.DKCodecBridge,current,
    onStatus:(message,good)=>status(message,good),
    onClockChanged:()=>updateTime(),
    onChaptersChanged:()=>updateChapterButton(),
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
    const item=current();
    if (!item) return;
    const value=Math.max(0,Number(seconds)||0);
    if (codecPlayback?.isActive(item))void codecPlayback.seek(item,value);
    else media.currentTime=value;
  };
  const rememberPosition = () => {
    const item = current();
    const duration=playbackDuration(),position=playbackSeconds();
    if (!item || !Number.isFinite(duration) || duration <= 0) return;
    if (position >= duration - 4) delete state.resume[item.key];
    else if (position > 2) state.resume[item.key] = position;
    if(item.libraryId&&window.DKLibraryStore)
      void window.DKLibraryStore.updateProgress(
        item.libraryId,position,duration,false).catch(()=>{});
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
  const updateSubtitleToggle = () => {
    const button = byId("subtitleToggle");
    const item = current();
    const on = subtitleIsOn();
    button.disabled = !item || (!on && !usableEmbeddedSubtitles(item).length &&
      !subtitleTracks().length &&
      !(codecPlayback?.isActive(item) &&
        (item.nativeSubtitleTracks||[]).some(isTextNativeSubtitle)));
    button.textContent = on ? "On" : "Off";
    button.setAttribute("aria-pressed",String(on));
    button.setAttribute("aria-label",on ? "Turn subtitles off" : "Turn subtitles on");
    button.title = on ? "Turn subtitles off" : "Turn embedded subtitles on";
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
    state.subtitlePreference = track ? {
      mode: "track", label: String(track.label || ""),
      language: String(track.language || "")
    } : {mode: "off"};
    write(store.subtitlePreference, state.subtitlePreference);
    applySubtitlePreference();
  };
  // PGS graphics occupy the actual picture rectangle, not the black bars.
  // Keep the image aligned on resize/fullscreen and when picture-fit changes.
  const positionPgsOverlay = () => {
    if (!pgsCanvas || !media.videoWidth || !media.videoHeight) return;
    const box = media.getBoundingClientRect();
    const outer = screen.getBoundingClientRect();
    const ratio = media.videoWidth / media.videoHeight;
    if (!box.width || !box.height || !ratio) return;
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
      const vtt=await window.DKCodecBridge.subtitleVtt(item.file,index);
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
  const updateButtons = () => {
    const item = current();
    const isPlaying = !!item && !media.paused && !media.ended;
    byId("playPause").textContent = isPlaying ? "⏸" : "▶";
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
  // Real chapter metadata only. Native chapter cues and MKV chapter atoms
  // are combined without assuming timestamps or episode runtimes.
  const chapterPicker = byId("chapterPicker");
  // Fullscreen and float mode move only #screen; keep the visible chapter
  // selector inside that surface so it remains accessible in both modes.
  if (chapterPicker.parentElement !== screen) screen.append(chapterPicker);
  const chapterEntries = byId("chapterEntries");
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
  const updateChapterButton = () => {
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
  byId("chapters").addEventListener("click",showChapterPicker);
  byId("closeChapters").addEventListener("click",()=>{chapterPicker.hidden=true;});
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
      const parsed = window.DKMediaMetadata?.parseFilename(item.name);
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
      if (queueHover) queueHover.bind(play, item, artworkBox);
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
    updateChapterButton();
  };
  const idle = () => {
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
    if (!current()) { status("Open a video or music file first."); return; }
    if (state.stopped) {
      state.stopped = false;
      screen.classList.remove("empty", "stopped");
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
    const result = media.play();
    if (result && typeof result.catch === "function") result.catch(err => {
      if (err && err.name === "NotAllowedError") status("Tap Play to start playback on this device.");
      else if (err && err.name !== "AbortError") status("Couldn't start this media. Check its format or source.");
    });
  };
  const load = (index, autoplay = true) => {
    if (index < 0 || index >= state.queue.length) return;
    const previous=current();
    if(previous?.remuxAbort){
      previous.remuxAbort.abort();
      previous.remuxAbort=null;
    }
    if (seekPreview) seekPreview.reset();
    if (!state.stopped) rememberPosition();
    if(codecPlayback?.isActive(previous))void codecPlayback.stop();
    state.stopped = false;
    clearSubtitles();
    if (mkvAudio) mkvAudio.stop();
    media.pause();
    state.current = index;
    const item = current();
    // Restore this file’s remembered subtitle offset immediately, including
    // for non-MKV files before any subtitle track is loaded.
    updateSubtitleDelayControls();
    rememberSelectedMedia(item);
    item.autoplayRequested = autoplay;
    // Reset stale conversion attempts when revisiting a file or selecting a
    // different format. An old asynchronous remux may not replace a new load.
    item.playbackEpoch = (item.playbackEpoch || 0) + 1;
    item.compatAttempted = false;
    item.codecAttempted = false;
    item.codecActive = false;
    item.codecRestart = false;
    item.compatPending = false;
    item.requestedFormat = playbackSettings.format;
    item.playbackMethod = (item.compatSrc && item.requestedFormat === "auto")
      ? "Cached lossless remux" : "Original source";
    const forcingContainer = item.requestedFormat === "mp4" || item.requestedFormat === "webm";
    if (item.compatSrc && (forcingContainer || item.requestedFormat === "original")) {
      URL.revokeObjectURL(item.compatSrc);
      item.compatSrc = null;
    }
    const directFormat = item.name.toLowerCase().endsWith("." + item.requestedFormat);
    const needsRemux = forcingContainer && !directFormat && /\.mkv$/i.test(item.name) && !!item.file;
    const cannotConvert = forcingContainer && !directFormat && !needsRemux;
    if (needsRemux || cannotConvert) {
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
    const titleInfo = window.DKMediaMetadata?.parseFilename(item.name);
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
    if(!item?.file || item.requestedFormat === "original") return false;
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
    const wasCurrent = state.current === index;
    if (wasCurrent) rememberPosition();
    const old = state.queue.splice(index, 1)[0];
    if (wasCurrent) {
      if (state.queue.length) { state.current = -1; load(Math.min(index, state.queue.length - 1), false); }
      else { idle(); clearRememberedMedia(); }
    } else {
      if (index < state.current) state.current--;
      renderQueue();
    }
    releaseArtwork(old);
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
        libraryId:artData?.libraryId||null,
        episodeTitle:artData?.episodeTitle||"",
        file, src: URL.createObjectURL(file), handle,
        path, folderArtwork: posterMap.get(path) || null,
        size: file.size, mime: file.type || "",
        key: "file:" + file.name + ":" + file.size + ":" + file.lastModified,
        embeddedSubtitles: [], embeddedAudio: [], embeddedVideo: [], mkvInspection: "not-mkv"};
      newItems.push(item);
      if(item.libraryId&&Number(artData?.libraryPosition)>2 &&
         !Number.isFinite(Number(state.resume[item.key])))
        state.resume[item.key]=Number(artData.libraryPosition);
      else if(item.libraryId&&Number(artData?.libraryPosition)>2 &&
              !Number(state.resume[item.key]))
        state.resume[item.key]=Number(artData.libraryPosition);
      if (/\.mkv$/i.test(file.name) && window.DKMkvChapters) {
        void window.DKMkvChapters.inspectFile(file).then(chapters=>{
          if (!state.queue.includes(item)) return;
          item.chapters = Array.isArray(chapters) ? chapters : [];
          if (current()===item) updateChapterButton();
        }).catch(()=>{});
      }
      if (/\.mkv$/i.test(file.name) && window.DKMatroska) {
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
    folderReconnectButton.hidden = !state.folderName;
    folderForgetButton.hidden = !state.folderName;
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
  const restoreLastMedia = async () => {
    const saved = read(store.lastMedia, null);
    if (!saved || state.queue.length) return;
    if (saved.kind === "url") {
      // Do not reopen links remembered by an older release.
      try { localStorage.removeItem(store.lastMedia); } catch (_) {}
      return;
    }
    if (saved.kind !== "file" && saved.kind !== "temporary-file") return;
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
    // Clearing Up Next should not interrupt the episode currently on screen.
    const old = state.queue.splice(state.current + 1);
    old.forEach(item => {
      releaseArtwork(item);
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
  let hideControlsTimer = null;
  let menuOpen = false;
  const revealControls = () => {
    screen.classList.remove("ui-hidden");
    clearTimeout(hideControlsTimer);
    if (!media.paused && current() && !menuOpen) {
      hideControlsTimer = setTimeout(() => {
        if (controls.matches(":hover") || controls.contains(document.activeElement) ||
            !infoPanel.hidden || menuOpen || media.paused) {
          revealControls();
          return;
        }
        screen.classList.add("ui-hidden");
      }, 2700);
    }
  };
  const keepControlsVisible = () => {
    clearTimeout(hideControlsTimer);
    screen.classList.remove("ui-hidden");
  };
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
    if (seekPreview) seekPreview.reset();
    const item = current();
    if (!item) return;
    cancelVideoClick();
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
    delete state.resume[item.key];
    write(store.resume, state.resume);
    if(item.libraryId&&window.DKLibraryStore)
      void window.DKLibraryStore.updateProgress(item.libraryId,0,playbackDuration(),false)
        .catch(()=>{});
    state.stopped = true;
    try { media.currentTime = 0; } catch (_) {}
    screen.classList.add("empty", "stopped");
    syncPgsOverlay();
    screen.classList.remove("audio", "ui-hidden", "cursor-hidden");
    byId("emptyTitle").textContent = "Stopped";
    byId("emptyDescription").textContent = "Press the red Play button to restart this movie.";
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
    if(codecPlayback?.isActive(item)) {
      // The stream has already been started at the original source time.
      updateTime();updateChapterButton();return;
    }
    const position = Number(state.resume[item.key] || 0);
    if (position > 2 && Number.isFinite(media.duration) && position < media.duration - 4) {
      try { media.currentTime = position; } catch (_) {}
    }
    updateTime();
    updateChapterButton();
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
  media.addEventListener("durationchange", updateTime);
  media.addEventListener("loadeddata", updateChapterButton);
  if(media.textTracks && typeof media.textTracks.addEventListener==="function")
    media.textTracks.addEventListener("addtrack",()=>setTimeout(updateChapterButton,0));
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
    if(completed.libraryId&&window.DKLibraryStore)
      void window.DKLibraryStore.updateProgress(
        completed.libraryId,playbackDuration(),playbackDuration(),true).catch(()=>{});
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
      load((state.current + 1) % state.queue.length,true);
    } else if (playbackSettings.removeWatched) {
      const previousIndex = state.current;
      state.queue.splice(previousIndex, 1);
      // Detach the completed source before revoking the old object URL.
      // Preserve the order of remaining movies; never replay past items.
      state.current = -1;
      if (previousIndex < state.queue.length) load(previousIndex, true);
      else idle();
      releaseArtwork(completed);
      releaseCompatible(completed);
      if (completed.kind === "file") URL.revokeObjectURL(completed.src);
    } else if (state.current < state.queue.length - 1) {
      load(state.current + 1, true);
    } else {
      updateButtons();
      renderQueue();
    }
  });
  media.addEventListener("error", () => {
    if (!current() || !media.error || state.stopped) return;
    const code = media.error.code;
    const item=current();
    if(codecPlayback?.isActive(item)){
      status("Included decoder output could not be played.");return;
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
  // User-approved 0–100% volume in BOTH editions. No gain amplification
  // or extra audio graph; the stream and its codec can switch freely.
  const volumeLimit=100;
  const volumeSlider=byId("volume");
  volumeSlider.max="100";
  const savedVolumeV2=read(store.volume,null);
  const legacyVolume=Number(read("dkmedia.web.volume.v1",1));
  let volumePercent=savedVolumeV2===null?
    Math.round(legacyVolume*100):Number(savedVolumeV2);
  if(!Number.isFinite(volumePercent))volumePercent=100;
  volumePercent=Math.max(0,Math.min(100,Math.round(volumePercent)));
  const applyVolume = () => {
    media.volume=volumePercent/100;
    media.muted=mkvAudio&&mkvAudio.active()?true:userMuted;
    if(mkvAudio)mkvAudio.setVolume(userMuted?0:volumePercent/100);
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
    const next=Math.max(0,Math.min(100,Math.round(Number(percent))));
    if (!Number.isFinite(next)) return;
    volumePercent=next;
    userMuted = false;
    applyVolume();
    write(store.volume, volumePercent);
    showVolumeOverlay();
  };
  screen.addEventListener("wheel", event => {
    if (!current() || !event.deltaY) return;
    event.preventDefault();
    setVolume(volumePercent + (event.deltaY < 0 ? 5 : -5));
  }, {passive: false});

  applyVolume();
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
  const desktopFullscreen = window.DKStandalone &&
    typeof window.DKStandalone.setFullscreen === "function" ? window.DKStandalone : null;
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
    screen.classList.toggle("desktop-fullscreen", !!fullscreen);
    document.documentElement.classList.toggle("dk-desktop-fullscreen", !!fullscreen);
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
    if (item && state.embeddedSubtitlePreferences[item.key]) {
      delete state.embeddedSubtitlePreferences[item.key];
      write(store.embeddedSubtitlePreferences,state.embeddedSubtitlePreferences);
    }
    const selected = index >= 0 ? subtitleTracks()[index] || null : null;
    if (state.mkvSubtitlePending || state.activePgsTrack ||
        (state.subtitleNode && (!selected || selected !== state.subtitleNode.track)))
      clearSubtitles();
    chooseSubtitleTrack(selected);
  };
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
    const chapters = availableTracks().filter(track => track.kind === "chapters");
    const cues = chapters.flatMap(track => {
      try { return Array.from(track.cues || []); }
      catch (_) { return []; }
    });
    if (cues.length) {
      addMenuHeading("Chapters");
      for (const cue of cues) addMenuItem(
        time(cue.startTime) + "  " + (cue.text || "Chapter"),
        () => { setPlaybackPosition(cue.startTime); });
    }

    addMenuHeading("Picture");
    addMenuItem("Fit full picture", () => {
      screen.classList.remove("fit-cover");
      syncPgsOverlay();
    }, {checked: !screen.classList.contains("fit-cover")});
    addMenuItem("Fill frame (crop edges)", () => {
      screen.classList.add("fit-cover");
      syncPgsOverlay();
    }, {checked: screen.classList.contains("fit-cover")});
    addMenuItem(document.fullscreenElement ? "Exit fullscreen" : "Fullscreen",
      () => { void toggleFullscreen(); });
    addMenuItem("Picture in picture", () => byId("pip").click(),
      {disabled: byId("pip").hidden});

    // Direct action, not a deeply nested row.
    activeMenuSection = contextMenu;
    addMenuItem("Media information", openMediaInfo);
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
  document.addEventListener("fullscreenchange", updateFullscreenButton);
  document.addEventListener("fullscreenchange", () => requestAnimationFrame(syncPgsOverlay));
  updateFullscreenButton();
  // Embedded MKV tracks use the existing menu; SRT/VTT loading is explicit.
  byId("addSubtitles").addEventListener("click", () => {
    if (!current()) return;
    cancelVideoClick();
    buildContextMenu();
    if (window.DKLocale) window.DKLocale.apply();
    contextMenu.hidden = false;
    menuOpen = true;
    keepControlsVisible();
    const bounds = screen.getBoundingClientRect();
    const button = byId("addSubtitles").getBoundingClientRect();
    contextAnchor = {x: button.left - bounds.left, y: button.top - bounds.top};
    const subtitleSection = contextMenu.querySelector(
      '.context-section-toggle[data-menu-section="Subtitles"]');
    if (subtitleSection) subtitleSection.click();
    else fitContextMenu();
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
      if (!chapterPicker.hidden) { event.preventDefault(); chapterPicker.hidden = true; }
      else if (menuOpen) { event.preventDefault(); closeContextMenu(); }
      else if (!infoPanel.hidden) { infoPanel.hidden = true; revealControls(); }
      else if (desktopFullscreen && screen.classList.contains("desktop-fullscreen")) {
        event.preventDefault();
        void desktopFullscreen.setFullscreen(false);
      }
      return;
    }
    const tag = event.target && event.target.tagName;
    if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tag)) return;
    const key = event.key.toLowerCase();
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
    cancelVideoClick();
    if (mkvAudio) mkvAudio.stop();
    clearTimeout(hideControlsTimer);
    clearTimeout(cursorIdleTimer);
    rememberPosition();
    if(codecPlayback)void codecPlayback.stop();
    clearSubtitles();
    state.queue.forEach(item => { releaseArtwork(item); releaseCompatible(item); if (item.kind === "file") URL.revokeObjectURL(item.src); });
  });
  idle();
  // Library selections launch in this original player window, not a new
  // playback implementation. Their durable ID resolves to the user's own
  // permissioned file, while the database stores no duplicated movie bytes.
  const openFromLibrary = async () => {
    const id=new URLSearchParams(window.location.search).get("libraryItem");
    if(!id)return false;
    if(!window.DKLibraryStore){
      status("The local library is unavailable.");return true;
    }
    try{
      const row=await window.DKLibraryStore.item(id);
      if(!row)throw new Error("The library item was not found");
      const selected=await window.DKLibraryStore.openFile(row,{
        requestPermission:true
      });
      addFiles([selected.file],[selected.handle],"open",{
        libraryId:id,libraryPosition:row.position||0,
        episodeTitle:row.episodeTitle||""
      });
      return true;
    }catch(error){
      status("Cannot open this library video. Reconnect its folder or grant permission.");
      return true;
    }
  };
  // Restore plain file selection only when this is not a library launch.
  void (async()=>{
    const selected=await openFromLibrary();
    if(!selected){
      await restoreLastMedia();
      await restoreSavedFolder();
    }
  })();
})();