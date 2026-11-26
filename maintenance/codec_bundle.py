#!/usr/bin/env python3
"""Stage the OPTIONAL bundled native decoder inside the original Electron UI.

All-or-nothing: a codec pack is either fully available and injected into
the original Electron main/preload code, or the portable build is rejected.
It never modifies the approved icon, visible HTML, or player executable.
"""
from pathlib import Path
import os
import tarfile

APP_PREFIX="resources/app/"
HOST="resources/app/desktop/codec-host.cjs"
PRELOAD="resources/app/desktop/codec-preload.cjs"
BOOT=b'require("./desktop/codec-host.cjs").install(win);'
MAIN_ANCHOR=b"void win.loadFile(player);"
LIBRARY_ANCHOR=b'void win.loadFile(player.replace(/index\\.html$/, "library.html"));'

class CodecBundle:
    def __init__(self,root):
        self.root=Path(root)
        self.bundle=self.root/"desktop-codecs"
        self.sources=self.root/"desktop"
        self.enabled=self.bundle.is_dir()
        self.main_done=False
        self.preload_done=False
        self.main_count=0
        self.preload_count=0
        self.extra={}
        if not self.enabled:
            return
        required=[
            self.sources/"codec-host.cjs",
            self.sources/"codec-preload.cjs",
            self.sources/"codec-policy.cjs",
            self.bundle/"bin/ffmpeg",
            self.bundle/"bin/ffprobe",
            self.bundle/"CODECS_INCLUDED.txt",
            self.bundle/"CONTAINERS_INCLUDED.txt",
            self.bundle/"ENCODERS_INCLUDED.txt",
            self.bundle/"FFMPEG_CONFIGURATION.txt",
        ]
        missing=[str(p) for p in required if not p.is_file()]
        if missing:raise RuntimeError("Incomplete bundled native codec backend: "+", ".join(missing))
        if not os.access(self.bundle/"bin/ffmpeg",os.X_OK) or \
           not os.access(self.bundle/"bin/ffprobe",os.X_OK):
            raise RuntimeError("FFmpeg and FFprobe must be executable")
        if not (self.bundle/"lib").is_dir():
            raise RuntimeError("Bundled native FFmpeg shared libraries are missing")
        for lib in ("avcodec","avformat","avutil","swresample","swscale"):
            if not any((self.bundle/"lib").glob("lib"+lib+".so.*")):
                raise RuntimeError("Missing bundled codec library: "+lib)
        self.extra={
            HOST:self.sources/"codec-host.cjs",
            PRELOAD:self.sources/"codec-preload.cjs",
            "resources/app/desktop/codec-policy.cjs":
                self.sources/"codec-policy.cjs",
        }
        for p in sorted(self.bundle.rglob("*")):
            if not p.is_file() or p.is_symlink():continue
            rel=p.relative_to(self.bundle).as_posix()
            if rel.startswith(("../","./")) or ".." in Path(rel).parts:
                raise RuntimeError("Unsafe portable codec member: "+rel)
            self.extra[APP_PREFIX+rel]=p
        if len(self.extra)>2500:
            raise RuntimeError("Native codec bundle has too many files")

    def patch(self,name,data):
        if not self.enabled:return data
        if name=="resources/app/main.cjs":
            self.main_count+=1
            marker=MAIN_ANCHOR if MAIN_ANCHOR in data else LIBRARY_ANCHOR
            if data.count(marker)!=1:
                raise RuntimeError("Cannot find unique approved Chromium player bootstrap")
            # Codec IPC is installed by desktop/library-host.cjs on each
            # actual Player window. Never attach it to the Library Home.
            self.main_done=True
        elif name.startswith(APP_PREFIX) and name.endswith((".cjs",".js")) and \
             name!="resources/app/main.cjs":
            # Electron normally gives exactly one preload the DKStandalone
            # contextBridge capability. Do not replace or remove its APIs.
            if b"DKStandalone" in data and b"exposeInMainWorld" in data:
                self.preload_count+=1
                if self.preload_count>1:
                    raise RuntimeError("Ambiguous Electron preload bridge")
                # Electron's sandboxed preload may not allow requiring a
                # custom local module. Append inside a private function
                # scope to avoid collisions with its original declarations.
                payload=self.sources.joinpath("codec-preload.cjs").read_bytes()
                marker=b"/* DK Kinehall bundled decoder bridge */"
                if marker not in data:
                    data+=b"\n;"+marker+b"\n(function(){\n"+payload+b"\n})();\n"
                self.preload_done=True
        return data

    def assert_ready(self):
        if self.enabled and not(self.main_done and self.preload_done and
                                self.main_count==1 and self.preload_count==1):
            raise RuntimeError("Original Chromium codec main/preload integration incomplete")

    def add_entries(self,archive,already_present=()):
        if not self.enabled:return
        present=set(already_present)
        for dest,src in sorted(self.extra.items()):
            if dest in present:
                # An earlier installed codec bundle is replaced in the
                # main archive loop; do not create a duplicate tar member.
                continue
            stat=src.stat()
            if stat.st_size>300*1024*1024:
                raise RuntimeError("Unusually large codec payload: "+dest)
            info=tarfile.TarInfo("./"+dest)
            info.size=stat.st_size
            info.mode=0o755 if os.access(src,os.X_OK) else 0o644
            info.mtime=int(stat.st_mtime)
            with src.open("rb") as inp:
                archive.addfile(info,inp)
