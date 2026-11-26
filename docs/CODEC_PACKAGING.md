# DK Kinehall standalone codec packaging

## Goal

The installed standalone Linux edition should ship its required video, audio, container and subtitle decoding components inside its own application, without asking users to install a browser, codec pack or separate media player. The hosted web edition retains the decoding restrictions of the Chromium browser being used.

## Non-negotiable product requirement

- Ship the standalone app with codecs, demuxers, and its decoding backend included by default, for all formats supported by the bundled engine. Do not instruct the user to install, buy or configure codecs, use a different player, or convert files manually.
- Include broad **video and audio** coverage, not only the ability to inspect containers or show subtitles. Unknown formats should be diagnosed accurately, not falsely reported as playable.
- A literal guarantee of every codec ever devised is not technically possible for encrypted/DRM formats, malformed files, unavailable proprietary decoders, or unknown future standards. Record those exceptions precisely rather than claiming absolute coverage.
- Treat this as an unmet release requirement until an integrated, packaged backend is verified with actual video and audio samples.

## Current source state

- The installed standalone edition currently uses the original embedded Chromium/Electron playback surface and the same `docs/` UI as GitHub Pages.
- A copy of Chromium does **not** inherently imply that every video or audio codec is bundled. The present web source has selective MKV inspection, subtitle extraction and compatible MKV-to-MP4/WebM remuxing, not a universal decode pipeline.
- An independent Qt/libmpv prototype also exists in `native/`. It is not interchangeable with the user's approved Chromium-based UI and should not be substituted as the installed standalone player.
- Media info and subtitle success notices must not imply that decoding has succeeded merely because subtitle data or metadata could be read. The routine subtitle-success message should not repeat a browser-codec disclaimer; actual unsupported-media errors remain actionable.

## Source-level codec and format progress

The native Qt/libmpv prototype can probe uncommon explicitly selected formats and its packaging verifies presence of FFmpeg's avcodec, avformat, avutil, swresample and swscale libraries without a hardcoded SONAME. This does not put native decoding behind the approved Chromium interface, does not prove playback of a specific file, and does not yet satisfy the requested all-in-one standalone release.

## Metadata/backend separation

The Qt/libmpv prototype's TVmaze lookup code is a separate, optional metadata path and is not itself a codec, decoder or guarantee of playback. Media bytes stay local. The eventual approved standalone decoder must run inside the existing interface; it cannot be replaced by an alternative player window.

## Actual native bundle inventory

Native packaging source now copies build-provided `ffmpeg` and `ffprobe` executables into the portable bundle, recursively bundles their linked libraries, and records `CODECS_INCLUDED.txt`, `CONTAINERS_INCLUDED.txt` and `FFMPEG_CONFIGURATION.txt`. The user is not asked to install them. The inventory identifies the capabilities of a particular build, but still needs playback verification and integration underneath the approved Chromium-based interface.

## Native decoding under the approved Chromium interface

The `desktop/` modules retain the existing Electron window, icons and web-based controls. The preload uses Electron's supported `webUtils.getPathForFile` on user-selected local files, and exposes only narrowly scoped codec IPC operations. The main process probes via **bundled FFprobe**, then runs **bundled FFmpeg** to stream compatible fragmented MP4 (H.264/AAC) or WebM (VP9/Opus, where encoders exist) over a random-token loopback HTTP endpoint to the same HTML video element. The `docs/codec-playback.js` adapter maintains source time for seeking, resume and chapter navigation; no source file is sent to a remote server.

The `maintenance/codec_bundle.py` injector, `maintenance/prepare_desktop_codecs.py` packager and runtime synchronization source are configured to refuse incomplete codec bundles and preserve the approved icon/window code. Decoder and container inventories must be generated from the *actually included* FFmpeg tools.

The decoder bridge source now includes user selection of an FFprobe-discovered audio stream and an explicit transcoded Repeat One restart. Real-world playback, synchronization, audio/subtitle combinations and correct seek behavior are still unverified.

**Unverified release blockers:** preloaded Electron bridge detection, selected-file path handling, seek/resume correctness, runtime performance, all supported decoder/encoder combinations, alternate audio and subtitle handling, legal redistribution and an end-to-end Linux package/playback check. This source is not an installed universal decoder, and must not be described or distributed as finished.

## Required implementation before claiming broad bundled codec coverage

1. Select and embed a complete native decoding back end (FFmpeg/libavcodec or libmpv-backed) **under the existing UI**, retaining the same playlist, controls, fullscreen, artwork, subtitles, icons, and window.
2. Bundle the correct Linux shared libraries and codec configurations in the release archive; do not silently use system-installed decoders or expect the user to install packages.
3. Connect the actual decoded video and audio pipeline to the existing controls, including seeking, chapters, queue transitions, selected embedded subtitles and audio tracks, volume and fullscreen.
4. Account for container/demux, video decode and audio decode separately. MKV, MP4, MPEG-TS, MOV, AVI and WebM containers do not guarantee specific codecs; the bundled back end must report its supported combinations.
5. Verify representative H.264, HEVC/H.265, VP9, AV1, MPEG-2, AAC, AC-3/E-AC-3, DTS, FLAC, MP3, Opus, Vorbis, PGS and VobSub samples before claiming a supported format.
6. Preserve the original approved launcher and icon identity. Update third-party notices and comply with the actual LGPL/GPL, patent and redistribution requirements of every shipped library.
7. Only after such a package is built and playback-verified should the README say that broad native codec coverage is **included**. Until then, document the limitation accurately and never claim that a successful subtitle lookup proves that video will play.

No compilation or playback validation was performed while writing this plan.
