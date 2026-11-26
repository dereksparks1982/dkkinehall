#!/usr/bin/env bash
# Build-time check: no app-level runtime dependency may resolve from the host.
set -euo pipefail
root="${1:?portable DK Kinehall directory required}"
for needed in "bin/DK Kinehall" "bin/qt.conf" "lib/libQt6Gui.so.6" "lib/libmpv.so.2" "lib/libGLX_mesa.so.0" "lib/dri/swrast_dri.so" "plugins/platforms/libqxcb.so" "plugins/xcbglintegrations/libqxcb-glx-integration.so"; do
  if [[ ! -f "$root/$needed" ]]; then
    echo "Incomplete DK Kinehall bundle: $needed" >&2; exit 1
  fi
done

# Require the FFmpeg decoder/demux libraries irrespective of SONAME.
# Codec major versions differ between supported Linux distributions.
for component in avcodec avformat avutil swresample swscale; do
  if [[ -z "$(find "$root/lib" -maxdepth 1 -type f -name "lib${component}.so.*" -print -quit)" ]]; then
    echo "Missing bundled FFmpeg library: lib${component}.so" >&2
    exit 1
  fi
done
lib="$(realpath "$root/lib")"
pattern='^[[:space:]]*([^[:space:]]+)[[:space:]]+=>[[:space:]]+(.+)[[:space:]]+\(0x[[:xdigit:]]+\)'
count=0
while IFS= read -r -d '' object; do
  if ! file -Lb "$object" | grep -q ELF; then continue; fi
  while IFS= read -r line; do
    if [[ "$line" == *'not found'* ]]; then
      echo "Missing ELF library for $object: $line" >&2; exit 1
    fi
    if [[ "$line" =~ $pattern ]]; then
      name="${BASH_REMATCH[1]}"
      resolved="${BASH_REMATCH[2]}"
      # The glibc ABI/loader, kernel and machine's own GPU/audio devices
      # are OS services. Everything else must come from the bundle.
      case "$name" in
        libc.so.6|libm.so.6|libpthread.so.0|libdl.so.2|librt.so.1|libresolv.so.2|libnss_*.so*) continue ;;
      esac
      if [[ "$resolved" != "$lib/"* ]]; then
        echo "Unbundled native library in $object: $name -> $resolved" >&2
        exit 1
      fi
    fi
  done < <(env LD_LIBRARY_PATH="$lib" ldd "$object")
  count=$((count+1))
done < <(find "$root/bin" "$root/lib" "$root/plugins" -type f -print0)
echo "Complete DK Kinehall portable ELF dependency audit passed ($count objects)"
