# DK Kinehall master development and acceptance roadmap

Updated 2026-11-26. This is the authoritative running backlog. Keep every unfinished feature here until accepted. **Source added** means committed, not tested or installed. **Planned** means not yet implemented. Maintain this file and README at every build.

## Approved product and scope

The current installed standalone edition uses **the approved DK Kinehall shared web UI inside Chromium/Electron**. The hosted web edition is frozen for now; shared-source changes must be guarded by the standalone bridge. Do not change the approved icons, transport buttons, episode artwork sizes or player identity.

The `native/` Qt/libmpv code is a **codec-capable prototype**, not an approved replacement for that UI. The older roadmap falsely said Chromium artifacts were deleted; they are still present on `main`.

## Local Library Home scope

- **New standalone requirement:** automatically discover movie/TV files under the user's home and standard mounted-media roots, without a folder-picker setup. A bounded one-shot scan follows immediate rendering of the saved IndexedDB collection; manual Scan Library remains available. Never run a constant scanner/server.
- **Filesystem actions:** right-click an individual movie or episode for Delete from Disk. The Electron main process validates the file path and requests OS confirmation before offering Trash or permanent removal. Permanent deletion requires additional confirmation. No bulk series deletion; never just hide the item.
- **Native-to-original-player path:** Electron returns a validated file URL and current file size and timestamp to the existing original video element; native MKV metadata is read through capped byte ranges. Native format conversion is restricted to the actual bundled decoder, not fake Blob remuxing. The original window appearance, background, controls and icons stay unchanged.
- **Acceptance still outstanding:** validate native file URL access and the range-reader in the actual Electron runtime on Linux, mount-disconnect recovery, scanning performance, and deletion/trash behavior before releasing the updater. The release updater remains gated; the separate development updater is opt-in and unaccepted. Do not provide terminal commands or downloads until requested.

- Start on **Library Home** in one native window. The existing Chromium player is a persistent internal view, not a second window or replacement; switching views preserves playback. Preserve the exact player background, approved icons and styles.
- **Movies / TV Shows only**, including Season 0 specials when present and excluding audio-only Ogg files. Nested Show/Season/01 - Episode folder layouts are classified as TV, and a metadata-only alias supplies proper series/episode details to the original player without renaming video files. Continue Watching above the entire selected collection; TV series group by title with season/episode drilldown. No music library, no Recently Added and **no media server**.
- Cache folder handles and catalog records in IndexedDB, plus separate series posters and episode stills and verified episode titles that remain cached independently of artwork. Generic poster.jpg is not assigned from a mixed collection root; dedicated series/movie folders are preferred. Scans use folder-specific database indexes; poster requests are deduplicated across Continue Watching and the TV series collection. Video files never enter the cache. Remember playing position and completed status between application launches.
- Verified episode-name changes update only matching card text without re-rendering the entire Home grid.
- Resume state handles short videos without accidentally marking Stop at 0:00 as watched; verified episode titles remain available when local poster artwork is already cached.
- Entire Movies/TV poster collection loads progressively as the user scrolls. Continue Watching refreshes are deferred while Home is unfocused, reducing work during movie playback on the Surface Pro.
- Visible manual **Scan Library**: inspect saved folders, add/update changed files, transfer saved progress/poster for unambiguously matched renames, mark genuinely missing files without deleting history, accurately report partial and permission-blocked scans, show progress and allow cancel. Startup loads cached catalog immediately and later performs one bounded check with no permission prompts.
- Pinned upstream source integrations are documented at `third_party/SOURCES.md`. Use LGPL-oriented libmpv SDK builds and retain third-party licenses. Jellyfin Desktop/FFmpeg and the not-yet-Linux Electron mpv addon are reference-only.
- All new native-window and library code is **source-level and not installed, compiled or playback-verified**; never mark the release gate complete on source commits alone.

## Source changes on main

