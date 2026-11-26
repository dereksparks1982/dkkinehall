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
      const width = Math.max(240,Math.min(360,window.innerWidth - 24));
      panel.style.width=width+"px";
      panel.style.left=Math.max(12,Math.min(rect.right-width,
        window.innerWidth-width-12))+"px";
      const height=Math.min(panel.scrollHeight,window.innerHeight-24);
      const above=rect.top-height-9;
      const below=rect.bottom+9;
      // The gear lives at the bottom of the picture. Prefer a popover
      // opening UP above it, and clamp height when the screen is narrow.
      const top=above>=12?above:
        below+height<=window.innerHeight-12?below:
          Math.max(12,window.innerHeight-height-12);
      panel.style.top=top+"px";
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
    // Category switches can change panel height while it is already open.
    panel.addEventListener("dk-settings-layout",()=>requestAnimationFrame(reposition));
    document.addEventListener("fullscreenchange",()=>requestAnimationFrame(reposition));
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
