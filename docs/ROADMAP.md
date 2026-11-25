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

## Implemented in web source
- Single-screen layout with DK Kinehall / ДК Кинехолл branding and English/Russian language selector, without Player/Library/Help navigation.
- Original golden emblem, Open files, Restore last file and drag-and-drop, with a local-file-only welcome sentence.
- Up Next playlist, watched items retained, red current-item border, red X removal and automatic next item.
- Browser-native video/audio playback, stop/reset, seeking, 10-second rewind/forward, volume, speed, fullscreen and picture-in-picture.
- Local-file resume through permissions-based file handles when possible, or user-driven file re-selection.
- External SRT/VTT loading, MKV subtitle track metadata inspection and local MKV text subtitle extraction (UTF-8/SubRip, ASCII, ASS/SSA) into browser WebVTT tracks. Users can select/off/switch tracks in the right-click menu. ASS styling is simplified to text.
- Initial source support for local MKV PGS bitmap subtitles (S_HDMV/PGS): Matroska packet reading, palette and RLE decoding, multiple composition objects, timestamps, clear frames, canvas overlay, responsive geometry and off/switch controls. Source-only fixtures added; not validated in a browser. VobSub and unhandled encodings remain unavailable.
- MKV audio descriptor scanning (track number, language, codec, name, channel count, sample rate and bit depth); distinguish informational MKV tracks from browser-switchable tracks in the video context menu. Select and remember real native audio tracks per local file when Chromium exposes a working track API. No claim of complete MKV demuxer audio switching or extra codecs.
- Corrected playlist media-file retention so on-demand MKV subtitle extraction receives the actual local `File` object rather than an undefined value.
- Hover seek frames, muted video previews, TVmaze episode artwork and image fallback/retries, no user token required.
- Cyrillic-only Russian interface.
- Outward-facing Kinehall name in both languages, browser tabs, GitHub Pages, home-screen manifests and desktop launchers; original icon and legacy internal file/state identifiers are unchanged.

## November 17, 2026: queue and transport sizing (source changes)
- Up Next keeps the existing sidebar width and image width. Queue rows and thumbnail height are approximately doubled so artwork has visual weight comparable to video recommendation lists. Maintain video aspect handling, scrollability, selected-item red border and remove buttons.
- Previous and Next icons are enlarged, and all six transport buttons have matching square hit areas. Play/Pause retains the red background but not its former oversized dimensions.
- CSS source updated; no Chromium browser run or automated tests performed for this visual adjustment. Do not mark runtime validation complete.

## November 17, 2026: WebCodecs MKV audio fallback (source-only)
- Add on-device Matroska AAC/Opus audio demuxing through File slices and Chromium WebCodecs + WebAudio. The menu offers real audio decoding attempts for supported codecs and a return to native audio. Add initial clock-aligned playback, pause, seek, rate-change, volume and cleanup integration.
- **Not compiled or run:** complete audio synchronization, WebCodecs profiles, laced packets, pause/seek behavior and long-file performance require Surface Pro Chromium testing. Other codecs remain out of scope for this increment.

## Next major feature: format compatibility
- Research and implement an optional client-side decoder/demuxer fallback for media that the host browser cannot play, potentially using a licensed WebAssembly-based codec engine.
- Preserve Chromium's native playback for supported files, and make decoding limitations and resource costs clear.
- Next: validate and harden the new WebCodecs AAC/Opus fallback on the Surface Pro, including synchronization, seeking, lacing, codec profiles and performance; then extend decoder coverage. Metadata-only listings do not count as switching.
- Investigate VobSub/remaining bitmap subtitle formats. Avoid presenting metadata-only track listing as playback capability.
- Then add more codec/container compatibility, retaining Chromium-native playback whenever supported.
- Complete quality and accessibility improvements while preserving the approved layout. Keep the approved icon, visuals and existing file/queue workflows; avoid compatibility-only development for other browser engines.
- Matroska, PGS and audio-track source-only fixtures are in `docs/tests/mkv-subtitles.cjs`, `docs/tests/mkv-tracks.cjs`, `docs/tests/pgs-subtitles.cjs` and `docs/tests/audio-tracks.cjs`. They have **not** been run. No compilation or test runs until the project owner requests them.

## Rights and history
- Retain TVmaze attribution and notices for all vendored third-party code.
- The DK Softworks Original Work License v1.0 applies to original DK Softworks-owned material only.
- Original Python/Tkinter/libVLC desktop sources and their historical yt-dlp/P2P features are archived, not active web development.
