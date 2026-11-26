#!/usr/bin/env python3
"""Keep the exact approved DK Kinehall emblem with transparent outer corners.

Runs AFTER repository files are copied, BEFORE the Chromium runtime is synced.
This prevents a future update from restoring opaque black icon corners.
No changes to the image's letters, colors, or interior artwork.
"""
from collections import deque
from pathlib import Path
import os
import sys

try:
    import gi
    gi.require_version("GdkPixbuf", "2.0")
    from gi.repository import GdkPixbuf, GLib
except (ImportError, ValueError) as error:
    raise SystemExit("GNOME GdkPixbuf image support is required: " + str(error))


def make_corners_transparent(path):
    original = GdkPixbuf.Pixbuf.new_from_file(str(path))
    pb = original if original.get_has_alpha() else original.add_alpha(False, 0, 0, 0)
    width, height = pb.get_width(), pb.get_height()
    channels, stride = pb.get_n_channels(), pb.get_rowstride()
    if channels != 4 or width < 16 or height < 16:
        raise RuntimeError("Unexpected approved icon format: " + str(path))
    pixels = bytearray(pb.get_pixels())
    visited = bytearray(width * height)
    border = deque()

    def index(x, y):
        return y * stride + x * channels

    def add(x, y):
        coordinate = y * width + x
        if visited[coordinate]:
            return
        visited[coordinate] = 1
        i = index(x, y)
        # Only remove near-black pixels connected to an OUTER edge.
        # Black accents enclosed by the red-and-gold emblem are untouched.
        if (pixels[i + 3] > 0 and pixels[i] <= 45
                and pixels[i + 1] <= 45 and pixels[i + 2] <= 45):
            border.append((x, y))

    for x in range(width):
        add(x, 0)
        add(x, height - 1)
    for y in range(height):
        add(0, y)
        add(width - 1, y)

    changed = 0
    while border:
        x, y = border.popleft()
        pixels[index(x, y) + 3] = 0
        changed += 1
        if x > 0:
            add(x - 1, y)
        if x + 1 < width:
            add(x + 1, y)
        if y > 0:
            add(x, y - 1)
        if y + 1 < height:
            add(x, y + 1)

    # Do not silently accept a black-corner icon. Check all four corners.
    for x, y in ((0, 0), (width - 1, 0), (0, height - 1),
                 (width - 1, height - 1)):
        if pixels[index(x, y) + 3] != 0:
            raise RuntimeError("Corner opacity remains in " + path.name)

    output = GdkPixbuf.Pixbuf.new_from_bytes(
        GLib.Bytes.new(bytes(pixels)), GdkPixbuf.Colorspace.RGB,
        True, 8, width, height, stride)
    temporary = path.with_name("." + path.name + ".transparent.tmp")
    try:
        output.savev(str(temporary), "png", [], [])
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    print("Transparent approved icon:", path.name, "| outer pixels:", changed)


def main(app_dir):
    icons = app_dir / "docs" / "icons"
    files = (
        "dk-media-player-128.png",
        "dk-media-player-180.png",
        "dk-media-player-192.png",
        "dk-media-player-512.png",
        "favicon-32.png",
    )
    for name in files:
        path = icons / name
        if not path.is_file():
            raise RuntimeError("Approved icon is missing: " + str(path))
        make_corners_transparent(path)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: make_icons_transparent.py PATH_TO_EXISTING_PLAYER")
    main(Path(sys.argv[1]).expanduser().resolve())
