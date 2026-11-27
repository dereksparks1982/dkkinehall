#!/usr/bin/env python3
"""Install only the pinned DK Media Plus logo directory, verifying Git blob hashes."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

def valid(root, rows):
    for row in rows:
        file = root / row["name"]
        if not file.is_file() or file.stat().st_size != row["size"]:
            return False
        data = file.read_bytes()
        digest = hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()
        if digest != row["sha"]:
            return False
    return True

def install(staged_docs, existing_docs):
    staged = Path(staged_docs) / "assets/channel_logos"
    existing = Path(existing_docs) / "assets/channel_logos/builtin"
    manifest = json.loads((staged / "manifest.json").read_text(encoding="utf-8"))
    rows = manifest["files"]
    dest = staged / "builtin"
    if valid(dest, rows):
        return
    if valid(existing, rows):
        dest.mkdir(parents=True, exist_ok=True)
        for row in rows:
            shutil.copy2(existing / row["name"], dest / row["name"])
        return
    with tempfile.TemporaryDirectory(prefix="dk-live-art-") as temp:
        repo = Path(temp) / "source"
        repo.mkdir()
        def git(*args):
            subprocess.run(["git", "-C", str(repo), *args], check=True)
        git("init", "-q")
        git("remote", "add", "origin", "https://github.com/" + manifest["repository"] + ".git")
        git("sparse-checkout", "init", "--cone")
        git("sparse-checkout", "set", "assets/channel_logos/builtin")
        git("fetch", "--quiet", "--depth=1", "--filter=blob:none", "origin", manifest["commit"])
        git("checkout", "--quiet", "--detach", "FETCH_HEAD")
        src = repo / "assets/channel_logos/builtin"
        if not valid(src, rows):
            raise RuntimeError("Pinned Live TV artwork failed verification")
        dest.mkdir(parents=True, exist_ok=True)
        for row in rows:
            shutil.copy2(src / row["name"], dest / row["name"])
    if not valid(dest, rows):
        raise RuntimeError("Live TV artwork installation failed verification")

if __name__ == "__main__":
    install(*sys.argv[1:])
