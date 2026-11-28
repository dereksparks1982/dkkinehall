"""Integrate the local Library Home with the existing Electron runtime.

Never replace the approved player, its video element, native launcher or icons.
The original BrowserWindow hosts a persistent internal Player view.
"""
from pathlib import Path
import io
import re
import os
import tarfile
import shutil
import subprocess
import tempfile

PREFIX="resources/app/"
MAIN="resources/app/main.cjs"
HOST="resources/app/desktop/library-host.cjs"
INDEXER="resources/app/desktop/library-indexer.cjs"
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
        self.indexer=self.root/"desktop"/"library-indexer.cjs"
        missing=[str(p) for p in (self.host,self.preload,self.indexer)
                 if not p.is_file()]
        if missing:raise RuntimeError("Library Home runtime sources missing: "+", ".join(missing))
        self.assert_portrait_cards()
        self.dvb_binary=None
        self.dvb_temp=None
        self.main_count=0
        self.preload_count=0

    def assert_portrait_cards(self):
        """Reject non-portrait aspect-ratio declarations on media card artwork."""
        targets = {
            "library-home.css": (".library-poster", ".dk-online-art-card img", ".dk-person-card img"),
            "player.css": (".queue-artwork",),
            "live-tv.css": (".dk-live-art", ".dk-live-card"),
        }
        for name, selectors in targets.items():
            css = (self.root / "docs" / name).read_text(encoding="utf-8")
            css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
            found = set()
            for selector, body in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
                ratios = re.findall(r"(?:^|;)\s*aspect-ratio\s*:\s*([^;]+)", body)
                for target in selectors:
                    if not re.search(re.escape(target) + r"(?![\w-])", selector):
                        continue
                    for ratio in ratios:
                        normalized = re.sub(r"\s+|!important", "", ratio)
                        if normalized != "2/3":
                            raise RuntimeError("Non-portrait media card in " + name + ": " + selector.strip())
                        found.add(target)
            if found != set(selectors):
                raise RuntimeError("Missing portrait media-card invariant in " + name)

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
            raise RuntimeError("Library Home/player wiring is incomplete")

    def prepare_dvb(self):
        source=self.root/"desktop"/"dvb"
        compiler=shutil.which("c++")
        if not compiler:
            print("ATSC helper not built: C++ compiler unavailable; existing player remains usable.")
            return
        self.dvb_temp=tempfile.TemporaryDirectory(prefix="dk-atsc-")
        binary=Path(self.dvb_temp.name)/"dk-atsc"
        try:
            subprocess.run([compiler,"-std=c++17","-O2","-pthread",
                str(source/"dk-atsc.cpp"),str(source/"tuner_backend.cpp"),"-o",str(binary)],
                check=True,timeout=180)
            self.dvb_binary=binary
        except (OSError,subprocess.SubprocessError) as exc:
            print("ATSC helper unavailable:",exc)
    def add_dvb(self,archive):
        if not self.dvb_binary:return
        data=self.dvb_binary.read_bytes()
        info=tarfile.TarInfo("./resources/app/bin/dk-atsc")
        info.size=len(data);info.mode=0o755
        archive.addfile(info,io.BytesIO(data))
        self.dvb_temp.cleanup()
    def add_host(self,archive,existing):
        for name,source in ((HOST,self.host),(INDEXER,self.indexer)):
            if name in existing:continue
            content=source.read_bytes()
            info=tarfile.TarInfo("./"+name)
            info.size=len(content)
            info.mode=0o644
            archive.addfile(info,io.BytesIO(content))
