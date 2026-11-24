#!/usr/bin/env bash
# Maintainer-only build: produces an ordinary executable folder (NOT AppImage).
# End users never run this script or install Python, libVLC or packages.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"
if ! command -v pyinstaller >/dev/null 2>&1; then
  printf >&2 'Cannot produce a portable release: PyInstaller is absent on this build machine.\n'
  exit 1
fi
if ! command -v ldconfig >/dev/null 2>&1; then
  printf >&2 'Cannot locate the VLC shared library on this build machine.\n'
  exit 1
fi
python3 - <<'PY'
import tkinter
import vlc
from PIL import Image, ImageTk
from tkinterdnd2 import TkinterDnD
print("Python/Tk, python-vlc and Pillow are available for bundling.")
PY

find_lib() {
  ldconfig -p | awk -v lib="$1" '$1 == lib && $0 ~ /x86-64/ && !found {print $NF; found=1}'
}
LIBVLC="$(find_lib libvlc.so.5)"
LIBVLCCORE="$(find_lib libvlccore.so.9)"
if [[ -z "$LIBVLCCORE" ]]; then
  LIBVLCCORE="$(find_lib libvlccore.so.8)"
fi
if [[ ! -f "$LIBVLC" || ! -f "$LIBVLCCORE" ]]; then
  printf >&2 'libVLC and libVLC core must be present on the build machine.\n'
  exit 1
fi
VLC_PLUGINS=""
for dir in \
    "/usr/lib/x86_64-linux-gnu/vlc/plugins" \
    "/usr/lib64/vlc/plugins" \
    "/usr/lib/vlc/plugins" \
    "$(dirname "$LIBVLC")/vlc/plugins"; do
  if [[ -d "$dir" ]]; then
    VLC_PLUGINS="$dir"
    break
  fi
done
if [[ -z "$VLC_PLUGINS" ]]; then
  printf >&2 'VLC plugins are absent. Refusing to make an incomplete portable package.\n'
  exit 1
fi

pyinstaller \
  --noconfirm --clean --onedir --windowed \
  --name 'DK Kinehall' \
  --paths "$ROOT/src" \
  --distpath "$ROOT/dist" \
  --workpath "$ROOT/build/portable" \
  --specpath "$ROOT/build" \
  --runtime-hook "$ROOT/tools/portable-vlc-hook.py" \
  --hidden-import vlc \
  --collect-all PIL \
  --collect-all tkinterdnd2 \
  --add-data "$ROOT/assets/images:assets/images" \
  --add-data "$ROOT/docs/images:docs/images" \
  --add-binary "$LIBVLC:." \
  --add-binary "$LIBVLCCORE:." \
  --add-binary "$VLC_PLUGINS:vlc/plugins" \
  "$ROOT/DKMedia.py"

TARGET="$ROOT/dist/DK Kinehall"
if [[ ! -x "$TARGET/DK Kinehall" || ! -d "$TARGET/_internal/vlc/plugins" ]]; then
  printf >&2 'Portable bundle is incomplete. No release was produced.\n'
  exit 1
fi
printf '\nPortable folder created:\n  %s\n' "$TARGET"
printf 'The entire folder, including _internal, must be distributed together.\n'
printf 'Codec support and double-click behavior still require testing on the target Ubuntu release.\n'
