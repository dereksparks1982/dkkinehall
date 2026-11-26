# Development history

Archived README as of November 26, 2026. This preserves the technical notes and previous decisions, including superseded statements. Consult [ROADMAP.md](ROADMAP.md) for current development status.

# DK Kinehall

![DK Kinehall standalone media player screenshot](../assets/images/Screenshot%20From%202026-11-26%2005-06-07.png)

**Standalone development version: v0.9.3 (2026-11-26).** The codec policy now permits compatible 8-bit 4:2:0 H.264 stream-copy with AAC audio even when the optional H.264 encoder is absent. Codec staging requires AAC encoding and AC-3, E-AC-3, DTS, TrueHD and MLP decoding. Seeking and other video formats can still need full transcoding. No codec release asset or installed playback has been verified. Multiple local video paths can now reach the existing player without reloading it; idle playback starts the first file and subsequent files join Up Next. The existing approved desktop launcher already accepts `%F`; its registration source now advertises supported video MIME types, without modifying icon artwork or dock identity. Actual installed launcher argument forwarding and Ubuntu dock drop delivery remain unverified. Not an accepted release. Linux file-manager launch handling now routes validated video command-line arguments to the original Player, including file URLs and paths containing spaces, with second-instance forwarding. Requires the installed launcher and file association to forward arguments to Electron; this has not been verified. Supported external paths currently use the native library roots. The standalone player window title displays the version. Codec packaging now includes the required source validator and refreshes previously embedded codec preloads.

**DK Kinehall (ДК Кинехолл)** is a free media player from **DK Softworks** for watching movies, television episodes, and listening to music from your own device.

**Approved button design:** All standalone command buttons, playback controls, queue actions, tabs and selectors use the same rounded solid button family. Primary actions remain red, Scan Library white, and secondary actions dark burgundy with gold accents. Icon artwork and media-card layout remain unchanged.

## v0.9.3 installed update

**Approved chapter markers:** The standalone player removes the separate Chapters button and picker. Actual embedded chapter starts appear as thin white 1.5 × 5 px ticks inside the existing gold seek bar, with chapter name/time on hover and click-to-seek. MKV parsing and native FFprobe chapter data are merged without duplicates, including Original playback mode. Videos without usable embedded chapter boundaries show nine equally spaced white ticks dividing the duration into ten virtual chapters. Virtual ticks have distinct hover labels, use click-to-seek, and are replaced automatically by real chapter boundaries when discovered. The hosted Web App retains its existing chapter controls.

**Approved folder controls:** The Player sidebar uses a two-by-two grid of equal-sized buttons: Choose folder and Reopen folder on the first row, Forget folder and white Scan Library on the second. The three folder controls have brown backgrounds, gold borders and gold lettering. Reopen and Forget remain visible but disabled without a saved folder. Scan Library is removed from the Player header; the Library Home header remains unchanged.

**Continue Watching:** Standalone library selections reuse the existing queue entry by library ID or native file identity, with an unambiguous file fingerprint fallback for manually opened files. Repeated selections are serialized, do not append duplicate entries, and resume the selected movie without rearranging the existing queue. Stop preserves the unfinished source position for Continue Watching; pressing Play directly after Stop still restarts the movie. Existing duplicate entries are not automatically deleted.

**Volume requirement:** The standalone volume slider and thumb are red. Standalone volume is 0–200%, including slider, scroll wheel, keyboard and remembered settings. Values above 100% use actual audio gain. Do not reduce the standalone maximum without explicit user approval. Hosted Web App volume stays at 0–100%.

**Native codec improvements:** Audio-only sources no longer treat embedded cover images as video. The native decoder supports audio-only AAC/Opus streams, selects the actual video stream, and retries the other supported output format once in Automatic mode. Explicit format choices are honored. The self-contained release codec asset remains pending.

**Resize handle:** In the standalone docked player, the original grip is positioned at the bottom-right edge of the entire player panel, beneath the video, playback controls and media information. Dragging resizes the panel width while retaining the video aspect ratio. Floating-player resizing and fullscreen behavior remain unchanged.

**Playback settings:** The standalone settings panel has a red × in its upper-right corner to close the panel and return focus to the existing gear. No playback icon artwork or application branding changes.

For updates to an existing installation, `maintenance/update_development_linux.sh` backs up and refreshes the original executable and runtime in place, preserving approved icons and the existing launcher path. It reuses locally installed FFmpeg/FFprobe; without them it refreshes the UI and library without adding native codecs. It does not open the release gate. Close the existing application before updating and reopen through its normal dock icon afterward. Real installed playback and dock launch still need verification. Library Home retains its white Scan Library header button. The Player places Scan Library in the sidebar folder controls.

## v0.9.3 development preview (not a release)

For local testing only, `maintenance/preview_existing_linux.sh` creates a temporary copy of the installed original Chromium runtime and stages the current source. It requires existing local FFmpeg and FFprobe, uses an isolated Electron profile, disables native library deletion, preserves the installed icons and does not update the existing installation. It launches Electron directly, so the original executable/file association and dock drop are not validated by this preview. Close the application window to remove its temporary files. Local system codecs are a test convenience only, not the bundled codec release. No release gate is opened. Preview launch and playback must still be tested on the target Linux machine.

**Subtitle translation roadmap:** [Offline English/Russian subtitle translation](SUBTITLE_TRANSLATION_ROADMAP.md), including text tracks, external subtitles, bilingual display, cached translations and export. Engine/model integration is pending; no translation feature is yet shipped.

## Choose your edition

### Web App

