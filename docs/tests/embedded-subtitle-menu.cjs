/* Regression check for the original Chromium player's embedded-MKV menu. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const player = fs.readFileSync(path.join(root, "player.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
new Function(player);
assert.match(player, /toggle\.dataset\.menuSection\s*=\s*label/,
  "Menu sections need stable identities independent of section order and UI language");
assert.match(player, /data-menu-section="Subtitles"/,
  "Subtitles button must explicitly select Subtitles, never Playback format");
assert.doesNotMatch(player, /querySelectorAll\("\.context-section-toggle"\)\[1\]/,
  "Positional menu selection accidentally expands Playback format");
assert.match(player, /refreshOpenSubtitleMenu\(\)/,
  "Embedded tracks should refresh after asynchronous MKV inspection");
assert.match(player, /window\.DKMkvSubtitles\.extractTextTrack/,
  "Embedded text tracks must load from the selected MKV");
assert.match(player, /window\.DKPGS\.extract/,
  "PGS subtitle tracks must be decoded locally");
assert.match(player, /window\.DKVobSub\.extract/,
  "VobSub subtitle tracks must be decoded locally");
assert.match(player, /addMenuItem\("Subtitles off"/,
  "The existing menu must always provide an Off setting");
assert.match(html, /id="addSubtitles"/);
assert.match(html, /id="playerContextMenu"/);
assert.match(html, /src="\.\/vobsub\.js/);
assert.match(html, /src="\.\/mkv-subtitles\.js/);
console.log("PASS: embedded subtitle menu wiring");
