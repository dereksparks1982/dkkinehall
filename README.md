# DK Kinehall

![DK Kinehall standalone media player screenshot](assets/images/Screenshot%20From%202026-11-26%2005-06-07.png)

![DK Kinehall standalone media library screenshot](assets/images/Screenshot%20From%202026-11-26%2007-16-40.png)

**Your movies. Your music. Your player.**

DK Kinehall (ДК Кинехолл) is a free media player made by **DK Softworks**. Watch movies and TV shows or listen to music saved on your own device.

## Features

- Play movies, TV shows and music.
- Organize your local media with posters, titles and movie information.
- Resume videos with Continue Watching and manage your Up Next playlist.
- In the standalone Library, search titles, filter movies by genre, decade, actor, director or filename-marked edition, and save movies or entire TV series to your local Watchlist.
- Add large TV collections to Up Next without scanning every episode at once.
- Adjust picture, sound, subtitles and playback speed. Standalone audio supports 0–200% volume, selectable stereo headphone/speaker modes, remembered volume by mode, a headphone EQ preset, dialogue enhancement, volume leveling and optional post-gain peak protection.
- Optional standalone Skip Intro and Skip Credits buttons for explicitly named chapters. Skipping is manual by default; automatic options are off unless enabled. Unmarked introductions and credits are not detected yet.
- Watch fullscreen or resize the player.
- Use the interface in English or Russian.

The standalone Linux edition also offers library scanning, file information, library cleanup and additional playback controls. Live TV is built into the Library beside Movies and TV Shows. Discover network media servers, enter a compatible HTTP/HTTPS stream, import an M3U channel list, find HDHomeRun and local television tuners, browse free internet channels by country through World TV, and save favourites. The channel guide uses the original DK Media Plus artwork (installed by the updater) and uses available playlist logos and supports free regional or manually supplied XMLTV guide URLs and files for the current session. HDHomeRun playback requires compatible hardware. Compatible Linux ATSC 1.0 USB/internal tuners have a ported native channel scanner and broadcast programme-guide reader, pending hardware validation and helper compilation. Local antenna playback and DVR remain outstanding. HLS and validated redirects are added at source level; actual playback requires a compatible bundled decoder and working upstream streams.

## Library controls

Movies (gold), TV Shows (white), and Live TV (brown) are the three standalone library navigation buttons. The standalone interface uses gold, brown, white and Russian red throughout its controls, menus, settings and dialogs.

- **Ctrl + mouse wheel:** Enlarge or shrink the library.
- **Ctrl + middle-click:** Restore the default library size.
- **Right-click a title:** Access file and library management options.

## Get started

1. Open DK Kinehall.
2. Choose a video or music file, or select a title from your library.
3. Press Play.

**[Try the Web App](https://dereksparks1982.github.io/dkkinehall/)**

**[Standalone Linux edition: standard update instructions](docs/PORTABLE_LINUX.md)**

The normal installed-player updater synchronizes the Player, Library and native application components together, preserving installed codec binaries unless a verified replacement codec package is available.

## More information

- [Third-party credits](THIRD_PARTY_NOTICES.md)
- [Contact DK Softworks](CONTACT.md)

## Free to use

DK Kinehall is free for personal and business use. DK Softworks' original software may not be sold or repackaged for distribution without permission. See the [license](LICENSE) for the full terms.

World TV uses public channel directories and free regional programme guides where available. The player reports specific decoder, broadcaster, connection and format failures instead of treating every unavailable stream as the same error. Live playback and guide matching depend on the stream and bundled decoder.

Live TV starts through the included decoder in Automatic mode and may try up to two alternative addresses for the exact same playlist channel ID. Original mode remains unconverted. No paid guide or tuner is required for internet channels.

World TV matches channels against the IPTV-ORG channel, feed, logo and stream databases for country, category, language and station artwork. Free regional guide downloads are matched by channel ID or unambiguous country-specific name. Coverage depends on published source data; unknown information is explicitly labelled rather than invented.

Live TV also has cached availability checks, persistent channel artwork and programme data, recently opened channels, time-selectable programme schedules, local recording and series rules, and opt-in disk replay for supported streams. Keep Kinehall open for recording. Recordings are written to a folder you choose. Commercial analysis suggests possible breaks in local videos for your review; skipping approved breaks is manual unless you enable automation.

Standalone seek previews can use the included native decoder for supported local files. Create personal movie collections from the movie right-click menu, filter by collection in release order, and edit edition labels without changing filenames. Possible alternate versions are grouped by title and year for review.

Live TV cards use aligned, fixed-size artwork, programme and action areas. The gold favourite star toggles saved channels without rebuilding the channel grid; full programme descriptions remain available through programme-title hover and the schedule.

Network settings include Automatic or adjustable 1–30-second buffer targets, HLS quality preferences and optional streaming statistics. Small completed HLS segments are reused, automatic quality can select a lower bitrate on reconnection, and prolonged stalls trigger bounded recovery. Buffer targets are best effort and depend on the source and browser.

Streaming recovery also retries transient HLS segment and playlist requests before restarting a channel. Native playback prebuffers before autoplay; compatible stereo AAC-LC streams may be passed through without re-encoding. Automatic buffering can reach 30 seconds and relaxes after sustained stable playback.

The existing hardware acceleration preference also controls optional VA-API decoding for eligible internet video on Linux. Compatible streams still use passthrough first. If the bundled decoder or render device cannot support hardware decoding, Kinehall falls back to software; streaming statistics distinguish hardware initialization, confirmed decoder output and fallback.

Automatic quality can now attempt in-session HLS rendition switching for a restricted class of compatible live MPEG-TS streams. Already advertised segments keep their original URLs, and changes use verified aligned timestamps and a discontinuity boundary. Other streams retain reconnect-based quality selection.
