# DK Kinehall acceptance roadmap

## Approved product and scope

The current installed standalone edition uses **the approved DK Kinehall shared web UI inside Chromium/Electron**. The web edition shares the same interface. Do not change the approved icons, transport buttons, episode artwork sizes or player identity.

The `native/` Qt/libmpv code is a **codec-capable prototype**, not an approved replacement for that UI. The older roadmap falsely said Chromium artifacts were deleted; they are still present on `main`.

## Source changes on main

- Mouse/touch/keyboard Up Next reordering, Shuffle, Loop Off/One/All.
- Visible Chapters button with embedded Matroska chapter reading and native cue fallback.
- Resizable video, Float/Dock in the application, Chromium native Picture-in-Picture.
- Episode show title on line one; SxxExx and episode name together on the wrapping second line.
- Source-level native Qt/libmpv chapter menu, queue drag ordering, Shuffle/Loop and wider file selection.
- Native prototype: TVmaze episode lookup from series and SxxExx only, cached verified names and stills, with original release filename kept for playback and local poster priority.
- File selection no longer depends on a narrow filename suffix list; actual decoding remains required.
- Source-level Electron codec backend: guarded preload IPC, FFprobe metadata, loopback-only FFmpeg output inside the existing video element, seek/resume original-time adapter, alternate audio stream selection, Repeat One stream restart, and all-or-nothing backend archive staging.
- Native portable packaging audits FFmpeg codec libraries, includes FFmpeg/FFprobe executables, records decoder/demuxer inventories and ships third-party notices.

These are source-level changes, not a claim that a final release has been fully checked.

## Unfinished, mandatory acceptance gates

1. **All-in-one native codecs.** Finish packaging and verify the Electron-to-FFmpeg backend behind the approved Chromium player interface. Current GitHub changes are source code only, not a finished codec-enabled binary.
2. **Video/audio sample coverage.** Verify MKV, MP4, AVI, MOV, WebM, TS, M2TS, VOB and older containers, and H.264, HEVC, VP9, AV1, MPEG-2/4, common legacy video; AAC, AC-3, E-AC-3, DTS, FLAC, MP3, Opus, Vorbis and common audio. Report genuine encrypted, proprietary, damaged and future-format exceptions honestly.
3. **Subtitle/audio tracks.** Verify text, ASS/SSA, PGS, VobSub, external subtitle files, audio switching, and timing/remembered settings.
4. **Playback/queue UI.** Verify fullscreen, resume, play-now vs queue-only, auto-next, shuffle, repeat, drag, chapters, Picture-in-Picture, float/dock, mouse/touch and keyboard.
5. **Episode artwork/metadata.** Verify show, episode number and episode name; posters, episode stills, provider retrieval and local fallback.
6. **Release packaging.** Ship a self-contained executable with actual codec libraries, correct licensing and notices, and unchanged approved icons. Verify English/Russian interface.
7. **Final release gate.** The existing updater checks `maintenance/release-gate.json` before changing the installed player. It remains closed until all acceptance checks pass. No update command, download instruction or announcement that "everything" is finished before verification of the actual packaged standalone player.

A decoder cannot literally handle every encrypted, malformed, unpublished or unknown future codec. Target broad coverage with automatic bundled support, never substitute an extension whitelist or metadata inspection for actual video/audio decoding.

**Current status: in progress; not fully verified. One GitHub branch: main.**
