/* DK Media Player web-only source checks. Run: node docs/tests/web-player-smoke.cjs */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "player.js"), "utf8");
const css = fs.readFileSync(path.join(root, "player.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
new Function(js);
assert.match(js, /screen\.addEventListener\("dblclick"/);
assert.match(js, /const toggleFullscreen = async/);
assert.match(js, /await openLocalFiles\("restore"\)/);
assert.match(js, /state\.pendingPickerMode/);
assert.match(js, /"temporary-file"/);
assert.doesNotMatch(js, /createMediaElementSource|createGain|AudioContext|enableAudioBoost|volumeGain/);
assert.match(js, /media\.volume = volumePercent \/ 100/);
assert.match(js, /Math\.min\(100,/);
assert.doesNotMatch(js, /Math\.min\(200,/);
assert.match(html, /id="volume" min="0" max="100"/);
assert.doesNotMatch(html, /id="volume" min="0" max="200"/);
assert.match(html, /class="speaker-icon"/);
assert.match(html, /id="volumeValue"/);
assert.doesNotMatch(html, /id="mute"[^>]*>🔊/);
assert.match(css, /\[hidden\]\s*\{\s*display:none\s*!important/);
assert.match(css, /\.screen video\s*\{[^}]*max-height:none/);
assert.match(css, /\.volume-icon-button\s*\{\s*color:var\(--accent\)/);
console.log("PASS: web player source checks");

assert.match(html, /id="screenControls"/);
assert.match(html, /id="playerContextMenu"/);
assert.match(html, /id="mediaInfo"/);
assert.ok(html.indexOf('id="screenControls"') < html.indexOf('class="now-playing"'),
  "seek and controls should be inside the video frame");
assert.match(css, /\.screen > \.controls\s*\{/);
assert.match(css, /\.screen\.ui-hidden > \.controls/);
assert.match(css, /\.player-context-menu\s*\{/);
assert.match(css, /images\/soviet-poster\.png/);
assert.match(js, /screen\.addEventListener\("contextmenu"/);
assert.match(js, /addMenuItem\("Subtitles off"/);
assert.match(js, /audioApi\.selectNative\(media,index\)/);
assert.match(js, /addMenuItem\("Media information"/);

assert.match(html, /src="\.\/images\/golden-emblem\.png"/);
assert.match(html, /src="\.\/icons\/dk-media-player-128\.png"/);
assert.doesNotMatch(html, /id="saveCurrent"|Save URL to Library/);
assert.doesNotMatch(js, /byId\("saveCurrent"\)/);
assert.match(css, /\.screen \.controls #playPause\s*\{/);
assert.match(css, /background:#d82e3c/);
assert.match(css, /\.screen\.cursor-hidden/);
assert.match(js, /cursorIdleTimer = setTimeout/);
assert.match(js, /\}, 3000\)/);
assert.match(js, /screen\.addEventListener\("pointermove", showCursor\)/);
assert.match(html, /<\/div>\s*<\/div>\s*<div id="playerContextMenu"/);
assert.match(html, /id="mediaInfoDetails"><\/dl><\/div>\s*<\/div>\s*<div class="now-playing"/);

assert.match(html, /id="emptyTitle"/);
assert.match(html, /id="emptyDescription"/);
assert.doesNotMatch(html, /Original DK Media|Browser Edition|Your videos and music, on your device/);
assert.match(html, /src="\.\/mkv-tracks\.js\?/);
assert.match(js, /const stopCurrent = \(\) =>/);
assert.match(js, /screen\.classList\.add\("empty", "stopped"\)/);
assert.match(js, /screen\.classList\.remove\("empty", "stopped"\)/);
assert.match(js, /delete state\.resume\[item\.key\]/);
assert.match(css, /\.screen\.stopped > \.controls/);
assert.match(js, /subtitlePreference: "dkmedia\.web\.subtitle-preference\.v1"/);
assert.match(js, /const applySubtitlePreference = \(\) =>/);
assert.match(js, /media\.textTracks\.addEventListener\("addtrack"/);
assert.match(js, /track\.mode = track === selection \? "showing" : "disabled"/);
assert.match(js, /DKMatroska\.inspectFile\(file\)/);
assert.match(js, /Detected MKV subtitle tracks/);

/* English / Russian switch and compact context-menu regression checks. */
const locale = fs.readFileSync(path.join(root, "i18n.js"), "utf8");
new Function(locale);
assert.match(html, /id="languageSelect"[^>]*>/);
assert.match(html, /<option value="en">English<\/option>/);
assert.match(html, /<option value="ru">Русский<\/option>/);
assert.doesNotMatch(html, /id="openHeader"/);
assert.doesNotMatch(js, /byId\("openHeader"\)|"openHeader"/);
assert.match(html, /id="openEmpty"/);
assert.match(html, /id="addQueueFiles"/);
assert.ok(html.indexOf('src="./i18n.js?') < html.indexOf('src="./player.js?'));
assert.match(js, /const addMenuHeading = label =>/);
assert.match(js, /className = "context-section-toggle"/);
assert.match(js, /activeMenuSection = contextMenu/);
assert.ok(js.indexOf('addMenuHeading("Subtitles")') < js.indexOf('addMenuHeading("Speed")'));
assert.match(js, /contextMenu\.querySelectorAll\("\.context-section-items"\)/);
assert.match(js, /window\.DKLocale\.apply\(\)/);
assert.match(css, /\.player-context-menu \.context-section-toggle/);
assert.match(css, /\.screen \.controls \.player-tool-button/);
assert.match(html, /id="pip"[^>]*><svg class="player-tool-icon"/);
assert.match(html, /id="fullscreen"[^>]*><svg class="player-tool-icon"/);
assert.match(locale, /MutationObserver/);
assert.match(locale, /document\.documentElement\.lang = language/);

// Subtitle files use a separately testable parser; do not rewrite dialogue lines.
assert.match(html, /src="\.\/subtitle-text\.js\?/);
assert.match(js, /DKSubtitleText\.toWebVTT\(await file\.text\(\), file\.name\)/);
assert.match(css, /background-position:right 17px center/);
assert.match(css, /appearance:none;-webkit-appearance:none/);

/* YouTube-style hover preview is separate from the playing media. */
assert.match(html, /id="seekPreview"/);
assert.match(html, /id="previewFrame"/);
assert.match(html, /src="\.\/seek-preview\.js\?/);
assert.match(js, /DKSeekPreview\.attach/);
assert.match(js, /seekPreview\.reset\(\)/);
assert.match(css, /\.seek-preview\.has-frame/);

/* Full queue keeps watched entries; red marker advances with playback.
   Reuse the existing red X for manual removal. */
assert.match(js, /const pending = state\.queue/);
assert.match(js, /if \(index === state\.current\)/);
assert.match(js, /li\.classList\.add\("current"\)/);
assert.match(js, /li\.setAttribute\("aria-current", "true"\)/);
assert.match(js, /const remove = document\.createElement\("button"\)/);
assert.match(js, /remove\.textContent = "×"/);
assert.match(js, /media\.addEventListener\("ended"/);
assert.match(js, /load\(state\.current \+ 1\)/);
assert.match(css, /\.queue li\.current/);
assert.match(css, /\.queue \.icon-btn\.remove \{ color:#ff5a62/);
assert.match(html, /src="\.\/queue-hover\.js\?/);
assert.match(js, /DKQueueHover\.create/);
assert.match(css, /\.queue \.queue-artwork/);
assert.match(css, /\.queue \.queue-hover-video/);

/* Metadata artwork comes from TVmaze / optional TMDb and Jellyfin selection. */
assert.match(html, /src="\.\/episode-metadata\.js\?/);
assert.match(html, /src="\.\/jellyfin-artwork\.js\?/);
assert.match(html, /src="\.\/metadata-ui\.js\?/);
assert.doesNotMatch(html, /src="\.\/title-card\.js\?/);
assert.match(js, /li\.dataset\.queueKind = item\.kind/);
assert.match(js, /li\.dataset\.queueAudio/);
assert.doesNotMatch(js, /DKTitleCard\.parse/);
assert.match(css, /\.queue \.queue-artwork\.has-art/);
assert.doesNotMatch(html, /id="autoArtwork"|id="tmdbToken"|id="applyTmdbToken"/);
assert.match(html, /https:\/\/www\.tvmaze\.com\//);
assert.ok(html.indexOf('id="addQueueFiles"') < html.indexOf('id="queue"'));
assert.ok(html.indexOf('id="clearQueue"') < html.indexOf('id="queue"'));
assert.match(css, /\.sidebar-top #addQueueFiles\{background:#d83a42/);
/* Dedicated seek buttons: exactly ten seconds in either direction. */
assert.match(html, /id="rewind10"/);
assert.match(html, /id="forward10"/);
assert.match(js, /byId\("rewind10"\)\.addEventListener\("click", \(\) => skipTen\(-10\)\)/);
assert.match(js, /byId\("forward10"\)\.addEventListener\("click", \(\) => skipTen\(10\)\)/);
assert.match(js, /Math\.max\(0, Math\.min\(media\.duration, media\.currentTime \+ delta\)\)/);
assert.match(css, /\.screen \.controls \.skip-ten/);

/* Episode art recovery: public metadata, visible diagnostics, cache-busted JS. */
const metaSource=fs.readFileSync(path.join(root, "episode-metadata.js"), "utf8");
const artUI=fs.readFileSync(path.join(root, "metadata-ui.js"), "utf8");
new Function(metaSource);new Function(artUI);
assert.match(html, /episode-metadata\.js\?v=20261125-posters/);
assert.match(html, /metadata-ui\.js\?v=20261125-posters/);
assert.match(metaSource, /const collapsed=entries\.filter/);
assert.match(metaSource, /status!==429/);
assert.match(metaSource, /const series=allowedImage\(show\.image/);
assert.match(metaSource, /fallbackUrl:data\.series/);
assert.match(artUI, /scheduleRetry/);
assert.match(artUI, /dataset\.artworkStatus/);
assert.match(artUI, /image\.onerror=/);
assert.match(artUI, /enabled=true,token=""/);
assert.match(artUI, /Finding movie poster/);
assert.match(artUI, /Apple/);
assert.doesNotMatch(artUI,/Automatic artwork is available for TV episodes/);
assert.match(html,/src="\.\/mkv-cover\.js\?/);
assert.match(html,/src="\.\/queue-artwork\.js\?/);
assert.match(js,/li\.dkQueueItem = item/);
assert.match(css,/data-artwork-type="movie"/);
assert.match(metaSource,/pickAppleMovie/);
assert.match(metaSource,/appleJSONP/);
assert.match(metaSource,/pickCinemetaMovie/);
assert.match(html, /Choose a video or music file from this device\./);
assert.doesNotMatch(html, /data-nav=|id="page-library"|id="page-help"|id="urlForm"|Private local playback/);
assert.doesNotMatch(js, /byId\("urlForm"\)|byId\("clearLibrary"\)|renderLibrary\(/);

/* Open files auto-plays when idle; Up Next never interrupts; Restore stays paused. */
assert.match(html, /src="\.\/queue-autoplay\.js\?/);
assert.match(js, /DKQueueAutoplay\.plan\(mode, state\.current, state\.queue\.length, playing\)/);
assert.match(js, /state\.queue\.splice\(plan\.insertAt, 0, \.\.\.newItems\)/);
assert.match(js, /if \(plan\.activate\) load\(plan\.insertAt, plan\.autoplay\)/);
assert.match(js, /openLocalFiles\("queue"\)/);
assert.match(js, /openLocalFiles\("open"\)/);
assert.match(js, /openLocalFiles\("restore"\)/);
require("./queue-autoplay.cjs");

/* Folder access: shared Chromium directory handle, not a second player. */
const folderSource=fs.readFileSync(path.join(root, "folder-access.js"), "utf8");
new Function(folderSource);
assert.match(html, /src="\.\/folder-access\.js\?/);
assert.match(html, /id="selectFolder"/);
assert.match(html, /id="reopenFolder"/);
assert.match(html, /id="forgetFolder"/);
assert.match(html, /id="folderStatus"/);
assert.match(html, /id="folderFallback"[^>]*webkitdirectory/);
assert.match(js, /showDirectoryPicker/);
assert.match(js, /folderHandleKey = "selectedMediaFolder"/);
assert.match(js, /storedHandle\("save", handle, folderHandleKey\)/);
assert.match(js, /storedHandle\("read", null, folderHandleKey\)/);
assert.match(js, /collectFolder\(handle, "startup"\)/);
assert.match(js, /await restoreLastMedia\(\);\s*await restoreSavedFolder\(\)/);
assert.match(js, /selections\.map\(e => e\.handle\), "queue"/);
assert.match(css, /\.folder-access\s*\{/);
console.log("PASS: folder-access web/player integration checks");

/* Build 3: codec switching is functional, not just metadata listing. */
const mkvAudioSource=fs.readFileSync(path.join(root,"mkv-audio.js"),"utf8");
const vobSubSource=fs.readFileSync(path.join(root,"vobsub.js"),"utf8");
new Function(mkvAudioSource);
new Function(vobSubSource);
assert.match(html, /src="\.\/vobsub\.js\?/);
assert.match(js, /const loadVobSubTrack = async track =>/);
assert.match(js, /window\.DKVobSub\.extract\(item\.file,track/);
assert.match(js, /state\.subtitleRenderer = window\.DKVobSub/);
assert.match(js, /embeddedSubtitlePreferences/);
assert.match(js, /restoreEmbeddedSubtitlePreference\(item\)/);
assert.match(js, /mkvAudio\.hold\(\)/);
assert.match(js, /mkvAudio\.restart\(\)/);
assert.match(mkvAudioSource, /const configFor=meta=>/);
assert.match(mkvAudioSource, /const splitBlock=async\(reader,part,number\)=>/);
require("./mkv-audio.cjs");
require("./vobsub.cjs");
console.log("PASS: MKV audio and DVD bitmap subtitle integration");

/* Build 4: unsupported codec names do not claim to be playable. */
const expandedSource=fs.readFileSync(path.join(root,"mkv-audio.js"),"utf8");
assert.match(html,/src="\.\/mkv-audio\.js\?v=20261125-codecs4/);
assert.match(html,/src="\.\/mkv-tracks\.js\?v=20261125-codecs4/);
assert.match(expandedSource,/A_MPEG\/L3/);
assert.match(expandedSource,/A_FLAC/);
assert.match(expandedSource,/A_VORBIS/);
assert.match(expandedSource,/inspectAudioPackets/);
assert.match(js,/Chromium cannot play this MKV video codec/);
assert.match(js,/Detected MKV video codec/);
require("./mkv-expanded-codecs.cjs");
console.log("PASS: Build 4 expanded MKV audio and clear video-codec diagnostics");

/* Build 5: native compatible WebM playback fallback, not metadata-only. */
const compatSource=fs.readFileSync(path.join(root,"mkv-webm.js"),"utf8");
new Function(compatSource);
assert.match(html, /mkv-webm\.js\?v=20261125-webm5/);
assert.match(js, /const retryAsWebM = async item =>/);
assert.match(js, /window\.DKMkvWebM\.wrap\(item\.file,info\)/);
assert.match(js, /item\.compatSrc \|\| item\.src/);
assert.match(js, /releaseCompatible\(item\)/);
console.log("PASS: Build 5 MKV to native WebM compatibility wiring");

/* Build 6 H264/AAC remux is wired into the shared player. */
const mp4Source=fs.readFileSync(path.join(root,"mkv-mp4.js"),"utf8");
new Function(mp4Source);
assert.match(html,/mkv-mp4\.js\?v=20261125-avc6/);
assert.match(html,/player\.js\?v=20261125-avc6/);
assert.match(js,/DKMkvMP4\.eligible\(compatibleInfo\(item\),item\.file\)/);
assert.match(js,/DKMkvMP4\.remux\(item\.file,compatibleInfo\(item\)\)/);
assert.match(js,/Playing H\.264\/AAC MKV through an MP4 container/);
console.log("PASS: H264/AAC fallback loaded without changing original player UI");
