# DK Kinehall native Linux release

DK Kinehall is now a **native standalone Linux player**, not a Chromium
application. The retired portable Electron executable and associated bundled
runtime were removed from the repository. The former download/run directions
in this file no longer apply.

## Current status

The source lives in `native/` and uses Qt 6 Widgets plus libmpv. It has
native local-media controls and embedded MKV subtitle-track selection without
a subtitle file picker. Native release packaging and runtime verification
are **not yet completed**. There is currently **no ready-to-run native
executable in the repository root**.

Maintainers can see `native/README.md` for source build requirements.
The eventual portable release must include all required native runtime
libraries and codecs in a distribution-compliant way. End users should not
need to install external players, browser engines or codec packs.

The application is local-only. Any future live conversion engine must be
separately integrated and tested before it is declared available.
