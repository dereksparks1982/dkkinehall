"""Integrate the local Library Home with the existing Electron runtime.

Never replace the approved player, its video element, native launcher or icons.
The only new window is a second BrowserWindow loading the EXISTING index.html.
"""
from pathlib import Path
import io
import os
import tarfile

PREFIX="resources/app/"
MAIN="resources/app/main.cjs"
HOST="resources/app/desktop/library-host.cjs"
MARKER=b"/* DK Kinehall library preload start */"
END=b"/* DK Kinehall library preload end */"
ORIGINAL=b"void win.loadFile(player);"
LIBRARY=b'void win.loadFile(player.replace(/index\\.html$/, "library.html"));'
BOOT=b'require("./desktop/library-host.cjs").install(win, player);'

class LibraryBundle:
    def __init__(self,source_root):
        self.root=Path(source_root)
        self.host=self.root/"desktop"/"library-host.cjs"
        self.preload=self.root/"desktop"/"library-preload.cjs"
        missing=[str(p) for p in (self.host,self.preload) if not p.is_file()]
        if missing:raise RuntimeError("Library Home runtime sources missing: "+", ".join(missing))
        self.main_count=0
        self.preload_count=0

    def patch_main(self,data):
        self.main_count+=1
        if self.main_count!=1:
            raise RuntimeError("Ambiguous main Electron runtime")
        if ORIGINAL in data:
            if data.count(ORIGINAL)!=1:
                raise RuntimeError("Original player window bootstrap must be unique")
            data=data.replace(ORIGINAL,LIBRARY+b"\n"+BOOT,1)
        elif LIBRARY in data:
            if BOOT not in data:raise RuntimeError("Library Home bootstrap incomplete")
        else:
            raise RuntimeError("Cannot identify approved Chromium player entrypoint")
        return data

    def patch_preload(self,name,data):
        if name==MAIN or not name.startswith(PREFIX) or \
           not name.endswith((".js",".cjs")) or "/node_modules/" in name:
            return data
        if b"DKStandalone" not in data or b"exposeInMainWorld" not in data:
            return data
        self.preload_count+=1
        if self.preload_count>1:
            raise RuntimeError("More than one DKStandalone preload found")
        embedded=b"\n"+MARKER+b"\n(function(){\n"+self.preload.read_bytes()+ \
          b"\n})();\n"+END+b"\n"
        if MARKER in data:
            first=data.index(MARKER)
            last=data.find(END,first)
            if last<0:raise RuntimeError("Incomplete existing library preload")
            data=data[:first]+embedded+data[last+len(END):]
        else:
            data+=embedded
        return data

    def assert_ready(self):
        if self.main_count!=1 or self.preload_count!=1:
            raise RuntimeError("Library Home/player two-window wiring is incomplete")

    def add_host(self,archive,existing):
        if HOST in existing:return
        content=self.host.read_bytes()
        info=tarfile.TarInfo("./"+HOST)
        info.size=len(content)
        info.mode=0o644
        archive.addfile(info,io.BytesIO(content))
