#!/usr/bin/env bash
# Developer preview; existing installed player stays untouched.
set -euo pipefail
for tool in git python3 ffmpeg ffprobe; do
  command -v "$tool" >/dev/null || { echo "Preview prerequisite missing: $tool" >&2; exit 1; }
done
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT
git clone --quiet --depth 1 --filter=blob:none --sparse --branch main https://github.com/dereksparks1982/dkkinehall.git "$WORK/repo"
git -C "$WORK/repo" sparse-checkout set docs desktop maintenance
python3 "$WORK/repo/maintenance/preview_existing_linux.py" "$@"
