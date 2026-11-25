# DK Kinehall

**DK Kinehall (ДК Кинехолл)** is a free, **standalone native Linux media player** by DK Softworks.

## Current development direction

**The former web player is retired. No Chromium, Electron, browser shell,
HTML/CSS player, media server, or browser-based playback engine.**

The replacement uses **Qt 6 Widgets** for the native application interface,
**libmpv** for local playback and embedded codec/subtitle handling.
Optional FFmpeg-based live transcoding is a later feature, not part of
the present native code. The user's original files are not modified or uploaded.

The native player source is in `native/`. It preserves the DK Kinehall
dark/red appearance and intended capabilities: local Open files, Up Next,
fullscreen, ten-second skips, volume up to 100%, playback resume, built-in
audio/subtitle selection, external subtitles, matching local artwork, English
and Russian interface, and configurable removal of completed queue items.

**Release status:** the native source is being developed, but a verified
portable native Linux executable has **not yet been produced in this session**.
The former Electron/Chromium executable, its browser runtime and the
web-player entrypoint have been removed from `main`. A native executable
must still be built and packaged from
`native/` before users can run this replacement. Do not treat a source commit
as a verified binary release.

## Embedded MKV subtitles (native player)

**Subtitles** on the playback bar and **right-click → Subtitles** select
subtitle streams reported by libmpv from the currently opened MKV. All
embedded tracks are listed after the file loads, including supported SRT,
ASS/SSA, PGS and VobSub types. **Off** is the default for a new video.
Selecting an embedded track immediately sets libmpv's `sid` property and
does not ask for an external subtitle file.

**Add external subtitle file...** is a separate, explicitly named action
for the occasions when an MKV does not contain the desired subtitle. It
must never be triggered by clicking the ordinary Subtitles button.

This implementation belongs to the same DK Kinehall native source tree. The
former browser player's `+ Subtitles` file picker is not part of the native
subtitle workflow. Functional playback requires a compiled native executable;
the former legacy Chromium executable was removed rather than relabeled as
native.

## Playback and future conversion

- Native **libmpv** handles local MKV, MP4, AVI, WebM and supported audio
  formats directly, without asking for a separate video conversion.
- Automatic hardware-assisted decoding is requested when supported and can
  be disabled in the native settings menu.
- Real FFmpeg live conversion into MP4/WebM is **not yet implemented** in
  the native player. No conversion option is shown as working until its
  dependencies, output stream and seeking behavior have been verified.
- Current work concentrates on embedded MKV subtitle selection, queue,
  playback controls, local artwork and fullscreen.

## Developer build (not for end users)

See [native/README.md](native/README.md) and [native/CMakeLists.txt](native/CMakeLists.txt).
Qt 6, libmpv, a C++17 compiler and CMake are **maintainer build
dependencies**. FFmpeg conversion is a future optional integration. A portable release must bundle its required runtime libraries
and codecs so end users do not need to install them.

## Project rules

- One GitHub branch: `main`. Do not create additional branches.
- No GitHub Actions build workflow unless explicitly approved.
- No executable/download delivery unless requested.
- No commercial sale or repackaging of DK Softworks original code under the
  project's applicable license. Third-party Qt, mpv and FFmpeg components
  retain their own licenses and distribution requirements.
- No Chromium, Electron or browser-engine regressions.
