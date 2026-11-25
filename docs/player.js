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
    audioPreferences: "dkmedia.web.audio-preferences.v1",
    embeddedSubtitlePreferences: "dkmedia.web.mkv-subtitle-preferences.v1",
    folderName: "dkmedia.web.folder-name.v1",
    playbackSettings: "dkmedia.web.playback-settings.v1"
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
    subtitleObject: null, subtitleNode: null, lastResumeSave: 0,
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
    /\.(mp4|m4v|mov|mkv|avi|webm|ogg|ogv|mp3|m4a|aac|wav|flac|opus|ts)$/i.test(file.name)
  );
  const fileIsAudio = file => !!file && (
    file.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|flac|opus)$/i.test(file.name)
  );
  const rememberPosition = () => {
    const item = current();
    if (!item || !Number.isFinite(media.duration) || media.duration <= 0) return;
    if (media.currentTime >= media.duration - 4) delete state.resume[item.key];
    else if (media.currentTime > 2) state.resume[item.key] = media.currentTime;
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
    const frame = api.frameAt(events,media.currentTime);
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
  const clearSubtitles = () => {
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
  const installSubtitleVTT = (vtt, label, language, embeddedNumber = null) => {
    clearSubtitles();
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
    node.addEventListener("error", () => status("The browser couldn't display this subtitle track."), {once: true});
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
      status("Embedded MKV text subtitles loaded. Video playback still depends on browser codecs.", true);
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
      status("PGS subtitles loaded locally. Video still needs a supported browser codec.",true);
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
    byId("previous").disabled = state.current <= 0;
    byId("next").disabled = state.current < 0 || state.current >= state.queue.length - 1;
    byId("clearQueue").disabled = state.current >= 0 ? state.current >= state.queue.length - 1 : state.queue.length === 0;
    byId("addSubtitles").disabled = !item;
    const muted = userMuted || volumePercent === 0;
    byId("mute").classList.toggle("is-muted", muted);
    byId("mute").setAttribute("aria-label", muted ? "Unmute" : "Mute");
    byId("mute").title = muted ? "Unmute" : "Mute";
  };
  const updateTime = () => {
    const length = media.duration;
    const seekable = Number.isFinite(length) && length > 0;
    byId("currentTime").textContent = time(media.currentTime);
    byId("duration").textContent = seekable ? time(length) : "0:00";
    byId("seek").disabled = !current() || !seekable;
    byId("rewind10").disabled = !current() || !seekable || state.stopped;
    byId("forward10").disabled = !current() || !seekable || state.stopped;
    byId("seek").value = seekable ? String(Math.max(0, Math.min(1000, Math.round(1000 * media.currentTime / length)))) : "0";
  };
  const queueHover = window.DKQueueHover && window.DKQueueHover.create({
    makeVideo: () => document.createElement("video")
  });
  const renderQueue = () => {
    if (queueHover) queueHover.stop();
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
      if (index === state.current) {
        li.classList.add("current");
        li.setAttribute("aria-current", "true");
      }
      const play = document.createElement("button");
      play.type = "button";
      play.className = "item-play";
      play.title = "Play " + item.name;
      const artworkBox = document.createElement("span");
      artworkBox.className = "queue-artwork";
      artworkBox.setAttribute("aria-hidden", "true");
      const fallback = document.createElement("span");
      fallback.className = "queue-artwork-fallback";
      fallback.textContent = item.audio ? "♫" : "▶";
      artworkBox.append(fallback);
      if (queueHover) queueHover.bind(play, item, artworkBox);
      const labels = document.createElement("span");
      labels.style.minWidth = "0";
      const title = document.createElement("span");
      title.className = "item-title";
      title.textContent = item.name;
      const source = document.createElement("span");
      source.className = "item-meta";
      source.textContent = "Local file";
      labels.append(title, source);
      play.append(artworkBox, labels);
      play.addEventListener("click", () => load(index));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-btn remove";
      remove.textContent = "×";
      remove.title = "Remove from queue";
      remove.setAttribute("aria-label", "Remove " + item.name);
      remove.addEventListener("click", () => removeItem(index));
      li.append(play, remove);
      queueView.append(li);
    });
    updateButtons();
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
    byId("kindBadge").textContent = "Ready";
    renderQueue();
    updateTime();
  };
  const seekPreview = window.DKSeekPreview && window.DKSeekPreview.attach({
    seek: byId("seek"), bubble: byId("seekPreview"), frame: byId("previewFrame"),
    label: byId("previewTime"), current, duration: () => media.duration,
    formatTime: time
  });
  const playCurrent = () => {
    if (!current()) { status("Open a video or music file first."); return; }
    if (state.stopped) {
      state.stopped = false;
      screen.classList.remove("empty", "stopped");
      syncPgsOverlay();
      screen.classList.toggle("audio", current().audio);
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
    if (seekPreview) seekPreview.reset();
    if (!state.stopped) rememberPosition();
    state.stopped = false;
    clearSubtitles();
    if (mkvAudio) mkvAudio.stop();
    media.pause();
    state.current = index;
    const item = current();
    rememberSelectedMedia(item);
    item.autoplayRequested = autoplay;
    // Reset stale conversion attempts when revisiting a file or selecting a
    // different format. An old asynchronous remux may not replace a new load.
    item.playbackEpoch = (item.playbackEpoch || 0) + 1;
    item.compatAttempted = false;
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
    byId("nowTitle").textContent = item.name;
    byId("nowSource").textContent = "Local device";
    byId("kindBadge").textContent = "LOCAL";
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
      } else void tryCompatibleFallback(item);
    } else if (cannotConvert) {
      item.playbackMethod = "Unsupported conversion";
      status("Requested format is not available for this file. It has not been converted.");
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
        status("Chromium cannot play this WebM codec combination.");
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
    status("Preparing H.264 and AAC video for Chromium…");
    try{
      const output=await window.DKMkvMP4.remux(item.file,compatibleInfo(item));
      if(!state.queue.includes(item) || current()!==item ||
         item.playbackEpoch!==epoch || state.stopped)return false;
      if(!media.canPlayType(output.mime))
        throw Error("Chromium cannot decode this H.264/AAC profile");
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
      if(current()===item && item.playbackEpoch===epoch)
        status("H.264/AAC container fallback unavailable: "+
          (error?.message||"unsupported stream"));
      return false;
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
  const releaseCompatible = item => {
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
    })).filter(entry => fileIsMedia(entry.file));
    if (!accepted.length) { status("No supported media file selected. Choose a video or audio file."); return; }
    const playing = Boolean(current()) && !state.stopped && !media.paused && !media.ended;
    const plan = window.DKQueueAutoplay.plan(mode, state.current, state.queue.length, playing);
    const newItems = [];
    for (const {file, handle, path} of accepted) {
      const item = {kind: "file", name: file.name, audio: fileIsAudio(file),
        file, src: URL.createObjectURL(file), handle,
        path, folderArtwork: posterMap.get(path) || null,
        size: file.size, mime: file.type || "",
        key: "file:" + file.name + ":" + file.size + ":" + file.lastModified,
        embeddedSubtitles: [], embeddedAudio: [], embeddedVideo: [], mkvInspection: "not-mkv"};
      newItems.push(item);
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
            if(item.compatPending){
              item.compatPending=false;
              void tryCompatibleFallback(item).then(ok=>{
                if(!ok&&current()===item&&!item.compatAttempted &&
                   item.requestedFormat === "auto")
                  status("This MKV video codec or container is not supported.");
              });
            }
          }
        }).catch(() => {
          item.mkvInspection = "unavailable";
          if (current() === item) {
            updateSubtitleStatus();
            if(item.compatPending)status("This MKV file could not be inspected.");
          }
        });
      }
    }
    // Put an explicitly opened movie ahead of pending entries, retaining
    // existing queue order. Multi-selection starts only the first new file.
    state.queue.splice(plan.insertAt, 0, ...newItems);
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
    try { localStorage.removeItem(store.folderName); } catch (_) {}
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
          if (fileIsMedia(file)) selected.push({file, handle});
        } catch (_) { /* Continue opening remaining files. */ }
      }
      if (selected.length) addFiles(selected.map(item => item.file),
                                    selected.map(item => item.handle), mode);
      else status("No readable video or audio file was selected.");
    } catch (error) {
      if (error && error.name === "AbortError") return;
      status("The Chromium file picker could not open. Try dragging a file onto the player.");
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
        status("Last local file restored. Press Play to resume.", true);
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
  screen.addEventListener("drop", event =>
    addFiles(event.dataTransfer && event.dataTransfer.files, [], "open"));
  byId("clearQueue").addEventListener("click", () => {
    // Clearing Up Next should not interrupt the episode currently on screen.
    const old = state.queue.splice(state.current + 1);
    old.forEach(item => {
      releaseArtwork(item);
      releaseCompatible(item);
      if (item.kind === "file") URL.revokeObjectURL(item.src);
    });
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
    if (mkvAudio) mkvAudio.stop();
    delete state.resume[item.key];
    write(store.resume, state.resume);
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
  byId("previous").addEventListener("click", () => load(state.current - 1));
  byId("next").addEventListener("click", () => load(state.current + 1));
  const skipTen = delta => {
    if (!current() || state.stopped || !Number.isFinite(media.duration) ||
        media.duration <= 0) return;
    media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + delta));
    updateTime();
  };
  byId("rewind10").addEventListener("click", () => skipTen(-10));
  byId("forward10").addEventListener("click", () => skipTen(10));
  byId("seek").addEventListener("input", event => {
    if (Number.isFinite(media.duration) && media.duration > 0) media.currentTime = media.duration * Number(event.target.value) / 1000;
  });
  media.addEventListener("loadedmetadata", () => {
    const item = current();
    if (!item) return;
    applySubtitlePreference();
    restoreAudioPreference();
    if (state.stopped) { updateTime(); return; }
    const position = Number(state.resume[item.key] || 0);
    if (position > 2 && Number.isFinite(media.duration) && position < media.duration - 4) {
      try { media.currentTime = position; } catch (_) {}
    }
    updateTime();
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
  if (media.textTracks && typeof media.textTracks.addEventListener === "function") {
    media.textTracks.addEventListener("addtrack", () => setTimeout(applySubtitlePreference, 0));
    media.textTracks.addEventListener("removetrack", () => setTimeout(applySubtitlePreference, 0));
  }
  media.addEventListener("ended", () => {
    const completed = current();
    if (!completed) return;
    rememberPosition();
    // A completed movie has no unfinished position to resume.
    delete state.resume[completed.key];
    write(store.resume, state.resume);
    if (playbackSettings.removeWatched) {
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
    if (!current() || !media.error) return;
    const code = media.error.code;
    const item=current();
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
        void tryCompatibleFallback(item);
        return;
      }
    }
    const mkvVideo = current().embeddedVideo?.[0]?.codec || null;
    const message = code === 4 && mkvVideo ?
      "Chromium cannot play this MKV video codec: " + mkvVideo + "." :
      code === 4 ? "This file format isn't supported by your browser." :
      code === 2 ? "The media file couldn't be read." :
      code === 3 ? "The browser couldn't decode this media format." :
      "Unable to play this media source.";
    status(message);
    updateButtons();
  });
  let volumeOverlayTimer = null;
  const savedVolumeV2 = read(store.volume, null);
  const legacyVolume = Number(read("dkmedia.web.volume.v1", 1));
  // Older releases stored native media.volume as a decimal from 0 to 1.
  let volumePercent = savedVolumeV2 === null ? Math.round(legacyVolume * 100) :
    Number(savedVolumeV2);
  if (!Number.isFinite(volumePercent)) volumePercent = 100;
  // Normalize older saved volumes, including settings above 100%, without
  // connecting video to Web Audio (which caused playback glitches).
  volumePercent = Math.max(0, Math.min(100, Math.round(volumePercent)));
  const applyVolume = () => {
    media.volume = volumePercent / 100;
    media.muted = mkvAudio && mkvAudio.active() ? true : userMuted;
    if (mkvAudio) mkvAudio.setVolume(userMuted ? 0 : volumePercent / 100);
    byId("volume").value = String(volumePercent);
    byId("volumeValue").textContent = (userMuted ? 0 : volumePercent) + "%";
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
    const next = Math.max(0, Math.min(100, Math.round(Number(percent))));
    if (!Number.isFinite(next)) return;
    volumePercent = next;
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
  if (!document.pictureInPictureEnabled || typeof media.requestPictureInPicture !== "function") byId("pip").hidden = true;
  byId("pip").addEventListener("click", async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (current()) await media.requestPictureInPicture();
    } catch (_) { status("Picture in picture isn't available for this video or browser."); }
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
        status("Fullscreen isn't available in this browser.");
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
    if (!item || !item.file || !mkvAudio || !mkvAudio.canAttempt(track)) return;
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
    status("Using Chromium's original audio track.",true);
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
    if (!item || state.stopped) return;
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
      {checked: !state.activePgsTrack && !state.mkvSubtitlePending &&
        tracks.every(track => track.mode !== "showing")});
    tracks.forEach((track, index) => addMenuItem(
      track.label || track.language || "Subtitle track " + (index + 1),
      () => switchSubtitles(index), {checked: track.mode === "showing"}));
    const item = current();
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
      }
    }
    addMenuItem("＋ Load SRT / VTT…", () => byId("subtitlePicker").click());

    addMenuHeading("Audio tracks");
    if (mkvAudio && mkvAudio.selectedNumber() !== null)
      addMenuItem("Use original Chromium audio",restoreOriginalAudio);
    const audios = audioTracks();
    if (audios.length) {
      addMenuSubheading("Browser audio tracks");
      audios.forEach((track,index) => addMenuItem(
        audioApi.labelNative(track,index),
        () => selectAudioTrack(index), {checked: Boolean(track.enabled)}));
    } else {
      addMenuItem("Browser audio-track switching unavailable", () => {},
        {disabled: true,reason: "This browser does not expose switchable audio streams."});
    }
    if (item && item.mkvInspection !== "not-mkv") {
      if (item.embeddedAudio && item.embeddedAudio.length) {
        addMenuSubheading("Embedded MKV audio · WebCodecs");
        item.embeddedAudio.forEach(track => {
          const possible = !!(mkvAudio && mkvAudio.canAttempt(track));
          addMenuItem(audioApi ? audioApi.labelEmbedded(track) :
            (track.name || track.language || track.codec),
            () => { if (possible) void chooseEmbeddedAudio(item,track); },
            {checked:possible ? mkvAudio.selectedNumber() === track.number : undefined,
              disabled:!possible,
              reason:"This format is not supported by the included Chromium audio decoder."});
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
        () => { media.currentTime = cue.startTime; });
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
    addDetail("Source", item.kind === "file" ? "Local file" : "Direct stream URL");
    addDetail("Requested playback format",item.requestedFormat || "auto");
    addDetail("Actual playback method",item.playbackMethod || "Original source");
    addDetail("Hardware acceleration preference",playbackSettings.hardware
      ? "Enabled (actual GPU use is controlled by Chromium)" : "Disabled preference (Chromium controls GPU use)");
    if (item.size !== undefined) addDetail("Size", (item.size / 1048576).toFixed(1) + " MiB");
    if (item.mime) addDetail("Format", item.mime);
    if (media.videoWidth && media.videoHeight)
      addDetail("Resolution", media.videoWidth + " × " + media.videoHeight);
    addDetail("Duration", Number.isFinite(media.duration) ? time(media.duration) : "Live / unknown");
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
    addDetail("Browser subtitle tracks", subtitleTracks().length);
    addDetail("Browser audio tracks", audioTracks().length);
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
  byId("addSubtitles").addEventListener("click", () => byId("subtitlePicker").click());
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
      if (menuOpen) { event.preventDefault(); closeContextMenu(); }
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
    if (key === "arrowleft" && Number.isFinite(media.duration)) media.currentTime = Math.max(0, media.currentTime - 5);
    if (key === "arrowright" && Number.isFinite(media.duration)) media.currentTime = Math.min(media.duration, media.currentTime + 5);
  });
  window.addEventListener("pagehide", () => {
    cancelVideoClick();
    if (mkvAudio) mkvAudio.stop();
    clearTimeout(hideControlsTimer);
    clearTimeout(cursorIdleTimer);
    rememberPosition();
    clearSubtitles();
    state.queue.forEach(item => { releaseArtwork(item); releaseCompatible(item); if (item.kind === "file") URL.revokeObjectURL(item.src); });
  });
  idle();
  // A restored file stays paused until the user presses Play.
  void (async () => {
    await restoreLastMedia();
    await restoreSavedFolder();
  })();
})();