- Mouse/touch/keyboard Up Next reordering, Shuffle, Loop Off/One/All.
- Tiny white chapter ticks inside the gold seek bar (no separate standalone Chapters button), using embedded Matroska/native chapters first, otherwise nine virtual markers dividing a video into ten sections.
- Resizable video, Float/Dock in the application, Chromium native Picture-in-Picture.
- Reordering preserves the Up Next scroll position and stores user-selected order for reopened, permission-approved folders. Standalone volume is 0–200% with actual gain above 100%; the hosted edition remains 0–100%. The standalone volume slider is red.
- Episode show title on line one; SxxExx and episode name together on the wrapping second line.
- Source-level native Qt/libmpv chapter menu, queue drag ordering, Shuffle/Loop and wider file selection.
- Native prototype: TVmaze episode lookup from series and SxxExx only, cached verified names and stills, with original release filename kept for playback and local poster priority.
- Explicit file selection no longer depends on a narrow filename suffix list; folder scanning recognizes additional modern and older video/audio formats. Actual decoding remains required.
- Playback format policy: **Original (no conversion)** never engages native FFmpeg transcoding. Automatic mode can use bundled decoding as a fallback.
- Automatic native fallback supports WebM VP9/Opus when H.264/AAC encoding is not bundled; explicit MP4/WebM selections remain strict, avoiding mandatory GPL-linked libx264 in an LGPL codec configuration.
- **Codec hardening:** Electron main validates discovered-video IDs/paths against the filesystem before invoking FFprobe/FFmpeg. The original player preload must be identified explicitly for the second window, avoiding reliance on undocumented Electron preferences availability.
- **Codec manifest validation:** Include ENCODERS_INCLUDED.txt alongside decoder/demuxer/build configuration inventories, parse compound demuxer aliases correctly and reject --enable-gpl/--enable-nonfree flags for LGPL-designated binaries. Synthetic regression cases are available for maintainer-side checking.
- Source-level Electron codec backend: guarded preload IPC, FFprobe metadata, loopback-only FFmpeg output inside the existing video element, seek/resume original-time adapter, alternate audio stream selection, FFprobe embedded chapter retrieval beyond MKV, on-demand text subtitle extraction to WebVTT (re-aligned after stream seeking), bounded FFprobe caching for repeated seek/audio changes, old MKV audio decoder teardown on native fallback, Repeat One stream restart, real playback-event confirmation and all-or-nothing backend archive staging.
- Native portable packaging audits FFmpeg codec libraries, includes FFmpeg/FFprobe executables, records decoder/demuxer inventories and ships third-party notices.

These are source-level changes, not a claim that a final release has been fully checked.

## Player-bar Settings build

- Move playback preferences from the upper header to a **gear icon in the video player bar** without changing existing control icons or the approved crimson liquid backdrop. Enforce this at packaging: exactly one video-bar gear, no top-header Playback settings button, and all previous settings still present.
- Put the caption **On/Off** toggle on the player bar. Move subtitle track selection, SRT/VTT loading, and the 0.25-second subtitle delay buttons into the gear menu together with speed and playback preferences.
- Remove the former subtitle strip below the playing media, but preserve the existing **series name first line / SxxExx plus episode title second line** without modification.
- Anchor settings to the player-bar gear in Chromium's top layer, ensure it stays accessible during video playback/fullscreen, and keep unsupported subtitle tracks disabled.
- Verify Russian translations for the menu and explicit playback formats; do not expose English interface labels in the Russian edition.
- Source-level changes are not a validated standalone runtime; release stays locked until acceptance.

## Unfinished, mandatory acceptance gates

1. **All-in-one native codecs.** Finish packaging and verify the Electron-to-FFmpeg backend behind the approved Chromium player interface. Current GitHub changes are source code only, not a finished codec-enabled binary.
2. **Video/audio sample coverage.** Verify MKV, MP4, AVI, MOV, WebM, TS, M2TS, VOB and older containers, and H.264, HEVC, VP9, AV1, MPEG-2/4, common legacy video; AAC, AC-3, E-AC-3, DTS, FLAC, MP3, Opus, Vorbis and common audio. Report genuine encrypted, proprietary, damaged and future-format exceptions honestly.
3. **Subtitle/audio tracks.** Verify text, ASS/SSA, PGS, VobSub, external subtitle files, audio switching, and timing/remembered settings.
4. **Playback/queue UI.** Verify fullscreen, resume, play-now vs queue-only, auto-next, shuffle, repeat, drag, chapters, Picture-in-Picture, float/dock, mouse/touch and keyboard.
5. **Episode artwork/metadata.** Verify show, episode number and episode name; posters, episode stills, provider retrieval and local fallback.
6. **Release packaging.** Ship a self-contained executable with actual codec libraries, correct licensing and notices, and unchanged approved icons. Verify English/Russian interface.
7. **Library acceptance.** Verify both internal views in one window, file and folder permission persistence in the installed Chromium runtime, TV/movie grouping, correct cached posters, manual/startup scans, missing drives, progress and resume after reboot, large collections and low idle resource usage. Compare the exact background image and player icons before release.
8. **Final release gate.** The existing updater checks `maintenance/release-gate.json` before changing the installed player. It remains closed until all acceptance checks pass. The future native-codec payload is built by the maintainer-only release asset script and delivered as a checksum-pinned DK Kinehall GitHub release asset, independently verified before installation. Do not announce that everything is finished before actual package verification. The separate development updater is unaccepted; do not provide terminal commands or downloads until requested.

A decoder cannot literally handle every encrypted, malformed, unpublished or unknown future codec. Target broad coverage with automatic bundled support, never substitute an extension whitelist or metadata inspection for actual video/audio decoding.

