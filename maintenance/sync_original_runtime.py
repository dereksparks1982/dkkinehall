#!/usr/bin/env python3
"""Repackage the ORIGINAL DK Kinehall Chromium player with current docs.

No UI recreation, browser removal, recompilation, or new executable.
The existing Go launcher uses a SHA-256 runtime ID for cache invalidation.
"""
from pathlib import Path
import hashlib
import io
import os
import sys
import tarfile
import tempfile

CHUNK = 70 * 1024 * 1024
PREFIX = "resources/app/docs/"

def sha(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for buf in iter(lambda: source.read(1024 * 1024), b""):
            result.update(buf)
    return result.hexdigest()

def sync(root):
    root = root.resolve()
    docs, internal, launcher = root / "docs", root / "_internal", root / "DK Kinehall"
    parts = sorted(internal.glob("runtime.tar.gz.*"))
    if len(parts) < 2 or not launcher.is_file() or not (docs / "index.html").is_file():
        raise RuntimeError("Original desktop runtime, launcher or docs missing")
    docs_map = {file.relative_to(docs).as_posix(): file
                for file in docs.rglob("*") if file.is_file()}
    required = {"index.html","player.js","player.css","mkv-tracks.js",
                "mkv-subtitles.js","pgs-subtitles.js","vobsub.js",
                "queue-autoplay.js","folder-access.js","i18n.js"}
    if not required.issubset(docs_map):
        raise RuntimeError("Missing original web player resources: " +
                           str(sorted(required - docs_map.keys())))
    # Stage archive chunks on the installation filesystem. /tmp can be a
    # separate mount, where os.replace() fails with EXDEV (errno 18).
    with tempfile.TemporaryDirectory(prefix=".dk-runtime-", dir=internal) as temp:
        temp = Path(temp)
        original, updated = temp / "original.tar.gz", temp / "updated.tar.gz"
        with original.open("wb") as output:
            for part in parts:
                with part.open("rb") as source:
                    for data in iter(lambda: source.read(1024*1024), b""):
                        output.write(data)
        old_sha = sha(original)
        binary = launcher.read_bytes()
        if binary.count(old_sha.encode("ascii")) != 1:
            raise RuntimeError("Cannot safely update the original launcher's cache ID")
        replaced = set()
        with tarfile.open(original, "r:gz") as before, tarfile.open(updated,"w:gz",compresslevel=3) as after:
            for entry in before:
                name = entry.name.removeprefix("./")
                relative = name[len(PREFIX):] if name.startswith(PREFIX) else ""
                if entry.isfile() and relative in docs_map:
                    data = docs_map[relative].read_bytes()
                    entry.size = len(data)
                    after.addfile(entry, io.BytesIO(data))
                    replaced.add(relative)
                elif entry.isfile():
                    after.addfile(entry, before.extractfile(entry))
                else:
                    after.addfile(entry)
            for name in sorted(docs_map.keys() - replaced):
                data = docs_map[name].read_bytes()
                entry = tarfile.TarInfo("./" + PREFIX + name)
                entry.size, entry.mode = len(data), 0o644
                entry.mtime = int(docs_map[name].stat().st_mtime)
                after.addfile(entry, io.BytesIO(data))
        with tarfile.open(updated, "r:gz") as archive:
            for name in required:
                assert archive.extractfile("./" + PREFIX + name).read() == docs_map[name].read_bytes(), name
            assert archive.extractfile("./resources/app/main.cjs").read(1)
            assert archive.extractfile("./electron").read(1)
        new_sha = sha(updated)
        if old_sha == new_sha: raise RuntimeError("Runtime update produced no changes")
        patched = binary.replace(old_sha.encode("ascii"), new_sha.encode("ascii"))
        if len(patched) != len(binary): raise RuntimeError("Launcher size changed")
        pending = []
        with updated.open("rb") as source:
            index = 0
            while chunk := source.read(CHUNK):
                staging = temp / ("runtime.tar.gz.%03d" % index)
                staging.write_bytes(chunk)
                pending.append((staging, internal / staging.name))
                index += 1
        if len(pending) < 2 or any(a.stat().st_size >= 100*1024*1024 for a,b in pending):
            raise RuntimeError("Runtime split exceeds GitHub blob limit")
        new_exe = temp / "launcher"
        new_exe.write_bytes(patched)
        new_exe.chmod(launcher.stat().st_mode)
        for part in parts: part.unlink()
        for staged,target in pending: os.replace(staged,target)
        os.replace(new_exe,launcher)
        print("Original Chromium player synchronized: %d existing, %d new web files; %d runtime parts; ID %s" %
              (len(replaced),len(docs_map)-len(replaced),len(pending),new_sha[:20]))

if __name__ == "__main__":
    if len(sys.argv) != 2: raise SystemExit("Usage: sync_original_runtime.py REPOSITORY_ROOT")
    sync(Path(sys.argv[1]))
