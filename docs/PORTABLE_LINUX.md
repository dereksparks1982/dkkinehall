# DK Kinehall portable Linux release

The current standalone application is **native Tk + libVLC**, not a browser
wrapper. The previous native application source remains in the legacy app
fragments for reference. The live native entrypoint is the desktop module
through the app module.

## End-user distribution contract

Publish the **entire** build folder produced by the release builder.
Inside it, the user double-clicks the executable named **DK Kinehall**.
Do not publish an installer, AppImage, shell launcher requiring system
Python, or an archive that fetches runtime dependencies on launch.

The binary and its _internal folder must travel together. The _internal
folder contains Python, Tcl/Tk, image support, libVLC, codec modules and
supporting libraries. The runtime must not fetch VLC, PyInstaller or Python.

## Maintainer preparation (not end-user steps)

The tools/build-portable-linux.sh script builds a PyInstaller one-folder
executable on an Ubuntu x86-64 build machine. It requires Python, python-vlc,
Pillow, PyInstaller, native libVLC, and the full VLC plugin folder to be
present on **the build machine**. It deliberately refuses incomplete
dependencies rather than attempting downloads. These are included in the
resulting portable folder; users should not need to install them.

Validate the resulting folder on a supported clean Ubuntu installation before
publishing it. In particular verify playback, subtitle and audio codecs,
fullscreen on X11/Wayland, picture-in-picture output transfer, seek/resume,
artwork, and clicking the executable from the graphical file manager.
Check all dynamically loaded VLC plugins and their transitive shared library
dependencies. The Linux distribution's base graphical and C runtime remain
necessary, as with any native Linux program.

## Current GitHub binary status

The Linux executable and its bundled runtime are committed to
`portable/DK Kinehall/` on the repository's main branch. The build job
completed successfully on an Ubuntu 24.04 runner. The `_internal` directory
contains Python, Tcl/Tk, Pillow, TkDnD, libVLC and VLC plugin libraries.

This confirms packaging, **not** successful end-user playback. Graphical
launch, codec behavior, file manager execution, and full desktop/web feature
parity have not yet been confirmed on a clean Ubuntu desktop.

Still outstanding: hover-video-frame previews, richer movie metadata,
native UI polish, and display/codec runtime verification.
