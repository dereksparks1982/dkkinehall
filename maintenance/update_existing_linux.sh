#!/usr/bin/env bash
# Update the ORIGINAL installed DK Kinehall Chromium player from main.
# No compilation, custom GitHub Actions, or replacement application.
set -euo pipefail

APP="${DK_KINEHALL_DIR:-$HOME/DKLab/Projects/DK Kinehall}"
if [[ ! -f "$APP/DK Kinehall" ||
      ! -f "$APP/_internal/runtime.tar.gz.000" ||
      ! -f "$APP/docs/index.html" ]]; then
  echo "ERROR: Existing DK Kinehall installation not found at: $APP" >&2
  exit 1
fi

for tool in git python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: $tool is required for direct GitHub updates." >&2
    exit 1
  fi
done

WORK="$(mktemp -d)"
BACKUP="$APP/.dk-backup-$(date +%Y%m%d-%H%M%S)-$$"
backup_ready=0

cleanup() {
  result=$?
  trap - EXIT
  if (( result != 0 )); then
    if (( backup_ready )); then
      echo "Update failed; restoring the original player from backup..." >&2
      rm -rf -- "$APP/docs" "$APP/_internal"
      cp -a -- "$BACKUP/docs" "$APP/docs"
      cp -a -- "$BACKUP/_internal" "$APP/_internal"
      cp -a -- "$BACKUP/DK Kinehall" "$APP/DK Kinehall"
      echo "Previous DK Kinehall installation restored." >&2
    fi
  fi
  rm -rf -- "$WORK"
  exit "$result"
}
trap cleanup EXIT

echo "Fetching DK Kinehall source from GitHub main..."
git clone --quiet --depth 1 --filter=blob:none --sparse --branch main \
  https://github.com/dereksparks1982/dkkinehall.git "$WORK/repo"
git -C "$WORK/repo" sparse-checkout set docs maintenance desktop assets/images

# A normal installed-player update always synchronizes all application code.
# A fully approved codec release may replace the installed codec payload;
# otherwise retain the existing codec executables and shared libraries.
if python3 - "$WORK/repo/maintenance/release-gate.json" <<'PYTHON'
import json,sys
from pathlib import Path
data=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
checks=data.get("acceptance",{})
sys.exit(0 if data.get("release_ready") is True and checks and all(v is True for v in checks.values()) else 1)
PYTHON
then
  python3 "$WORK/repo/maintenance/fetch_release_codecs.py" "$WORK/repo"
else
  echo "Retaining installed codec binaries; synchronizing all application components."
fi

# Abort before touching the installed player if the source is incomplete.
for resource in index.html player.js player.css mkv-tracks.js \
                mkv-subtitles.js pgs-subtitles.js vobsub.js i18n.js \
                library.html library-home.js library-home.css library-store.js \
                native-file.js live-tv.js live-tv.css assets/channel_logos/manifest.json; do
  if [[ ! -f "$WORK/repo/docs/$resource" ]]; then
    echo "ERROR: GitHub source is missing $resource." >&2
    exit 1
  fi
done
if [[ ! -f "$WORK/repo/maintenance/sync_original_runtime.py" ]]; then
  echo "ERROR: Chromium synchronizer is missing." >&2
  exit 1
fi

echo "Preparing verified Live TV channel artwork..."
python3 "$WORK/repo/maintenance/install_live_tv_artwork.py" "$WORK/repo/docs" "$APP/docs"

echo "Backing up the current installation..."
mkdir -p -- "$BACKUP"
cp -a -- "$APP/docs" "$APP/_internal" "$APP/DK Kinehall" "$BACKUP/"
backup_ready=1

echo "Updating player resources while preserving approved icons..."
# Never overwrite approved transparent icons from repository master artwork.
# Do not regenerate dock launchers, GIO icon metadata, or GNOME favorites.
python3 - "$WORK/repo/docs" "$APP/docs" <<'PYTHON'
from pathlib import Path
from shutil import copy2
import sys
source, target = map(Path, sys.argv[1:])
for item in source.rglob("*"):
    relative = item.relative_to(source)
    if relative.parts[0] == "icons":
        continue
    dest = target / relative
    if item.is_dir():
        dest.mkdir(parents=True, exist_ok=True)
    elif item.is_file():
        dest.parent.mkdir(parents=True, exist_ok=True)
        copy2(item, dest)
PYTHON

python3 "$WORK/repo/maintenance/sync_original_runtime.py" "$APP" "$WORK/repo"

echo "SUCCESS: Existing DK Kinehall updated; approved icons untouched."
echo "Backup: $BACKUP"

# Open the original desktop player once the update and icon registration
# have succeeded. Launch in its own working directory and detach completely,
# so a terminal updater invoked from Python can exit normally.
if [[ "${DK_KINEHALL_NO_LAUNCH:-0}" != "1" ]]; then
  if [[ -x "$APP/DK Kinehall" ]]; then
    echo "Opening the installed standalone Chromium DK Kinehall (not the website)..."
    (
      cd -- "$APP"
      # Launch the installed binary and its bundled local resources directly.
      # Never run a URL or xdg-open the separately hosted Web App.
      nohup "./DK Kinehall" </dev/null >/dev/null 2>&1 &
    )
  else
    echo "WARNING: DK Kinehall is updated but the executable is not marked executable." >&2
  fi
fi
