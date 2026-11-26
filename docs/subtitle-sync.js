/* Subtitle synchronization for text, PGS and VobSub in DK Kinehall.
 * A positive delay shows subtitles later; a negative delay shows them earlier.
 * Never modifies original MKV or subtitle file bytes.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DKSubtitleSync = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const originals = new WeakMap();
  const clampDelay = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(-30, Math.min(30, Math.round(number * 4) / 4));
  };
  const displayDelay = (value, language = "en") => {
    const delay = clampDelay(value);
    const sign = delay > 0 ? "+" : delay < 0 ? "−" : "";
    return sign + Math.abs(delay).toFixed(2) + (language === "ru" ? " с" : " s");
  };
  const shiftedTime = (playbackSeconds, delay) =>
    Number(playbackSeconds) - clampDelay(delay);
  const shiftTextTrack = (track, delay) => {
    let cues;
    try { cues = track && track.cues; }
    catch (_) { return 0; }
    if (!cues) return 0;
    const shift = clampDelay(delay);
    let count = 0;
    for (const cue of Array.from(cues)) {
      try {
        let original = originals.get(cue);
        if (!original) {
          original = {start: cue.startTime, end: cue.endTime};
          if (!Number.isFinite(original.start) || !Number.isFinite(original.end))
            continue;
          originals.set(cue, original);
        }
        // Keep the complete cue duration when possible, without negative
        // browser cue times. Always recalculate from the original values,
        // never from already-shifted timestamps (prevents accumulated drift).
        const start = Math.max(0, original.start + shift);
        const end = Math.max(start + 0.001, original.end + shift);
        if (shift >= 0) {
          cue.endTime = end;
          cue.startTime = start;
        } else {
          cue.startTime = start;
          cue.endTime = end;
        }
        count++;
      } catch (_) { /* Native/read-only cues cannot be retimed. */ }
    }
    return count;
  };
  return Object.freeze({clampDelay, displayDelay, shiftedTime, shiftTextTrack});
});
