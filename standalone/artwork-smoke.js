(async()=>{
  "use strict";
  // Exercise the same Up Next mutation path as adding a local movie.
  // No movie file is uploaded; only its parsed name is searched.
  const queue=document.getElementById("queue");
  const li=document.createElement("li");
  li.dataset.queueKind="file";
  li.dataset.queueAudio="0";
  const button=document.createElement("button");
  button.className="item-play";
  const box=document.createElement("span");
  box.className="queue-artwork";
  const name=document.createElement("span");
  name.className="item-title";
  name.textContent="The.Matrix.1999.1080p.mkv";
  button.append(box,name);li.append(button);
  queue.replaceChildren(li);
  li.scrollIntoView({block:"nearest"});
  const started=Date.now();
  while(Date.now()-started<38000){
    const img=box.querySelector("img.queue-artwork-image:not([hidden])");
    if(box.dataset.artworkStatus==="loaded"&&img&&img.complete&&img.naturalWidth>0){
      const result={passed:true,provider:box.title,width:img.naturalWidth,
        height:img.naturalHeight,imageHost:new URL(img.src).hostname,
        artKind:li.dataset.artworkType};
      if(result.artKind!=="movie")throw Error("Artwork not classified as a movie poster");
      return result;
    }
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  throw Error("Live movie poster was not displayed: "+JSON.stringify({
    state:box.dataset.artworkStatus,title:box.title,
    apiAvailable:!!window.DKMediaMetadata,
    imageSource:box.querySelector("img")?.src||null
  }));
})()