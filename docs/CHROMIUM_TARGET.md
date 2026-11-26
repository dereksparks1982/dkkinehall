# DK Kinehall: Chromium target

DK Kinehall is a **Chromium-only** local media player. The primary target is the Chromium engine used by **DK NetNav** (the separate browser project), along with Chromium itself. Other browser engines are outside the project scope. Do not spend DK Kinehall development time on compatibility shims, separate code paths, or test matrices for other engines.

## Separate local Library Home (development)

The local Library Home is `docs/library.html`, using the **same**
`player.css` and backdrop as the video player. It contains Movies and TV Shows
only, Continue Watching, and the full selected collection, backed by IndexedDB.
The standalone runtime starts with the Home window and launches the *existing*
player as a second Electron BrowserWindow through a narrow IPC bridge.
No server is started. A visible Scan Library control triggers bounded,
incremental, manual scans; a one-shot scan after startup never requests
permission automatically. Cache image blobs and metadata, **not movies**.

Source-level implementation is not evidence that Electron's original preload
or filesystem permissions have been verified. Keep the release gate closed
until the installed standalone package has been checked.

## Local files and saved playback

- Use Chromium's `showOpenFilePicker` and File System Access permission model for user-selected media. Handle references may be stored in origin-scoped IndexedDB; file bytes are never uploaded.
- Maintain drag-and-drop and ordinary file inputs as **Chromium permission/context fallbacks**, not as support commitments to other browser engines. These temporary inputs cannot silently reopen a file.
- Respect permission prompts and allow the user to reselect a file if a previously approved handle expires.
- Never read arbitrary directories without explicit user permission.

## Playback, subtitles and audio

- Prefer native Chromium video/audio decoding whenever a format is supported; do not claim codecs are implemented merely because metadata is visible.
- MKV header inspection and text/PGS subtitle readers are local, with known limitations documented in README.
- A usable MKV audio-track selector must actually demux/decode/synchronize a selectable track. `audioTracks` support may vary even among Chromium builds, and a list of MKV track descriptors is not playback.
- Focus future codec, container and audio-track work **on Chromium and DK NetNav**. Codec licensing and DRM constraints continue to apply.

## Interface and project boundaries

- Preserve the approved DK Kinehall icon, English/Russian interface and player appearance.
- DK NetNav lives in its own repository. Work here does not automatically change that browser.
- README must describe actual implemented features, not promise unverified functionality. No compilation, browser testing or GitHub Actions until the project owner asks.

## Folder access (Build 2)

- Only users choose folders. Save browser-approved directory handles in
  origin-local IndexedDB; query existing read permission at startup.
- If permission has expired, provide a user-triggered reconnect operation.
  Never request new folder permissions during automatic startup.
- Keep scanning bounded to 500 playable files and six nested levels, and
  do not interrupt current playback when importing a folder.
- Chromium's ordinary `webkitdirectory` picker remains a temporary fallback
  when persistent folder handles are unavailable.
- The standalone edition uses the same Chromium APIs and source files, not
  an independent media library implementation.

## Build 3 codec availability

- MKV metadata inspection is not evidence that media can be decoded.
- AAC/Opus track switching depends on Chromium's WebCodecs decoder availability
  and actual Matroska codec headers. The selected audio must start a real
  decoding path, and failures must be displayed without faking selection.
- PGS and basic DVD VobSub bitmap subtitle packets render on the same local
  canvas as video. The VobSub palette and frame size come from Matroska's
  CodecPrivate data. Unsupported DVD commands must show an error.
- Preserve the source player interface and native Chromium playback.

## Build 4: expanded audio and clear video limitations

The MKV WebCodecs path also attempts MP3, FLAC and Vorbis audio. All attempts
are gated by CodecPrivate validation and the bundled Chromium decoder's
actual capabilities; MP3 has no private configuration. Unsupported codecs
remain disabled and visible as descriptors. The MKV header inspector also
identifies video CodecID and dimensions, but this is **not** a video decoder.

The WebCodecs audio codec registry covers AAC, Opus, MP3, FLAC and Vorbis
among others; it does not guarantee AC3/E-AC3/DTS. Likewise an HEVC decoder
capability probe does not provide MPEG-TS/MKV demuxing or synced rendering.
Do not describe this build as universal MKV playback. Source documentation:
https://www.w3.org/TR/webcodecs-codec-registry/

## Build 5: WebM-compatible MKV fallback

Lossless EBML DocType rewriting is permitted only for Matroska tracks whose
video/audio codecs are WebM-compatible and supported by Chromium. In other
cases no remuxing or decoding is claimed; a full Matroska media pipeline is
still required. This fallback is in the shared docs player, with no desktop-
only implementation. It preserves local file bytes, seeking controls,
subtitles off defaults, queue semantics, and original permissions.

## Build 6: H.264/AAC MKV fallback

A bounded browser-local Matroska remuxer builds MP4 sample tables and codec
initialization records from video and audio tracks. Only one H.264 track
without frame reordering, one AAC track, and no extra streams are allowed.
Original media samples are reused through File slices, no transcoding.
This does not add HEVC, MPEG-2, AC3, E-AC3 or DTS decoders.
