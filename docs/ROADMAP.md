# DK Kinehall roadmap

**Direction (November 2026):** The web player is the single interface for both GitHub Pages and the standalone Linux desktop release. The desktop launcher embeds Chromium and loads the original `docs/` assets **unchanged**, rather than recreating them in a second toolkit. Do not add yt-dlp, download managers, media servers, direct-URL streaming forms, or saved-link libraries to DK Kinehall.

## Exact-web standalone Linux version (replaces rejected Tkinter redesign)
- The **web player itself** in `docs/` is the desktop UI. No separate Tkinter player or approximate visual recreation.
- The portable x86-64 launcher **DK Kinehall** is a Linux executable in the root folder, with its bundled Chromium/Electron runtime stored in `_internal/` for GitHub-safe delivery. On launch, it extracts the included runtime to a local user cache and opens the existing `docs/index.html` using the exact CSS and JavaScript.
- No AppImage, installer, browser download, VLC dependency download, or end-user build step.
- A desktop smoke test verifies the original web player, styles, buttons, and queue load in Electron on Ubuntu 24.04. Full local media playback and per-machine double-click behavior require user-side confirmation.
- The rejected Tkinter/libVLC standalone source and packaging were removed. Retain the web version unchanged.
- Electron relies on a bundled Chromium engine and is larger than the web player alone; this is required for identical browser rendering without a separately installed browser.

## Fullscreen fix, November 24, 2026
- The shared web player fullscreen button, F shortcut and double-click work even before a media file is selected.
- The standalone edition uses a limited Electron preload bridge to fullscreen the actual native window, while the **same** `#screen` and video/controls use the original CSS and fill the monitor.
- Escape, fullscreen button, and OS window events synchronize the button/overlay state.
- One-time Linux GUI test must exercise native enter, exit, double-click and Escape through the built executable before declaring this fix accepted.

## November 24, 2026: automatic playback and application icon
- `Open files` starts the first new media selection automatically if the player is not currently playing. If a movie is already playing, new selections are added to Up Next without interrupting it.
- `+ Add files` is explicitly queue-only, including when no movie is selected or playback is paused.
- Opening several files starts only the first; automatic next-file playback, watched-item retention, and restore-last-file-paused remain unchanged.
- The standalone launcher registers `dk-kinehall.desktop` in the user's XDG applications directory on first run. It points at the existing approved DK Kinehall PNG icon and executable; Linux window WM_CLASS / desktop identity match it for the Ubuntu dock.
- When available, GNOME Files/GIO also assigns that icon as the executable file's per-file custom icon on first launch. This file-manager metadata cannot be delivered pre-set inside a normal GitHub ZIP.
- Rebuild the single root executable with the unchanged web UI and verify the exact playback/queue behavior under Electron plus Go launcher, then remove the one-time workflow.

## Build 2: remembered media folders (November 2026)
- Users explicitly select a directory with Chromium's `showDirectoryPicker`. Only the authorized `FileSystemDirectoryHandle` is saved to origin-local IndexedDB, under its own key independent of the last-playing file handle.
- The same `docs/` interface runs in the web player and standalone Electron. No Tkinter redesign, media server, unrestricted directory access, or backend service.
- The player enumerates supported local media in nested folders (maximum depth six), sorts names naturally, and queues up to 500 files without autoplay or interrupting the current movie. It avoids duplicate entries when reopening a folder already in Up Next.
- Remember the folder name locally, automatically rescan on a later launch **only when read permission is already granted**, show a permission reconnect action otherwise, and let the user forget the folder without deleting or removing already queued files.
- Restrictive browser contexts retain one-session folder selection through a `webkitdirectory` input fallback. Persistent access there is not claimed.
- New tests verify nested scanning, file limits, folder selection, queue noninterruption, re-opening without duplicates, and forgetting access. Automated tests cannot guarantee that a particular user's Chromium/Ubuntu permissions will persist.
- The approved player appearance, fullscreen, previous autoplay behavior, and red selected-item marker remain unchanged.

