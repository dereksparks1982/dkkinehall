(async () => {
  "use strict";
  const video = document.getElementById("media");
  const input = document.getElementById("filePicker");
  if (!video || !input) throw new Error("Original web media controls missing");
  let plays = 0;
  let playing = false;
  Object.defineProperty(video, "paused", { configurable: true, get: () => !playing });
  video.pause = () => { playing = false; };
  video.play = () => { plays++; playing = true; return Promise.resolve(); };
  video.load = () => {};
  window.showOpenFilePicker = undefined;
  input.click = () => {};
  const labels = () => [...document.querySelectorAll("#queue .item-title")].map(e => e.textContent);
  const selected = () => document.querySelector("#queue .current .item-title")?.textContent || null;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  let fileSerial = 0;
  const choose = (button, names) => {
    const files = names.map(name => new File([new Uint8Array([0,1,2,3])],
      name, {type:"video/mp4",lastModified:++fileSerial}));
    Object.defineProperty(input, "files", {configurable:true, value:files});
    document.getElementById(button).click();
    input.dispatchEvent(new Event("change", {bubbles:true}));
  };
  choose("addQueueFiles", ["Waiting.mp4"]);
  assert(labels().length === 1 && !selected() && plays === 0,
    "Adding to Up Next while idle must NOT autoplay");
  choose("openEmpty", ["First.mp4", "Second.mp4"]);
  assert(plays === 1 && selected() === "First.mp4", "First opened file must autoplay");
  assert(labels().join("|") === "First.mp4|Second.mp4|Waiting.mp4",
    "Opening files must place them before existing idle queue items");
  choose("addQueueFiles", ["Queued2.mp4"]);
  assert(plays === 1 && selected() === "First.mp4",
    "Adding to queue must not interrupt playback");
  choose("openEmpty", ["OpenedWhilePlaying.mp4"]);
  assert(plays === 1 && selected() === "First.mp4",
    "Opening while playing must append without interruption");
  video.dispatchEvent(new Event("ended"));
  assert(plays === 2 && selected() === "Second.mp4",
    "Finishing a movie must automatically start next queued movie");
  video.pause();
  choose("openEmpty", ["ExplicitNew.mp4"]);
  assert(plays === 3 && selected() === "ExplicitNew.mp4",
    "Explicitly opening a new movie while paused must start it");
  assert(labels().length === 6 && labels().includes("OpenedWhilePlaying.mp4"),
    "Previously queued entries must remain present");
  return {passed:true, plays, totalQueue:labels().length,
    selected:selected(), queued:labels()};
})()