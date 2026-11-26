# DK Kinehall

**Standalone development version: v0.9.3 (2026-11-26).** The codec policy now permits compatible 8-bit 4:2:0 H.264 stream-copy with AAC audio even when the optional H.264 encoder is absent. Codec staging requires AAC encoding and AC-3, E-AC-3, DTS, TrueHD and MLP decoding. Seeking and other video formats can still need full transcoding. No codec release asset or installed playback has been verified. Multiple local video paths can now reach the existing player without reloading it; idle playback starts the first file and subsequent files join Up Next. The existing approved desktop launcher already accepts `%F`; its registration source now advertises supported video MIME types, without modifying icon artwork or dock identity. Actual installed launcher argument forwarding and Ubuntu dock drop delivery remain unverified. Not an accepted release. Linux file-manager launch handling now routes validated video command-line arguments to the original Player, including file URLs and paths containing spaces, with second-instance forwarding. Requires the installed launcher and file association to forward arguments to Electron; this has not been verified. Supported external paths currently use the native library roots. The standalone player window title displays the version. Codec packaging now includes the required source validator and refreshes previously embedded codec preloads.

**DK Kinehall (ДК Кинехолл)** is a free media player from **DK Softworks** for watching movies, television episodes, and listening to music from your own device.

## v0.9.3 development preview (not a release)

For local testing only, `maintenance/preview_existing_linux.sh` creates a temporary copy of the installed original Chromium runtime and stages the current source. It requires existing local FFmpeg and FFprobe, uses an isolated Electron profile, disables native library deletion, preserves the installed icons and does not update the existing installation. It launches Electron directly, so the original executable/file association and dock drop are not validated by this preview. Close both windows to remove its temporary files. Local system codecs are a test convenience only, not the bundled codec release. No release gate is opened. Preview launch and playback must still be tested on the target Linux machine.

**Subtitle translation roadmap:** [Offline English/Russian subtitle translation](docs/SUBTITLE_TRANSLATION_ROADMAP.md), including text tracks, external subtitles, bilingual display, cached translations and export. Engine/model integration is pending; no translation feature is yet shipped.

## Choose your edition

### Web App

