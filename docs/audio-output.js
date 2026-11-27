/* Standalone output routing and sample-peak protection. No external dependency. */
(() => {
"use strict";
function curve(){
 const points=new Float32Array(4097);
 for(let i=0;i<points.length;i++){
  const x=2*i/(points.length-1)-1,a=Math.abs(x);
  // Transparent below the knee; smoothly compress the top 10%.
  const y=a<=.9?a:.9+.08*(1-Math.exp(-(a-.9)/.035));
  points[i]=Math.sign(x)*y;
 }
 return points;
}
function setChannels(node,mode){
 const stereo=mode==="headphones"||mode==="stereo";
 node.channelInterpretation="speakers";
 node.channelCount=2;
 node.channelCountMode=stereo?"explicit":"max";
}
function create(context,master,getSettings){
 const bus=context.createGain();
 master.connect(bus);
 let compressor=null,guard=null,route=null;
 function apply(){
  const s=getSettings();
  setChannels(bus,s.mode);
  const stereo=s.mode==="headphones"||s.mode==="stereo"||context.destination.channelCount<=2;
  const next=!s.protect?"direct":stereo?"compressed":"guard";
  if(next===route)return;
  bus.disconnect();compressor?.disconnect();guard?.disconnect();
  try{
   if(next==="direct")bus.connect(context.destination);
   else{
    if(!guard){guard=context.createWaveShaper();guard.curve=curve();guard.oversample="none";guard.channelCountMode="max";}
    if(next==="compressed"){
     if(!compressor){
      compressor=context.createDynamicsCompressor();
      compressor.threshold.value=-1.5;compressor.knee.value=0;compressor.ratio.value=20;
      compressor.attack.value=.003;compressor.release.value=.09;
     }
     bus.connect(compressor);compressor.connect(guard);
    }else bus.connect(guard);
    guard.connect(context.destination);
   }
   route=next;
  }catch(error){
   bus.disconnect();compressor?.disconnect();guard?.disconnect();bus.connect(context.destination);route=null;throw error;
  }
 }
 try{apply();}catch(_){}
 return {bus,apply};
}
window.DKAudioOutput=Object.freeze({create,setChannels});
})();