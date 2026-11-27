/* DK Media Player seek preview. A second, muted, paused video is used only
   for local media. Hover never changes playback on the primary video. */
(function(root, factory){
  const api = factory();
  if(typeof module !== "undefined" && module.exports)module.exports=api;
  else root.DKSeekPreview=api;
})(typeof window !== "undefined" ? window : globalThis, function(){
 "use strict";
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function position(clientX,left,width){
   return width>0?clamp((clientX-left)/width,0,1):0;
 }
 function attach({seek,bubble,frame,label,current,duration,formatTime}){
   let frameSource="", pendingTime=null, timer=null, failed=false,request=0,nativeBusy=false,nativeWanted=null;
   const bridge=typeof window!=="undefined"&&window.DKLibraryBridge?.internalPages?window.DKCodecBridge:null;
   const nativeImage=bridge?.previewFrame?document.createElement("img"):null;
   if(nativeImage){nativeImage.className="dk-native-seek-frame";nativeImage.alt="";nativeImage.hidden=true;frame.before(nativeImage);}
   function clearNative(){request++;nativeWanted=null;if(nativeImage)nativeImage.hidden=true;void bridge?.cancelPreview?.().catch(()=>{});}
   async function pumpNative(){
     if(nativeBusy||!nativeWanted||!nativeImage||bubble.hidden)return;
     const job=nativeWanted;nativeWanted=null;nativeBusy=true;
     try{
       const result=await bridge.previewFrame(job.item.file,job.at);
       if(job.id!==request||current()!==job.item||bubble.hidden||!result||typeof result.base64!=="string"||result.base64.length>220000||Math.abs((pendingTime??-100)-job.at)>2)return;
       nativeImage.src="data:image/jpeg;base64,"+result.base64;nativeImage.hidden=false;frame.hidden=true;bubble.classList.add("has-frame");
     }catch(_){}finally{nativeBusy=false;if(nativeWanted)void pumpNative();}
   }
   const scheduleNative=item=>{if(!nativeImage||!item?.file||item.file.dvdToken||item.audio||item.kind!=="file"||bubble.hidden)return;nativeWanted={item,at:pendingTime,id:++request};void pumpNative();};
   const clear=()=>{clearTimeout(timer);timer=null;};
   const hide=()=>{clear();bubble.hidden=true;clearNative();if(nativeImage&&!nativeImage.hidden)nativeImage.hidden=true;};
   const reset=()=>{
     hide();frameSource="";pendingTime=null;failed=false;
     frame.hidden=true;bubble.classList.remove("has-frame");if(nativeImage)nativeImage.removeAttribute("src");
     try{frame.pause();frame.removeAttribute("src");frame.load();}catch(_){}
   };
   const seekFrame=()=>{
     if(failed||pendingTime===null||!frameSource)return;
     if(frame.readyState<1)return;
     try{frame.currentTime=pendingTime;}catch(_){frame.hidden=true;}
   };
   const show=(event=null)=>{
     const item=current(),length=duration();
     if(!item||seek.disabled||!Number.isFinite(length)||length<=0){hide();return;}
     const rect=seek.getBoundingClientRect();
     if(!rect.width){hide();return;}
     const fraction=event&&Number.isFinite(event.clientX)?
       position(event.clientX,rect.left,rect.width):
       clamp(Number(seek.value)/1000,0,1);
     pendingTime=clamp(fraction*length,0,Math.max(0,length-.05));
     const bubbleWidth=frame.hidden&&(!nativeImage||nativeImage.hidden)?70:160;
     const margin=Math.min(rect.width/2,bubbleWidth/2);
     bubble.style.left=clamp(fraction*rect.width,margin,rect.width-margin)+"px";
     label.textContent=formatTime(pendingTime);
     bubble.hidden=false;
     // Remote URLs could cause additional requests; only inspect local blobs.
     if(item.kind!=="file"||item.audio||!item.src){frame.hidden=true;if(nativeImage)nativeImage.hidden=true;bubble.classList.remove("has-frame");return;}
     if(nativeImage&&item.file&&!item.file.dvdToken&&(item.codecActive||item.file.nativeVirtual||failed)){clear();frame.hidden=true;timer=setTimeout(()=>scheduleNative(item),160);return;}
     if(item.src!==frameSource){
       frameSource=item.src;failed=false;frame.hidden=true;
       bubble.classList.remove("has-frame");
       try{frame.muted=true;frame.src=item.src;frame.load();}
       catch(_){failed=true;return;}
     }
     clear();
     timer=setTimeout(seekFrame,110);
   };
   seek.addEventListener("pointermove",event=>{
     if(event.pointerType!=="touch")show(event);
   });
   seek.addEventListener("pointerenter",event=>{
     if(event.pointerType!=="touch")show(event);
   });
   seek.addEventListener("pointerleave",hide);
   seek.addEventListener("pointerdown",event=>show(event));
   seek.addEventListener("pointerup",event=>{
     if(event.pointerType==="touch")setTimeout(hide,550);
   });
   seek.addEventListener("pointercancel",hide);
   seek.addEventListener("focus",()=>show());
   seek.addEventListener("blur",hide);
   seek.addEventListener("input",()=>show());
   frame.addEventListener("loadedmetadata",seekFrame);
   frame.addEventListener("seeked",()=>{
     const item=current();
     if(!bubble.hidden&&!failed&&item&&item.kind==="file"&&
        frameSource===item.src&&frame.readyState>=2){
       frame.hidden=false;bubble.classList.add("has-frame");
     }
   });
   frame.addEventListener("error",()=>{
     failed=true;frame.hidden=true;bubble.classList.remove("has-frame");
     const item=current();if(item&&nativeImage&&!bubble.hidden){clear();timer=setTimeout(()=>scheduleNative(item),160);}
   });
   return {hide,reset};
 }
 return {attach,position};
});