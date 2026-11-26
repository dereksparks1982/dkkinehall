/* Keep Playback Settings above Chromium's accelerated video surface.
   Popovers live in the browser top layer, unlike ordinary z-index stacking. */
(() => {
  "use strict";
  const init = () => {
    const details = document.querySelector(".playback-settings");
    const panel = details?.querySelector(".playback-settings-panel");
    if (!details || !panel || typeof panel.showPopover !== "function") return;
    const summary = details.querySelector("summary");
    if (!summary) return;
    panel.setAttribute("popover", "manual");
    document.body.append(panel);
    const reposition = () => {
      if (!details.open || !panel.matches(":popover-open")) return;
      const rect = summary.getBoundingClientRect();
      const width = Math.min(330, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
      panel.style.width = width + "px";
      panel.style.left = left + "px";
      panel.style.top = Math.max(12, rect.bottom + 7) + "px";
      const bottom = panel.getBoundingClientRect().bottom;
      if (bottom > window.innerHeight - 12 && rect.top > panel.offsetHeight + 20)
        panel.style.top = Math.max(12, rect.top - panel.offsetHeight - 7) + "px";
    };
    const close = () => {
      if (panel.matches(":popover-open")) panel.hidePopover();
    };
    details.addEventListener("toggle", () => {
      if (!details.open) { close(); return; }
      try { panel.showPopover(); reposition(); }
      catch (_) { details.open = false; }
    });
    document.addEventListener("pointerdown", event => {
      if (details.open && !details.contains(event.target) &&
          !panel.contains(event.target)) details.open = false;
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && details.open) {
        event.preventDefault();
        details.open = false;
        summary.focus();
      }
    });
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, {passive:true});
    panel.addEventListener("toggle", () => {
      if (!panel.matches(":popover-open") && details.open) details.open = false;
    });
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, {once:true});
  else init();
})();