## Active feature development sequence

All classic Windows Media Player features below are in scope. Network playback is no longer deferred. Continue sequentially, and retain all existing behavior. The settings gear remains the single home for enhancements; do not add unnecessary controls to the transport bar.

| Priority | Feature | State / remaining work |
|---|---|---|
| 1 | Brightness, contrast, saturation and hue | Source added: live sliders, persisted values, reset to neutral; runtime acceptance pending |
| 2 | Gamma correction and sharpness | Source added: local SVG gamma transfer/convolution, neutral bypass; verify rendering, subtitle compatibility and Surface Pro performance |
| 3 | Single-frame forward and reverse | Source added: bounded FFprobe presentation timestamp lookup, paused Previous/Next frame and Shift+Left/Right, native stream restart at chosen timestamp. Verify direct, remuxed and transcoded presentation accuracy, unusual start times, variable frame rate, sparse keyframes and final frames; further decoder work if exact stepping fails. No fixed-FPS approximation. |
| 4 | Video zoom, crop, aspect ratio | Source added: fit/fill, 50/100/150/200% presets, custom 50–300%, horizontal/vertical pan, original/4:3/16:9/1:1/21:9/2.35:1 aspect options, reset and saved preferences. Overrides may stretch picture; verify bitmap/text subtitle alignment, clipping, fullscreen, float/dock and PiP. |
| 5 | Ten-band graphic equalizer | Source added: ten ±12 dB bands at 31/62/125/250/500 Hz, 1/2/4/8/16 kHz; eight presets, custom settings, bass/treble ±12 dB, stereo balance, optional estimated EQ headroom, reset and persistence. Shared DSP topology for normal, native-transcoded and separate MKV playback. Neutral bypass, preserve 200% volume. Verify sound with local-file and loopback origins, track switching, mono/stereo/surround, balance downmix, clipping, resume and performance. |
| 6 | Automatic volume leveling and dialogue enhancement | Source added: independent opt-in adjustable dynamic range compression with conservative makeup gain and speech-frequency EQ; master 0–200% gain downstream of DSP, shared direct/native/MKV path. Not integrated LUFS normalization or isolated voice extraction; verify audio, clipping, surround downmix, latency and lip sync. Evaluate true channel-aware center/dialogue processing and integrated loudness normalization after acceptance. |
| 7 | Deinterlacing | Planned: automatic detection or manual off/auto/on using actual decoder filters, preserve timestamps and avoid unnecessary transcoding |
| 8 | Video smoothing | Planned: define interpolation vs simple scaling, opt-in quality modes, no fake frame interpolation; respect hardware limits |
| 9 | DVD, ISO, VIDEO_TS and menus | Planned: physical disc, image and folder support; interactive navigation, titles/chapters, extras, multiple angles, audio and subtitles; actual licensed disc navigation backend rather than merely playing VOB files |
| 10 | Network media playback | Planned: DLNA/UPnP discovery and client playback, network shares, URL streaming, secure local/network source access, timeouts and permissions; no media server or persistent daemon |
| 11 | Offline English/Russian subtitle translation | Source foundation and opt-in installer added; complete verified local runtime/models, automatic ahead-of-playback translation, bilingual display, SRT export, opt-in cache, bitmap-subtitle OCR; see detailed roadmap |
| 12 | DK Voiceover: offline Russian/English movie dubbing | Planned: local ASR, translation, male/female speech synthesis, diarization, synchronization, original audio mixing/separation, progress, cancellation, cache, ahead-of-playback and export; see [VOICEOVER_ROADMAP.md](VOICEOVER_ROADMAP.md) |
| Preserve | Playback speed, fullscreen, mini-player, Picture-in-Picture, chapters | Existing source; verify regressions and maintain |
| Preserve | Video format conversion and 200% volume | Existing source; improve codec coverage and progress, verify native exports and actual amplification |

Picture adjustments apply only to the visible player video, not original files, thumbnails, or exported files. Default neutral values bypass filters. Native Picture-in-Picture and browser-rendered subtitle behavior with filters remain to be verified; do not assume support.

## Outstanding library, player and packaging backlog

