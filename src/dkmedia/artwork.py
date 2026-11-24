"""Local cover art and optional TVmaze episode stills for the standalone Kinehall.

The video file is never uploaded. Only a sanitized programme name and episode
number can be sent to TVmaze. All artwork is cached on the local device.
"""
from __future__ import annotations

import hashlib
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

from .library import APP_DIR

CACHE = APP_DIR / "artwork"
MAX_IMAGE = 6 * 1024 * 1024
EPISODE = re.compile(r"(?i)(.+?)[ ._-]+s(\d{1,2})e(\d{1,3})(?:\D|$)")
IMAGE_NAMES = ("poster.jpg", "poster.png", "folder.jpg", "folder.png", "cover.jpg", "cover.png")


def _json(url: str):
    req = urllib.request.Request(url, headers={
        "User-Agent": "DK-Kinehall/1.0 (desktop video artwork)",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.loads(response.read(512 * 1024).decode("utf-8"))


def _image(url: str, path: Path) -> Path | None:
    if not url.startswith("https://"):
        return None
    req = urllib.request.Request(url, headers={"User-Agent": "DK-Kinehall/1.0"})
    with urllib.request.urlopen(req, timeout=7) as response:
        content = response.read(MAX_IMAGE + 1)
        mime = response.headers.get("Content-Type", "")
    if not content or len(content) > MAX_IMAGE or not mime.startswith("image/"):
        return None
    CACHE.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(content)
    temporary.replace(path)
    return path


def artwork_for(file_path: str | Path) -> Path | None:
    """Resolve a nearby image first, then fetch a TV episode still if possible.

    Called on a background thread. Never touches Tk widgets or VLC.
    """
    media = Path(file_path).expanduser()
    if not media.is_file():
        return None
    for stem in (media.stem, media.stem + "-poster", media.stem + "-thumb"):
        for suffix in (".jpg", ".jpeg", ".png", ".webp"):
            candidate = media.with_name(stem + suffix)
            if candidate.is_file():
                return candidate
    for filename in IMAGE_NAMES:
        candidate = media.parent / filename
        if candidate.is_file():
            return candidate

    match = EPISODE.search(media.stem)
    if not match:
        return None
    title = re.sub(r"[._-]+", " ", match.group(1)).strip()
    if not title:
        return None
    season, episode = int(match.group(2)), int(match.group(3))
    key = hashlib.sha256(f"{title.casefold()}:{season}:{episode}".encode()).hexdigest()
    cached = CACHE / (key + ".img")
    if cached.exists() and cached.stat().st_size:
        return cached
    try:
        q = urllib.parse.urlencode({"q": title})
        shows = _json("https://api.tvmaze.com/search/shows?" + q)
        if not isinstance(shows, list):
            return None
        for result in shows[:5]:
            show = result.get("show") or {}
            show_id = show.get("id")
            if not isinstance(show_id, int):
                continue
            episodes = _json(f"https://api.tvmaze.com/shows/{show_id}/episodes")
            if not isinstance(episodes, list):
                continue
            for entry in episodes:
                if entry.get("season") == season and entry.get("number") == episode:
                    image = (entry.get("image") or {}).get("original") or (
                        entry.get("image") or {}).get("medium")
                    if image:
                        return _image(image, cached)
            break
    except (OSError, ValueError, TimeoutError, TypeError, KeyError):
        return None
    return None
