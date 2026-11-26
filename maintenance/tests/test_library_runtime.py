#!/usr/bin/env python3
"""Source-only runtime integration regression checks. No compiling/installing.

These tests use synthetic Electron startup/preload source and never touch the
actual installed player's binary, codecs or icons.
"""
import io
import pathlib
import sys
import tarfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"maintenance"))
from library_bundle import LibraryBundle, ORIGINAL, LIBRARY, BOOT
from codec_bundle import CodecBundle

class LibraryRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.bridge=LibraryBundle(ROOT)

    def test_original_player_startup_stays_available_in_second_window(self):
        main=(b'"use strict";\n'
              b'app.setAppUserModelId("org.dksoftworks.dk-kinehall");\n'
              b'const player="/app/docs/index.html";\n'
              b'void win.loadFile(player);\n')
        patched=self.bridge.patch_main(main)
        self.assertNotIn(ORIGINAL,patched)
        self.assertIn(LIBRARY,patched)
        self.assertIn(BOOT,patched)
        self.assertIn(b'dk-kinehall',patched)
        # A later installer run creates a fresh adapter over the patched
        # archive, and must not duplicate the Library Home bootstrap.
        second=LibraryBundle(ROOT).patch_main(patched)
        self.assertEqual(second.count(BOOT),1)
        self.assertEqual(self.bridge.main_count,1)

    def test_original_preload_survives_library_injection(self):
        preload=(b'const {contextBridge}=require("electron");\n'
                 b'contextBridge.exposeInMainWorld("DKStandalone", {});\n')
        once=self.bridge.patch_preload("resources/app/preload.cjs",preload)
        self.assertIn(preload,once)
        self.assertIn(b'exposeInMainWorld("DKLibraryBridge"',once)
        self.assertEqual(once.count(b"DK Kinehall library preload start"),1)

    def test_ambiguous_preload_is_rejected(self):
        preload=(b'const {contextBridge}=require("electron");\n'
                 b'contextBridge.exposeInMainWorld("DKStandalone", {});\n')
        self.bridge.patch_preload("resources/app/preload.cjs",preload)
        with self.assertRaisesRegex(RuntimeError,"More than one"):
            self.bridge.patch_preload("resources/app/extra.cjs",preload)

    def test_empty_codec_backend_never_claims_bundled_decoder(self):
        codecs=CodecBundle(ROOT)
        self.assertFalse(codecs.enabled)
        sample=b'void win.loadFile(player);'
        self.assertEqual(codecs.patch("resources/app/main.cjs",sample),sample)
        codecs.assert_ready()

    def test_patched_window_contains_no_server_dependency(self):
        code=(ROOT/"desktop"/"library-host.cjs").read_text()
        self.assertIn("new BrowserWindow",code)
        self.assertIn("player.loadFile(playerFile",code)
        self.assertIn('dk-library:discover',code)
        self.assertIn('dk-library:delete-video',code)
        self.assertTrue((ROOT/"desktop"/"library-indexer.cjs").is_file())
        self.assertNotIn("jellyfin-server",code)
        self.assertNotIn("plex-server",code)

if __name__=="__main__":
    unittest.main()
