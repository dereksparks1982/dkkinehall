#!/usr/bin/env python3
"""Maintainer-only complete codec release asset builder.

Source: a fully built, audited native codec bundle with FFmpeg and FFprobe.
Output: a checksum-pinned GitHub Release candidate archive containing only
the private codec payload needed by the EXISTING Chromium player.
Does not activate the release gate, install the player, or upload a release.
"""
from pathlib import Path
import hashlib
import os
import sys
import tarfile
import tempfile

from prepare_desktop_codecs import stage, verify

CHUNK=1024*1024
MAX_ARCHIVE=950*1024*1024

def write_archive(project,outdir):
    root=project/"desktop-codecs"
    verify(root)
    outdir.mkdir(parents=True,exist_ok=True)
    dest=outdir/"dk-kinehall-desktop-codecs-linux-x86_64.tar.gz"
    temp=dest.with_suffix(dest.suffix+".tmp")
    try:
        with tarfile.open(temp,"w:gz",compresslevel=5) as archive:
            root_info=tarfile.TarInfo("desktop-codecs")
            root_info.type=tarfile.DIRTYPE
            root_info.mode=0o755
            root_info.mtime=0
            archive.addfile(root_info)
            files=sorted(p for p in root.rglob("*") if p.is_file() and not p.is_symlink())
            if len(files)>3499:raise RuntimeError("Too many files for verified codec asset")
            for path in files:
                relative=path.relative_to(root).as_posix()
                info=tarfile.TarInfo("desktop-codecs/"+relative)
                info.size=path.stat().st_size
                info.mode=0o755 if relative in ("bin/ffmpeg","bin/ffprobe") else 0o644
                info.mtime=0
                with path.open("rb") as infile:
                    archive.addfile(info,infile)
        if temp.stat().st_size>MAX_ARCHIVE:
            raise RuntimeError("Codec asset exceeds updater's release size limit")
        sha=hashlib.sha256()
        with temp.open("rb") as infile:
            while block:=infile.read(CHUNK):
                sha.update(block)
        os.replace(temp,dest)
        (outdir/(dest.name+".sha256")).write_text(
            sha.hexdigest()+"  "+dest.name+"\n",encoding="utf-8")
        return dest,sha.hexdigest()
    finally:
        if temp.exists():temp.unlink()

def main(args):
    if len(args)!=3:
        raise SystemExit("Maintainer usage: build_codec_release_asset.py PROJECT_ROOT NATIVE_BUNDLE OUTPUT_DIR")
    project,native,outdir=map(lambda value:Path(value).resolve(),args)
    stage(project,native)
    dest,digest=write_archive(project,outdir)
    print("Codec release candidate:",dest)
    print("Codec archive SHA-256:",digest)
    print("IMPORTANT: The user-update release gate remains CLOSED until all acceptance checks pass.")

if __name__=="__main__":
    main(sys.argv[1:])
