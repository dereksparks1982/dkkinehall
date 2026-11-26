# DK Kinehall

![DK Kinehall standalone media player screenshot](assets/images/Screenshot%20From%202026-11-26%2005-06-07.png)

**Your movies. Your music. Your player.**

DK Kinehall (ДК Кинехолл) is a free media player made by **DK Softworks**. Watch movies and TV shows or listen to music saved on your own device.

## What can it do?

- Watch movies and TV shows, and play music.
- Organize your movies and shows with posters and titles, and find their files on disk.
- Continue watching where you left off, or remove a title from Continue Watching.
- Make a playlist and choose what plays next.
- Make dark movies brighter and adjust the picture and sound. Scroll over the video to change volume; scroll inside menus to browse their options.
- Turn subtitles on or off, or load your own.
- Watch fullscreen or resize the player to suit you. The standalone Picture Settings menu combines picture adjustments, zoom, cropping and display modes. The standalone video controls and cursor are designed to hide after three seconds of inactivity, even while paused.
- Use the whole app in English or Russian, with one shared language setting.

## How do I use it?

1. Open DK Kinehall.
2. Choose a video or music file, or select a movie from your library.
3. Press Play. Add more files to Up Next if you want to keep watching.

**[Try the Web App](https://dereksparks1982.github.io/dkkinehall/)**

A standalone Linux edition is also in development. It offers additional features without needing a separate browser.

## What's next?

We're working on better file-format support, DVD and network playback, offline subtitle translation, and DK Voiceover so you can hear foreign-language movies in your own language. We're also developing automatic subtitles made from the movie's own audio, including automatic English/Russian/Arabic spoken-language detection, with local reuse of generated voiceover soundtracks to avoid repeated processing. Voiceover settings can display and clear the saved audio cache without deleting movies or playback history. Optional progressive synthesis exposes completed 30-second audio segments during generation, with original-audio fallback for unfinished sections. These features require separately installed models and are not yet verified. A maintainer-only speech-runtime staging tool now checks the engine and model files before placing them in the local runtime directory; it does not download or install anything automatically. A pinned CPU-only engine build recipe and explicit local setup tool are also available for maintainer use; no runtime payload has been built or released. English, Russian and Arabic have source-level speech recognition and translation routes; optional male/female voice profiles and experimental speaker-aware assignments require compatible local models.

**Current standalone development version: v0.9.3.** Some advanced features still need testing or additional offline language models. This is not a finished release.

## More information

- [Development roadmap](docs/ROADMAP.md)
- [Linux installation information](docs/PORTABLE_LINUX.md)
- [Technical development history](docs/DEVELOPMENT_HISTORY.md)
- [Third-party credits](THIRD_PARTY_NOTICES.md)
- [Contact DK Softworks](CONTACT.md)

## Free to use

DK Kinehall is free for personal and business use. DK Softworks' original software may not be sold or repackaged for distribution without permission. See the [license](LICENSE) for the full terms.


Standalone metadata repair: existing incorrect 1974 Golden Gun movie records are corrected in place on library opening, preserving watch history and local artwork, with a verified IMDb identity for poster lookup. No rescan or filename change is required for this repair.

Standalone Continue Watching uses the same portrait card dimensions and spacing as the collection, keeps the original poster uncropped, and retains its playback progress indicator.

Standalone library: hold Ctrl and scroll the mouse wheel to scale all library content (50–200% in 10% steps); Ctrl + middle-click resets to 100%. The preference is local to the library and retained across restarts. Native discovery has no fixed time, video-count, entry-count or directory-depth quota. Stop Scan saves discovered records without marking unseen videos unavailable; the expandable scan issues report lists filesystem or verification failures. Existing scope/exclusions and per-video probe timeout remain in place.

Standalone library maintenance: red Empty Trash beside Scan Library checks catalog paths directly and removes only confirmed missing-file records (not video files). Right-click Remove from Library hides that exact path from future scans, retaining an exclusion record. Movie Details includes local file format, filename, location, size and FFprobe stream details when available. Uncertain or disconnected paths are retained.