## Build 3: MKV embedded audio and subtitles (November 2026)
- Keep the original common player UI and Chromium-first architecture. No separate standalone player and no system codec installation.
- Add a packet decoder for basic `S_VOBSUB` DVD subpicture tracks in MKV, using the per-track CodecPrivate IDX palette and DVD subpicture control commands. Render selected subtitles over the video using the existing subtitle canvas. Report unsupported DVD control commands instead of treating a track label as playback.
- Keep existing `S_HDMV/PGS` rendering and embedded text subtitle selection, with per-file remembered embedded subtitle preferences and subtitles off by default for unseen movies.
- Harden the AAC/Opus MKV WebCodecs fallback: hold buffered audio while seeking, restart decoding at completed seeks, and re-prime audio after a pause to avoid stale buffered playback; retain native track selection when Chromium exposes it.
- Include Node tests for AAC/Opus configuration, no-lacing and Xiph/fixed/EBML Matroska block lacing, DVD subpicture RLE/palette and decoder safety limits, MKV private metadata and PGS regressions. Also check WebCodecs capability and subtitle canvas rendering in a Linux Electron window.
- The fallback does **not** add decoding of unsupported video codecs or all MKV audio profiles. Final sync/codec coverage must be verified using real user movies; do not claim universal Matroska support. Expanded format compatibility remains Build 4.

## Movie poster and episode still repair (November 2026)
- Root cause: `metadata-ui.js` had a branch that skipped **every movie file**, while `episode-metadata.js` required an optional TMDb token for movie lookup. The shipped interface supplied no token, so movies could never display online posters.
- Remove the episode-only restriction and add keyless, automatically requested movie artwork from the public Cinemeta and Apple movie catalogs. Match normalized titles and release years; do not display unrelated posters for ambiguous remakes. Retain TVmaze still-first lookup and series poster fallback for episodes.
- Use original approved Matroska cover attachments when present, and local muted video-frame previews if a public poster is unavailable; label those as local previews, not as posters. Limit concurrent decoding and only process relevant visible queue entries. Never upload full files or local paths.
- Reattach actual artwork images when the queue is rerendered; retain recently verified remote artwork **URLs only** across sessions. Retry bad image links and temporary failures. Do not persist remote image bytes.
- Preserve the existing Up Next card width and height. Show portrait posters without cutting off film titles; TV episode stills continue to fill the rectangular area.
- Include tests for matched movie poster, year-mismatch rejection, episode still/series fallback, failed image recovery, persistent URL cache, queue DOM redraw, and actual image load in Linux Chromium/Electron. Public provider availability is outside the player's control.
- Keep the same player on GitHub Pages and in the root Linux executable, then remove the temporary test workflow.

## Next: selectable playback format and progressive output
- Add a right-click **Playback format** selector: Auto, Original, MP4, WebM.
  Save the user preference; disable choices unavailable for the current
  codecs instead of pretending to convert them.
- Preserve seek position and playback state when switching containers.
- Progressively remux into MediaSource/fMP4 instead of preparing the entire
  movie before playback. This is planned, not yet implemented.
- Container switching does not decode HEVC, MPEG-2, AC3 or DTS. Genuine
  transcoding needs separate decoder/encoder integration and licensing.

## Build 6: H.264/AAC Matroska-to-MP4 fallback (November 2026)
- Implement a small EBML-to-ISO-BMFF remux for precisely one AVC/H.264
  video track without decode-order/presentation-order reordering, plus one
  AAC audio track. Preserve original compressed packets via File slices.
  Generate ftyp/moov/mdat, avcC and AAC esds, movie and media
  timing tables, sample sizes, chunk offsets and keyframe indexes.
