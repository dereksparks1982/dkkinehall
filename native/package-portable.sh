#!/usr/bin/env bash
# DK Kinehall portable Linux packaging. Maintainer/build-job use only.
set -euo pipefail
BINARY="$1"
OUT="dist"
ROOT="$OUT/DK Kinehall"
mkdir -p "$ROOT/bin" "$ROOT/lib" "$ROOT/plugins" "$ROOT/docs/icons"
install -m 0755 "$BINARY" "$ROOT/bin/DK Kinehall"
cp docs/icons/dk-media-player-512.png "$ROOT/docs/icons/dk-media-player-512.png"

PLUGIN_ROOT="$(qtpaths6 --query QT_INSTALL_PLUGINS 2>/dev/null || true)"
if [[ -z "$PLUGIN_ROOT" || ! -d "$PLUGIN_ROOT" ]]; then
  for p in /usr/lib/x86_64-linux-gnu/qt6/plugins /usr/lib/qt6/plugins; do
    if [[ -d "$p" ]]; then PLUGIN_ROOT="$p"; break; fi
  done
fi
if [[ -z "$PLUGIN_ROOT" || ! -d "$PLUGIN_ROOT/platforms" ]]; then
  echo "Qt6 platform plugins are missing" >&2; exit 1
fi
# XCB's OpenGL implementation is a separate, dynamically loaded Qt plugin.
# Omitting xcbglintegrations made the first distributed executable segfault
# before showing a usable window, even though the unbundled build started.
for name in platforms xcbglintegrations imageformats egldeviceintegrations platformthemes platforminputcontexts styles iconengines generic; do
  if [[ -d "$PLUGIN_ROOT/$name" ]]; then cp -a "$PLUGIN_ROOT/$name" "$ROOT/plugins/"; fi
done
if [[ ! -d "$ROOT/plugins/xcbglintegrations" ]]; then
  echo "Missing Qt6 XCB OpenGL integration plugin; refusing broken package" >&2
  exit 1
fi
if ! find "$ROOT/plugins/xcbglintegrations" -type f -name '*glx*' | grep -q .; then
  echo "Missing Qt6 XCB GLX plugin; refusing broken package" >&2
  exit 1
fi
# Mesa's GLX and EGL vendor libraries and DRI drivers are loaded through
# dlopen(), so ldd cannot discover them. Bundle them with the player.
# Linux kernel/device-specific proprietary drivers remain OS-level services.
for vendor in /usr/lib/x86_64-linux-gnu/libGLX_mesa.so.0 /usr/lib/x86_64-linux-gnu/libEGL_mesa.so.0 /usr/lib/x86_64-linux-gnu/libglapi.so.0 /usr/lib/x86_64-linux-gnu/libgbm.so.1; do
  if [[ -f "$vendor" ]]; then
    cp -L "$vendor" "$ROOT/lib/$(basename "$vendor")"
  fi
done
mkdir -p "$ROOT/lib/dri"
for driver in /usr/lib/x86_64-linux-gnu/dri/*_dri.so; do
  if [[ -f "$driver" ]]; then cp -L "$driver" "$ROOT/lib/dri/$(basename "$driver")"; fi
done
if [[ ! -f "$ROOT/lib/dri/swrast_dri.so" || ! -f "$ROOT/lib/libGLX_mesa.so.0" ]]; then
  echo "Missing bundled Mesa GLX/software renderer; refusing incomplete package" >&2
  exit 1
fi
# Recursively collect native dependencies, including libmpv video codecs
# and Qt's platform plugins. Leave glibc/ld loader with the host OS.
for pass in $(seq 1 9); do
  changed=0
  while IFS= read -r -d '' obj; do
    if ! file -Lb "$obj" | grep -q 'ELF'; then continue; fi
    while IFS= read -r lib; do
      [[ -f "$lib" ]] || continue
      base="$(basename "$lib")"
      case "$base" in
        libc.so.6|libm.so.6|libpthread.so.0|libdl.so.2|librt.so.1|libresolv.so.2|ld-linux-x86-64.so.2|libnss_*.so*) continue ;;
      esac
      if [[ ! -e "$ROOT/lib/$base" ]]; then
        cp -L "$lib" "$ROOT/lib/$base"; changed=1
      fi
    done < <(ldd "$obj" 2>/dev/null | awk '$2=="=>" && $3 ~ /^\// {print $3} $1 ~ /^\// {print $1}')
  done < <(find "$ROOT/bin" "$ROOT/lib" "$ROOT/plugins" -type f -print0)
  [[ "$changed" -eq 0 ]] && break
done
cat > "$OUT/launcher.c" <<'C'
#define _GNU_SOURCE
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <libgen.h>
int main(int argc, char **argv) {
  char exe[PATH_MAX];
  ssize_t count=readlink("/proc/self/exe",exe,sizeof(exe)-1);
  if(count<=0){perror("DK Kinehall");return 1;}
  exe[count]=0;char *base=dirname(exe);
  char libs[PATH_MAX],plugins[PATH_MAX],bin[PATH_MAX],platforms[PATH_MAX];
  snprintf(libs,sizeof(libs),"%s/lib",base);
  snprintf(plugins,sizeof(plugins),"%s/plugins",base);
  snprintf(platforms,sizeof(platforms),"%s/plugins/platforms",base);
  snprintf(bin,sizeof(bin),"%s/bin/DK Kinehall",base);
  setenv("LD_LIBRARY_PATH",libs,1);
  setenv("QT_PLUGIN_PATH",plugins,1);
  setenv("QT_QPA_PLATFORM_PLUGIN_PATH",platforms,1);
  char dri[PATH_MAX];
  snprintf(dri,sizeof(dri),"%s/lib/dri",base);
  setenv("LIBGL_DRIVERS_PATH",dri,1);
  setenv("LIBVA_DRIVERS_PATH",dri,1);
  char **args=calloc((size_t)argc+1,sizeof(char*));if(!args)return 1;
  args[0]=bin;for(int i=1;i<argc;i++)args[i]=argv[i];
  execv(bin,args);perror("DK Kinehall native executable");return 1;
}
C
gcc -O2 -s -o "$ROOT/DK Kinehall" "$OUT/launcher.c"
cat > "$ROOT/bin/qt.conf" <<'QT'
[Paths]
Prefix=..
Plugins=plugins
QT
# Fail early if any ELF has a dependency the package and system cannot resolve.
while IFS= read -r -d '' object; do
  if ! file -Lb "$object" | grep -q ELF; then continue; fi
  if env LD_LIBRARY_PATH="$PWD/$ROOT/lib" ldd "$object" 2>/dev/null | grep -q 'not found'; then
    echo "Incomplete portable runtime: $object" >&2
    env LD_LIBRARY_PATH="$PWD/$ROOT/lib" ldd "$object" >&2 || true
    exit 1
  fi
done < <(find "$ROOT/bin" "$ROOT/lib" "$ROOT/plugins" -type f -print0)
cat > "$ROOT/README.txt" <<'DOC'
DK Kinehall native Linux x86_64
Unpack the complete directory before launching.
Double-click or run the ELF executable named "DK Kinehall".
Keep bin/, lib/, plugins/ and docs/ alongside it.
Qt6/libmpv; no browser engine or Electron.
Requires Linux graphical desktop, OpenGL and audio/graphics drivers.
DOC
tar -czf "$OUT/DK-Kinehall-native-linux-x86_64.tar.gz" -C "$OUT" "DK Kinehall"
du -h "$OUT/DK-Kinehall-native-linux-x86_64.tar.gz"
