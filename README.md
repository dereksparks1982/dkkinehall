# DK Kinehall

**DK Kinehall (ДК Кинехолл)** is a free, **standalone native Linux media player** by DK Softworks.

## Current development direction

**The former web player is retired. No Chromium, Electron, browser shell,
HTML/CSS player, media server, or browser-based playback engine.**

The replacement uses **Qt 6 Widgets** for the native application interface,
**libmpv** for local playback and codec handling, and a locally bundled
**FFmpeg** executable for optional live remux/transcoding into an MP4 or WebM
stream. The user's original media files are never modified or uploaded.

The native player source is in `native/`. It preserves the DK Kinehall
red/gold appearance and intended capabilities: local Open files, Up Next,
fullscreen, ten-second skips, volume up to 100%, playback resume, built-in
audio/subtitle selection, external subtitles, matching local artwork, English
and Russian interface, and configurable removal of completed queue items.

**Release status:** the native source is being developed, but a verified
portable native Linux executable has **not yet been produced in this session**.
The former Electron/Chromium executable and its bundled browser runtime are
being removed. A native executable must be built and packaged from
`native/` before users can run this replacement. Do not treat a source commit
as a verified binary release.

## Playback format settings

- **Automatic** (default): libmpv plays the supported local file directly.
- **Original:** direct playback without requesting container conversion.
- **MP4:** when bundled FFmpeg is available, transcode a selected file into
  a fragmented MP4 stream for playback. Playback can begin while FFmpeg runs.
- **WebM:** similar local streamed conversion using VP9/Opus.
- **Hardware acceleration:** enabled by default for libmpv automatic hardware
  decoding where available. FFmpeg may fall back to software encoding;
  the preference is not a guarantee of GPU encoding.
- **Remember preference:** enabled by default.

Forced conversion has practical limits, notably seeking within a live
nonseekable stream and codec availability in the bundled FFmpeg build. Original
playback is preferable where possible. Any FFmpeg distribution must retain
the applicable third-party license notices.

## Developer build (not for end users)

See [native/README.md](native/README.md) and [native/CMakeLists.txt](native/CMakeLists.txt).
Qt 6, libmpv, a C++17 compiler, CMake and FFmpeg are **maintainer build
dependencies**. A portable release must bundle its required runtime libraries
and codecs so end users do not need to install them.

## Project rules

- One GitHub branch: `main`. Do not create additional branches.
- No GitHub Actions build workflow unless explicitly approved.
- No executable/download delivery unless requested.
- No commercial sale or repackaging of DK Softworks original code under the
  project's applicable license. Third-party Qt, mpv and FFmpeg components
  retain their own licenses and distribution requirements.
- No Chromium, Electron or browser-engine regressions.