- Attempt only after native video fails, and only when Chromium reports
  support for the resulting MP4 codec string. Avoid copying complete
  movie bytes into JavaScript, avoid any external codec/FFmpeg dependency
  for users, and revoke temporary blob URLs when queue items leave.
- Bound the first implementation to 1 GiB and 130,000 samples per track.
  Unsupported B-frame reordering, additional streams and missing headers
  must fail explicitly, not claim successful remuxing.
- Run actual H.264/AAC Matroska fixture playback in Chromium and the root
  standalone Linux executable, not metadata-only checks.
- Keep existing UI, locale support, artwork, resume and Up Next. No extra
  branch; remove the temporary GitHub Actions workflow after verified
  release.

## Build 5: lossless WebM-compatible Matroska video playback (November 2026)
- Implement a bounded EBML header rewrite for files that **only** contain
  WebM-compatible VP8/VP9/AV1 video, Opus/Vorbis audio, and optional WebM
  subtitles. Replace Matroska's DocType with WebM and fill the remaining
  header bytes with a valid EBML Void element, preserving size and offsets.
- Only try this on actual native player decode/source failure; keep native
  playback first. Never change files on disk or upload them. Create a
  local Blob from a tiny modified header plus the original File's slices.
  Reuse the existing <video> playback pipeline, controls, audio, queue
  and resume, with URL cleanup when a file is removed.
- Reject H.264/H.265, MPEG-2, AC3/E-AC3, DTS and unsupported subtitle
  tracks rather than implying any of those codecs can play in WebM.
- Generate short VP9+Opus Matroska fixtures on the GitHub build runner.
  Run EBML size/integrity checks and verify moving picture in actual Linux
  Chromium/Electron. Test the installed root executable, not only source.
- No new installer, codec pack, server, video player, branch, or persistent
  GitHub Actions workflow.

## Build 4: expanded Matroska audio codec paths and diagnostics (November 2026)
- Added experimental Chromium WebCodecs audio-track paths for `A_MPEG/L3` (MP3),
  `A_FLAC`, and `A_VORBIS`, retaining existing AAC and Opus. All use the
  existing local MKV demuxer and WebAudio synchronization with the video;
  no download, external player or separately installed codec library.
- Parse FLAC `fLaC` STREAMINFO metadata and Matroska Vorbis/Xiph laced
  identification/comment/setup packets. Validate Chromium-compatible
  Xiph-packed initialization bytes, reject missing/invalid headers, and check decoder
  support before enabling output. MP3/FLAC packet lengths receive codec-aware
  estimates when no Matroska default duration is present.
- Extend the local Matroska header inspector with actual video CodecID and
  dimensions. Display codec information in Media Information and name the
  detected codec when Chromium reports unsupported video.
- **No false universal playback:** the WebCodecs API does not provide automatic
  video remuxing or guaranteed HEVC, MPEG-2, AC3, E-AC3, DTS decoding.
  Video remuxer/decoder integration and compliant codec licensing are still
  needed for those files. Native Chromium playback remains preferred.
- GitHub-only build runs decoder configuration and invalid-header regressions;
  generates actual encoded MP3, FLAC, and Vorbis test MKVs, and attempts to
  decode packets in the bundled Chromium. It also runs existing queue,
  fullscreen, metadata artwork, subtitles and folder regressions.
- The desktop and GitHub Pages continue to run the **same HTML/JS source**.
  One branch `main`, no persistent build workflow after successful validation.

