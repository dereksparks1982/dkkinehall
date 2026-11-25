# DK Kinehall native Linux application

This is the DK Kinehall standalone source, within the **existing**
`dereksparks1982/dkkinehall` repository. It is not a second player, a
browser wrapper, or a web interface.

## Architecture

- **Qt 6 Widgets**: native application window and controls.
- **libmpv**: local playback and built-in MKV video/audio/subtitle decoding.
- No Chromium, Electron, web view, media server or file upload.
- C++17 and CMake are used to build the native application.
- FFmpeg or libavcodec support used by libmpv is subject to the selected
  libmpv distribution; arbitrary format conversion is not yet implemented
  in the native application.

## Embedded MKV subtitle fix

The normal **Subtitles ▾** button opens an in-app menu, never a file picker.

1. Open a local MKV through **Open files**.
2. After libmpv's `MPV_EVENT_FILE_LOADED` event, the player reads
   `track-list` and lists its **embedded** subtitle streams.
3. Selecting one sets the native `sid` property. **Off** sets `sid=no`.
   Subtitles default off when a new movie opens.
4. Right-clicking the picture reveals the same menu plus audio tracks.
5. **Add external subtitle file…** is a separate action and the *only*
   action that opens a subtitle picker.

libmpv supports Matroska subtitle formats including text subtitles, ASS,
PGS and DVD VobSub, where its underlying codec build supports decoding
the specific stream. No extractor or subtitle file is required for a
properly recognized embedded track.

## Controls

- Open files: play the first selected file immediately.
- Add files: append to Up Next without interrupting playback.
- Choose folder: add local media in the selected folder to Up Next.
- Play/pause, Stop, Previous, Next, Rewind 10 seconds, Forward 10 seconds.
- Time seek, 0–100% volume, playback speed, native fullscreen.
- Double-click the video for fullscreen; mouse cursor hides after 3 seconds.
- Right-click video for native subtitle and audio menus.
- Watched files leave Up Next automatically by default; preference is saved.
- Resume time and selected folder are stored locally with QSettings.
- English and Russian window text.
- Local same-folder poster/cover artwork, where present.

## Maintainer build requirements

Qt 6.4+ with Widgets, OpenGL and OpenGLWidgets modules, libmpv development
headers and pkg-config, CMake 3.21+, a C++17 compiler.

To compile on a build workstation (maintainers only):

```sh
cmake -S native -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --parallel 2
```

A release must package the resulting **DK Kinehall** native executable with
its required shared libraries and applicable notices, so users are not
required to install codecs separately. **A native Linux x86-64 release candidate has been compiled and packaged**
on November 25, 2026. See
[the successful build](https://github.com/dereksparks1982/dkkinehall/actions/runs/45644468833).
Its bundled binary passed a virtual X11 startup check, but real user movie
and embedded-MKV-subtitle playback still require verification before final
acceptance.

## Licensing

DK Softworks' original code retains the project's restrictions on
commercial sale and repackaging. Third-party Qt, libmpv, FFmpeg, codec
libraries and other dependencies retain their own licenses, including
applicable LGPL/GPL terms and relinking/source obligations.
