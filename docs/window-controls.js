/* DK Kinehall: drag/resize the SAME video surface; never open a new player.
 * A browser floating surface stays within the browser viewport. Native
 * Picture-in-Picture remains the way to move video outside that viewport.
 */
(function(root){
"use strict";
const KEY="dk-kinehall.player-window.v1";
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function attach({screen,button,onResize=()=>{}}){
  if(!screen||!button)return null;
  const container=screen.parentElement;
  const nativeDock=Boolean(root.DKLibraryBridge?.internalPages);
  const availableWidth=()=>Math.max(0,nativeDock?(container.parentElement?.clientWidth||container.clientWidth):container.clientWidth);
  const placeholder=document.createElement("div");
  placeholder.className="dk-player-placeholder";
  placeholder.hidden=true;
  container.insertBefore(placeholder,screen);
  const handle=document.createElement("button");
  handle.type="button";
  handle.className="dk-float-handle";
  handle.textContent="Drag to move";
  handle.title="Drag floating player to move it";
  handle.setAttribute("aria-label","Drag floating player to move it");
  const corner=document.createElement("button");
  corner.type="button";
  corner.className="dk-player-resize";
  corner.textContent="◢";
  corner.title="Drag to resize player";
  corner.setAttribute("aria-label","Drag to resize player");
  screen.append(handle);
  if(nativeDock){container.classList.add("dk-resizable-panel");container.append(corner);}
  else screen.append(corner);
  let saved={};
  try{saved=JSON.parse(localStorage.getItem(KEY)||"{}")||{};}catch(_){}
  let floating=false;
  let dockWidth=Number(saved.dockWidth)||0;
  let floatWidth=Number(saved.floatWidth)||560;
  let floatHeight=Number(saved.floatHeight)||315;
  let left=Number.isFinite(saved.left)?saved.left:48;
  let top=Number.isFinite(saved.top)?saved.top:48;
  const notify=()=>requestAnimationFrame(onResize);
  const save=()=>{
    try{localStorage.setItem(KEY,JSON.stringify({
      dockWidth,floatWidth,floatHeight,left,top,floating
    }));}catch(_){}
  };
  function layout(){
    if(floating){
      if(nativeDock)container.style.removeProperty("width");
      floatWidth=clamp(floatWidth,Math.min(300,innerWidth-16),Math.max(300,innerWidth-16));
      floatHeight=clamp(floatHeight,Math.min(175,innerHeight-16),Math.max(175,innerHeight-16));
      left=clamp(left,0,Math.max(0,innerWidth-floatWidth));
      top=clamp(top,0,Math.max(0,innerHeight-floatHeight));
      Object.assign(screen.style,{
        width:floatWidth+"px",height:floatHeight+"px",left:left+"px",top:top+"px"
      });
    }else{
      const available=availableWidth();
      if(nativeDock){
        screen.style.removeProperty("width");
        if(dockWidth)container.style.width=Math.min(dockWidth,available)+"px";
        else container.style.removeProperty("width");
      }else if(dockWidth)screen.style.width=Math.min(dockWidth,available)+"px";
      else screen.style.removeProperty("width");
      for(const key of ["height","left","top"])screen.style.removeProperty(key);
    }
    notify();
  }
  function toggle(force){
    floating=typeof force==="boolean"?force:!floating;
    screen.classList.toggle("dk-floating",floating);
    screen.classList.toggle("dk-sized",!floating&&dockWidth>0);
    placeholder.hidden=!floating;
    if(nativeDock){
      container.classList.toggle("dk-player-detached",floating);
      (floating?screen:container).append(corner);
    }
    button.textContent=floating?"Dock":"Float";
    button.setAttribute("aria-pressed",String(floating));
    button.title=floating?"Dock player back into page":"Move player into floating mode";
    layout();
    save();
  }
  button.addEventListener("click",()=>toggle());
  function startPointer(element,onMove,onDone){
    element.addEventListener("pointerdown",event=>{
      if(event.button!==0&&event.pointerType!=="touch")return;
      event.preventDefault();
      event.stopPropagation();
      const id=event.pointerId,x=event.clientX,y=event.clientY;
      element.setPointerCapture(id);
      const move=e=>{if(e.pointerId!==id)return;e.preventDefault();onMove(e.clientX-x,e.clientY-y);};
      const end=e=>{
        if(e.pointerId!==id)return;
        element.removeEventListener("pointermove",move);
        element.removeEventListener("pointerup",end);
        element.removeEventListener("pointercancel",end);
        if(element.hasPointerCapture(id))element.releasePointerCapture(id);
        save();onDone?.();
      };
      element.addEventListener("pointermove",move);
      element.addEventListener("pointerup",end);
      element.addEventListener("pointercancel",end);
    });
  }
  let movingStart={left:0,top:0};
  handle.addEventListener("pointerdown",()=>{movingStart={left,top};}, {capture:true});
  startPointer(handle,(dx,dy)=>{
    left=movingStart.left+dx;top=movingStart.top+dy;
    layout();
  });
  let sizingStart={width:0,height:0};
  corner.addEventListener("pointerdown",()=>{
    const bounds=(nativeDock&&!floating?container:screen).getBoundingClientRect();
    sizingStart={width:bounds.width,height:bounds.height};
  },{capture:true});
  startPointer(corner,(dx,dy)=>{
    if(floating){
      floatWidth=sizingStart.width+dx;floatHeight=sizingStart.height+dy;
    }else{
      // The docked surface preserves 16:9; the video always uses contain.
      const available=availableWidth();
      dockWidth=clamp(sizingStart.width+dx,Math.min(300,available),available);
      screen.classList.add("dk-sized");
    }
    layout();
  });
  for(const element of [handle,corner])element.addEventListener("dblclick",e=>e.stopPropagation());
  window.addEventListener("resize",layout);
  if(dockWidth||saved.floating)toggle(Boolean(saved.floating));
  else layout();
  return {toggle,isFloating:()=>floating,layout};
}
root.DKPlayerWindow={attach};
})(typeof window!=="undefined"?window:globalThis);
