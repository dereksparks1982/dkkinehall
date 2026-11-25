# DK Kinehall native Linux release

DK Kinehall is now a **native standalone Linux player**, not a Chromium
application. The retired portable Electron executable and associated bundled
runtime were removed from the repository. The former download/run directions
in this file no longer apply.

## Current status

The source lives in `native/` and uses Qt 6 Widgets plus libmpv. It has
native local-media controls and embedded MKV subtitle-track selection without
a subtitle file picker. A native release candidate **was compiled and packaged on November 25,
2026**. Download the `DK-Kinehall-native-linux-x86_64` artifact from
[the build run](https://github.com/dereksparks1982/dkkinehall/actions/runs/45644468833)
and extract its tar.gz. The folder contains an executable named
`DK Kinehall` and the bundled libraries. The archive is a release
candidate: real media playback and MKV subtitle selection are not yet
verified on the user's own Linux desktop.

The executable is distributed in the build artifact, not the repository
root.

Maintainers can see `native/README.md` for source build requirements.
The eventual portable release must include all required native runtime
libraries and codecs in a distribution-compliant way. End users should not
need to install external players, browser engines or codec packs.

The application is local-only. Any future live conversion engine must be
separately integrated and tested before it is declared available.
