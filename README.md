# DK Kinehall

**DK Kinehall (ДК Кинехолл)** is a free local media player by **DK Softworks**, with a classic cinema-inspired red-and-gold interface. Watch movies, television episodes, and listen to music using Chromium or DK NetNav.

**[Open DK Kinehall](https://dereksparks1982.github.io/dkkinehall/)**

DK stands for **Дом культуры** (*Dom kultury*, “House of Culture”), traditionally a community space for music, art, performance, and learning.

## Features

- **Play your own files.** Open local videos and music, choose a remembered folder, or drag files into the player. Media files remain on your device.
- **Up Next queue.** Organize videos, move between episodes, keep watched items in the list, and remove entries when you choose.
- **Movie posters and episode artwork.** Automatically find film posters through the keyless Cinemeta and Apple movie catalogs and episode stills through TVmaze; use series artwork, embedded MKV cover art, or local video frames when preferred artwork is unavailable. No personal API token required.
- **Playback controls.** Play, pause, stop, previous, next, 10-second rewind and forward, timeline seeking, volume, mute, playback speed, fullscreen, and picture-in-picture.
- **Preview the timeline.** Hover over the progress bar to preview a scene when the video format allows it.
- **Resume watching.** Remember playback position and, where Chromium permissions allow, reopen your last selected local file.
- **Subtitles.** Load SRT/VTT, select supported text, PGS or DVD VobSub tracks embedded in MKV files, and turn subtitles off. New files start with subtitles off; selected embedded tracks can be remembered per file.
- **Compatible MKV video.** Automatically retry VP8/VP9/AV1 and Opus/Vorbis Matroska video in a lossless WebM-compatible wrapper where Chromium supports its codecs.
- **Audio tracks.** Switch Chromium-native audio tracks when exposed, or select supported MKV AAC, Opus, MP3, FLAC, and Vorbis streams using WebCodecs and WebAudio. Availability depends on the specific codec/profile and Chromium installation.
- **Embedded bitmap subtitles.** Local PGS and basic DVD VobSub bitmap subtitle decoding in MKV files, with subtitle selection from the existing right-click menu. Unsupported DVD display commands and encodings are reported rather than faked.
- **English and Russian.** Switch the interface between English and Русский.

## Build 6: H.264 video and AAC audio in MKV files

When Chromium cannot open an MKV containing a single H.264/AVC video track
and a single AAC soundtrack, Kinehall now attempts a **lossless local MP4
remux** using the original encoded samples. It builds MP4 sample tables,
codec initialization records, durations and keyframe indexes without
re-encoding, downloading codecs, or changing the original file. This uses
the same HTML5 video player in both the browser and standalone editions.

This initial implementation is deliberately restricted to **AVC without
B-frame reordering**, ordinary AAC streams, no additional subtitle or
audio tracks and files up to 1 GiB, with up to 130,000 samples per track.
More complex multi-audio, B-frame, large-file, and HEVC MKVs still require
further work. When remuxing is not supported or Chromium lacks the codec,
Kinehall leaves the original item alone and displays the limitation.

GitHub's synthetic H.264/AAC MKV test validates a real moving image in the
built Chromium runtime. This does not establish that every movie plays or
that long-run synchronization is perfect.

## Build 5: play WebM-compatible MKV video without transcoding

Chromium sometimes refuses an MKV file because its container announces
`matroska`, even though it already decodes the **VP8, VP9, or AV1 video**
and **Opus or Vorbis audio** inside it. DK Kinehall now detects this precise
case and attempts a **lossless, local container fallback** when native
playback rejects the file. The original MKV is never modified, uploaded,
transcoded, or copied into memory in its entirety. Only the small EBML
header is rewritten in a temporary browser Blob, preserving all encoded
video/audio bytes and their offsets.

The fallback checks the actual video/audio track metadata first and
refuses unsupported codecs or subtitle tracks. A video plays through the
existing Chromium <video> element, preserving the approved interface,
play/pause, seeking, volume, fullscreen, and Up Next behavior. If the
embedded codecs or Matroska features cannot be handled by WebM/Chromium,
the user receives a format error rather than a false success.

This is a **targeted MKV compatibility improvement**, not H.264/H.265
transcoding. HEVC, MPEG-2, AC3/E-AC3 and DTS still need independently
licensed decoders, a complete demuxer, or other video/audio pathways.
The build verifies actual moving VP9+Opus video with Chromium using
a synthetic MKV created locally in GitHub Actions.

## Build 4: additional MKV audio codecs and honest format diagnostics

The shared Chromium player now includes MKV audio demuxing and conditional
WebCodecs output for **MP3 (MPEG Layer III), FLAC, and Vorbis** alongside AAC
and Opus. For Vorbis and FLAC, the decoder is initialized using the actual
Matroska `CodecPrivate` stream headers; tracks without required headers are
not offered as playable. Unsupported tracks such as AC3, E-AC3 and DTS remain
identified in Media Information but are not presented as working decoders.
The user does **not** need to install a codec pack.

The player now reports the detected MKV video codec (for example H.264 or
HEVC/H.265) and source dimensions in Media Information. If Chromium cannot
play the video codec, the player displays that codec in its error rather than
silently treating the file as supported.

**Important limitation:** This build expands the *audio-track fallback* for
MKV video files that Chromium can already display. WebCodecs does not by
itself provide an MKV video renderer or MPEG-2/HEVC software codec. Full MKV
video remuxing and optional decoder licensing for incompatible HEVC, MPEG-2,
AC3, E-AC3 and DTS remain future work. File compatibility cannot be promised
for all MKV files. Selecting an audio track triggers a real decoder-support
probe and may report that the selected codec cannot be decoded.

Tests generate fresh short encoded MP3/FLAC/Vorbis Matroska samples and
attempt decoding with the bundled Chromium, alongside the existing player
and Linux-executable checks. These synthetic tests do not replace testing
your own movie files, long seeking or audio/video synchronization.

## Movie poster and episode artwork repair

Older versions intentionally skipped movie artwork entirely unless a private
TMDb token was configured. This defect is fixed. For recognized movie names,
Kinehall requests a matching movie poster from Cinemeta, then the Apple catalog if needed, without
requiring user credentials. Matching requires the actual title and, when
available, its release year to avoid confusing remakes. Television episodes
prefer verified TVmaze episode stills, falling back to series art.

Up Next shows the **actual poster image**, not the movie filename as a fake
picture. Movie posters fit within the existing tall sidebar thumbnails without
cropping. When a provider is unavailable or a title cannot be matched, Kinehall
can use an embedded Matroska cover or local video frame as a visual fallback,
where the local video format is decodable. Titles may be looked up online;
the media files themselves never leave your device.

Only approved remote artwork links (not image bytes) are remembered locally
for faster display after reloading or changing the queue. Links are retried
if an image expires. The display remains dependent on metadata availability,
network access and the provider's catalog. Artwork credits and provider links
remain visible beneath Up Next.

## Build 3: MKV audio and subtitle playback

The original right-click playback menu can attempt supported AAC/Opus audio
track switching in MKV files. WebCodecs support varies by Chromium build and
codec profile. Selecting a track must start an actual decoder or report a
specific error; listing track metadata alone is not considered success.
Audio pause and seek restart decoder scheduling against the video's clock.

For embedded subtitles, Kinehall now reads the Matroska VobSub CodecPrivate
palette and decodes supported DVD subpicture RLE packets to the same on-video
subtitle canvas used for PGS. Both types use local files and no internet
conversion service. Some DVD commands, malformed subtitle streams, codecs
and configurations remain unsupported. **Subtitles begin off by default**;
a successfully selected embedded track is remembered per movie and can be
restored when the file is reopened.

Audio and subtitle decoding are format dependent. The presence of a track
label never guarantees that the browser can decode the track or video.

## Remembered media folder

**Choose folder** from the Up Next sidebar to select a folder of movies, episodes,
or music. Kinehall scans supported media files in that folder and its subfolders,
then adds them to Up Next without interrupting playback. A folder selection does
not automatically start the first alphabetically named movie.

Chromium and the standalone player can save the approved directory handle in
their own local IndexedDB storage. On a later launch, Kinehall restores the
folder's files when its read permission is still granted. Otherwise **Reopen
folder** requests permission again. **Forget folder** removes the remembered
directory permission reference without deleting your original files or the
current session's queue. Folder access is initiated by the user and media bytes
remain on the device.

A scan is limited to 500 supported files and six nested folder levels to avoid
overwhelming the player. Files beyond the limit can be opened individually. If
your Chromium context does not support persistent folder handles, the fallback
file selector works for that session, but the folder must be selected again.

## Automatic playback and Up Next

- **Open files** starts the first selected movie immediately when nothing is playing. Additional selected files wait in Up Next.
- **+ Add files** always queues the selection and never interrupts playback. It does not start a movie automatically when the player is idle.
- Opening a movie while one is already playing adds it to Up Next without interrupting that movie.
- The next queued movie plays when the current movie finishes.
- **Restore last file** reopens the saved movie and leaves it paused at its remembered position.
- The web and standalone versions use this same player code.

## Planned: Playback Format selector (not yet implemented)

Add a **Playback Format** setting in the existing player settings, shared by the web player and the standalone Chromium edition.

- **Automatic (default):** Prefer direct playback or lossless remuxing when supported, then use local on-the-fly transcoding only when necessary and available.
- **Original:** Attempt playback without conversion; clearly report unsupported containers/codecs.
- **MP4 (H.264/AAC):** Allow the user to request an MP4-compatible playback stream, remuxing without quality loss when possible and transcoding otherwise.
- **WebM (VP9/Opus):** Allow the user to request WebM-compatible playback under the same remux-first approach.
- **Hardware acceleration: enabled by default.** Use supported hardware encoding/decoding where available, with a graceful software fallback and honest resource/compatibility reporting.
- **Remember preferred playback format: enabled by default.** Persist the selected playback-format preference locally across sessions, with Automatic as the initial selection.
- Play as soon as sufficient converted output can be streamed; do **not** wait for whole-file conversion, alter the original file, upload media, or turn Kinehall into a media server.
- Investigate an appropriate locally bundled transcoding backend (e.g., FFmpeg) for the standalone player. The web edition must truthfully handle browser sandbox limitations; do not promise support where browser APIs and bundled codecs cannot provide it.
- Preserve play/pause, seeking, subtitles, audio selection, fullscreen, and Up Next behavior wherever the selected playback pipeline supports those features.
- Treat this as **roadmap only** until an explicit build instruction. No feature implementation, compilation, tests, or downloadable package is authorized by this entry.

## Getting started

1. Open **[DK Kinehall](https://dereksparks1982.github.io/dkkinehall/)** in Chromium or DK NetNav.
2. Select **Open files**, or drag your media files onto the player.
3. The first opened movie plays automatically. Use **+ Add files** to queue others without interrupting it.
4. Optionally choose a media folder from the Up Next sidebar and reopen it in later sessions.
5. Right-click the video for subtitles, audio tracks, playback speed, picture options, and media information.

The player uses local media files, not direct streaming links. Playback depends on the codecs available in your Chromium installation. Some MKV audio and subtitle formats may not be supported.

If you choose to restore a previously opened file, Chromium may ask you to grant file access again. Your media is not uploaded. Artwork and episode-information lookups may contact online metadata providers.

## Controls

| Action | Control |
| --- | --- |
| Play or pause | Space or K |
| Fullscreen | Button, F, or double-click the video; Escape exits |
| Mute | M |
| Jump backward or forward | Left or right arrow (5 seconds) |
| Adjust volume | Up or down arrow; mouse wheel over the player |
| Rewind or forward 10 seconds | Dedicated transport buttons |
| Video options | Right-click the video |

## Availability

DK Kinehall runs in a browser or as a standalone Linux desktop application. Both use **the same HTML, CSS, JavaScript, and player interface**.

**Standalone Linux:** [Download the repository](https://github.com/dereksparks1982/dkkinehall/archive/refs/heads/main.zip), extract it, and double-click **DK Kinehall** in the main folder. Keep the supplied `_internal` folder alongside it. This is the **exact same web player**, running in its own Chromium desktop window; the desktop package uses the existing `docs/index.html`, `docs/player.css`, and `docs/player.js` directly. No separately installed browser, Python, VLC, installer, AppImage, or runtime download is needed. The executable unpacks its bundled runtime to the user's cache on first launch. Supported target: Ubuntu x86-64.

**Web player:** [Open DK Kinehall online](https://dereksparks1982.github.io/dkkinehall/).

## License

**Original DK Softworks code is free to use, including in businesses, but it cannot be sold or repackaged for distribution without written permission.** Businesses may use it internally without paying a fee; selling copies, charging for access, or including DK Softworks-owned code in paid software is prohibited by the **DK Softworks Original Work License v1.0**.

See [LICENSE](LICENSE) for the precise terms. These terms apply to DK Softworks-owned work, not to third-party components under their own licenses. See [Third-Party Notices](THIRD_PARTY_NOTICES.md) for credits and applicable notices. Earlier releases retain their existing licenses.

© DK Softworks.
