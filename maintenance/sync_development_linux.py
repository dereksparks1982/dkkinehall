#!/usr/bin/env python3
"""Explicit local development install, not a release or redistributable package."""
import os
import shutil
import subprocess
import sys
from pathlib import Path
import sync_original_runtime as sync
from codec_bundle import CodecBundle, APP_PREFIX, HOST, PRELOAD

class LocalCodecBundle(CodecBundle):
    def __init__(self, root):
        super().__init__(root)
        if self.enabled:
            raise RuntimeError("Local development checkout must not contain a release codec payload")
        tools={name:shutil.which(name) for name in ("ffmpeg","ffprobe")}
        if not all(tools.values()):
            print("NOTICE: System FFmpeg/FFprobe unavailable; updating navigation and player UI only.",flush=True)
            return
        binaries={name:Path(value).resolve() for name,value in tools.items()}
        for binary in binaries.values():
            with binary.open("rb") as stream:
                if stream.read(4)!=b"\x7fELF":
                    raise RuntimeError("Local codec tool is not a Linux ELF executable")
            subprocess.run([str(binary),"-version"],check=True,stdout=subprocess.DEVNULL,timeout=15)
        self.enabled=True
        # Local-only binaries use the operating system's shared libraries.
        # Never present this configuration as the verified release bundle.
        host=self.sources/"codec-host.cjs"
        content=host.read_text(encoding="utf-8")
        anchor='LD_LIBRARY_PATH:libs+path.delimiter+(process.env.LD_LIBRARY_PATH||""),'
        if content.count(anchor)!=1:
            raise RuntimeError("Cannot safely configure local codec library lookup")
        host.write_text(content.replace(anchor,'LD_LIBRARY_PATH:"",'),encoding="utf-8")
        self.extra={
            HOST:host,
            PRELOAD:self.sources/"codec-preload.cjs",
            APP_PREFIX+"desktop/codec-policy.cjs":self.sources/"codec-policy.cjs",
            APP_PREFIX+"desktop/codec-source.cjs":self.sources/"codec-source.cjs",
            **{APP_PREFIX+"bin/"+name:binary for name,binary in binaries.items()}
        }
        print("Local test only: using existing system FFmpeg and FFprobe.",flush=True)

if __name__=="__main__":
    if len(sys.argv)!=3:raise SystemExit("Usage: sync_development_linux.py INSTALL_ROOT SOURCE_ROOT")
    sync.CodecBundle=LocalCodecBundle
    sync.sync(Path(sys.argv[1]),Path(sys.argv[2]))
