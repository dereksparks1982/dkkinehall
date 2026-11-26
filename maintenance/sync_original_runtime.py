#!/usr/bin/env python3
"""Repackage the ORIGINAL DK Kinehall Chromium player with current docs.

No UI recreation, browser removal, recompilation, or new executable.
The existing Go launcher uses a SHA-256 runtime ID for cache invalidation.
"""
from pathlib import Path
import hashlib
import io
import os
import shutil
import sys
import tarfile
import tempfile

from codec_bundle import CodecBundle
from library_bundle import LibraryBundle

CHUNK = 70 * 1024 * 1024
PREFIX = "resources/app/docs/"

def verify_player_settings(html):
    """Prevent legacy top-header playback controls from shipping again.

    The video-bar gear is the SINGLE owner of playback and subtitle settings.
    Check the exact HTML that will be installed, not just source comments.
    """
    if isinstance(html,str):
        html=html.encode("utf-8")
    header_start=html.find(b"<header")
    header_end=html.find(b"</header>",header_start)
    if header_start<0 or header_end<0:
        raise RuntimeError("DK Kinehall player header is missing")
    header=html[header_start:header_end]
    if b"playback-settings" in header or b"Playback settings" in header:
        raise RuntimeError(
            "Legacy Playback settings control in top header; release blocked")
    if b'id="languageSelect"' not in header:
        raise RuntimeError("Player header language selector is missing")
    if html.count(b'data-settings-location="player-bar"')!=1 or (
        html.count(b'class="playback-settings player-bar-settings"')!=1):
        raise RuntimeError("Expected exactly one video-bar playback settings gear")
    for element in (b'id="subtitleToggle"',b'id="subtitleTrackSelect"',
                    b'id="playbackFormat"',b'id="rate"',
                    b'id="subtitleDelayEarlier"',b'id="subtitleDelayLater"',
                    b'id="subtitleDelayReset"'):
        if html.count(element)!=1:
            raise RuntimeError(
                "Missing or duplicated playback-bar setting: "+
                element.decode("ascii"))

def stage_standalone_background(source_root, docs):
    """Use the approved static Crimson Flow asset only in desktop staging."""
    source = Path(source_root) / "assets/images/Crimson Liquid Wave Texture.png"
    if not source.is_file():
        raise RuntimeError("Approved Crimson Flow background asset missing")
    docs = Path(docs)
    target = docs / "images/crimson-flow.png"
    css = docs / "player.css"
    original = 'url("./images/soviet-poster.png") center center / contain fixed no-repeat'
    replacement = 'url("./images/crimson-flow.png") center center / cover fixed no-repeat'
    text = css.read_text(encoding="utf-8")
    if text.count(original) == 1 and replacement not in text:
        text = text.replace(original, replacement, 1)
    elif text.count(replacement) != 1 or original in text:
        raise RuntimeError("Cannot identify the shared standalone background rule")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    css.write_text(text, encoding="utf-8")


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
    source_root = codec_source if codec_source is not None else root
    stage_standalone_background(source_root, docs)
    docs_map = {file.relative_to(docs).as_posix(): file
                for file in docs.rglob("*") if file.is_file()}
    codec_bundle = CodecBundle(source_root)
    library_bundle = LibraryBundle(source_root)
    required = {"index.html","player.js","player.css","mkv-tracks.js",
                "mkv-subtitles.js","pgs-subtitles.js","vobsub.js",
                "queue-autoplay.js","folder-access.js","i18n.js",
                "library.html","library-home.css","library-home.js",
                "library-store.js","native-file.js","images/crimson-flow.png"}
    if not required.issubset(docs_map):
        raise RuntimeError("Missing original web player resources: " +
                           str(sorted(required - docs_map.keys())))
    verify_player_settings(docs_map["index.html"].read_bytes())
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
                    if (b'void win.loadFile(player);' not in host and
                        b'void win.loadFile(player.replace(' not in host):
                        raise RuntimeError("Original Chromium player entrypoint could not be identified")
                    host = codec_bundle.patch(name, host)
                    host = library_bundle.patch_main(host)
                    # Legacy development runtimes attached FFmpeg to the
                    # single old main window. The new Library Home must not
                    # own decoding: the separate Player window does.
                    host = host.replace(
                        b'require("./desktop/codec-host.cjs").install(win);',
                        b'')
                    entry.size = len(host)
                    after.addfile(entry, io.BytesIO(host))
                elif entry.isfile() and name in (
                        "resources/app/desktop/library-host.cjs",
                        "resources/app/desktop/library-indexer.cjs"):
                    data = (library_bundle.host if name.endswith("library-host.cjs")
                            else library_bundle.indexer).read_bytes()
                    entry.size = len(data)
                    after.addfile(entry, io.BytesIO(data))
                elif entry.isfile() and codec_bundle.enabled and name in codec_bundle.extra:
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
                elif (entry.isfile() and name.startswith("resources/app/")
                      and name.endswith((".js", ".cjs"))
                      and "/node_modules/" not in name):
                    # Keep the existing DKStandalone preload intact. Add
                    # library IPC without replacing its original functions.
                    data = library_bundle.patch_preload(
                        name, before.extractfile(entry).read())
                    data = codec_bundle.patch(name, data)
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
            library_bundle.assert_ready()
            library_bundle.add_host(after, existing)
            codec_bundle.assert_ready()
            codec_bundle.add_entries(after, existing)
        with tarfile.open(updated, "r:gz") as archive:
            verify_player_settings(
                archive.extractfile("./" + PREFIX + "index.html").read())
            for name in required:
                assert archive.extractfile("./" + PREFIX + name).read() == docs_map[name].read_bytes(), name
            host = archive.extractfile("./resources/app/main.cjs").read()
            assert b'app.commandLine.appendSwitch("class", "dk-kinehall");' in host
            assert b'dk-media-player-512.png' in host
            assert b'library.html' in host
            assert b'library-host.cjs' in host
            assert archive.extractfile("./resources/app/desktop/library-host.cjs").read()
            assert archive.extractfile("./resources/app/desktop/library-indexer.cjs").read()
            assert archive.extractfile("./electron").read(1)
            if codec_bundle.enabled:
                assert b'codec-host.cjs' in archive.extractfile(
                    "./resources/app/desktop/library-host.cjs").read()
                assert archive.extractfile("./resources/app/desktop/codec-host.cjs").read()
                assert archive.extractfile("./resources/app/desktop/codec-policy.cjs").read()
                assert archive.extractfile("./resources/app/desktop/codec-source.cjs").read()
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
