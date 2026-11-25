# Portable DK Kinehall for Ubuntu

The standalone desktop player **is the original DK Kinehall web player**.
It loads `docs/index.html`, `docs/player.css`, `docs/player.js`,
and the same supporting artwork/JavaScript through a bundled Electron
Chromium renderer. There is no separately designed desktop UI.

## End-user use

Download and extract the GitHub repository. Double-click the **DK Kinehall**
executable in the root folder. Keep the adjacent `_internal` folder.
No AppImage, installer, separately installed web browser, Python, or VLC.

The executable is a small native Linux bootstrap. Its complete Chromium
runtime ships in `_internal/runtime.tar.gz.000` (and subsequent numbered
parts). On first use it decompresses those existing files into the current
user's `~/.cache/dk-kinehall` directory, then launches the original player.
This **does not download** anything or install system packages. Subsequent
launches reuse the cached runtime. All media remains local to the user; only
optional artwork/episode metadata lookups use the internet.

## Build information for maintainers only

`standalone/main.cjs` is a minimal Electron host for the actual web files.
`standalone/launcher.go` is the root, natively compiled Linux starter.
The one-time GitHub build bundles Electron and the exact contents of
`docs/` into a compressed runtime, splits that archive into GitHub-safe
pieces, compiles the starter, and commits both directly to `main`.
Build-only dependencies never need installing on the end user's computer.
The one-time workflow is removed after it succeeds.

This format is larger than a web-only player because the Chromium runtime
has to be included. Like other Linux binaries, it still relies on the
Linux kernel, a running graphical desktop and basic system facilities.
The desktop bundle is aimed at Ubuntu x86-64.

The Electron process currently uses `--no-sandbox` on Linux because an
uninstalled application cannot set up the setuid sandbox on Ubuntu without
privileges. The desktop host disables Node.js in the renderer, limits page
navigation to the local player and routes HTTPS external links to the system
browser. It is a **local media player**, not a general-purpose web browser.
A future portable sandbox solution would improve defense in depth.

## DK Kinehall application icon

The original artwork is at `docs/icons/dk-media-player-512.png`. On the
first standalone launch, the executable registers a user-local XDG
`dk-kinehall.desktop` application entry pointing to the executable and
original icon. Electron sets its Linux desktop name to match the entry so
the dock shows the Kinehall icon rather than a generic gear. GNOME Files
can display the same image on the executable after the launcher assigns
its custom-icon metadata through GIO (when supported). The GitHub ZIP
cannot transport user-specific GNOME file metadata, so that per-file icon
is established on first launch, not before it.

No administrator permissions, additional program downloads, or separate
installer are required. The launcher continues to work if these optional
icon-registration facilities are unavailable.

## Persistent media folder access

The Linux standalone edition runs the same Chromium File System Access
folder picker and IndexedDB handle storage as the web player. This browser
profile is stored in the current user's application data directory, not in
GitHub or a remote media server. A previously selected folder is scanned again
if read access remains approved. If permission has expired, select **Reopen
folder** to ask for access again. The user can remove the saved handle with
**Forget folder**. Do not silently grant additional disk permissions.

The directory picker is user-initiated and local. There is a one-session
`webkitdirectory` fallback for contexts that cannot retain directory handles.
