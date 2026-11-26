"use strict";
/* DK Kinehall player-bar settings regression.
 * Source-level only: no browser, OS codec build, or launcher rebuild.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=name=>fs.readFileSync(path.join(root,name),"utf8");
const html=read("index.html"),css=read("player.css");
const js=read("player.js"),layer=read("playback-settings-layer.js");
const i18n=read("i18n.js");
for(const src of [js,layer])new Function(src);
const count=(value,needle)=>value.split(needle).length-1;
for(const id of [
 "subtitleToggle","subtitleTrackSelect","addSubtitles",
 "subtitleDelayEarlier","subtitleDelayLater","subtitleDelayReset",
 "subtitleDelayValue","subtitleLabel","playbackFormat","playbackHardware",
 "playbackRemember","removeWatched","rate","nowTitle","nowSource"
])assert.equal(count(html,'id="'+id+'"'),1,"exactly one "+id);
const header=html.slice(html.indexOf("<header"),html.indexOf("</header>"));
const screen=html.slice(html.indexOf('id="screen"'),html.indexOf('id="chapterPicker"'));
assert.doesNotMatch(header,/playback-settings/);
assert.match(screen,/player-bar-settings/);
assert.match(screen,/id="subtitleToggle"/);
assert.match(screen,/id="subtitleTrackSelect"/);
assert.ok(screen.indexOf('id="subtitleToggle"')<
  screen.indexOf('player-bar-settings'),
  "Subtitles On/Off sits immediately before the gear on the video bar");
assert.ok(screen.indexOf('id="subtitleTrackSelect"')>
  screen.indexOf('player-bar-settings'),
  "Track chooser belongs inside the gear panel");
assert.match(screen,/id="addSubtitles"/);
assert.match(screen,/id="subtitleDelayEarlier"/);
assert.match(screen,/id="subtitleDelayLater"/);
assert.match(screen,/id="subtitleDelayReset"/);
assert.doesNotMatch(html,/class="sub-row"/,"No subtitle strip under the video");
assert.match(html,/class="now-playing"/,"Original now-playing block remains");
assert.match(html,/id="nowTitle"/);
assert.match(html,/id="nowSource"/);
assert.match(js,/subtitleTrackSelect\.addEventListener\("change"/);
assert.match(js,/lastSubtitleChoice/,
  "Caption quick toggle remembers the previous subtitle selection");
assert.match(js,/subtitlePicker"\)\.click\(\)/,
  "External SRT/VTT loading stays in the gear menu");
assert.match(js,/refreshSubtitleTrackOptions=\(\)=>/);
assert.match(js,/subtitlePicker"\)\.click\(\)/);
assert.match(js,/keepControlsVisible/);
assert.match(layer,/showPopover\(\)/);
assert.match(layer,/const above=rect\.top-height-9/);
assert.match(css,/\.screen \.controls \.player-bar-settings/);
assert.match(css,/\.screen \.controls \.subtitle-toggle/);
for(const label of [
 "Playback settings","Subtitle track","Subtitles off",
 "＋ Load SRT / VTT…","Subtitle delay","Playback speed"
])assert.ok(i18n.includes('"'+label+'"'),"Russian translation for "+label);
console.log("PASS: gear and CC toggle in original bar, track/delay in gear, no lower strip, title unchanged");
