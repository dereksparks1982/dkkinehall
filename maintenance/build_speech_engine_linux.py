#!/usr/bin/env python3
"""Maintainer-only, explicitly invoked build recipe for the offline ASR engine.

Requires an independently obtained, audited local Whisper.cpp Git checkout and
existing Linux build tools. Does not fetch sources/models, install packages,
run the engine, update DK Kinehall, or publish a release.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tempfile

from stage_speech_runtime_linux import copy_checked

COMMIT = "371b5a7561823ab2bb32142d2751e35e7534727b"
VERSION = "v1.9.3"
FLAGS = {
    "CMAKE_BUILD_TYPE": "Release",
    "BUILD_SHARED_LIBS": "OFF",
    "WHISPER_BUILD_IS_DEV": "OFF",
    "WHISPER_BUILD_TESTS": "OFF",
    "WHISPER_BUILD_EXAMPLES": "ON",
    "WHISPER_BUILD_SERVER": "OFF",
    "WHISPER_USE_SYSTEM_GGML": "OFF",
    "WHISPER_USE_SYSTEM_LLAMA": "OFF",
    "WHISPER_CURL": "OFF",
    "WHISPER_SDL2": "OFF",
    "WHISPER_COMMON_FFMPEG": "OFF",
    "WHISPER_COREML": "OFF",
    "WHISPER_OPENVINO": "OFF",
    "GGML_NATIVE": "OFF",
    "GGML_BACKEND_DL": "OFF",
    "GGML_CPU_ALL_VARIANTS": "OFF",
    "GGML_CPU": "ON",
    "GGML_AVX": "ON",
    "GGML_AVX2": "ON",
    "GGML_FMA": "ON",
    "GGML_F16C": "ON",
    "GGML_OPENMP": "OFF",
    "GGML_BLAS": "OFF",
    "GGML_CUDA": "OFF",
    "GGML_HIP": "OFF",
    "GGML_METAL": "OFF",
    "GGML_VULKAN": "OFF",
    "GGML_SYCL": "OFF",
    "GGML_OPENCL": "OFF",
    "GGML_RPC": "OFF",
    "FETCHCONTENT_FULLY_DISCONNECTED": "ON",
}
# Standard Linux runtime libraries only; no separately installed ggml/whisper,
# BLAS, GPU or compiler parallelism libraries are permitted in this candidate.
ALLOWED_LIBS = {"libc.so.6", "libm.so.6", "libstdc++.so.6", "libgcc_s.so.1",
                "libpthread.so.0", "libdl.so.2", "librt.so.1",
                "ld-linux-x86-64.so.2"}

def run(*argv, capture=False):
    return subprocess.run(argv, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None,
                          stdin=subprocess.DEVNULL, timeout=3600).stdout

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True,
                   help="New directory for the candidate CLI and audit records")
    args = p.parse_args()
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        p.error("Linux x86-64 build host required")
    for tool in ("git", "cmake", "readelf"):
        if not shutil.which(tool):
            p.error(f"Required maintainer tool unavailable: {tool}")
    source = args.source.resolve(strict=True)
    output = args.output.absolute()
    if os.path.lexists(output):
        p.error("Output already exists; refusing overwrite")
    if source == output or source in output.parents:
        p.error("Output must be outside the upstream checkout")
    if run("git", "-C", str(source), "rev-parse", "HEAD", capture=True).strip() != COMMIT:
        p.error("Upstream checkout does not match the pinned commit")
    if run("git", "-C", str(source), "status", "--porcelain", "--untracked-files=all",
           capture=True).strip():
        p.error("Upstream checkout has local changes")
    output.parent.mkdir(parents=True, exist_ok=True)
    # Build in a fresh temporary directory, not the source checkout. Only the
    # whisper-cli target is built, with two jobs for limited-memory Linux hosts.
    with tempfile.TemporaryDirectory(prefix=".dk-whisper-build-", dir=output.parent) as tmp:
        build = Path(tmp) / "build"
        run("cmake", "-S", str(source), "-B", str(build),
            *[f"-D{k}={v}" for k, v in FLAGS.items()])
        run("cmake", "--build", str(build), "--config", "Release",
            "--target", "whisper-cli", "--parallel", "2")
        cli = build / "bin/whisper-cli"
        header = run("readelf", "-h", str(cli), capture=True)
        dynamic = run("readelf", "-d", str(cli), capture=True)
        versions = run("readelf", "--version-info", str(cli), capture=True)
        interpreter = run("readelf", "-l", str(cli), capture=True)
        if "ELF64" not in header or "X86-64" not in header.upper():
            raise ValueError("Unexpected executable architecture")
        needed = sorted(set(re.findall(r"\(NEEDED\).*?\[(.*?)\]", dynamic)))
        if set(needed) - ALLOWED_LIBS:
            raise ValueError("Unexpected shared dependencies: " +
                             ", ".join(sorted(set(needed) - ALLOWED_LIBS)))
        if re.search(r"\((?:RPATH|RUNPATH)\)", dynamic):
            raise ValueError("Unexpected runtime library search path")
        match = re.search(r"Requesting program interpreter:\s*([^\]]+)", interpreter)
        if match and match.group(1) not in ("/lib64/ld-linux-x86-64.so.2",
                                             "/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2"):
            raise ValueError("Unexpected ELF interpreter")
        candidate = Path(tmp) / "candidate"
        candidate.mkdir(mode=0o700)
        digest = copy_checked(cli, candidate / "whisper-cli", 128 * 1024 * 1024,
                              executable=True)
        copy_checked(source / "LICENSE", candidate / "whisper-cpp-LICENSE.txt", 1024 * 1024)
        (candidate / "ELF-AUDIT.txt").write_text(
            header + "\n" + dynamic + "\n" + interpreter + "\n" + versions,
            encoding="utf-8")
        (candidate / "BUILD.json").write_text(json.dumps({
            "schema": 1, "version": VERSION, "sourceCommit": COMMIT,
            "architecture": "linux-x86_64-avx2-fma-f16c",
            "cliSha256": digest, "sharedLibraries": needed,
            "cmakeOptions": FLAGS, "runtimeVerified": False,
            "redistributionApproved": False
        }, indent=2) + "\n", encoding="utf-8")
        if os.path.lexists(output):
            raise FileExistsError("Output already exists")
        candidate.rename(output)
    print("Candidate CLI and ELF audit recorded; not installed or accepted.")

if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise SystemExit(f"Speech engine build failed: {error}")
