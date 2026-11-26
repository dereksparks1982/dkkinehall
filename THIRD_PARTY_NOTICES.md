# Third-party notices

DK Kinehall's **standalone Linux distribution** includes Electron,
Chromium, Node.js and their associated third-party libraries under their
respective open-source licenses. Upstream licenses and notices ship inside
the bundled Electron runtime, including Chromium's LICENSES file.
The portable runtime is distributed without charging for DK Softworks code.

The Chromium-based web player remains available without installing anything
and includes the third-party notices already carried in its own assets.

DK Softworks-owned original source is governed by the repository's
DK Softworks Original Work License. That license does not override the
separate license terms of the third-party runtime.

## Native codec components under development

The planned standalone codec bridge can bundle independent FFmpeg, FFprobe,
libavcodec/libavformat/libavutil and third-party codec libraries including
libx264, libvpx and libopus. Actual redistribution rights depend on the
specific compiled binaries. Native packages must carry applicable third-party
licenses plus accurate FFmpeg build flags and decoder/encoder inventories.
DK Softworks' sale restrictions do not replace those third-party licenses.
A codec-enabled Electron release has not yet been verified or distributed.

## Online artwork providers

DK Kinehall can query TVmaze for episode artwork , Cinemeta for keyless film poster links, and the Apple iTunes Search
API as a fallback. Artwork and associated names belong to their
respective rights holders. DK Softworks does not grant any license to
third-party images or claim their ownership. No artwork images are bundled
or redistributed with the application. See the provider terms:

- TVmaze: https://www.tvmaze.com/api (episode metadata and images, attribution under CC BY-SA as applicable)
- Cinemeta: https://v3-cinemeta.strem.io/
- Apple Search API: https://performance-partners.apple.com/search-api

The original Jellyfin Web image-selection code attribution remains in
`docs/jellyfin-artwork.js` and `docs/vendor/jellyfin/`.