**[Open DK Kinehall Web App](https://dereksparks1982.github.io/dkkinehall/)**

Open the **Movies/TV Library Home** first, then launch media in the separate original player window. Both share the same background, icons, artwork and playback controls. All library files remain on your device. Browser security and codec restrictions can limit file access, MKV playback, embedded subtitles, and other advanced features.

### Standalone Linux

DK Kinehall also has a standalone Linux edition that uses the **same web player interface** in its own bundled Chromium window. It does not require you to install a separate browser. Keep the included `_internal` runtime alongside the **DK Kinehall** executable. Media and subtitle support still depends on the codecs available to that bundled player.

The updater preserves the existing **approved DK cinema emblem, launcher and dock icon** without changing or re-registering them. After a successful update, it opens the **installed standalone Chromium player**, not the hosted Web App. The original Chromium player is preserved.

The two editions are separate. The Web App remains available regardless of changes to the standalone version.

## Local Library Home (new source; release not verified)

**Catalog corrections:** Native rescans reclassify unchanged files when their classification differs, skip sample clips, and group TV series by normalized name across seasons. In the Grey is treated as a movie. Keyless movie search and poster retrieval use restricted native HTTPS requests rather than renderer CORS or remote JSONP scripts; successful movie title/year updates are stored separately from playback history. Movie lookup removes the 007 James Bond collection prefix before matching titles and release years. The standalone library retrieves movie descriptions, genre, runtime, cast and directors when supplied by Cinemeta or Apple; it saves metadata independently of local artwork. Right-click a movie for Movie Details or Refresh Metadata. Unknown or unavailable provider fields remain blank; existing playback history is retained. Provider availability and the installed UI have not been verified.

**v0.9.3 standalone navigation:** A single native window opens on Library and switches to the persistent embedded Player view. Red navigation buttons keep the approved design. Scan Library buttons on both pages must remain white with dark text, including during scanning and hover. They share the same scan and show its active state; gold trim applies only to standalone pages. Switching pages does not reload the player. Installed behavior is not yet verified.

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
- **One window:** The standalone Library is the original window, with a persistent internal Player view. Selecting a movie or episode routes to the Player without creating a second application window. Hosted web navigation is unchanged.
- **Same appearance:** Both standalone pages share the approved static Crimson Flow backdrop, the original player styling, fonts, colors and icons. The hosted web edition retains its Soviet-themed backdrop. No replacement video player.
- **Local persistent database:** IndexedDB retains chosen folders, categorized filenames and file information, watched/resume positions, verified episode titles, and separate TV-series posters and episode stills. Movie/video bytes are **not** cached or duplicated.
- **Collection browsing:** The full selected collection loads in small batches while scrolling, so large libraries stay accessible without creating thousands of poster elements at once.
- **Manual scanning:** A visible **Scan Library** button checks automatically discovered movie/TV locations in the standalone app (or permissioned folders in the hosted web version), finds new or changed files, conservatively reconciles uniquely identifiable renamed videos without losing progress or artwork, and marks genuinely missing entries unavailable without erasing history. A cancel option is available while scanning. Incomplete or permission-blocked scans are reported honestly rather than claiming a complete scan.
- **Startup:** Cached catalog and artwork render before a one-shot, bounded background-in-the-window check. Continue Watching repainting is deferred when the Library Home is unfocused, so playback does not continually redraw the poster grid. Scans query the selected folder's database index instead of rereading every catalog entry for each folder; repeated poster requests for the same TV show are shared. No continuously running process, media server, account, or subscription. Reconnect prompts are user-initiated if folder permission expires.
- **Resume accuracy:** Stopping at 0:00 clears Continue Watching for that file and cannot accidentally mark short videos as fully watched. Verified TV episode names and posters are kept across recognized renames.
- **Efficient metadata updates:** A verified episode name updates the visible episode card directly without re-rendering the entire library grid on the Surface Pro.
- **Accurate local artwork:** Video-specific sidecar images are preferred. Generic folder posters are used only from dedicated title/series subfolders, not indiscriminately from a mixed collection root. Episode stills and series posters have separate cache keys.
- **Sources:** See [third_party/SOURCES.md](../third_party/SOURCES.md). MPV and auxiliary metadata/subtitle sources are pinned for audited build-time integration; Jellyfin remains an architectural reference, **not** a dependency or media server.

**Status:** The new library and two-window wiring are committed as source-level development, not yet verified as a finished Linux package. The updater remains closed.

## Features

- **Local playback:** Open video and music stored on your device. Explicitly selected uncommon formats are passed to the playback engine for probing rather than rejected solely by extension. Folder scanning also recognizes many older container extensions, although recognition alone does not prove the file is decodable.
- **Up Next:** Reorder queued videos with mouse/touch drag handles or keyboard arrows without interrupting the playing video.
- **Shuffle / repeat:** Shuffle upcoming videos. Repeat Off, One or All; remember these preferences. Repeat modes keep played entries available.
- **Chapters:** The standalone player displays small white chapter markers on its gold seek bar instead of a separate button. Real embedded chapters take precedence. Videos without usable interior chapter boundaries receive ten equal virtual sections, with nine internal markers. The hosted Web App retains its previous controls.
- **Resizable/movable video:** Resize the existing player with the corner handle; press **Float** to move and resize the video within the app window, then **Dock** to return.
- **Picture-in-Picture:** A visible PiP button opens Chromium's native movable, resizable video window where supported.
- **Codec roadmap:** **Release requirement:** The standalone player must automatically bundle its own playback engine, codecs, and demuxers for broad video/audio and legacy format support, including MKV, MP4, AVI, MOV, TS, WebM and their common codec combinations. The user must not be required to install codecs, switch players, or manually convert files. **Not yet met:** the current Chromium build has selective decoding and remuxing; this update does not add a universal decoder. See `docs/CODEC_PACKAGING.md` for the required standalone backend work and acceptance checks. TV episodes show the **series name** on the first line and the **complete SxxExx number plus actual episode title** together on the second wrapping line. Metadata provides verified titles, with a filename title fallback when available. No raw release filenames or redundant “Local file” labels appear in the sidebar. Artwork and playback still use the original filenames; existing icons and artwork dimensions are unchanged.
- **Playback controls:** Play, pause, stop, seek, previous, next, and 10-second rewind or fast-forward.
- **Fullscreen:** Watch videos in fullscreen using the player controls.
- **Playback settings on the player bar:** The gear icon is inside the existing video control bar, not the top header. The top-header Playback settings button has been removed; the runtime packager now rejects any legacy header button or duplicate settings gear before allowing an update. Opening it reveals one settings panel over the picture, above the video and Up Next. The gear panel contains subtitle track selection, optional external SRT/VTT file loading, subtitle delay (earlier/later by 0.25 seconds and reset), playback speed, playback format, hardware preference, preference persistence, and automatic removal of watched queue items. There is no separate subtitle control strip below the player.
- **One-click subtitles on the player bar:** A caption icon with **On/Off** sits directly on the controls beside the settings gear. The setting is off by default; pressing it toggles captions without opening Settings. The gear's track selector includes available browser, native decoded, and embedded MKV subtitle tracks, disabling unsupported choices. Turning captions off and back on restores the last selected available track. Text and graphical subtitle timing preferences are remembered per media file. The separate two-line show title and SxxExx/episode name immediately below the video are unchanged. The standalone edition retains the approved **0–200% volume** range with actual audio amplification; the hosted Web App remains at 0–100%.
- **Playback resume:** Return to where you stopped in a movie when the edition can restore access to that file.
- **Artwork:** Display movie posters, episode stills, and local cover images when available, with automatic recovery when an online artwork source fails. The native Qt/libmpv source now also includes TVmaze show lookup, season/episode title resolution, and still caching; that prototype is not the approved standalone release.
- **Languages:** English and Russian interface options. Error messages in the standalone edition describe DK Kinehall's available decoding capabilities rather than implying that another browser needs to be installed.
- **Background artwork:** Standalone v0.9.3 development uses the approved `assets/images/Crimson Liquid Wave Texture.png` as a static, full-window backdrop in both Player and Library. Desktop staging copies it locally and uses cover sizing while preserving the existing dimming overlay, controls and icons. The video surface and hosted web background are unchanged. Preview and release staging are wired; installed appearance is not yet verified.

## Native codec integration under development

The existing Chromium-based player has source code for a guarded desktop decoding adapter. The latest source changes make Electron validate auto-discovered media paths again before handing them to FFprobe/FFmpeg (rather than trusting a page-supplied path). The codec packager now requires the encoder manifest, checks FFmpeg demuxer aliases, and rejects GPL/nonfree build flags for an LGPL-designated release payload. The separate Player window also locates the original DKStandalone preload explicitly, including when Electron's nonpublic preferences helper is absent. The new desktop window router must attach native codec IPC to the second **Player** window rather than the Library Home. When an FFmpeg/FFprobe payload is actually bundled and its Electron bridge works, an unsupported local file can be decoded inside the application into WebM (VP9/Opus) or MP4 (H.264/AAC, when an appropriate encoder is bundled) and played through the **same video surface and controls**. Automatic mode chooses a supported packaged output instead of requiring GPL-linked libx264 in an LGPL configuration. FFprobe metadata is cached in memory per file size and modification time so repeated seeking and audio-track changes do not unnecessarily re-probe an unchanged file. The decoder source also offers on-demand selection of supported embedded text subtitles in more containers. FFmpeg converts those to WebVTT, and the player realigns timestamps after a native seek. Text subtitles remain Off until selected; graphical subtitles such as PGS/VobSub need separate verification. When bundled FFmpeg takes over playback, the previous MKV audio decoder is stopped to prevent duplicate or muted audio. The adapter reports playback success only after the video actually begins playing, not merely after FFmpeg returns a stream URL. The current installed standalone has **not** been verified with this backend. No user codec installations, other media players or manual conversion should be necessary in the finished release. The explicit **Original (no conversion)** setting does not engage native transcoding; Automatic remains the normal broad-format mode.

## Additional decoding source progress

**v0.9.3 continued:** The standalone playback gear now offers Convert video, alongside the existing shortcut. MP4 export can copy compatible H.264 video, MP4/WebM export maps supported text subtitles (with a warning about style/bitmap loss), and MKV export remuxes original video, audio, subtitles and attachments. Original files are not overwritten. Export controls require the bundled desktop bridge; hosted playback is unchanged. Full runtime and subtitle export verification remain outstanding.

**Silent video compatibility:** In Automatic mode the standalone player probes selected media before playback and routes AC-3, E-AC-3, DTS, TrueHD and MLP audio through the bundled decoder instead of waiting for a video error. MP4 native output converts audio to stereo AAC; H.264 video starting at zero is stream-copied without re-encoding. Seeking/resuming may still require video transcoding for accurate timestamps, and WebM-only bundles still use the existing full transcode. The shared player change is guarded by the native Electron bridge, so hosted playback is unchanged. Requires the packaged codec backend; actual sound on the reported files remains unverified.

The standalone playback transcoder now reports FFmpeg encoded-time progress through the native Electron window/taskbar progress API, with indeterminate progress for unknown duration and clearing on stop or process exit. Linux desktop support for this indicator is environment-dependent. This is a source-level streaming conversion indicator. Separately, the standalone Player now has a native video export dialog (Ctrl+Shift+E), with local file selection, supported MP4/WebM output, timestamp-based percentage progress and cancellation. The original is never overwritten; completed exports are published to a new destination only after FFmpeg exits successfully. Export currently excludes subtitles, attachments and additional video streams, requires a destination filesystem supporting hard links, and still needs runtime verification and a visible player control. No hosted web files changed.

The bundled-codec adapter now also has source-level selection of alternate audio streams and actual chapter markers discovered by FFprobe, including for source formats beyond Matroska. Repeat One explicitly restarts a transcoded file at the beginning. Both still require real standalone runtime verification and do not make the release complete.

## Final acceptance gate

The complete checklist is in [docs/ROADMAP.md](ROADMAP.md). The native prototype packaging now includes FFmpeg/FFprobe and generates decoder/container inventories, but that native backend is not yet underneath the approved Chromium interface. Neither a code commit nor a successful subtitle lookup establishes universal media decoding. The standalone codec/backend integration and package verification remain unfinished. The maintainer-only codec asset builder produces an audited tarball and SHA-256 digest for GitHub Releases without activating the updater. The updater is blocked by `maintenance/release-gate.json` until all acceptance checks are verified. Once approved, its native codec payload must be retrieved automatically from a DK Kinehall release asset and verified against a pinned SHA-256 checksum before any installed files are touched. No end-user update instructions should be given until all requested functionality is accepted.

## Getting started

Choose the **Web App** link above to play media in a browser, or use the standalone Linux edition for native playback. Open a local movie or music file, then use **Up Next** to queue more. You can also drop files directly onto the player: they play automatically when nothing is loaded, or join **Up Next** without interrupting the loaded movie.

## Pinned third-party integrations

The Git repository pins build/reference sources for libmpv packaging, official render examples, MediaInfo.js, and JavascriptSubtitlesOctopus. Their independent licenses remain intact. No GPL Jellyfin desktop code is imported into DK Kinehall, and no third-party library is advertised as bundled until it is actually packaged and verified. See [third_party/SOURCES.md](../third_party/SOURCES.md).

## License

DK Softworks' original code may not be sold or commercially repackaged. Third-party components retain their own licenses.


**Offline translation foundation (standalone, v0.9.3):** Playback settings now provide English → Russian and Russian → English translation of a selected text subtitle track, progress, cancellation, and restoration of original text. A restricted native worker uses local CTranslate2 and SentencePiece assets only, with 32-line batches, two CPU threads, bounded input and no download or online API code. Existing cue timestamps and line breaks are retained; translated styling is plain text. Translation is manually initiated and applied after completion. Changing media or tracks, stopping, or rebuilding a native-transcoded subtitle track invalidates the translation. Image subtitles, automatic translation during playback, and export remain pending.

**Runtime packaging is not complete:** the worker requires a trusted local Python environment with compatible CTranslate2 and SentencePiece modules at Electron's the local XDG data directory's dk-kinehall/translation-runtime/bin/python3, and direct bilingual model directories at the translation-runtime/models/en-ru and ru-en, each containing model/model.bin (and its required configuration/vocabulary files), source.model and target.model. These models must be compatible with the worker's unprefixed encoder-decoder tokenization contract. No model or engine is installed by this update. Model availability is a filesystem check, not a runtime validation. Pin versions, audit code and model redistribution terms separately, package verified assets, and verify on the standalone Linux target before declaring support shipped.


### v0.9.3 AVI local-file recovery and offline model installation

The standalone decoder now retries a missing Electron File path using a unique matching native library record (exact filename, size, modification time within 1 ms, and relative path when available), then validates the file again through the native library bridge. This applies to probing, decoding, and native text subtitle extraction. Standalone Add files uses the Chromium file input to preserve native selection paths. If no unambiguous match exists, scan the Library and open the video there. No video contents are uploaded, duplicated or converted on disk by this recovery path. The hosted web player is unchanged.

The separate opt-in maintenance/install_translation_linux.py --install command provisions a private Python virtual environment using binary wheels for CTranslate2 4.6.0 and SentencePiece 0.2.0, and official OPUS-MT archives en-ru opus-2020-02-11 and ru-en opus-2020-02-26 from Helsinki-NLP. The upstream ct2-opus-mt-converter produces INT8 models; only the converted models and tokenizers are retained. See https://github.com/Helsinki-NLP/OPUS-MT-train and https://opennmt.net/CTranslate2/guides/opus_mt.html. Assets are installed in ${XDG_DATA_HOME:-$HOME/.local/share}/dk-kinehall/translation-runtime, with a completion manifest and attribution. The archived original model releases are CC BY 4.0; dependency notices are retained. SHA256 digests are recorded after download, not independently authenticated. Transitive dependencies are not fully locked. Redistribution audit and standalone verification are pending. The normal development updater does not download language models or Python packages. The installer has not been executed; translation is unavailable until successful installation.


**Virtual chapter fallback:** Standalone videos with a known positive duration always have timeline divisions: embedded chapter boundaries when available, otherwise nine small white ticks at 10% through 90%. Virtual chapters are labeled in the current interface language and are never written to the media file. The existing gold seek bar and chapter-marker dimensions are unchanged. Audio-only files receive no synthetic markers.


**Standalone exact-file restore:** Restore remembers the actual selected local file through Electron rather than opening File Explorer. A local private record retains only the last file identity and validates filename, size and modification time before restoring it paused at the saved position. A restricted session grant permits decoding and bounded media reads, not deleting files or scanning new directories. Existing matching queue entries are reused. Older filename-only records can be recovered only if the saved full fingerprint uniquely matches a native library record, or a valid saved file handle remains. Missing, moved, changed, or ambiguous files report unavailability rather than opening the picker or substituting another file. Existing Open/Add Files behavior, hosted Web App, icons, and player styling are unchanged. Standalone runtime verification is pending.


### Standalone library controls and navigation

The approved Player sidebar has three rows: brown Choose folder / Reopen folder, white Forget folder / Scan Library, gold Empty Trash / Refresh Metadata. Add files and Clear queue remain red. Shuffle and Loop are white with an inset gold active-state indicator. Gold is used for selected Library tabs and metadata actions; the existing red navigation, volume slider, gold seek bar, white chapter ticks, crimson background and original icons are retained.

- Empty Trash is a confirmed **catalog-only** operation, removing records already marked unavailable and associated cached artwork. It never invokes native file deletion. Reconnect disconnected drives and scan before using it, because unavailable entries may have viewing history that will be removed.
- Native scan reconciliation consolidates an unambiguous stale record with a live native record using filename, size and modification time (integer milliseconds); legacy folder records also require a matching relative folder suffix. Most recent viewing history and verified metadata are retained, along with cached artwork when the destination lacks it. Distinct available native files are not merged, and ambiguous matches are left alone. This is a metadata heuristic, not a byte-for-byte content comparison.
- Refresh Metadata runs through available movies, TV episodes and one poster per TV series, sequentially with progress and a stop command. Existing cached data is retained on provider failures. Internet access is required for online providers; it does not rescan or modify video files.
- Mouse Back and Forward navigate the current session's Library and Player history, including movie/TV mode, selected series and season. The persistent Player view is not recreated and changing views does not restart playback. Forward history is discarded when the user takes a new navigation path.
- Standalone only; source changes committed to main. No runtime testing or compilation performed. Version stays at 0.9.3 for this incremental update.


### Standalone playback fixes (v0.9.3)

Shuffle and Loop use the same fixed 46 px height, two equal-width columns and 8 px gap as the Up Next action row. Off, One, All, shuffle on/off, hover, focus, pressed and disabled states keep the same geometry. Active and keyboard-focus indicators are inset; no expanding outer focus ring. Both controls remain white with dark text.

During standalone playback, Left/Right arrows seek backward/forward ten seconds and reveal the existing controls. Repeated arrow presses restart the three-second inactivity timer, and the existing seek position/time display updates through the playback clock. Paused playback keeps the controls visible. Form inputs and open menus retain their own keyboard handling. No hosted player behavior changed.

### Classic Windows Media Player feature-parity roadmap (standalone)

All items are in scope, including network playback; none are deferred indefinitely. Source-level implementation and successful runtime acceptance are separate milestones.

| Priority | Feature | Status |
|---|---|---|
| Preserve | Playback speed, fullscreen, mini-player, chapters | Existing; retain |
| 1 | Brightness, contrast, saturation, hue, reset picture settings | Source added; runtime acceptance pending |
| 2 | Gamma correction and sharpness | Source added; runtime acceptance pending |
| 3 | Single-frame forward and reverse navigation | Source added; rendered-frame accuracy and decoder acceptance pending |
| 4 | 50%, 100%, 150%, 200% and custom zoom, crop, aspect ratio | Source added; runtime acceptance pending |
| 5 | Ten-band graphic equalizer, presets, bass/treble, stereo balance | Source added; runtime acceptance pending |
| 6 | Automatic volume leveling and dialogue enhancement | Source added; runtime acceptance pending |
| 7 | Deinterlacing | Source added; runtime acceptance pending |
| 8 | Video smoothing | User-tested working 2026-11-26; specific modes/performance not independently verified |
| 9 | Physical DVD, ISO and VIDEO_TS playback, interactive menus, chapters, bonus material, audio/subtitle and angle selection | Partial source; compatible DVD decoder and full navigation still outstanding |
| 10 | DLNA/UPnP discovery, network shares and client-side streaming | Partial source; compatible IPv4 LAN playback, further support and runtime acceptance outstanding |
| 11 | Offline subtitle translation | In development; local runtime/model installation and acceptance outstanding |
| 12 | DK Voiceover (offline English/Russian translated speech) | Planned; [detailed roadmap](VOICEOVER_ROADMAP.md) |
| Preserve | Video format conversion and 200% volume amplification | Existing source; retain and improve |

Enhancements belong in the existing settings gear and must not modify original media files. Preserve the approved palette, icons, background and existing controls. No compiling, runtime testing or hosted development in this update.


### Standalone picture enhancements (v0.9.3)

The existing playback gear now includes six live picture sliders: brightness, contrast and saturation (0–200%, neutral 100%), hue (−180° to +180°, neutral 0°), gamma (0.25–3.00, neutral 1.00), and sharpness (0–100%, neutral 0%). Values are remembered locally; Reset picture restores all neutral settings. CSS picture filters and local SVG gamma/convolution filters apply only to the existing video element, with no filtering at neutral defaults. Original media, export output, icons, crimson background and playback bar layout are not changed. Native Picture-in-Picture, subtitle rendering and performance with non-neutral filters require later runtime acceptance.

[Master development and acceptance roadmap](ROADMAP.md) is the consolidated source of truth for all outstanding classic player features, previous library/player fixes, translation and codec packaging, design requirements and acceptance gates. Next: zoom, cropping and aspect ratio controls. Standalone source only; no compilation, testing, downloads or terminal commands in this update.


### Expandable docked player and frame navigation

Drag the docked player's right edge or existing bottom-right resize grip beyond the normal two-column boundary to hide Up Next. Drag to the left across the boundary to restore the sidebar. The same video element, playlist and current playback remain mounted; full available content width does not require fullscreen. Width and expanded state are saved. Float/dock behavior remains separate.

Frame navigation in the settings gear adds Previous frame and Next frame; Shift+Left and Shift+Right are keyboard shortcuts. Playback pauses and the guarded native decoder bridge obtains presentation timestamps from the actual local source video using bounded FFprobe windows and a small reusable cache. Direct playback seeks just inside the selected frame interval, while native transcoded playback restarts paused at the selected source timestamp with a frame-specific end clamp. No assumed frame rate, whole-film indexing or modification of the source file. This is source-level implementation, not proof of frame-perfect rendering: variable frame rates, nonzero timestamp origins, browser/remux timelines, decoder keyframes, final frames and native stream startup need acceptance. FFprobe and the existing native bridge are required.

Next implementation priority: video zoom, cropping and aspect ratio controls. Master roadmap updated. No compile, runtime tests, downloads or terminal commands.


### Standalone footer and picture geometry

The Player and Library now have the same gold text-only footer: DK Kinehall ☭ DK Softworks on the left, ACP on the right. The latter opens https://acp.us/ in the system default browser via a fixed, guarded Electron command, not by navigating either internal view. No ACP logo asset, background box or new application icon. The Russian interface localizes the labels.

The playback gear now has fit/fill, zoom presets 50/100/150/200%, a custom 50–300% slider, horizontal and vertical pan (available when the corresponding picture dimension exceeds the viewport), original and override aspect ratios (4:3, 16:9, 1:1, 21:9, 2.35:1), and Reset zoom and cropping. Overrides deliberately allow stretching to the selected ratio. Saved preferences affect the displayed picture, not the source or export. The video and bitmap subtitle overlay share calculated geometry and clipping; the control bar is not scaled. Existing right-click fit/fill actions use the same preferences. Native Picture-in-Picture, browser-rendered text captions, fullscreen and actual rendering performance require runtime acceptance.

Next priority: ten-band graphic equalizer, presets, bass/treble and stereo balance. Standalone source changes only, no compiling/testing. Master roadmap updated.


### Standalone audio enhancements

The playback settings gear now includes an optional ten-band graphic equalizer (31, 62, 125, 250, 500 Hz; 1, 2, 4, 8, 16 kHz, each −12 to +12 dB), eight presets (Flat, Cinema, Speech, Rock, Classical, Jazz, Bass boost, Treble boost), custom settings, independent bass/treble shelves (±12 dB), stereo balance and reset. Settings persist locally. Neutral/disabled effects bypass processing; filters are allocated only when necessary. The existing 0–200% volume gain remains independent. Optional EQ headroom compensates for the estimated frequency-response boost; this is not an automatic loudness normalizer or clipping guarantee.

The same Web Audio effect topology is used by the normal media element, loopback native codec stream and separate MKV WebCodecs audio path. Nonzero stereo balance can downmix surround sound. No change to original media, export, transport, icons or crimson background. Actual local-file and loopback audio behavior, separate audio switching, frequency response and output compatibility are unverified. No compiling or testing.

Next priority: automatic volume leveling and dialogue enhancement. Master roadmap updated.


### Standalone volume leveling, dialogue and context menu

The settings gear adds independent, off-by-default Automatic volume leveling and Dialogue enhancement switches, 0–100% strength adjustments, saved preferences and reset. Leveling uses dynamic range compression and modest makeup gain, not measured integrated loudness normalization. Dialogue enhancement uses speech-frequency emphasis (not voice isolation or translated speech). Master volume gain remains downstream of processing, including 200% amplification. Normal, native-transcoded and separately decoded MKV audio share the effect topology. Web Audio compression and stereo balance can downmix surround channels; clipping, latency/lip sync, audio output and channel-aware processing remain acceptance work.

The approved top-level right-click palette uses red Playback, gold Playback format/Speed/Picture, and white Subtitles/Audio tracks/Media information. Other sections stay brown/gold; nested entries remain unchanged. Focus indicators are inset. No icon/background changes.

**DK Voiceover:** the full offline translated movie speech feature is now tracked in [docs/VOICEOVER_ROADMAP.md](VOICEOVER_ROADMAP.md) and the master roadmap. Candidate local ASR, translation and TTS/diarization engines require pinned models, license review, provisioning, secure processing, mixing, synchronized playback, cache/export and real runtime verification. No engine/model downloads or voiceover implementation yet.

Next priority: deinterlacing. Standalone source only; no compilation, testing or terminal commands.


### Approved transport colours

Transport palette: solid brown Previous/Next with gold glyphs; solid white 10-second Rewind/Fast-forward with dark glyphs; red Play/Pause with white glyph; solid gold Stop with dark square. Use the approved compact SVG symbols: outlined Previous/Next triangles with bars, filled double-triangle Rewind/Fast-forward, circled Play/Pause, and outlined rounded-square Stop. Keep the order, dimensions, spacing, gold borders, inset focus indicators and muted disabled states. Rewind/Fast-forward still skip ten seconds. Standalone CSS only. Runtime appearance remains unverified; next feature remains deinterlacing.


### Standalone deinterlacing

The existing gear now includes Deinterlacing: Off (default), Automatic and On. Automatic checks FFprobe field-order metadata and elects the native decoder only for declared interlaced video; unknown or progressive sources are not forced through this filter. On explicitly requests FFmpeg BWDIF for video. The fixed native filter uses send_frame and automatic field parity; the selected native output is re-encoded, never stream-copied through a filter. Original playback format bypasses native conversion, and the selected mode takes effect when opening the next video. Preferences are saved locally. Native seeks, repeat and audio selection carry the selected mode. Initial filter preparation failures fall back to ordinary playback; subsequent decoder errors use the existing codec error handling. Requires an available FFmpeg BWDIF filter and a usable output encoder. Source and exported files are unchanged. Interlacing flags, field parity, mixed material, synchronization, actual rendering and CPU performance remain unverified.

Next priority: video smoothing. Master roadmap updated. Source-only changes; no compilation or runtime testing.


### Approved replacement transport symbols

The standalone six-button transport uses compact SVG symbols matching the approved reference. Play/Pause switches between circled play and pause; previous/next and stop use outlines; the ten-second rewind/forward use filled double triangles. No playback actions or application/launcher icons changed. Hosted playback retains its prior symbols. Runtime appearance remains unverified. Next feature: video smoothing.


### Standalone history and default player size repairs

Continue Watching retains unfinished entries above two seconds, including unavailable media until their storage is reconnected. Existing legacy resume positions remain a fallback. The standalone player ignores zero/uninitialized/seeking clocks and waits for resume positioning before updating history; completion requires the actual ended event. Native source transitions suspend stale-clock writes. Scan batch transactions preserve the current row's playback fields instead of stale snapshots, and native duplicate reconciliation does not prefer an accidental zero over meaningful unfinished progress. No database deletion, version reset or profile replacement. Previously lost or overwritten entries cannot be guaranteed recoverable; actual local history must be checked after installation.

The standalone player opens docked at the full width of its left grid column, ignoring stale saved pixel widths and expanded/floating startup state. Up Next retains its existing column. Manual drag sizing and expansion remain available during the session, and double-clicking the right resize edge restores automatic width. Floating dimensions and position are retained. Float/Dock was subsequently changed to brown with gold text; Settings gear styling was subsequently superseded by the approved white button with Russian red icon in both languages. No changes to approved SVG shapes, app icons or background.

Source-only repair build, v0.9.3. Runtime acceptance pending; next new feature remains video smoothing.


### Permanent standalone Russian red palette

All existing solid red interface accents use the shared Russian red token `#D52B1E` across the Player and Library in both languages. Red-tinted supporting text, darker trim and translucent highlights derive from the same hue. The settings gear is permanently Russian red on pure white with a gold border, including idle, open, hovered, pressed and focused states. The gear-specific CSS selectors match the actual summary classes to outrank the shared transport button palette. The approved gold, white and brown palette, transport symbols, dimensions, crimson background and application icons are preserved. The hosted web palette retains its original fallback colours. Source styling only; actual installed rendering remains unverified. Next feature remains video smoothing.

Picture-in-Picture uses solid Russian red with the original white glyph and gold border in idle, hover, pressed, focused and active states. Existing dimensions and behavior remain unchanged.

Closed captions use solid gold with the original brown CC glyph and brown On/Off text in both subtitle states. The speaker/mute button uses solid Russian red with its original white speaker and mute glyphs. Both retain gold borders and their colours during hover, press and focus; existing disabled semantics, dimensions, volume slider and playback behavior are unchanged. Standalone appearance remains unverified on the installed runtime.

Fullscreen/Exit fullscreen is also solid gold with a dark symbol and gold border, matching Stop. Existing fullscreen behavior, symbols, dimensions and spacing remain unchanged.

### Compact standalone player footer

Removed the persistent status strip and reserved bottom padding below Now Playing. The existing corner resize grip now sits inside the bottom-right corner of the Now Playing title row when docked, with space reserved for the grip, not a separate footer. Floating mode retains its original resize grip on the video. The right-edge resizing and sidebar expansion remain available. Status messages are still announced through the existing accessible live region and displayed as a temporary five-second, non-blocking overlay rather than a permanent strip. Folder access handling remains unchanged. Hosted web layout is unchanged. Source-only v0.9.3 repair; runtime verification pending.

### Standalone Continue Watching identity repair

Manually opened, OS-launched and restored videos now resolve to the existing library record using native ID, exact native path or an unambiguous file fingerprint. Progress and completion writes are serialized per queue item; missing catalog records are retried periodically. The Library can recover existing unfinished positions from the player resume store when native filesystem timestamps differ from Chromium File timestamps by at most one millisecond. Ambiguous matches are not guessed, and completed catalog entries are not resurrected by legacy positions. Returning to Library refreshes the visible history. No database reset, profile replacement, media file changes or icon changes. Recovery requires a surviving saved position and matching catalog record; installed runtime acceptance is pending. Standalone source only, v0.9.3.

### Standalone video smoothing and Float/Dock palette

The existing playback settings gear offers Off (default), Automatic, 60 FPS and 120 FPS. The native FFmpeg backend uses motion-compensated minterpolate, not simple duplicate frames. Automatic targets 60 FPS only for source rates below 59.5 FPS, dimensions at most 1280×720, at least eight available logical CPUs and 7 GiB RAM; this is a conservative eligibility heuristic, not a benchmark. Manual modes request interpolation only when the measured source rate is below the target. Deinterlacing runs first when enabled. Original playback and source-frame stepping bypass interpolation; preferences apply on the next open. Native filter/encoder support is required. Initial setup failures fall back to ordinary playback, and interpolation-stream errors attempt a native restart without smoothing. Real-time throughput, actual output FPS, timing, subtitle synchronization, seeking, final frames and audio behavior remain unverified. Original files and exports are unchanged.

Float/Dock returns to brown (#462A25) with gold (#E2B956) lettering and its existing gold border, retaining the original geometry and behavior. Other approved controls and history are unchanged. Standalone source only; no compile or runtime tests. Next priority: DVD, ISO, VIDEO_TS and interactive menus. Master roadmap updated.

### DVD title playback foundation and right-click menu refinements

Standalone-only source adds native selection of Linux optical drives, ISO files and VIDEO_TS folders, with title, starting chapter and angle selection through the existing settings gear or Open DVD on the empty player. The selected source is represented by an opaque session grant, and the original video element receives the native stream. DVD capability is checked before selection; FFmpeg and FFprobe must contain the dvdvideo demuxer (GPL-enabled libdvdnav/libdvdread). The existing LGPL release codec policy is not relaxed. No new binaries, disc decryption, interactive menus, disc subtitle rendering or automatic title enumeration are provided; DVD selections are session-only and do not replace normal file restore history. Audio selection and timeline use the existing native path, but physical media, seeking, chapter offsets, duration, multi-angle, audio and actual playback remain unverified. See https://ffmpeg.org/ffmpeg-formats.html#dvdvideo. Full interactive navigation and licensed packaging remain mandatory roadmap work.

The player right-click menu now uses a stable varied palette: red, gold, white, brown, gold, optional white, brown, white. No two brown top-level buttons are adjacent. Hover and keyboard focus retain normal button fill and ink, with an inset outline only; nested items also retain their normal fill. Existing dimensions, actions, controls, icons and background remain unchanged. No compile or runtime tests performed.

### Standalone network media client foundation

Network media is available from the empty player and playback settings gear. An explicit SSDP scan searches for IPv4 UPnP MediaServer devices; ContentDirectory Browse requests expose nested media folders and paginated results. Compatible video/audio resources can be played immediately or added to Up Next. Private IPv4 HTTP(S) media URLs can also be entered manually. The standalone main process validates addresses, rejects redirects and URL credentials, limits discovery/metadata requests, and grants session-only loopback URLs with single-range forwarding to the original Chromium video element. Discovered control/media URLs must remain on the discovered server's IP; no external-facing server or periodic scan is installed. Network items do not replace the remembered local file or enter the durable local library. The English and Russian UI uses the existing controls and palette.

This is a source-only foundation: only Chromium-decodable streams are supported initially. Native network decoding, authenticated shares, direct SMB/NFS, IPv6, hostnames, public streaming URLs and adaptive playlists are not implemented. Mounted shares still use ordinary local-file access. Actual SSDP discovery, device compatibility, byte-range seeking, proxy and queue cleanup, playback and disconnect behavior remain unverified. Existing DVD navigation and packaging work remains open. No compile, runtime test or heavy CI performed. Next roadmap feature: complete offline English/Russian subtitle translation.

### Shared Library Home settings and attribution cleanup

The standalone Library Home header now includes a gold Settings button immediately after Scan Library, matching its existing navigation button dimensions and language-specific widths. The dialog projects the actual existing global Player settings controls, including brightness, gamma, other picture adjustments, zoom/aspect, audio enhancements, playback format, hardware preference, remember format, queue behavior and capability-gated deinterlacing/smoothing. A shared default text subtitle language selector uses existing subtitle preferences and preserves per-file embedded choices. Both entry points use the same persistent Player renderer and settings handlers, not parallel preference files. Current-track selection, subtitle timing, playback speed, frame stepping, pan, file opening and other media-dependent actions remain in the Player. Library format changes apply at the next video open; opening Settings on first launch defers automatic media restoration until normal Player activation. The Artwork: prefix has been removed from the player attribution while retaining all provider links. English/Russian translations included. No compile or runtime verification performed. Master roadmap updated; offline subtitle translation remains the next larger development feature.

### Categorized settings, cinematic presets and library discovery repair

User reported video smoothing working on 2026-11-26 and positively confirmed brightness adjustment. This records user acceptance of the tested experience, not certification of every frame rate, input format or performance condition. No automated tests or compilation were performed in this source build.

Both standalone settings entry points now use category navigation. Library Network and DVD & Disc launch the existing real Player tools rather than inert placeholders. Library catalog maintenance has its own category. Picture offers Original, Dark cinema, Very dark scenes, Overexposed picture, Classic films, Vivid animation, Soft picture and Black and white, plus one reusable custom preset. Explicit all-video, individual video and TV series scope selectors keep local overrides separate from the global default. The Library Settings dialog edits default picture values. These adjustments do not rewrite files. Additional named presets and category-level acceptance remain roadmap work.

Automatic discovery excludes DKLab Projects/Archives, development/fixture directories, reported technical basenames, and candidates under 1 MiB. A bounded packaged FFprobe check looks for actual video streams when available; recognizable binary container signatures are used as a fallback, and unknown unverified types are skipped. Known false catalog entries are quarantined from display without deleting any physical media or viewing history. Explicit manual opening remains unchanged. Movie poster lookup now uses the stored title/year, handles additional release-year fields and includes a specific Casino Royale (2006) IMDb identity fallback, retrying alternative providers and allowlisted HTTPS image redirects. Actual poster retrieval, full media coverage, local runtime behavior and scan speed remain unverified. Existing library card sizes, grid, spacing, background and player icons are unchanged. Master roadmap updated.

### Direct right-click picture adjustments

The standalone video context menu includes a gold Picture adjustments button with brown text, immediately before Media information. It opens the existing Picture settings category directly, with the same presets, brightness/gamma and other live picture controls, reset and individual video/series scope. No duplicate controls, settings store or additional playback-bar icon. The button is disabled for audio-only or stopped playback. The settings layer repositions when its category changes; Escape closes settings before leaving desktop fullscreen. Existing menu colors retain their outline-only hover behavior. English and Russian labels included. Source-only build; local playback and fullscreen behavior remain to be verified.

### Progressive offline subtitle translation and queue palette

Standalone subtitle translation now streams validated local worker batches of up to 32 lines. Current/future cues are prioritized; unprocessed cues retain their original text. Optional bilingual display and opt-in automatic translation of a selected known matching source-language text track are persisted. Cancel/restore returns original text. SRT export writes translated available cues with the source timeline offset and current subtitle delay, using a native save dialog that refuses to overwrite existing files. Native stream restarts can omit earlier cues; full-track export and seek behavior need verification. No online translation service or automatic downloads are introduced. The separate runtime/model installer, packaging, persistent cache, bitmap OCR and end-to-end testing remain outstanding.

Shuffle and Loop now use gold (#E2B956) backgrounds and brown (#462A25) text, retaining the existing 46px dimensions and active-state inset outline. Other buttons and Library Home layout are unchanged. English/Russian labels updated. Source only; no compile, installation or runtime tests performed.

### Standalone player-size reset and queue layout repair

The standalone Now Playing footer now has adjacent 25px controls: Russian-red Reset with a white reset symbol, and gold Resize with a brown corner symbol. The same controls follow the floating surface. Reset and Escape restore the default docked size, restore Up Next, clear custom resize/expanded state, and cancel active dragging without reopening the video or rebuilding the queue. Escape also exits fullscreen; native and browser fullscreen exit events restore the normal dock layout. Native modal dialogs keep their normal Escape-to-cancel behavior. Standalone now reserves a right-hand queue column even below the website's 970px breakpoint and limits docked shrinking relative to available width; deliberate expansion remains available. The web layout and other approved controls remain unchanged. Source committed only; local runtime verification remains outstanding.

### DK Voiceover first stage and on-video Up Next countdown

Standalone Settings now has a Voiceover category for explicit English/Russian translated speech generation from the selected original text subtitles. The native source implementation uses the existing offline translation runtime and a separately provisioned candidate sherpa-onnx VITS voice runtime/model, stage progress, cancellation and separate WAV export with no overwrite. Source-only: voice runtime and models are not installed or verified, and live dubbing, speech recognition, speaker selection, persistent cache and synchronized original-audio mixing remain outstanding. Original media is unchanged.

Automatic advancement now shows a five-second countdown directly on the video area, including the next title or episode code, Play now and Cancel. Repeat One stays immediate, deliberate manual playback and queue removal cancel stale transitions, and auto-remove watched still removes the completed catalog queue item rather than deleting its file. This applies to standalone only. Existing library layout, controls and approved icons unchanged. Roadmaps updated; no compile, runtime test, model download or local installation performed.

Future language expansion: Arabic ↔ English and Arabic ↔ Russian, with explicit source and target selection. Evaluate multilingual Arabic ASR, direct translation models (or explicitly documented pivot if no suitable direct model exists), Arabic TTS voices, Modern Standard Arabic first and dialect support only after validation. Preserve local-only operation and opt-in installation. Arabic models, voice quality, dialect coverage and RTL subtitle UI remain unimplemented and require licensing/accuracy review.

### Stable artwork during playback

Standalone playback-history writes and legacy-resume storage notifications now update only the keyed Continue Watching cards and their progress indicators instead of rebuilding the entire movie/TV collection. Returning focus does not trigger a full library redraw. Existing cached poster blobs display before descriptive metadata retrieval; bounded per-session attempts prevent repeatedly requesting failed matches. Explicit metadata refresh remains available. Native automatic scans only redraw the collection when reported catalog counts change. Normalize both James Bond 007 and 007 James Bond filename prefixes for canonical metadata lookup (including Octopussy). Remove the player sidebar TVmaze/Cinemeta/Apple link footer; provider lookups and existing credits remain. TVmaze API attribution: https://www.tvmaze.com/api (CC BY-SA); Cinemeta: https://v3-cinemeta.strem.io/; Apple metadata: https://www.apple.com/apple-tv-app/. No change to the existing playback-history save cadence, library design or icons. Source-only repair; live artwork stability and Octopussy retrieval require local verification.

### Synchronized Voiceover and resize color correction

Second-stage standalone Voiceover source streams generated timed speech from a restricted loopback WAV endpoint. Optional speech playback follows the video clock and speed, with independent original and voiceover levels, master volume/mute and original fallback. It requires pre-generated original-text-subtitle-derived speech and a separately provisioned offline runtime and voice models; it is not instant speech recognition or true dialogue separation. No model downloads, compilation or runtime testing performed. Removed legacy CSS specificity conflict so Resize is gold and Reset remains red. See current roadmap for acceptance requirements.

### Shared interface language

Native standalone language preference is persisted in the existing user profile and broadcast to both views, using revisioned updates. Localized UI pairs and source strings allow dynamic labels, explicit-value options and shared settings snapshots to be restored when switching back to English. Library and Player do not reload or clear history on a language switch. Russian Scan Library text wraps within the existing button. Source-only change; verify both directions, active playback, scans, menus and relaunch. Literal media data is not modified.

### Show in folder

Standalone library context menu opens the selected movie or individual episode in the system file manager via native file identity and root validation. Local files are not modified. Missing entries cannot be revealed; reconnect or rescan. The menu is bilingual. Source only; verify native file-manager selection on Ubuntu.
