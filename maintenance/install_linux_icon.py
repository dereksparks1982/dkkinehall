#!/usr/bin/env python3
"""Register the approved original ДК emblem for the existing Chromium player.

Creates a Linux application launcher; never replaces or rebuilds the ELF.
"""
import ast
import os
import shutil
import subprocess
import sys
from pathlib import Path

# New identity bypasses GNOME's cached black-corner icon.
DESKTOP_ID = "dk-kinehall-approved.desktop"
OLD_DESKTOP_ID = "dk-kinehall.desktop"
APP_ICON_NAME = "dk-kinehall-approved-transparent-v2"

def optional(*args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=8)
    except (OSError, subprocess.TimeoutExpired):
        return None

def quoted(path):
    return '"' + str(path).replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$").replace(chr(96), chr(92) + chr(96)) + '"'

def launcher_entry(binary, icon, app_dir):
    return "\n".join((
        "[Desktop Entry]",
        "Type=Application",
        "Version=1.0",
        "Name=DK Kinehall",
        "Name[ru]=ДК Кинехолл",
        "Comment=Play local movies, episodes and music",
        "Comment[ru]=Проигрыватель фильмов, сериалов и музыки",
        "Exec=" + quoted(binary) + " --class=dk-kinehall %F",
        "Path=" + str(app_dir),
        "Icon=" + str(icon),
        "Terminal=false",
        "Categories=AudioVideo;Video;Audio;Player;",
        "MimeType=video/mp4;video/x-matroska;video/webm;video/quicktime;video/x-msvideo;video/mpeg;video/x-ms-wmv;video/mp2t;video/ogg;",
        "StartupNotify=true",
        "StartupWMClass=dk-kinehall",
        "",
    ))

def write_launcher(target, content):
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name("." + target.name + ".new")
    try:
        temporary.write_text(content, encoding="utf-8")
        temporary.chmod(0o755)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)

def pin_to_dock():
    current = optional("gsettings", "get", "org.gnome.shell", "favorite-apps")
    if not current or current.returncode:
        print("GNOME dock preferences unavailable; launcher is registered.")
        return
    try:
        favorites = [] if current.stdout.strip() == "@as []" else ast.literal_eval(current.stdout.strip())
        if not isinstance(favorites, list) or not all(isinstance(s, str) for s in favorites):
            raise ValueError("Unexpected GNOME favorites")
    except (ValueError, SyntaxError):
        print("GNOME favorites not modified because format is unknown.")
        return
    # Migrate the old dock favorite in place, preserving the user's order.
    # Changing the desktop ID forces GNOME to resolve the NEW transparent icon
    # instead of recycling the old opaque icon texture from its cache.
    revised = []
    for entry in favorites:
        entry = DESKTOP_ID if entry == OLD_DESKTOP_ID else entry
        if entry == DESKTOP_ID and entry in revised:
            continue
        revised.append(entry)
    if DESKTOP_ID not in revised:
        revised.append(DESKTOP_ID)
    if revised == favorites:
        print("DK Kinehall already pinned using the transparent icon.")
        return
    updated = optional("gsettings", "set", "org.gnome.shell", "favorite-apps", repr(revised))
    if updated and updated.returncode == 0:
        print("DK Kinehall pinned to GNOME dock.")
    else:
        print("Launcher registered; GNOME dock does not allow automatic pinning.")

def install(app_dir):
    app_dir = app_dir.expanduser().resolve()
    binary = app_dir / "DK Kinehall"
    icons = app_dir / "docs" / "icons"
    source_icon = icons / "dk-media-player-512.png"
    if not binary.is_file() or not source_icon.is_file() or source_icon.stat().st_size < 16000:
        raise SystemExit("Existing DK Kinehall executable or approved icon is missing.")
    home = Path.home()
    for size in (128, 192, 512):
        source = icons / ("dk-media-player-%d.png" % size)
        if not source.is_file():
            continue
        target = home / ".local" / "share" / "icons" / "hicolor" / ("%dx%d" % (size, size)) / "apps" / (APP_ICON_NAME + ".png")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    # Point both launcher and Nautilus metadata at a FRESH icon path, never at
    # docs/icons/dk-media-player-512.png which previous GNOME sessions cached.
    icon = home / ".local" / "share" / "icons" / "hicolor" / "512x512" / "apps" / (APP_ICON_NAME + ".png")
    content = launcher_entry(binary, icon, app_dir)
    project_launcher = app_dir / "DK Kinehall.desktop"
    menu_launcher = home / ".local" / "share" / "applications" / DESKTOP_ID
    write_launcher(project_launcher, content)
    write_launcher(menu_launcher, content)
    # Remove only the outdated DK Kinehall launcher, never anyone else's apps.
    old_launcher = menu_launcher.with_name(OLD_DESKTOP_ID)
    if old_launcher.exists():
        previous = old_launcher.read_text(encoding="utf-8", errors="replace")
        if "Name=DK Kinehall" in previous and "StartupWMClass=dk-kinehall" in previous:
            old_launcher.unlink()
    result = optional("gio", "set", "-t", "string", str(binary), "metadata::custom-icon", icon.as_uri())
    print("Executable icon in Files:", "set" if result and result.returncode == 0 else "not supported by this desktop")
    optional("gio", "set", "-t", "string", str(project_launcher), "metadata::trusted", "true")
    optional("update-desktop-database", str(menu_launcher.parent))
    optional("gtk-update-icon-cache", "-f", "-t",
             str(home / ".local" / "share" / "icons" / "hicolor"))
    pin_to_dock()
    print("Approved DK icon installed for the original Chromium application's launcher and dock.")
    print("Project launcher:", project_launcher)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: install_linux_icon.py PATH_TO_EXISTING_PLAYER")
    install(Path(sys.argv[1]))
