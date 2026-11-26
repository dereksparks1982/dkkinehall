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

## Required implementation before claiming broad bundled codec coverage

1. Select and embed a complete native decoding back end (FFmpeg/libavcodec or libmpv-backed) **under the existing UI**, retaining the same playlist, controls, fullscreen, artwork, subtitles, icons, and window.
2. Bundle the correct Linux shared libraries and codec configurations in the release archive; do not silently use system-installed decoders or expect the user to install packages.
3. Connect the actual decoded video and audio pipeline to the existing controls, including seeking, chapters, queue transitions, selected embedded subtitles and audio tracks, volume and fullscreen.
4. Account for container/demux, video decode and audio decode separately. MKV, MP4, MPEG-TS, MOV, AVI and WebM containers do not guarantee specific codecs; the bundled back end must report its supported combinations.
5. Verify representative H.264, HEVC/H.265, VP9, AV1, MPEG-2, AAC, AC-3/E-AC-3, DTS, FLAC, MP3, Opus, Vorbis, PGS and VobSub samples before claiming a supported format.
6. Preserve the original approved launcher and icon identity. Update third-party notices and comply with the actual LGPL/GPL, patent and redistribution requirements of every shipped library.
7. Only after such a package is built and playback-verified should the README say that broad native codec coverage is **included**. Until then, document the limitation accurately and never claim that a successful subtitle lookup proves that video will play.

No compilation or playback validation was performed while writing this plan.
