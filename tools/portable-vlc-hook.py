"""PyInstaller runtime hook: keep the bundled VLC binary and plugins local."""
from __future__ import annotations
import os
import sys
from pathlib import Path

bundle = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
plugins = bundle / "vlc" / "plugins"
libvlc = bundle / "libvlc.so.5"
if plugins.is_dir():
    os.environ["VLC_PLUGIN_PATH"] = str(plugins)
if libvlc.is_file():
    os.environ["PYTHON_VLC_LIB_PATH"] = str(libvlc)
