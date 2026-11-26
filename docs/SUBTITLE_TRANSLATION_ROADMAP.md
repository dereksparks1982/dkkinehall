# Offline subtitle translation (v0.9.3 roadmap)

Planned, not shipped. Keep the existing player gear, subtitle toggle, icons and UI. Desktop only.

- Explicit source/target selection, initially English ↔ Russian. Native text subtitle tracks and external SRT/VTT first.
- Evaluate a pinned, redistributable offline engine and language model (Argos Translate or OPUS-MT); audit code/model licenses separately. Bundle verified runtime/model assets, never silently download or use an online service.
- Translate text ahead of playback in bounded batches, preserve cue timing and line breaks, and invalidate work on file/track changes. Preserve original subtitles as fallback, including when seeking or translation fails.
- Optional bilingual display and SRT export, and an opt-in local cache keyed by source text, languages and model version.
- Image subtitles (PGS/VobSub) need separate OCR and are deferred until text translation is reliable.
- Test English/Russian accuracy, Cyrillic rendering, seeking, long episodes, CPU/RAM on Surface Pro and cancellation. No network calls during translation. No claims of installed support until engine, model and end-to-end verification exist.
- Do not increment the build version until the accepted installable v0.9.3 release. Translation can be staged as a roadmap item without blocking the existing codec/playback test preview.
