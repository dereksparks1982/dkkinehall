#!/usr/bin/env python3
"""Explicit one-time, local-only OPUS-MT installer. Not invoked by normal updates."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import venv
import zipfile

MODELS = {
    "en-ru": "opus-2020-02-11.zip",
    "ru-en": "opus-2020-02-26.zip",
}
BASE = "https://object.pouta.csc.fi/OPUS-MT-models/"
MAX_DOWNLOAD = 600 * 1024 * 1024
MAX_EXPANDED = 2 * 1024 * 1024 * 1024

def download(url, dest):
    digest = hashlib.sha256()
    total = 0
    with urllib.request.urlopen(url, timeout=60) as response, dest.open("wb") as out:
        if not response.geturl().startswith("https://object.pouta.csc.fi/"):
            raise RuntimeError("Unexpected model download host")
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_DOWNLOAD:
                raise RuntimeError("Model archive exceeds download limit")
            digest.update(chunk)
            out.write(chunk)
    return digest.hexdigest()

def extract(archive, target):
    with zipfile.ZipFile(archive) as source:
        total = sum(info.file_size for info in source.infolist())
        if total > MAX_EXPANDED or len(source.infolist()) > 1000:
            raise RuntimeError("Unexpected OPUS-MT archive size")
        for info in source.infolist():
            dest = (target / info.filename).resolve()
            if not dest.is_relative_to(target.resolve()):
                raise RuntimeError("Invalid model archive path")
            if info.is_dir():
                dest.mkdir(parents=True, exist_ok=True)
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            with source.open(info) as inp, dest.open("wb") as out:
                shutil.copyfileobj(inp, out)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--install", action="store_true", help="explicitly authorize model and wheel downloads")
    args = parser.parse_args()
    if not args.install:
        parser.error("Use --install to authorize the one-time downloads.")
    if sys.platform != "linux" or sys.version_info < (3, 10):
        raise SystemExit("Linux and Python 3.10 or newer required.")
    root = Path(os.environ.get("XDG_DATA_HOME") or Path.home()/".local/share")/"dk-kinehall"/"translation-runtime"
    root.parent.mkdir(parents=True, exist_ok=True)
    if root.exists():
        if (root/"READY.json").is_file():
            print("Offline translation runtime is already installed.")
            return
        raise SystemExit(f"An incomplete runtime exists at {root}; move it aside before retrying.")
    if shutil.disk_usage(root.parent).free < 3 * 1024**3:
        raise SystemExit("At least 3 GiB free space is required for temporary model conversion.")
    root.mkdir(mode=0o700)
    complete = False
    try:
        print("Installing local CPU translation runtime...", flush=True)
        venv.EnvBuilder(with_pip=True).create(root)
        python = root/"bin/python3"
        subprocess.run([str(python),"-m","pip","--disable-pip-version-check","--no-input","install",
                        "--only-binary=:all:","ctranslate2==4.6.0","sentencepiece==0.2.0","PyYAML==6.0.2"],check=True)
        manifest = {"engine":"CTranslate2 4.6.0","tokenizer":"SentencePiece 0.2.0","models":{}}
        for pair, filename in MODELS.items():
            print(f"Preparing OPUS-MT {pair} (INT8)...",flush=True)
            with tempfile.TemporaryDirectory(prefix="dk-opus-",dir=root.parent) as work:
                work = Path(work)
                url = BASE+pair+"/"+filename
                checksum = download(url,work/"model.zip")
                extracted = work/"source"
                extracted.mkdir()
                extract(work/"model.zip",extracted)
                candidates = list(extracted.rglob("source.spm"))
                if len(candidates) != 1:
                    raise RuntimeError("Source tokenizer missing or ambiguous")
                source = candidates[0].parent
                if not (source/"target.spm").is_file():
                    raise RuntimeError("Target tokenizer missing")
                output = root/"models"/pair
                output.mkdir(parents=True)
                subprocess.run([str(root/"bin/ct2-opus-mt-converter"),"--model_dir",str(source),
                                "--output_dir",str(output/"model"),"--quantization","int8"],check=True)
                shutil.copy2(source/"source.spm",output/"source.model")
                shutil.copy2(source/"target.spm",output/"target.model")
                for notice in source.iterdir():
                    if notice.is_file() and notice.name.lower().startswith(("license","notice","readme","copying")):
                        shutil.copy2(notice,output/notice.name)
                manifest["models"][pair]={"source":url,"download_sha256":checksum,
                                          "license":"CC BY 4.0","changes":"Converted to CTranslate2 INT8"}
        notices = """OPUS-MT pretrained models: Helsinki-NLP, University of Helsinki and OPUS contributors.
Source: https://github.com/Helsinki-NLP/OPUS-MT-train
Model license: https://creativecommons.org/licenses/by/4.0/
Changes: converted to CTranslate2 INT8. Source archives and recorded SHA256 are listed in READY.json.
CTranslate2: https://github.com/OpenNMT/CTranslate2 (MIT).
SentencePiece: https://github.com/google/sentencepiece (Apache 2.0).
Python wheel notices remain in the virtual environment's package metadata.
Local installation only; redistribution requires separate complete dependency and model license review.
"""
        (root/"THIRD_PARTY_NOTICES.txt").write_text(notices,encoding="utf-8")
        (root/"READY.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
        complete = True
        print("Offline translation components installed. Restart DK Kinehall.",flush=True)
    finally:
        if not complete:
            shutil.rmtree(root,ignore_errors=True)
if __name__ == "__main__":
    main()
