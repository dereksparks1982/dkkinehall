#!/usr/bin/env bash
# Import the pinned server package and matching GPL source already preserved
# by DK Media Plus. This does not install a system service or launch Jellyfin.
set -euo pipefail
[[ $# -eq 2 ]] || { echo "Usage: bash import_jellyfin_runtime.sh DK_MEDIA_PLUS_CHECKOUT DESTINATION" >&2; exit 2; }
source_root="$(cd "$1" && pwd)/components/jellyfin"
dest="$2"
[[ "$(uname -m)" == x86_64 ]] || { echo "Pinned package requires amd64" >&2; exit 1; }
server="$source_root/packages/jellyfin-server_10.11.11+ubu2604_amd64.deb"
archive="$source_root/source/jellyfin-10.11.11.zip"
test "$(sha256sum "$server" | cut -d' ' -f1)" = a956e58f9e6a95315dc09ca8111a8d29672b36584e5365035dc1bbac9bdd8aea
test "$(sha256sum "$archive" | cut -d' ' -f1)" = a07f2fcab3465f8dbae54a0d43cd0389bd77ef1df385dc49adf3ae70a233d3c2
test "$(dpkg-deb -f "$server" Package)" = jellyfin-server
test "$(dpkg-deb -f "$server" Version)" = 10.11.11+ubu2604
test "$(dpkg-deb -f "$server" Architecture)" = amd64
unzip -tq "$archive" >/dev/null
mkdir -p "$(dirname "$dest")"
test ! -e "$dest"
stage="$(mktemp -d "$(dirname "$dest")/.dk-jellyfin.XXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
dpkg-deb -x "$server" "$stage/package"
mkdir -p "$stage/install/runtime" "$stage/install/source" "$stage/install/licenses"
cp -a "$stage/package/usr/lib/jellyfin/bin/." "$stage/install/runtime/"
cp -a "$archive" "$stage/install/source/"
cp -a "$stage/package/usr/share/doc/jellyfin-server/." "$stage/install/licenses/"
test -x "$stage/install/runtime/jellyfin"
test "$("$stage/install/runtime/jellyfin" --version 2>&1)" = "Jellyfin.Server 10.11.11.0"
mv -T -- "$stage/install" "$dest"
echo "Imported Jellyfin 10.11.11 and corresponding source. No server started."
