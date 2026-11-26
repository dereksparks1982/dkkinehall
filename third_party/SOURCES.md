# Pinned upstream source integrations

These four upstream **source** projects are included as pinned Git submodules on the single DK Kinehall `main` branch. They are not downloaded on end-user startup, and submodule source is not an automatically packaged native library. No separate media server is involved.

| Source | Commit | Role | License treatment |
| --- | --- | --- | --- |
| [mpv-prebuilt](https://github.com/jason-yau/mpv-prebuilt) | `2da537b8e25b875bed911cb9058785d9a77f13e9` | Maintainer-side build of LGPL libmpv+FFmpeg SDK for native decoding | MIT build scripts; bundled *LGPL* flavor libraries have separate licenses and required notices |
| [mpv-examples](https://github.com/mpv-player/mpv-examples) | `e0d1a84c99e8c469b58fde31a1541401acfb0eb2` | Reference for video render API and GUI embedding | Verify specific example files before copying |
| [mediainfo.js](https://github.com/buzz/mediainfo.js) | `3efad558d3ea34b6f1a99d0dd061ea16956f47a1` | Candidate for optional local-container/codec inspection in web and standalone | BSD-2-Clause, include attribution/license when actually bundled |
| [JavascriptSubtitlesOctopus](https://github.com/libass/JavascriptSubtitlesOctopus) | `fccf9c1fa51127ea3802a3c7d24e40a33f6c19f1` | Candidate for bundled ASS/SSA subtitle rendering using WASM and libass | MIT wrapper, libass and dependencies require their own notices |

**Not vendored or linked into DK Kinehall:** [Jellyfin Desktop](https://github.com/jellyfin/jellyfin-desktop) (GPL-2.0 server-focused client), [Jellyfin FFmpeg](https://github.com/jellyfin/jellyfin-ffmpeg) (distribution-specific fork and mixed licenses), and [electron-mpv-video](https://github.com/yscoder/electron-mpv-video) (MIT, but Linux is unsupported as of this assessment). They are architectural references until an implementation fits the approved Linux Chromium player and license constraints.

## Integration boundaries

1. The **approved DK Kinehall UI, poster backdrop, executable, window identity and icons must remain unchanged**. No Jellyfin server and no Electron player replacement.
2. The native prototype's CMake build accepts `DK_LIBMPV_SDK_DIR` pointing to an appropriately licensed SDK from the mpv-prebuilt source. This does not imply the original Electron runtime is already using libmpv.
3. The web edition can use MediaInfo/SubtitleOctopus only if their matching JavaScript, WASM, workers and required notices have been **bundled locally**, not fetched from a CDN or installed by an end user.
4. The original standalone runtime currently has a source-level FFmpeg streaming bridge. Installing actual bundled codec libraries, playback verification and licensing remain release blockers.
5. Don't import Jellyfin's GPL desktop code into DK Softworks' noncommercial-redistribution source. Its design can be studied, not silently relicensed.
6. Submodules are source references, not additional Git branches in this repository. Their pinned commits make upstream code auditable.

## Local library vs media server

The Library Home uses origin-local IndexedDB (folders, titles, playback progress and cached images) and the user's previously approved file-system directory handles. The video files themselves remain in their local folders. Manual Scan Library and a bounded per-launch scan update this database. Nothing starts a continuous media server, DLNA service, downloader or background daemon.

## Packaging acceptance

Only the codec and subtitle components actually included in a tested standalone package may be described as **bundled**. Merely pinning upstream sources or parsing metadata is insufficient.
