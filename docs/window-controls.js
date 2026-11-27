/* DK Kinehall: drag/resize the SAME video surface; never open a new player.
 * A browser floating surface stays within the browser viewport. Native
 * Picture-in-Picture remains the way to move video outside that viewport.
 */
(function(root){
"use strict";
const KEY="dk-kinehall.player-window.v1";
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function attach({screen,button,theaterButton,onResize=()=>{}}){
  if(!screen||!button)return null;
  const container=screen.parentElement;
  const nativeDock=Boolean(root.DKLibraryBridge?.internalPages);
  const grid=nativeDock?container.closest(".main-grid"):null;
  const sidebar=grid?.querySelector(":scope > aside");
  const dockGripHost=nativeDock?(container.querySelector(":scope > .now-playing")||container):container;
  let expanded=false,normalDockWidth=0;
  // Match the standalone grid's reserved queue width at every viewport
  // size, including when the queue is deliberately hidden in expanded mode.
  const normalLimit=()=>{
    const width=availableWidth();
    if(!grid||!sidebar)return width;
    const gap=Number.parseFloat(getComputedStyle(grid).columnGap)||19;
    const sidebarWidth=Math.min(width*.45,Math.max(180,Math.min(305,width*.31)));
    return Math.max(0,width-sidebarWidth-gap);
  };
  const minimumDockWidth=()=>Math.min(normalLimit(),Math.max(480,normalLimit()*.8));
  const applyExpanded=value=>{
    expanded=Boolean(value&&grid&&sidebar);
    grid?.classList.toggle("dk-player-expanded",expanded&&!floating);
    if(sidebar)sidebar.inert=expanded&&!floating;
    const playlistButton=document.getElementById("dkPlaylistToggle");
    if(playlistButton){playlistButton.setAttribute("aria-pressed",String(!expanded||floating));playlistButton.disabled=floating||screen.classList.contains("desktop-fullscreen")||Boolean(document.fullscreenElement);}
    if(theaterButton){
      theaterButton.setAttribute("aria-pressed",String(expanded&&!floating));
      const label=expanded?"Exit Theater Mode":"Theater Mode";
      if(theaterButton.title!==label){theaterButton.title=label;theaterButton.setAttribute("aria-label",label);root.DKLocale?.apply();}
      theaterButton.disabled=floating||screen.classList.contains("desktop-fullscreen")||Boolean(document.fullscreenElement);
    }
  };
  const availableWidth=()=>Math.max(0,nativeDock?(grid?.clientWidth??container.parentElement?.clientWidth??0):container.clientWidth);
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
  const resetButton=document.createElement("button");
  resetButton.type="button";resetButton.className="dk-player-reset";resetButton.textContent="↺";
  resetButton.title="Reset player size (Escape)";resetButton.setAttribute("aria-label","Reset player size (Escape)");
  screen.append(handle);
  if(nativeDock){container.classList.add("dk-resizable-panel");dockGripHost.append(resetButton,corner);}
  else screen.append(corner);
  let saved={};
  try{saved=JSON.parse(localStorage.getItem(KEY)||"{}")||{};}catch(_){}
  let floating=false;
  // Standalone opens fully docked at the current column width every launch.
  // Pixel widths from an older or smaller display must not shrink the default.
  let dockWidth=nativeDock?0:Number(saved.dockWidth)||0;
  expanded=Boolean(!nativeDock&&saved.expanded&&dockWidth&&grid&&sidebar);
  let floatWidth=Number(saved.floatWidth)||560;
  let floatHeight=Number(saved.floatHeight)||315;
  let left=Number.isFinite(saved.left)?saved.left:48;
  let top=Number.isFinite(saved.top)?saved.top:48;
  const notify=()=>requestAnimationFrame(onResize);
  let cancelPointer=null;
  const save=()=>{
    try{localStorage.setItem(KEY,JSON.stringify({
      dockWidth:nativeDock?0:dockWidth,floatWidth,floatHeight,left,top,
      floating:nativeDock?false:floating,expanded:nativeDock?false:expanded
    }));}catch(_){}
  };
  function layout(){
    if(floating){
      if(nativeDock){applyExpanded(expanded);container.style.removeProperty("width");}
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
        applyExpanded(expanded);
        if(dockWidth&&available>0){
          const limit=expanded?available:normalLimit();
          container.style.width=clamp(dockWidth,minimumDockWidth(),limit)+"px";
        }else container.style.removeProperty("width");
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
      (floating?screen:dockGripHost).append(resetButton,corner);
    }
    button.textContent=floating?"Dock":"Float";
    button.setAttribute("aria-pressed",String(floating));
    button.title=floating?"Dock player back into page":"Move player into floating mode";
    layout();
    save();
  }
  function toggleTheater(){
    if(!nativeDock||!grid||!sidebar||floating||screen.classList.contains("desktop-fullscreen")||document.fullscreenElement)return false;
    cancelPointer?.();
    if(expanded){dockWidth=normalDockWidth;expanded=false;}
    else{normalDockWidth=dockWidth;dockWidth=0;expanded=true;}
    screen.classList.toggle("dk-sized",dockWidth>0);
    layout();save();return true;
  }
  function reset(){
    cancelPointer?.();
    dockWidth=0;normalDockWidth=0;expanded=false;
    floatWidth=560;floatHeight=315;left=48;top=48;
    container.style.removeProperty("width");
    toggle(false);
    save();
  }
  button.addEventListener("click",()=>toggle());
  if(nativeDock&&theaterButton){
    theaterButton.hidden=false;
    theaterButton.addEventListener("click",toggleTheater);
    document.addEventListener("fullscreenchange",layout);
  }
  if(nativeDock)resetButton.addEventListener("click",event=>{event.stopPropagation();reset();});
  function startPointer(element,onMove,onDone){
    element.addEventListener("pointerdown",event=>{
      if(event.button!==0&&event.pointerType!=="touch")return;
      event.preventDefault();
      event.stopPropagation();
      cancelPointer?.();
      const id=event.pointerId,x=event.clientX,y=event.clientY;
      element.setPointerCapture(id);
      const move=e=>{if(e.pointerId!==id)return;e.preventDefault();onMove(e.clientX-x,e.clientY-y);};
      const end=e=>{
        if(e.pointerId!==id)return;
        element.removeEventListener("pointermove",move);
        element.removeEventListener("pointerup",end);
        element.removeEventListener("pointercancel",end);
        element.removeEventListener("lostpointercapture",end);
        cancelPointer=null;
        if(element.hasPointerCapture(id))element.releasePointerCapture(id);
        save();onDone?.();
      };
      cancelPointer=()=>end({pointerId:id});
      element.addEventListener("lostpointercapture",end);
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
      dockWidth=clamp(sizingStart.width+dx,nativeDock?minimumDockWidth():Math.min(300,available),available);
      if(grid&&sidebar){
        const limit=normalLimit();
        // Cross the normal two-column boundary to hide Up Next; crossing
        // back restores it. Hysteresis avoids flicker at the threshold.
        if(!expanded&&dockWidth>limit+12){normalDockWidth=Math.min(sizingStart.width,limit);expanded=true;}
        else if(expanded&&dockWidth<=limit)expanded=false;
      }
      screen.classList.add("dk-sized");
    }
    layout();
  });
  if(grid&&sidebar){
    const edge=document.createElement("div");
    edge.className="dk-dock-resize-edge";edge.setAttribute("aria-hidden","true");
    container.append(edge);
    edge.addEventListener("pointerdown",()=>{
      const bounds=container.getBoundingClientRect();sizingStart={width:bounds.width,height:bounds.height};
    },{capture:true});
    startPointer(edge,dx=>{
      if(floating)return;
      const available=availableWidth();
      dockWidth=clamp(sizingStart.width+dx,nativeDock?minimumDockWidth():Math.min(300,available),available);
      const limit=normalLimit();
      if(!expanded&&dockWidth>limit+12){normalDockWidth=Math.min(sizingStart.width,limit);expanded=true;}
      else if(expanded&&dockWidth<=limit)expanded=false;
      screen.classList.add("dk-sized");layout();
    });
    edge.addEventListener("dblclick",event=>{
      event.stopPropagation();
      if(floating)return;
      reset();
    });
  }
  for(const element of [handle,corner,resetButton])element.addEventListener("dblclick",e=>e.stopPropagation());
  window.addEventListener("resize",layout);
  if(!nativeDock&&(dockWidth||saved.floating))toggle(Boolean(saved.floating));
  else layout();
  return {toggle,toggleTheater,isFloating:()=>floating,isTheater:()=>expanded&&!floating,layout,reset};
}
root.DKPlayerWindow={attach};
})(typeof window!=="undefined"?window:globalThis);
