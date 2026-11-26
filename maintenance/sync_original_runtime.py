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

from codec_bundle import CodecBundle

CHUNK = 70 * 1024 * 1024
PREFIX = "resources/app/docs/"

def sha(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for buf in iter(lambda: source.read(1024 * 1024), b""):
            result.update(buf)
    return result.hexdigest()

def sync(root, codec_source=None):
    root = root.resolve()
    docs, internal, launcher = root / "docs", root / "_internal", root / "DK Kinehall"
    parts = sorted(internal.glob("runtime.tar.gz.*"))
    if len(parts) < 2 or not launcher.is_file() or not (docs / "index.html").is_file():
        raise RuntimeError("Original desktop runtime, launcher or docs missing")
    docs_map = {file.relative_to(docs).as_posix(): file
                for file in docs.rglob("*") if file.is_file()}
    codec_bundle = CodecBundle(codec_source if codec_source is not None else root)
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
            existing = set()
            for entry in before:
                name = entry.name.removeprefix("./")
                existing.add(name)
                relative = name[len(PREFIX):] if name.startswith(PREFIX) else ""
                if entry.isfile() and name == "resources/app/main.cjs":
                    # The window icon was already configured, but Ubuntu's dock
                    # could not associate the app with our registered launcher.
                    # Set a consistent X11 WM_CLASS without changing the player.
                    host = before.extractfile(entry).read()
                    switch = b'app.commandLine.appendSwitch("class", "dk-kinehall");'
                    anchor = b'app.setAppUserModelId("org.dksoftworks.dk-kinehall");'
                    if switch not in host:
                        if host.count(anchor) != 1:
                            raise RuntimeError("Original Chromium window identity marker not found")
                        host = host.replace(anchor, anchor + b"\n" + switch, 1)
                    if b'dk-media-player-512.png' not in host:
                        raise RuntimeError("Approved Chromium window icon is not configured")
                    if b'void win.loadFile(player);' not in host:
                        raise RuntimeError("Standalone Chromium must load the bundled local player, not a website")
                    host = codec_bundle.patch(name, host)
                    entry.size = len(host)
                    after.addfile(entry, io.BytesIO(host))
                elif entry.isfile() and codec_bundle.enabled and                      name in codec_bundle.extra:
                    # Replace previously bundled native codec binaries,
                    # libraries and bridge scripts on subsequent updates.
                    src = codec_bundle.extra[name]
                    stat = src.stat()
                    entry.size = stat.st_size
                    entry.mode = 0o755 if os.access(src,os.X_OK) else 0o644
                    entry.mtime = int(stat.st_mtime)
                    with src.open("rb") as source:
                        after.addfile(entry,source)
                elif entry.isfile() and relative in docs_map:
                    data = docs_map[relative].read_bytes()
                    entry.size = len(data)
                    after.addfile(entry, io.BytesIO(data))
                    replaced.add(relative)
                elif entry.isfile() and codec_bundle.enabled and                      name.startswith("resources/app/") and                      name.endswith((".js", ".cjs")) and                      "/node_modules/" not in name:
                    # Locate and extend the original preload. Abort if the
                    # expected DKStandalone bridge cannot be identified.
                    data = codec_bundle.patch(name, before.extractfile(entry).read())
                    entry.size = len(data)
                    after.addfile(entry, io.BytesIO(data))
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
                existing.add(PREFIX + name)
            # Never publish a runtime with only one half of the Electron
            # native-codec bridge. The archive remains staged until verified.
            codec_bundle.assert_ready()
            codec_bundle.add_entries(after, existing)
        with tarfile.open(updated, "r:gz") as archive:
            for name in required:
                assert archive.extractfile("./" + PREFIX + name).read() == docs_map[name].read_bytes(), name
            host = archive.extractfile("./resources/app/main.cjs").read()
            assert b'app.commandLine.appendSwitch("class", "dk-kinehall");' in host
            assert b'dk-media-player-512.png' in host
            assert archive.extractfile("./electron").read(1)
            if codec_bundle.enabled:
                assert b'codec-host.cjs' in host
                assert archive.extractfile("./resources/app/desktop/codec-host.cjs").read()
                assert archive.extractfile("./resources/app/bin/ffmpeg").read(4) == b"\x7fELF"
                assert archive.extractfile("./resources/app/bin/ffprobe").read(4) == b"\x7fELF"
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
    if len(sys.argv) not in (2, 3):
        raise SystemExit("Maintainer usage: sync_original_runtime.py INSTALL_ROOT [CODEC_SOURCE_ROOT]")
    sync(Path(sys.argv[1]),Path(sys.argv[2]) if len(sys.argv)==3 else None)
