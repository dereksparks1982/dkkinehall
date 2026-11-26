# DK Voiceover — offline translated movie speech

Approved 2026-11-26. Standalone DK Kinehall only. This is a planned major feature inspired by translated-video voiceovers, not an integration with Yandex's proprietary service. First-stage source added; no runtime or model installation yet. Preserve the original Chromium player and all existing settings, audio tracks, subtitle translation and controls.

## Required behavior

- Russian and English translated voiceovers, initially English to Russian and Russian to English; explicit source/target selection plus automatic source-language detection.
- Male/female synthetic voice options and automatic speaker identification/diarization with consistent speaker-to-voice assignment; manual correction and generic voice fallback. Do not assume speaker gender from a voice or promise perfect diarization.
- Generate synchronized spoken translations from the selected original audio track; prefer reliable timed source subtitles when explicitly selected and compatible, otherwise speech recognition. Keep original speech/music/effects available. Background preservation should use genuine separation when available; initially mix translated speech over attenuated original audio, not claim isolated dialogue removal.
- Settings gear: Voiceover On/Off, Original language, Voiceover language, Voice selection (automatic/manual), Original audio level, Voiceover volume, Generate voiceover, status/progress, cancellation, resume from cached results, cache management and optional audio export. Off by default. Never automatically process all library items.
- Ahead-of-playback generation and cached voiceovers so repeated viewing does not require reprocessing. First release may require pre-generation; later bounded lookahead and buffering. No promise of instant dubbing on CPU hardware.
- Seek/pause/resume, playback rate, queue/track changes, loop modes and 200% master volume must stay synchronized. Keep source files unmodified; export only to a separate user-selected output.
- Once explicitly installed, local speech recognition, translation and synthesis must work offline, without subscriptions, paid APIs, online fallbacks or transmission of files, transcripts or generated voices.

## Proposed components (candidates, not yet pinned or redistributed)

- [whisper.cpp](https://github.com/ggml-org/whisper.cpp): local speech recognition and timestamped segments; select CPU-capable multilingual model.
- [OPUS-MT](https://github.com/Helsinki-NLP/Opus-MT), CTranslate2 and SentencePiece: reuse the existing English/Russian subtitle translation runtime where compatible, translate in context-aware bounded batches.
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx): evaluate local text-to-speech and speaker diarization models; verify usable English and Russian voices, speaker assignment, phonemization and CPU performance.
- Existing FFmpeg/FFprobe: extract selected audio, resample, inspect timing, mix and export. Evaluate actual dialogue/background separation model separately if needed.

## Implementation sequence

1. Review and pin each upstream engine, individual model/voice license, redistribution terms, notices, dependencies and checksums. Design opt-in runtime provisioning, no surprise downloads, disk/RAM budget and a CPU mode suitable for Surface Pro.
2. Secure native job manager: validate selected-file identity and track, restrict IPC, process arguments and cache roots, bound duration/input/output/CPU and memory, progress by stage, cancel workers and clean partial artifacts, never execute arbitrary shell commands or download implicitly.
3. Timestamped ASR and language detection; source subtitle import; segmentation, speaker diarization and stable speaker assignment. Preserve silence and original media timeline, including nonzero origins and variable frame rates.
4. Offline translation with existing local bilingual models; sentence context, punctuation and timing-aware segmentation; maintain originals and expose errors without fabricating translations.
5. Synthesize generic English/Russian voices, align durations using bounded tempo adjustment or sensible resegmentation; avoid truncated dialogue, long drift and overlapping speech.
6. Generate synchronized audio in bounded chunks, original-audio ducking/mix and independent gain controls; use real separation only when supported. Do not imply original music/effects are isolated if the original track is merely attenuated.
7. Cache keyed by verified file identity, audio-track identity, model/voice versions, languages and synthesis options; atomic manifests, size quota, invalidation, explicit clear and deletion behavior. No duplicate media videos or sharing transcripts.
8. Integrate player clock, seek, pause, playback-rate, loop and queue transitions. Select cached voiceovers, fallback to original audio if absent or failed; preserve subtitle and existing audio controls.
9. Export generated audio as a separate file, optionally mixed or standalone translated track; preserve originals. Add ahead-of-playback generation and optional background preservation only after basic synchronization is accepted.
10. Acceptance: actual English/Russian movie clips, male/female voice options, multiple speakers, noisy music, silence, long movies, seeking, track switching, native transcode/direct playback, cancellation, cache reuse, exports, offline operation, licenses, and Surface Pro CPU/RAM/disk use. No source commit alone establishes dubbing quality or runtime availability.

See [master roadmap](ROADMAP.md), [subtitle translation](SUBTITLE_TRANSLATION_ROADMAP.md), and [codec packaging](CODEC_PACKAGING.md). Current work remains source-only; no compile, tests, model downloads or terminal commands unless authorized.

## First-stage implementation status (2026-11-26)

The new standalone Voiceover settings category starts an explicitly requested local job using the selected original text subtitle track and English/Russian translation direction. It reuses the local translation runtime and expects separately provisioned compatible sherpa-onnx Python modules and single-speaker VITS voice assets under translation-runtime/voices/en and /ru (READY.json, model.onnx, tokens.txt and espeak-ng-data). No installer, audited model selection, dependency locking or verified speech runtime is supplied in this build. Native job limits are 6000 cues, three hours of cue timeline, two CPU threads and bounded output, with stage progress, cancellation, temporary-file cleanup and exclusive new-file WAV export. Speech is fitted to available cue intervals with bounded speed adjustment; lines that cannot fit are skipped and flagged rather than cut off. This is separate audio generation/export, not live translated movie playback. Original audio, movie files and subtitles are unchanged. ASR, diarization, voice selection, native seeking integration, persistent cache, mixing and full acceptance are still outstanding.
