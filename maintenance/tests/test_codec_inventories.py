#!/usr/bin/env python3
"""Codec inventory and packaging safety checks using synthetic fixtures.

No downloading, compiling, installing or real media playback.
"""
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"maintenance"))
from prepare_desktop_codecs import (
    demuxer_lines,codec_lines,verify,REQUIRED_DECODERS,
    REQUIRED_ENCODERS,REQUIRED_DEMUXERS,
)

class CodecInventoryTest(unittest.TestCase):
    def test_demuxer_aliases(self):
        inventory="""File formats:
  D. = Demuxing supported
 --
 D  matroska,webm           Matroska/WebM
 D  mov,mp4,m4a,3gp,3g2,mj2 QuickTime
 D  avi AVI
 D  mpegts MPEG transport stream
 D  asf ASF
 D  flv FLV
"""
        names=demuxer_lines(inventory)
        self.assertTrue(set(REQUIRED_DEMUXERS).issubset(names))
        self.assertIn("webm",names)
        self.assertIn("mp4",names)

    def make_bundle(self,root,gpl=False):
        (root/"bin").mkdir()
        (root/"lib").mkdir()
        for name in ("ffmpeg","ffprobe"):
            binary=root/"bin"/name
            binary.write_bytes(b"\x7fELF synthetic test fixture")
            binary.chmod(0o755)
        for stem in ("avcodec","avformat","avutil","swresample","swscale"):
            (root/"lib"/("lib"+stem+".so.99")).write_bytes(
                b"\x7fELF synthetic test fixture")
        video={"h264","hevc","vp9","av1","mpeg2video","mpeg4"}
        decoders="\n".join(
            (" V..... " if x in video else " A..... ")+x+"  test decoder"
            for x in REQUIRED_DECODERS)+"\n"
        encoders="\n".join(
            (" S..... " if x=="webvtt" else
             " A..... " if x=="libopus" else " V..... ")+x+" test encoder"
            for x in REQUIRED_ENCODERS)+"\n"
        demuxers="\n".join(" D  "+name+" test demuxer"
                           for name in REQUIRED_DEMUXERS)+"\n"
        (root/"CODECS_INCLUDED.txt").write_text(decoders,encoding="utf-8")
        (root/"ENCODERS_INCLUDED.txt").write_text(encoders,encoding="utf-8")
        (root/"CONTAINERS_INCLUDED.txt").write_text(
            demuxers,encoding="utf-8")
        (root/"FFMPEG_CONFIGURATION.txt").write_text(
            "configuration: --enable-libvpx --enable-libopus "+
            ("--enable-gpl" if gpl else "--disable-gpl"),
            encoding="utf-8")

    def test_complete_lgpl_inventory_is_accepted(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            self.make_bundle(root)
            verify(root)

    def test_missing_encoder_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            self.make_bundle(root)
            enc=root/"ENCODERS_INCLUDED.txt"
            enc.write_text(enc.read_text().replace("libopus","missing_opus"))
            with self.assertRaisesRegex(RuntimeError,"encoder:libopus"):
                verify(root)

    def test_gpl_packaging_is_not_mislabeled_lgpl(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            self.make_bundle(root,gpl=True)
            with self.assertRaisesRegex(RuntimeError,"GPL/nonfree"):
                verify(root)

if __name__=="__main__":
    unittest.main()
