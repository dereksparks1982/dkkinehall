#!/usr/bin/env python3
"""Maintainer staging for original Chromium Kinehall's bundled codec backend.

Input is a self-contained native FFmpeg/libav bundle produced by the native
packager. Output is desktop-codecs/ for codec_bundle.py to inject into the
ORIGINAL Electron runtime. This script does not install or launch anything.
"""
from pathlib import Path
import os
import re
import shutil
import sys
import tempfile

REQUIRED_DECODERS=(
    "h264","hevc","vp9","av1","mpeg2video","mpeg4",
    "aac","ac3","eac3","dca","truehd","mlp","flac","mp3","opus","vorbis",
)
# VP9/Opus is the license-compatible baseline; MP4/H.264 is optional.
# libx264 must never be required by an LGPL-oriented build.
REQUIRED_ENCODERS=("libvpx-vp9","libopus","aac","webvtt")
REQUIRED_DEMUXERS=("matroska","mov","avi","mpegts","asf","flv")

def codec_lines(text,video_audio=True):
    result=set()
    for line in text.splitlines():
        # FFmpeg -decoders and -encoders use capability flags at the start.
        # Example: " V..... h264  H.264 / AVC ..."
        match=re.match(r"^\s*[VAS][A-Z.]{5}\s+([A-Za-z0-9_-]+)\s",line)
        if match:result.add(match.group(1))
    return result

def read(path):
    if not path.is_file():raise RuntimeError("Missing codec inventory: "+str(path))
    return path.read_text(encoding="utf-8",errors="replace")

def demuxer_lines(text):
    """FFmpeg lists demuxer aliases as a comma-separated group, e.g.
    ' D  mov,mp4,m4a,3gp,3g2,mj2'; all names must be preserved."""
    result=set()
    for line in text.splitlines():
        match=re.match(r"^\s*D\s+([^\s]+)",line)
        if match:
            result.update(part.strip().lower()
                          for part in match.group(1).split(",") if part.strip())
    return result

def verify(source):
    for name in ("ffmpeg","ffprobe"):
        path=source/"bin"/name
        if not path.is_file() or not os.access(path,os.X_OK):
            raise RuntimeError("Bundled codec executable missing: "+name)
        if path.open("rb").read(4)!=b"\x7fELF":
            raise RuntimeError("Not a Linux ELF executable: "+name)
    if not (source/"lib").is_dir():
        raise RuntimeError("Codec bundle has no private shared libraries")
    for stem in ("avcodec","avformat","avutil","swresample","swscale"):
        if not any((source/"lib").glob("lib"+stem+".so.*")):
            raise RuntimeError("Bundled FFmpeg library missing: "+stem)
    decoders=codec_lines(read(source/"CODECS_INCLUDED.txt"))
    encoders=codec_lines(read(source/"ENCODERS_INCLUDED.txt"))
    missed=[x for x in REQUIRED_DECODERS if x not in decoders]
    missed+=["encoder:"+x for x in REQUIRED_ENCODERS if x not in encoders]
    if missed:
        raise RuntimeError("Codec build lacks required capabilities: "+", ".join(missed))
    demux=demuxer_lines(read(source/"CONTAINERS_INCLUDED.txt"))
    missed=[name for name in REQUIRED_DEMUXERS if name not in demux]
    if missed:
        raise RuntimeError("Codec build lacks required demuxers: "+", ".join(missed))
    config=read(source/"FFMPEG_CONFIGURATION.txt")
    # Nonfree/GPL builds may not be redistributed under the expected
    # LGPL-only portable codec terms. Audit licensing separately if needed.
    if re.search(r"(?<!\S)--enable-(?:gpl|nonfree)(?!\S)",config):
        raise RuntimeError("Codec build enables GPL/nonfree components; LGPL bundle rejected")

def stage(root,source):
    root=root.resolve()
    source=source.resolve()
    verify(source)
    output=root/"desktop-codecs"
    temp=Path(tempfile.mkdtemp(prefix=".dk-codecs-",dir=root))
    try:
        (temp/"bin").mkdir()
        for name in ("ffmpeg","ffprobe"):
            shutil.copy2(source/"bin"/name,temp/"bin"/name)
        shutil.copytree(source/"lib",temp/"lib",symlinks=False)
        for filename in (
            "CODECS_INCLUDED.txt","CONTAINERS_INCLUDED.txt",
            "ENCODERS_INCLUDED.txt","FFMPEG_CONFIGURATION.txt",
        ):
            shutil.copy2(source/filename,temp/filename)
        if (root/"THIRD_PARTY_NOTICES.md").is_file():
            shutil.copy2(root/"THIRD_PARTY_NOTICES.md",temp/"THIRD_PARTY_NOTICES.md")
        if output.exists():
            shutil.rmtree(output)
        os.replace(temp,output)
        print("Native codec payload prepared for original Chromium player:",output)
    finally:
        if temp.exists():shutil.rmtree(temp)

if __name__=="__main__":
    if len(sys.argv)!=3:
        raise SystemExit("Maintainer usage: prepare_desktop_codecs.py PROJECT_ROOT NATIVE_BUNDLE")
    stage(Path(sys.argv[1]),Path(sys.argv[2]))
