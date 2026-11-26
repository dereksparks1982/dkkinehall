#!/usr/bin/env python3
"""Explicit one-time local setup using an independently approved CLI candidate.

No downloads, builds, automatic execution of the engine or changes to the
installed player. The supplied digest must come from the maintainer's audit,
not from an untrusted candidate directory.
"""
import argparse
import json
from pathlib import Path
import platform
import re
import subprocess
import sys

from build_speech_engine_linux import COMMIT, VERSION

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--candidate", type=Path, required=True)
    p.add_argument("--approved-cli-sha256", required=True)
    p.add_argument("--model", type=Path, required=True)
    p.add_argument("--model-license", type=Path, required=True)
    args = p.parse_args()
    digest = args.approved_cli_sha256.lower()
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        p.error("Invalid independently approved CLI checksum")
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        p.error("Linux x86-64 required")
    cpu = Path("/proc/cpuinfo").read_text(encoding="utf-8")
    features = [set(line.partition(":")[2].split()) for line in cpu.splitlines()
                if line.partition(":")[0].strip() == "flags"]
    if not features or not all({"avx", "avx2", "fma", "f16c"} <= flags for flags in features):
        p.error("This speech engine candidate requires AVX2, AVX, FMA and F16C")
    root = args.candidate.resolve(strict=True)
    manifest = root / "BUILD.json"
    if manifest.is_symlink() or not manifest.is_file() or manifest.stat().st_size > 65536:
        p.error("Invalid candidate manifest")
    data = json.loads(manifest.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or any(data.get(k) != v for k, v in {
        "schema": 1, "sourceCommit": COMMIT, "version": VERSION,
        "architecture": "linux-x86_64-avx2-fma-f16c", "cliSha256": digest,
    }.items()):
        p.error("Candidate does not match the pinned build and approved checksum")
    # Reuse the existing staging implementation, which verifies actual bytes,
    # includes license notices and refuses to overwrite an existing runtime.
    stage = Path(__file__).resolve().with_name("stage_speech_runtime_linux.py")
    subprocess.run([sys.executable, str(stage), "--cli", str(root / "whisper-cli"),
                    "--cli-sha256", digest, "--model", str(args.model),
                    "--engine-license", str(root / "whisper-cpp-LICENSE.txt"),
                    "--model-license", str(args.model_license)], check=True)
    print("Setup staged. Actual transcription and codec availability still need verification.")

if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise SystemExit(f"Offline speech setup failed: {error}")
