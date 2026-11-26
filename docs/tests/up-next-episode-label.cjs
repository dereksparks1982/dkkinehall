"use strict";
/* TV queue regression: show on line one, SxxExx and episode title together on line two.
   Internal artwork still resolves using unmodified source filenames.
   Installed icons and GNOME launchers must survive every updater run. */
const assert = require("node:assert/strict");
const fs = require("node:fs"),path = require("node:path");
const root = path.resolve(__dirname,"..");
const read = name => fs.readFileSync(path.join(root,name),"utf8");
const meta = require("../episode-metadata.js");
const filename = "South.Park.S05E04.1080p.WEB-DL-jhonny2.mkv";
assert.deepEqual(meta.parseFilename(filename),
  {type:"episode",series:"South Park",season:5,episode:4,year:null});
const withTitle = meta.parseFilename("South.Park.S05E04.Super.Best.Friends.mkv");
assert.equal(withTitle.episodeTitle,"Super Best Friends");
const player=read("player.js");
const css=read("player.css");
const artwork=read("metadata-ui.js");
const html=read("index.html");
const updater=fs.readFileSync(path.join(root,"../maintenance/update_existing_linux.sh"),"utf8");
new Function(player);
new Function(artwork);
assert.ok(player.includes('title.textContent = displayName;'));
assert.ok(player.includes('source.textContent = episodeCode;'));
assert.ok(player.includes('episodeName.className = "item-episode-name";'));
assert.ok(player.includes('source.append(episodeName);'),
  "Episode name must follow SxxExx inside the SECOND row");
assert.ok(player.includes('labels.append(source);'),
  "Series title stays on line one, with episode details below");
assert.ok(!player.includes('labels.append(source, episodeName);'));
assert.ok(css.includes('.queue li[data-queue-episode="1"] .item-meta{'));
assert.ok(css.includes('.queue .item-episode-name{'));
assert.ok(artwork.includes("finder.episodeTitle(name)"));
assert.ok(artwork.includes("originalFilename(li)"),
  "Artwork must use the original file rather than visible shortened show");
assert.ok(html.includes("episode-metadata.js?v=20261126-queue-3lines5"));
assert.ok(updater.includes('if relative.parts[0] == "icons":'));
assert.ok(!updater.includes('python3 "$WORK/repo/maintenance/install_linux_icon.py" "$APP"'));
const requests=[];
const resolver=meta.create({
  sleep:async()=>{},
  fetchJSON:async url=>{
    requests.push(url);
    let result;
    if(url.includes("/search/shows"))
      result=[{show:{id:1,name:"South Park"}}];
    else if(url.includes("/shows/1/episodes"))
      result=[{season:5,number:4,name:"Super Best Friends",image:null}];
    else throw Error("Unexpected lookup: "+url);
    return {ok:true,status:200,text:async()=>JSON.stringify(result)};
  }
});
(async()=>{
  assert.equal(await resolver.episodeTitle(filename),"Super Best Friends");
  assert.equal(await resolver.episodeTitle(filename),"Super Best Friends");
  assert.equal(requests.length,2,"TVmaze show/episode responses are cached");
  assert.ok(requests.every(url=>!url.includes(".mkv")),
    "Only title and episode metadata, never local filename, go to TVmaze");
  console.log("PASS: two TV label rows, true episode title, full-filename artwork, icons untouched");
})().catch(error=>{console.error(error);process.exitCode=1});