- **Library catalog:** Verify automatic and manual scanning, exact native paths, mount disconnect/reconnect, stale record reconciliation with preserved history, manual Empty Trash (catalog only; confirmation; reconnect drives first), and actual Delete from Disk (separate native confirmation and trash/permanent choices). Distinct available files must never be merged just because they have the same show/episode.
- **Artwork and metadata:** Verify correct series posters vs individual episode stills (especially South Park Season 0), provider matching, verified titles, movie details and Refresh Metadata progress/cancel, local cover preference, cached art and old wrong-art recovery. Recheck old series cache and use a versioned key or explicit invalidation when necessary. Do not claim a refresh found new data simply because old cached metadata exists.
- **Player restore/history:** Restore exact last file and saved time without opening a file explorer; handle legacy records, picked files and native library files. Persist history and avoid adding a duplicate when Library Continue Watching reopens a queued video. Stop must preserve unfinished progress, while ordinary Play after Stop restarts at the beginning. Verify mouse Back/Forward through views and seasons.
- **Docked player expansion:** Source added: drag existing corner or right edge across the normal sidebar boundary to hide Up Next, drag left to restore it, full available content width without fullscreen, retain queue and video element, remember expanded/width preference. Verify resize pointer capture, narrow windows, float/dock, fullscreen transitions and subtitle positioning.
- **Queue and controls:** Add file plays immediately when requested, queue-only adds without interrupting; auto-remove completed videos, red removal X, approved larger artwork, drag reorder, repeat Off/One/All, shuffle, all button states fixed-size. Verify arrow seeking reveals the seek bar and hides after three seconds of playback inactivity. Preserve chapter ticks, right-click options and subtitles toggle/gear, exact episode labels, resize/float/dock/fullscreen and cursor auto-hide.
- **Codec compatibility:** Resolve AVI and other unsupported container/audio cases, validate direct file and restored-file grants, native seek timing, track switching and all output modes. Finish real self-contained bundled codecs, including uncommon legacy audio/video, without asking end users to install external codecs. Native Qt prototype is reference only; never replace the approved player. See [CODEC_PACKAGING.md](CODEC_PACKAGING.md).
- **Conversion:** MP4, WebM and MKV output; preserve originals, correct progress and cancellation, compatible stream copy, subtitle handling and honest unsupported cases. Verify output is playable and seekable. Live format selection is distinct from permanent export.
- **Translation:** [SUBTITLE_TRANSLATION_ROADMAP.md](SUBTITLE_TRANSLATION_ROADMAP.md) retains engine, model, packaging, licensing and accuracy requirements. No surprise model downloads.
- **DK Voiceover:** [VOICEOVER_ROADMAP.md](VOICEOVER_ROADMAP.md) is the approved detailed offline dubbing roadmap. No downloaded models or implementation yet.
- **Localization:** English and Russian interface parity, including dynamic settings, provider labels and all dialogs. No untranslated English interface strings on Russian pages; media titles are content, not interface labels.
- **Resource usage:** Preserve bounded discovery, incremental rendering, low idle resource use, and avoid unnecessary network requests. Make optional intensive enhancements default off/neutral; no large downloads or heavyweight CI.
- **Release:** Maintain standalone development updater separately from gated accepted release; verify install/rollback, existing launcher/executable/file association, no icon changes, codec and model license notices, checksum-pinned self-contained packages and actual target Linux playback when permission to compile/test is restored.

## Permanent design and workflow requirements

- Approved standalone footer: gold DK Kinehall ☭ DK Softworks on the left and gold text-only ACP link to https://acp.us/ on the right. Localized Russian footer. Open the fixed URL in the default browser only on explicit link activation; no icon, embedded page or automatic network request.
- Approved crimson background and original application icons must not change without explicit approval. Existing standalone remains the exact Chromium-based player; no hosted web development for now.
- Preserve red Library/Player navigation, Play, Add files, Clear queue, red volume slider and removal X; gold headings, seek bar and selected Library tabs; brown/gold secondary controls; white Shuffle/Loop with inset active/focus indicators. Sidebar rows: brown Choose folder/Reopen folder; white Forget folder/Scan Library; gold Empty Trash/Refresh Metadata. Scan Library white on both pages. White chapter ticks.
- Right-click menu top-level palette: Playback red; Playback format, Speed and Picture gold; Subtitles, Audio tracks and Media information white; other sections brown/gold. Keep the same sizes and inset focus indicators; nested controls remain unchanged.
- Transport palette: solid brown Previous/Next with gold glyphs; solid white 10-second Rewind/Fast-forward with dark glyphs; red Play/Pause with white glyph; solid gold Stop with dark square. Preserve original symbols, order, dimensions, spacing and gold borders; inset focus indicators and muted disabled states.
- Preserve the two-line series and episode text, original control sizes, 200% actual volume, existing preferences and saved library history.
- One branch only: main. One build at a time. Build on explicit instruction, stop on request. No compile, tests, large downloads or GitHub Actions during the current source-only period. No terminal commands or downloads until the user requests them again.
- Keep README and this master roadmap current. Version changes at meaningful milestones rather than every commit. Never claim runtime acceptance based on source commits alone. Keep the application free; comply with third-party redistribution obligations.

**Current status: v0.9.3 source development; not fully verified. Next implementation priority: deinterlacing.**