## Implemented in web source
- Single-screen layout with DK Kinehall / ДК Кинехолл branding and English/Russian language selector, without Player/Library/Help navigation.
- Original golden emblem, Open files, Restore last file and drag-and-drop, with a local-file-only welcome sentence.
- Up Next playlist, watched items retained, red current-item border, red X removal and automatic next item.
- Browser-native video/audio playback, stop/reset, seeking, 10-second rewind/forward, volume, speed, fullscreen and picture-in-picture.
- Local-file resume through permissions-based file handles when possible, or user-driven file re-selection.
- External SRT/VTT loading, MKV subtitle track metadata inspection and local MKV text subtitle extraction (UTF-8/SubRip, ASCII, ASS/SSA) into browser WebVTT tracks. Users can select/off/switch tracks in the right-click menu. ASS styling is simplified to text.
- Local MKV PGS and basic VobSub bitmap subtitles (S_HDMV/PGS, S_VOBSUB): packet reading, palette/RLE decoding, timestamps, canvas overlay and off/switch controls; supported fixture rendering validated in Chromium. Some subtitle commands remain unsupported.
- MKV audio descriptor scanning and native track selection, plus experimental local WebCodecs audio selection for supported AAC, Opus, MP3, FLAC, and Vorbis; unsupported tracks remain informational.
- Corrected playlist media-file retention so on-demand MKV subtitle extraction receives the actual local `File` object rather than an undefined value.
- Hover seek frames, muted video previews, automatic keyless movie posters, TVmaze episode stills and series fallbacks, bounded local thumbnails, artwork URL caching and retry.
- Cyrillic-only Russian interface.
- Outward-facing Kinehall name in both languages, browser tabs, GitHub Pages, home-screen manifests and desktop launchers; original icon and legacy internal file/state identifiers are unchanged.

## November 17, 2026: queue and transport sizing (source changes)
- Up Next keeps the existing sidebar width and image width. Queue rows and thumbnail height are approximately doubled so artwork has visual weight comparable to video recommendation lists. Maintain video aspect handling, scrollability, selected-item red border and remove buttons.
- Previous and Next icons are enlarged, and all six transport buttons have matching square hit areas. Play/Pause retains the red background but not its former oversized dimensions.
- CSS source updated; no Chromium browser run or automated tests performed for this visual adjustment. Do not mark runtime validation complete.

## November 17, 2026: WebCodecs MKV audio fallback (source-only)
- Add on-device Matroska AAC/Opus audio demuxing through File slices and Chromium WebCodecs + WebAudio. The menu offers real audio decoding attempts for supported codecs and a return to native audio. Add initial clock-aligned playback, pause, seek, rate-change, volume and cleanup integration.
- **Not compiled or run:** complete audio synchronization, WebCodecs profiles, laced packets, pause/seek behavior and long-file performance require Surface Pro Chromium testing. Other codecs remain out of scope for this increment.

## Remaining work: universal format compatibility
- Research and implement an optional client-side decoder/demuxer fallback for media that the host browser cannot play, potentially using a licensed WebAssembly-based codec engine.
- Preserve Chromium's native playback for supported files, and make decoding limitations and resource costs clear.
- Next: validate and harden the new WebCodecs AAC/Opus fallback on the Surface Pro, including synchronization, seeking, lacing, codec profiles and performance; then extend decoder coverage. Metadata-only listings do not count as switching.
- Continue improving nonstandard VobSub/PGS subtitle commands and verify with full user media. Avoid presenting metadata-only track listing as playback capability.
- Then add more codec/container compatibility, retaining Chromium-native playback whenever supported.
- Complete quality and accessibility improvements while preserving the approved layout. Keep the approved icon, visuals and existing file/queue workflows; avoid compatibility-only development for other browser engines.
- Matroska, PGS and audio-track source-only fixtures are in `docs/tests/mkv-subtitles.cjs`, `docs/tests/mkv-tracks.cjs`, `docs/tests/pgs-subtitles.cjs` and `docs/tests/audio-tracks.cjs`. They have **not** been run. No compilation or test runs until the project owner requests them.

## Rights and history
- Retain TVmaze attribution and notices for all vendored third-party code.
- The DK Softworks Original Work License v1.0 applies to original DK Softworks-owned material only.
- Original Python/Tkinter/libVLC desktop sources and their historical yt-dlp/P2P features are archived, not active web development.
