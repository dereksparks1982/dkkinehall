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
git -C "$WORK/repo" sparse-checkout set docs maintenance

# Abort before touching the installed player if the source is incomplete.
for resource in index.html player.js player.css mkv-tracks.js \
                mkv-subtitles.js pgs-subtitles.js vobsub.js i18n.js; do
  if [[ ! -f "$WORK/repo/docs/$resource" ]]; then
    echo "ERROR: GitHub source is missing $resource." >&2
    exit 1
  fi
done
if [[ ! -f "$WORK/repo/maintenance/sync_original_runtime.py" ||
      ! -f "$WORK/repo/maintenance/install_linux_icon.py" ||
      ! -f "$WORK/repo/maintenance/make_icons_transparent.py" ]]; then
  echo "ERROR: Chromium synchronizer, desktop icon installer or transparency fixer is missing." >&2
  exit 1
fi

echo "Backing up the current installation..."
mkdir -p -- "$BACKUP"
cp -a -- "$APP/docs" "$APP/_internal" "$APP/DK Kinehall" "$BACKUP/"
backup_ready=1

echo "Updating existing web resources and Chromium runtime..."
cp -a -- "$WORK/repo/docs/." "$APP/docs/"

# The repository still contains the original approved, opaque emblem masters.
# Restore the transparent outer corners EVERY update, BEFORE Chromium bundles
# the icon, and BEFORE Ubuntu registers it for the executable and GNOME dock.
echo "Restoring transparent corners on the approved DK emblem..."
python3 "$WORK/repo/maintenance/make_icons_transparent.py" "$APP"

python3 "$WORK/repo/maintenance/sync_original_runtime.py" "$APP"

echo "Registering the approved DK Kinehall icon for Ubuntu and the executable..."
python3 "$WORK/repo/maintenance/install_linux_icon.py" "$APP"

echo "SUCCESS: Existing DK Kinehall updated from GitHub main, with approved icon."
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
