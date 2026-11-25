# DK Kinehall native roadmap

**Current product: DK Kinehall standalone Linux media player.** The previous
browser/Electron application is retired; it is not the development or release
target. The old root binary, Chromium runtime archive, Electron host files,
and GitHub Pages player entrypoint have been deleted from `main`.

## Native build: in progress

- **Single application:** `native/src/main.cpp`, `MainWindow.cpp` and
  `MpvWidget.cpp` implement the DK Kinehall Qt Widgets window.
- **Playback:** libmpv renders picture/audio with local media support,
  dedicated equal-size transport buttons, ten-second skips, volume capped at
  100%, seek bar, native fullscreen and restart/resume.
- **MKV subtitles:** the standard Subtitles button and right-click menu
  enumerate *embedded* MKV subtitle tracks using libmpv's `track-list`.
  Choosing a track sets `sid`. The Off action sets `sid=no`, by default.
  External subtitle selection is a distinct, explicitly labeled action.
- **Audio:** the same native track list supplies the audio menu.
- **Up Next:** playing Open files selections immediately, queue-only Add,
  choosing a media directory, auto-advancing, optional watched-item cleanup,
  red selected marker, local folder poster previews.
- **English/Russian:** selectable interface with locally remembered setting.
- **No browser:** no Chromium, Electron, WebView, server, downloads, or
  browser codec restrictions in the new source.

## Required before a user-ready native release

1. Compile the Qt 6/libmpv source on an appropriate Linux build machine.
2. Check that opening real MKVs, PGS/VobSub/text track switching, Off default,
   seek/resume, fullscreen, poster fallback, queue and both languages work.
3. Fix actual build and runtime faults that those checks reveal.
4. Bundle all required native libraries/codecs, desktop metadata and icon
   into a native release without telling end users to install a codec pack.
5. Add genuine optional streaming remux/FFmpeg conversion later, without
   changing DK Kinehall's interface or introducing a browser engine.
6. Update licensing and third-party notices for shipped dependencies.
7. Publish a verified executable only on explicit request.

**State:** source committed on `main`; **no compiled native executable
has been verified or delivered**. The former executable was removed
because it required Chromium.

There must remain exactly one GitHub branch: `main`. No persistent or
heavy GitHub Actions. No commercial sale or repackaging of DK Softworks'
original code.
