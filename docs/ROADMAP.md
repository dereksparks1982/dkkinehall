# DK Kinehall acceptance roadmap

## Approved product and scope

The current installed standalone edition uses **the approved DK Kinehall shared web UI inside Chromium/Electron**. The web edition shares the same interface. Do not change the approved icons, transport buttons, episode artwork sizes or player identity.

The `native/` Qt/libmpv code is a **codec-capable prototype**, not an approved replacement for that UI. The older roadmap falsely said Chromium artifacts were deleted; they are still present on `main`.

## Local Library Home scope

- **New standalone requirement:** automatically discover movie/TV files under the user's home and standard mounted-media roots, without a folder-picker setup. A bounded one-shot scan follows immediate rendering of the saved IndexedDB collection; manual Scan Library remains available. Never run a constant scanner/server.
- **Filesystem actions:** right-click an individual movie or episode for Delete from Disk. The Electron main process validates the file path and requests OS confirmation before offering Trash or permanent removal. Permanent deletion requires additional confirmation. No bulk series deletion; never just hide the item.
- **Native-to-original-player path:** Electron returns a validated file URL and current file size and timestamp to the existing original video element; native MKV metadata is read through capped byte ranges. Native format conversion is restricted to the actual bundled decoder, not fake Blob remuxing. The original window appearance, background, controls and icons stay unchanged.
- **Acceptance still outstanding:** validate native file URL access and the range-reader in the actual Electron runtime on Linux, mount-disconnect recovery, scanning performance, and deletion/trash behavior before releasing the updater. No update command until the actual package is verified.

- Start in a separate **Library Home** window. The existing Chromium player opens as a second window, not a replacement. Preserve the exact player background, approved icons and styles.
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
- Visible Chapters button with embedded Matroska chapter reading and native cue fallback.
- Resizable video, Float/Dock in the application, Chromium native Picture-in-Picture.
- Reordering preserves the Up Next scroll position and stores user-selected order for reopened, permission-approved folders. Both editions enforce the approved 0–100% volume range without amplification.
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

- Move playback preferences from the upper header to a **gear icon in the video player bar** without changing existing control icons or the Soviet-themed backdrop. Enforce this at packaging: exactly one video-bar gear, no top-header Playback settings button, and all previous settings still present.
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
7. **Library acceptance.** Verify both windows together, file and folder permission persistence in the installed Chromium runtime, TV/movie grouping, correct cached posters, manual/startup scans, missing drives, progress and resume after reboot, large collections and low idle resource usage. Compare the exact background image and player icons before release.
8. **Final release gate.** The existing updater checks `maintenance/release-gate.json` before changing the installed player. It remains closed until all acceptance checks pass. The future native-codec payload is built by the maintainer-only release asset script and delivered as a checksum-pinned DK Kinehall GitHub release asset, independently verified before installation. No update command, download instruction or announcement that "everything" is finished before verification of the actual packaged standalone player.

A decoder cannot literally handle every encrypted, malformed, unpublished or unknown future codec. Target broad coverage with automatic bundled support, never substitute an extension whitelist or metadata inspection for actual video/audio decoding.

**Current status: in progress; not fully verified. One GitHub branch: main.**
