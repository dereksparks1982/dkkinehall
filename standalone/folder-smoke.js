(async () => {
  "use strict";
  const assert = (condition, message) => {if(!condition)throw new Error(message);};
  const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
  const files = [...document.querySelectorAll("#queue .item-title")].map(x => x.textContent);
  const current = () => document.querySelector("#queue .current .item-title")?.textContent;
  const originalSelected = current();
  const originalCount = files.length;
  const video = document.getElementById("media");
  const calls = {play:0};
  const originalPlay = video.play;
  video.play = () => { calls.play++; return Promise.resolve(); };
  const file = name => ({kind:"file",getFile:async()=>new File([new Uint8Array([1,2,3])],
      name,{type:"video/mp4",lastModified:1000})});
  const sample = {kind:"directory",name:"My Movies",
    queryPermission:async()=>"granted",
    requestPermission:async()=>"granted",
    async *entries(){
      yield ["Film B.mp4",file("Film B.mp4")];
      yield ["Film A.mp4",file("Film A.mp4")];
      yield ["notes.txt",file("notes.txt")];
    }};
  Object.defineProperty(window,"showDirectoryPicker",{configurable:true,value:async()=>sample});
  const waitFor = async predicate => {
    for(let i=0;i<70;i++){if(predicate())return;await sleep(50);}
    throw Error("Timed out waiting for folder scan");
  };
  const status = () => document.getElementById("folderStatus").textContent;
  document.getElementById("selectFolder").click();
  await waitFor(()=>status().includes("My Movies") &&
    [...document.querySelectorAll("#queue .item-title")].some(x=>x.textContent==="Film A.mp4"));
  let all = [...document.querySelectorAll("#queue .item-title")].map(x=>x.textContent);
  assert(all.length===originalCount+2, "Folder should add two playable movies, not text files");
  assert(all.indexOf("Film A.mp4")<all.indexOf("Film B.mp4"),"Folder order must be natural");
  assert(current()===originalSelected && calls.play===0,
    "Folder import must not interrupt or autoplay a different movie");
  assert(!document.getElementById("reopenFolder").hidden, "Reconnect control missing");
  document.getElementById("reopenFolder").click();
  await waitFor(()=>status().includes("My Movies") &&
    document.getElementById("status").textContent.includes("already"));
  all=[...document.querySelectorAll("#queue .item-title")].map(x=>x.textContent);
  assert(all.length===originalCount+2, "Reopening folder must not duplicate queue entries");
  document.getElementById("forgetFolder").click();
  await waitFor(()=>document.getElementById("forgetFolder").hidden);
  assert(document.getElementById("reopenFolder").hidden, "Forget must clear reconnect control");
  assert([...document.querySelectorAll("#queue .item-title")].length===originalCount+2,
    "Forgetting folder should retain current queue for this session");
  video.play=originalPlay;
  return {passed:true,filesAdded:2,queuePreserved:true,duplicateFree:true,
    forgetKeptQueue:true};
})()