**[Open DK Kinehall Web App](https://dereksparks1982.github.io/dkkinehall/)**

Open the **Movies/TV Library Home** first, then launch media in the separate original player window. Both share the same background, icons, artwork and playback controls. All library files remain on your device. Browser security and codec restrictions can limit file access, MKV playback, embedded subtitles, and other advanced features.

### Standalone Linux

DK Kinehall also has a standalone Linux edition that uses the **same web player interface** in its own bundled Chromium window. It does not require you to install a separate browser. Keep the included `_internal` runtime alongside the **DK Kinehall** executable. Media and subtitle support still depends on the codecs available to that bundled player.

The updater preserves the existing **approved DK cinema emblem, launcher and dock icon** without changing or re-registering them. After a successful update, it opens the **installed standalone Chromium player**, not the hosted Web App. The original Chromium player is preserved.

The two editions are separate. The Web App remains available regardless of changes to the standalone version.

## Local Library Home (new source; release not verified)

**Standalone automatic discovery:** No folder selection is required. On startup
DK Kinehall loads its saved collection immediately, then performs one bounded
scan of the user's home and connected volumes mounted under `/media/$USER`,
`/run/media/$USER` or `/mnt`. The visible **Scan Library** button forces
another scan. Media files are opened from validated native paths without a
browser folder-selection prompt. The player uses current file size and
modification time when opening a cached video, even if that file changed
since the last scan. App caches, hidden/system folders, symlinks and Trash are
excluded to limit CPU, I/O and accidental catalog entries. Scans have depth,
time and item limits and report incomplete results; a partial scan never
marks all unseen files as deleted. The scanner runs only in the existing
Electron application, not as a separate server.

**Delete actual files:** Right-click an individual movie or episode and choose
**Delete from Disk…**. The standalone native dialog offers Cancel, Move to
Trash, or Delete Permanently. Permanent removal requires a second
confirmation. Filesystem validation and scope checks happen in Electron main;
only after a successful filesystem operation does the catalog entry disappear.
Right-clicking a TV series header does not delete every episode at once.
The hosted website cannot discover or erase arbitrary local files because
browsers prohibit that access; it retains its folder-permission workflow.

- **Movies | TV Shows:** Only these two library categories, with TV Season 0 specials included when present. Folder structures such as `South Park/Season 1/01 - Episode Name.mkv` are recognized as TV even without SxxExx in the filename. Audio-only Ogg files are not treated as movies. A **Continue Watching** row appears above the full collection for the selected category. Television series open into seasons and episodes. No music, Recently Added or server dashboard sections in the library.
- **TV naming:** The existing player and Up Next show the series name above SxxExx and the episode title, including when TV organization comes from a season folder. A metadata-only display alias does not change the actual file name or decoding path.
- **Two windows:** On the standalone edition, the Library Home opens first, and a movie or episode opens the **existing DK Kinehall Player** in another window. The Library Home stays available while playback continues. The hosted web edition opens the same player in another browser window.
- **Same appearance:** Library Home loads the exact same `docs/player.css` and `docs/images/soviet-poster.png` backdrop, fonts, colors, and approved icons. No substitute image or replacement video player.
- **Local persistent database:** IndexedDB retains chosen folders, categorized filenames and file information, watched/resume positions, verified episode titles, and separate TV-series posters and episode stills. Movie/video bytes are **not** cached or duplicated.
- **Collection browsing:** The full selected collection loads in small batches while scrolling, so large libraries stay accessible without creating thousands of poster elements at once.
- **Manual scanning:** A visible **Scan Library** button checks automatically discovered movie/TV locations in the standalone app (or permissioned folders in the hosted web version), finds new or changed files, conservatively reconciles uniquely identifiable renamed videos without losing progress or artwork, and marks genuinely missing entries unavailable without erasing history. A cancel option is available while scanning. Incomplete or permission-blocked scans are reported honestly rather than claiming a complete scan.
- **Startup:** Cached catalog and artwork render before a one-shot, bounded background-in-the-window check. Continue Watching repainting is deferred when the Library Home is unfocused, so playback does not continually redraw the poster grid. Scans query the selected folder's database index instead of rereading every catalog entry for each folder; repeated poster requests for the same TV show are shared. No continuously running process, media server, account, or subscription. Reconnect prompts are user-initiated if folder permission expires.
- **Resume accuracy:** Stopping at 0:00 clears Continue Watching for that file and cannot accidentally mark short videos as fully watched. Verified TV episode names and posters are kept across recognized renames.
- **Efficient metadata updates:** A verified episode name updates the visible episode card directly without re-rendering the entire library grid on the Surface Pro.
- **Accurate local artwork:** Video-specific sidecar images are preferred. Generic folder posters are used only from dedicated title/series subfolders, not indiscriminately from a mixed collection root. Episode stills and series posters have separate cache keys.
- **Sources:** See [third_party/SOURCES.md](third_party/SOURCES.md). MPV and auxiliary metadata/subtitle sources are pinned for audited build-time integration; Jellyfin remains an architectural reference, **not** a dependency or media server.

**Status:** The new library and two-window wiring are committed as source-level development, not yet verified as a finished Linux package. The updater remains closed.

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
- **Playback settings on the player bar:** The gear icon is inside the existing video control bar, not the top header. The top-header Playback settings button has been removed; the runtime packager now rejects any legacy header button or duplicate settings gear before allowing an update. Opening it reveals one settings panel over the picture, above the video and Up Next. The gear panel contains subtitle track selection, optional external SRT/VTT file loading, subtitle delay (earlier/later by 0.25 seconds and reset), playback speed, playback format, hardware preference, preference persistence, and automatic removal of watched queue items. There is no separate subtitle control strip below the player.
- **One-click subtitles on the player bar:** A caption icon with **On/Off** sits directly on the controls beside the settings gear. The setting is off by default; pressing it toggles captions without opening Settings. The gear's track selector includes available browser, native decoded, and embedded MKV subtitle tracks, disabling unsupported choices. Turning captions off and back on restores the last selected available track. Text and graphical subtitle timing preferences are remembered per media file. The separate two-line show title and SxxExx/episode name immediately below the video are unchanged. Both editions keep the approved **0–100% volume** range with no amplification above 100%.
- **Playback resume:** Return to where you stopped in a movie when the edition can restore access to that file.
- **Artwork:** Display movie posters, episode stills, and local cover images when available, with automatic recovery when an online artwork source fails. The native Qt/libmpv source now also includes TVmaze show lookup, season/episode title resolution, and still caching; that prototype is not the approved standalone release.
- **Languages:** English and Russian interface options. Error messages in the standalone edition describe DK Kinehall's available decoding capabilities rather than implying that another browser needs to be installed.
- **Background artwork:** The complete Soviet-themed picture is fitted to the window without cutting off its edges.

## Native codec integration under development

The existing Chromium-based player has source code for a guarded desktop decoding adapter. The latest source changes make Electron validate auto-discovered media paths again before handing them to FFprobe/FFmpeg (rather than trusting a page-supplied path). The codec packager now requires the encoder manifest, checks FFmpeg demuxer aliases, and rejects GPL/nonfree build flags for an LGPL-designated release payload. The separate Player window also locates the original DKStandalone preload explicitly, including when Electron's nonpublic preferences helper is absent. The new desktop window router must attach native codec IPC to the second **Player** window rather than the Library Home. When an FFmpeg/FFprobe payload is actually bundled and its Electron bridge works, an unsupported local file can be decoded inside the application into WebM (VP9/Opus) or MP4 (H.264/AAC, when an appropriate encoder is bundled) and played through the **same video surface and controls**. Automatic mode chooses a supported packaged output instead of requiring GPL-linked libx264 in an LGPL configuration. FFprobe metadata is cached in memory per file size and modification time so repeated seeking and audio-track changes do not unnecessarily re-probe an unchanged file. The decoder source also offers on-demand selection of supported embedded text subtitles in more containers. FFmpeg converts those to WebVTT, and the player realigns timestamps after a native seek. Text subtitles remain Off until selected; graphical subtitles such as PGS/VobSub need separate verification. When bundled FFmpeg takes over playback, the previous MKV audio decoder is stopped to prevent duplicate or muted audio. The adapter reports playback success only after the video actually begins playing, not merely after FFmpeg returns a stream URL. The current installed standalone has **not** been verified with this backend. No user codec installations, other media players or manual conversion should be necessary in the finished release. The explicit **Original (no conversion)** setting does not engage native transcoding; Automatic remains the normal broad-format mode.

## Additional decoding source progress

**v0.9.3 continued:** The standalone playback gear now offers Convert video, alongside the existing shortcut. MP4 export can copy compatible H.264 video, MP4/WebM export maps supported text subtitles (with a warning about style/bitmap loss), and MKV export remuxes original video, audio, subtitles and attachments. Original files are not overwritten. Export controls require the bundled desktop bridge; hosted playback is unchanged. Full runtime and subtitle export verification remain outstanding.

**Silent video compatibility:** In Automatic mode the standalone player probes selected media before playback and routes AC-3, E-AC-3, DTS, TrueHD and MLP audio through the bundled decoder instead of waiting for a video error. MP4 native output converts audio to stereo AAC; H.264 video starting at zero is stream-copied without re-encoding. Seeking/resuming may still require video transcoding for accurate timestamps, and WebM-only bundles still use the existing full transcode. The shared player change is guarded by the native Electron bridge, so hosted playback is unchanged. Requires the packaged codec backend; actual sound on the reported files remains unverified.

The standalone playback transcoder now reports FFmpeg encoded-time progress through the native Electron window/taskbar progress API, with indeterminate progress for unknown duration and clearing on stop or process exit. Linux desktop support for this indicator is environment-dependent. This is a source-level streaming conversion indicator. Separately, the standalone Player now has a native video export dialog (Ctrl+Shift+E), with local file selection, supported MP4/WebM output, timestamp-based percentage progress and cancellation. The original is never overwritten; completed exports are published to a new destination only after FFmpeg exits successfully. Export currently excludes subtitles, attachments and additional video streams, requires a destination filesystem supporting hard links, and still needs runtime verification and a visible player control. No hosted web files changed.

The bundled-codec adapter now also has source-level selection of alternate audio streams and actual chapter markers discovered by FFprobe, including for source formats beyond Matroska. Repeat One explicitly restarts a transcoded file at the beginning. Both still require real standalone runtime verification and do not make the release complete.

## Final acceptance gate

The complete checklist is in [docs/ROADMAP.md](docs/ROADMAP.md). The native prototype packaging now includes FFmpeg/FFprobe and generates decoder/container inventories, but that native backend is not yet underneath the approved Chromium interface. Neither a code commit nor a successful subtitle lookup establishes universal media decoding. The standalone codec/backend integration and package verification remain unfinished. The maintainer-only codec asset builder produces an audited tarball and SHA-256 digest for GitHub Releases without activating the updater. The updater is blocked by `maintenance/release-gate.json` until all acceptance checks are verified. Once approved, its native codec payload must be retrieved automatically from a DK Kinehall release asset and verified against a pinned SHA-256 checksum before any installed files are touched. No end-user update instructions should be given until all requested functionality is accepted.

## Getting started

Choose the **Web App** link above to play media in a browser, or use the standalone Linux edition for native playback. Open a local movie or music file, then use **Up Next** to queue more. You can also drop files directly onto the player: they play automatically when nothing is loaded, or join **Up Next** without interrupting the loaded movie.

## Pinned third-party integrations

The Git repository pins build/reference sources for libmpv packaging, official render examples, MediaInfo.js, and JavascriptSubtitlesOctopus. Their independent licenses remain intact. No GPL Jellyfin desktop code is imported into DK Kinehall, and no third-party library is advertised as bundled until it is actually packaged and verified. See [third_party/SOURCES.md](third_party/SOURCES.md).

## License

DK Softworks' original code may not be sold or commercially repackaged. Third-party components retain their own licenses.
