# DK Kinehall standalone Linux

The current standalone edition uses the approved DK Kinehall interface in a bundled Chromium/Electron runtime. The separate Qt/libmpv source in `native/` is not the installed edition described here.

## Update an existing installation

Close DK Kinehall. Run the standard updater in a terminal:

```bash
python3 - <<'PY'
import urllib.request
import subprocess

url = "https://raw.githubusercontent.com/dereksparks1982/dkkinehall/main/maintenance/update_existing_linux.sh"

with urllib.request.urlopen(url, timeout=30) as response:
    subprocess.run(["bash"], input=response.read(), check=True)
PY
```

The updater synchronizes the Player, Library and native bridge in the existing installation, preserves approved icons and installed codec binaries unless a verified replacement is available, creates a backup, and reopens the player. The default installation location is `~/DKLab/Projects/DK Kinehall`.

## New installations

A fully verified standalone distribution package is not currently published in this repository. The existing-installation updater is not a fresh installer. No separate preview installation is required for routine updates.

## Live TV

The Library provides Movies, TV Shows and Live TV buttons. Live TV supports compatible HDHomeRun network tuner discovery and channel selection; USB/internal tuner discovery does not yet provide channel scanning or playback.
