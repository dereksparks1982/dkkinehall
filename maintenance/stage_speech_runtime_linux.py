#!/usr/bin/env python3
"""Stage an explicitly supplied offline speech runtime; maintainer development only.

No network, build, execution of supplied binaries, sudo, or replacement of an
existing runtime. The maintainer must independently audit the CLI and its digest.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile

ENGINE = "whisper.cpp v1.9.3"
ENGINE_RELEASE = "https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.3"
MODEL_REVISION = "fb5ed9369c26eaf08392504d8446da431e0fffb9"
MODEL_SHA256 = "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"
MODEL_BYTES = 147951465

def copy_checked(source, target, limit, expected=None, size=None, executable=False):
    # Read only regular files; do not follow input symlinks.
    with os.fdopen(os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as src:
        info = os.fstat(src.fileno())
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= limit:
            raise ValueError(f"Invalid input file: {source}")
        if size is not None and info.st_size != size:
            raise ValueError(f"Unexpected input size: {source}")
        digest = hashlib.sha256()
        count = 0
        with target.open("xb") as dst:
            while chunk := src.read(1024 * 1024):
                count += len(chunk)
                if count > limit:
                    raise ValueError("Input exceeds limit")
                digest.update(chunk)
                dst.write(chunk)
        if count != info.st_size or (size is not None and count != size):
            raise ValueError("Input changed during copying")
        actual = digest.hexdigest()
        if expected is not None and actual != expected:
            raise ValueError(f"SHA-256 mismatch: {source}")
    target.chmod(0o700 if executable else 0o600)
    return actual

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", required=True, type=Path)
    parser.add_argument("--cli-sha256", required=True,
                        help="Independently recorded SHA-256 of audited Linux CLI")
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--engine-license", required=True, type=Path)
    parser.add_argument("--model-license", required=True, type=Path)
    args = parser.parse_args()
    cli_hash = args.cli_sha256.lower()
    if not re.fullmatch(r"[0-9a-f]{64}", cli_hash):
        parser.error("CLI SHA-256 must contain exactly 64 hexadecimal digits")
    xdg = os.environ.get("XDG_DATA_HOME")
    data = Path(xdg) if xdg and Path(xdg).is_absolute() else Path.home() / ".local/share"
    parent = data / "dk-kinehall"
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination = parent / "speech-runtime"
    lock = parent / ".speech-runtime-install.lock"
    lock.mkdir(mode=0o700)
    stage = None
    try:
        if os.path.lexists(destination):
            raise FileExistsError("Existing speech runtime retained; no replacement attempted")
        stage = Path(tempfile.mkdtemp(prefix=".speech-runtime-", dir=parent))
        for directory in ("bin", "models", "licenses"):
            (stage / directory).mkdir(mode=0o700)
        cli = stage / "bin/whisper-cli"
        copy_checked(args.cli, cli, 128 * 1024 * 1024, cli_hash, executable=True)
        with cli.open("rb") as stream:
            header = stream.read(20)
        if len(header) != 20 or header[:6] != b"\x7fELF\x02\x01" or header[18:20] != b"\x3e\x00":
            raise ValueError("Expected a Linux x86-64 ELF executable")
        copy_checked(args.model, stage / "models/ggml-base.bin",
                     MODEL_BYTES, MODEL_SHA256, MODEL_BYTES)
        copy_checked(args.engine_license, stage / "licenses/whisper-cpp.txt", 1024 * 1024)
        copy_checked(args.model_license, stage / "licenses/whisper-model.txt", 1024 * 1024)
        # This marker means staged, not tested or accepted. The app checks its
        # codec prerequisites separately. No runtime execution occurs here.
        manifest = {
            "schema": 1, "engine": ENGINE, "engineRelease": ENGINE_RELEASE,
            "cliSha256": cli_hash, "modelRevision": MODEL_REVISION,
            "modelSha256": MODEL_SHA256, "modelBytes": MODEL_BYTES,
            "languages": ["en", "ru"], "runtimeVerified": False,
        }
        marker = stage / "READY.json"
        marker.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        marker.chmod(0o600)
        if os.path.lexists(destination):
            raise FileExistsError("Existing speech runtime retained")
        stage.rename(destination)
        stage = None
        print("Offline speech runtime staged; actual transcription is not verified.")
    finally:
        if stage is not None:
            shutil.rmtree(stage)
        lock.rmdir()

if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        raise SystemExit(f"Speech runtime staging failed: {error}")
