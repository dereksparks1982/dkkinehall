#!/usr/bin/env python3
"""Release-only codec payload retrieval for the original DK Kinehall player.

Not called for development builds. The release gate MUST be fully accepted,
and the codec bundle must be published as a checksum-pinned GitHub release
asset in the same repository. Uses Python's standard library, never curl.
No installation files are modified while this script is running.
"""
import hashlib
import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath

MAX_DOWNLOAD=950*1024*1024
MAX_UNPACKED=1500*1024*1024
MAX_MEMBERS=3500
BUFFER=1024*1024

def verify_release_gate(path):
    manifest=json.loads(path.read_text(encoding="utf-8"))
    checks=manifest.get("acceptance",{})
    if manifest.get("release_ready") is not True or not checks or \
       not all(value is True for value in checks.values()):
        raise RuntimeError("Standalone release gate is closed")
    asset=manifest.get("codec_bundle_asset_url")
    digest=manifest.get("codec_bundle_asset_sha256")
    if not isinstance(asset,str) or not isinstance(digest,str) or \
       not re.fullmatch(r"[0-9a-f]{64}",digest):
        raise RuntimeError("Accepted codec release asset and SHA-256 are required")
    url=urllib.parse.urlparse(asset)
    if url.scheme!="https" or url.hostname!="github.com" or \
       url.username or url.password or url.port or \
       url.query or url.fragment or \
       not url.path.startswith("/dereksparks1982/dkkinehall/releases/download/") or \
       not url.path.endswith(".tar.gz"):
        raise RuntimeError("Codec archive must be a DK Kinehall GitHub release asset")
    return asset,digest

def download(url,target,digest):
    checksum=hashlib.sha256()
    size=0
    req=urllib.request.Request(url,headers={"User-Agent":"DK-Kinehall-release-updater"})
    with urllib.request.urlopen(req,timeout=120) as reply, target.open("wb") as output:
        while True:
            data=reply.read(BUFFER)
            if not data:break
            size+=len(data)
            if size>MAX_DOWNLOAD:
                raise RuntimeError("Codec archive exceeds the maximum supported size")
            checksum.update(data)
            output.write(data)
    if not size or checksum.hexdigest()!=digest:
        raise RuntimeError("Codec archive SHA-256 mismatch. Player unchanged")

def unpack(archive,staging):
    count=0
    size=0
    with tarfile.open(archive,"r:gz") as bundle:
        for member in bundle:
            count+=1
            if count>MAX_MEMBERS:
                raise RuntimeError("Too many codec archive entries")
            parts=PurePosixPath(member.name).parts
            if not parts or parts[0]!="desktop-codecs" or any(
                part in ("..",".","") for part in parts):
                raise RuntimeError("Codec archive has an unexpected path")
            if len(parts)==1:
                if not member.isdir():raise RuntimeError("Invalid archive root")
                continue
            if member.isdir():
                (staging.joinpath(*parts[1:])).mkdir(parents=True,exist_ok=True)
                continue
            if not member.isfile() or member.size<0:
                raise RuntimeError("Codec archive contains unsupported special entries")
            size+=member.size
            if size>MAX_UNPACKED:
                raise RuntimeError("Unpacked codec files exceed the safety limit")
            target=staging.joinpath(*parts[1:])
            target.parent.mkdir(parents=True,exist_ok=True)
            source=bundle.extractfile(member)
            if source is None:raise RuntimeError("Invalid codec archive member")
            with source,target.open("wb") as output:
                remaining=member.size
                while remaining>0:
                    block=source.read(min(BUFFER,remaining))
                    if not block:raise RuntimeError("Truncated codec archive member")
                    output.write(block)
                    remaining-=len(block)
            target.chmod(0o755 if target.relative_to(staging).as_posix() in (
                "bin/ffmpeg","bin/ffprobe") else 0o644)
    if not count:raise RuntimeError("Codec archive is empty")

def main(root):
    root=root.resolve()
    asset,digest=verify_release_gate(root/"maintenance/release-gate.json")
    if (root/"desktop-codecs").exists():
        raise RuntimeError("Refusing to overwrite a preexisting codec bundle")
    with tempfile.TemporaryDirectory(prefix=".dk-release-codecs-",dir=root) as temp:
        work=Path(temp)
        archive=work/"codecs.tar.gz"
        staging=work/"desktop-codecs"
        staging.mkdir()
        download(asset,archive,digest)
        unpack(archive,staging)
        from prepare_desktop_codecs import verify
        verify(staging)
        os.replace(staging,root/"desktop-codecs")
    print("Verified full standalone codec payload. Runtime integration may proceed.")

if __name__=="__main__":
    if len(sys.argv)!=2:raise SystemExit("Maintainer internal usage: fetch_release_codecs.py REPO_ROOT")
    try: main(Path(sys.argv[1]))
    except Exception as error:raise SystemExit("ERROR: "+str(error))
