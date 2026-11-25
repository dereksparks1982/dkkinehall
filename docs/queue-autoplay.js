/* DK Kinehall shared Open / Up Next behavior.
 * Pure playback planning, used by both the web player and standalone host.
 * No browser APIs or dependencies.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DKQueueAutoplay = api;
})(typeof window !== "undefined" ? window : globalThis, function() {
  "use strict";
  function plan(mode, currentIndex, queueLength, playing) {
    if (!["open", "queue", "restore"].includes(mode)) {
      throw new TypeError("Unknown file-open mode");
    }
    const hasCurrent = currentIndex >= 0 && currentIndex < queueLength;
    const startNow = mode === "open" && !playing;
    const restorePaused = mode === "restore" && !hasCurrent;
    // Open is the explicit watch-now action. Preserve the playing movie,
    // and keep any already queued movies after the newly opened selection.
    const insertAt = startNow && hasCurrent ? currentIndex + 1 :
      startNow ? 0 : queueLength;
    return Object.freeze({
      insertAt,
      activate: startNow || restorePaused,
      autoplay: startNow
    });
  }
  return Object.freeze({plan});
});
