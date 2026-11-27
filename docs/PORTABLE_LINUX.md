# DK Kinehall standalone Linux

The current standalone edition uses the approved DK Kinehall interface in a bundled Chromium/Electron runtime. The separate Qt/libmpv source in `native/` is not the installed edition described here.

## Update an existing installation

Close DK Kinehall. Run the standard updater in a terminal:

```bash
python3 - <<'PY'
import urllib.request
import subprocess

url = "https://raw.githubusercontent.com/dereksparks1982/dkkinehall/main/maintenance/update_existing_linux.sh"

with urllib.request.urlopen(url, timeout=30) as response:
    subprocess.run(["bash"], input=response.read(), check=True)
PY
```

The updater synchronizes the Player, Library and native bridge in the existing installation, preserves approved icons and installed codec binaries unless a verified replacement is available, creates a backup, and reopens the player. The default installation location is `~/DKLab/Projects/DK Kinehall`.

## New installations

A fully verified standalone distribution package is not currently published in this repository. The existing-installation updater is not a fresh installer. No separate preview installation is required for routine updates.

## Live TV

The Library provides Movies, TV Shows and Live TV buttons. Live TV has six controls: Discover Streams, Open Network Stream, Import Playlist, Scan TV Tuners, World TV, and Saved Channels. It displays channel cards with the original 101 DK Media Plus logos; the standard updater installs and verifies the exact pinned artwork, reusing existing verified assets on subsequent updates. Import an M3U channel list and optional XMLTV guide. Programme data is session-only; favourites and imported channels are stored locally. HDHomeRun scanning and playback use the existing native backend; Compatible Linux USB/internal ATSC 1.0 tuners can scan RF channels, load a per-device channel cache and explicitly refresh broadcast PSIP guide data using the native helper ported from DK Media Plus. The helper is compiled by the runtime synchronizer when a C++ compiler and Linux DVB headers are available; no compiler is automatically installed. A future bundled binary is needed for dependency-free fresh installs. Local tuner playback and other broadcast standards remain unimplemented. Public HTTP/HTTPS IPv4 streams now support bounded redirects and rewritten HLS manifests through the loopback-only decoder bridge. LAN redirects stay on the original host. World TV loads IPTV-ORG worldwide or country playlists on demand, with raster logos from playlist metadata, regional free XMLTV where configured and user-supplied guide URLs (including gzip). Guide matching and availability are not guaranteed; DVR remains pending. The native runtime must include the HLS demuxer and required decoder/protocol support; hardware and live playback acceptance remain pending.

Live TV checks actual bundled FFmpeg/FFprobe HLS, MPEG-TS and HTTP/crypto capabilities at runtime. Reconnects for live channels start at the live edge. Available cached channel artwork accompanies the queue item. The free EPG directory includes US2, UK1 and other regional guides; guides remain session-only and unmatched channels show no data.

Automatic Live TV playback now starts through the included FFmpeg decoder rather than waiting for Chromium to reject HLS. Alternate addresses are limited to the same exact channel identifier in the imported directory and public IPv4 validation still applies. Original mode does not transcode. Runtime codec availability is reported; the normal updater does not replace unapproved codec payloads.

Channel metadata is joined from IPTV-ORG's separate current API collections; exact stream URL is a fallback for missing IDs. The free guide is refreshed on demand and periodically while Live TV is open, with bounded regional downloads. A channel with no reliable country or schedule match is explicitly marked unknown. Metadata and logo sources may be incomplete.

Internet TV availability is sampled near visible cards, while successful playback is tracked independently. Cached artwork and programme data persist in the local application data folder. Recordings and scheduled programmes use the bundled FFmpeg and an explicitly chosen destination; Kinehall must remain open. One recording is supported at a time. Replay is opt-in and bounded by completed segments, disk limits and source codec compatibility; use Replay Buffer then Go Live. Commercial candidates in local recordings are approximate; review/approve them before skipping. Automatic commercial skipping is disabled by default.

The standalone player may generate a small seek thumbnail using the bundled decoder when browser preview is unavailable or native playback is active. Only local media is eligible, requests are bounded and cancelled on hover exit. Local collection membership and edition overrides do not alter source videos.
