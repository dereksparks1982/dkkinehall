# DK Kinehall

**DK Kinehall (ДК Кинехолл)** is a free media player from **DK Softworks** for watching movies, television episodes, and listening to music from your own device.

## Choose your edition

### Web App

**[Open DK Kinehall Web App](https://dereksparks1982.github.io/dkkinehall/)**

Play local media directly in your web browser, with the familiar DK Kinehall interface, Up Next queue, artwork, and playback controls. Browser security and codec restrictions can limit file access, MKV playback, embedded subtitles, and other advanced features.

### Standalone Linux

DK Kinehall also has a standalone Linux edition that uses the **same web player interface** in its own bundled Chromium window. It does not require you to install a separate browser. Keep the included `_internal` runtime alongside the **DK Kinehall** executable. Media and subtitle support still depends on the codecs available to that bundled player.

The updater preserves the existing **approved DK cinema emblem, launcher and dock icon** without changing or re-registering them. After a successful update, it opens the **installed standalone Chromium player**, not the hosted Web App. The original Chromium player is preserved.

The two editions are separate. The Web App remains available regardless of changes to the standalone version.

## Features

- **Local playback:** Open video and music stored on your device. Explicitly selected uncommon formats are passed to the playback engine for probing rather than rejected solely by extension. Folder scanning also recognizes many older container extensions, although recognition alone does not prove the file is decodable.
- **Up Next:** Reorder queued videos with mouse/touch drag handles or keyboard arrows without interrupting the playing video.
- **Shuffle / repeat:** Shuffle upcoming videos. Repeat Off, One or All; remember these preferences. Repeat modes keep played entries available.
- **Chapters:** A visible **Chapters** button selects real MKV or supported native-text-track chapter markers. Right-click is optional.
- **Resizable/movable video:** Resize the existing player with the corner handle; press **Float** to move and resize the video within the app window, then **Dock** to return.
- **Picture-in-Picture:** A visible PiP button opens Chromium's native movable, resizable video window where supported.
- **Codec roadmap:** **Release requirement:** The standalone player must automatically bundle its own playback engine, codecs, and demuxers for broad video/audio and legacy format support, including MKV, MP4, AVI, MOV, TS, WebM and their common codec combinations. The user must not be required to install codecs, switch players, or manually convert files. **Not yet met:** the current Chromium build has selective decoding and remuxing; this update does not add a universal decoder. See `docs/CODEC_PACKAGING.md` for the required standalone backend work and acceptance checks. TV episodes show the **series name** on the first line and the **complete SxxExx number plus actual episode title** together on the second wrapping line. Metadata provides verified titles, with a filename title fallback when available. No raw release filenames or redundant “Local file” labels appear in the sidebar. Artwork and playback still use the original filenames; existing icons and artwork dimensions are unchanged.
- **Playback controls:** Play, pause, stop, seek, previous, next, and 10-second rewind or fast-forward.
- **Fullscreen:** Watch videos in fullscreen using the player controls.
- **Playback settings:** The preferences panel stays above the video and Up Next queue while open.
- **Playback settings:** Change playback format and preferences from a header menu that stays above the video and Up Next panel.
- **Subtitles and audio:** The **On/Off** button beside **+ Subtitles** shows whether embedded MKV subtitles are currently enabled. Click it to toggle playback, or use **+ Subtitles** to choose a different track or load external SRT/VTT subtitles. **Subtitle delay** controls shift captions earlier (−) or later (+) in 0.25-second steps, with Reset to restore the original timing; the adjustment is remembered separately for each file and works with loaded text, PGS, and VobSub tracks. Both editions use the approved **0–100% volume** range; no audio amplification above 100%.
- **Playback resume:** Return to where you stopped in a movie when the edition can restore access to that file.
- **Artwork:** Display movie posters, episode stills, and local cover images when available, with automatic recovery when an online artwork source fails. The native Qt/libmpv source now also includes TVmaze show lookup, season/episode title resolution, and still caching; that prototype is not the approved standalone release.
- **Languages:** English and Russian interface options.
- **Background artwork:** The complete Soviet-themed picture is fitted to the window without cutting off its edges.

## Native codec integration under development

The existing Chromium-based player has source code for a guarded desktop decoding adapter. When an FFmpeg/FFprobe payload is actually bundled and its Electron bridge works, an unsupported local file can be transcoded inside the application into MP4 (H.264/AAC) or WebM (VP9/Opus, where available) and played through the **same video surface and controls**. The adapter now reports playback success only after the video actually begins playing, not merely after FFmpeg returns a stream URL. The current installed standalone has **not** been verified with this backend. No user codec installations, other media players or manual conversion should be necessary in the finished release.

## Additional decoding source progress

The bundled-codec adapter now also has source-level selection of alternate audio streams and actual chapter markers discovered by FFprobe, including for source formats beyond Matroska. Repeat One explicitly restarts a transcoded file at the beginning. Both still require real standalone runtime verification and do not make the release complete.

## Final acceptance gate

The complete checklist is in [docs/ROADMAP.md](docs/ROADMAP.md). The native prototype packaging now includes FFmpeg/FFprobe and generates decoder/container inventories, but that native backend is not yet underneath the approved Chromium interface. Neither a code commit nor a successful subtitle lookup establishes universal media decoding. The standalone codec/backend integration and package verification remain unfinished. The maintainer-only codec asset builder produces an audited tarball and SHA-256 digest for GitHub Releases without activating the updater. The updater is blocked by `maintenance/release-gate.json` until all acceptance checks are verified. Once approved, its native codec payload must be retrieved automatically from a DK Kinehall release asset and verified against a pinned SHA-256 checksum before any installed files are touched. No end-user update instructions should be given until all requested functionality is accepted.

## Getting started

Choose the **Web App** link above to play media in a browser, or use the standalone Linux edition for native playback. Open a local movie or music file, then use **Up Next** to queue more. You can also drop files directly onto the player: they play automatically when nothing is loaded, or join **Up Next** without interrupting the loaded movie.

## License

DK Softworks' original code may not be sold or commercially repackaged. Third-party components retain their own licenses.
