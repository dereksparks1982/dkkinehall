/* DK Kinehall: local Matroska S_VOBSUB DVD subpicture decoder.
 * CodecPrivate carries IDX palette and screen size. SPU packets are the same
 * DVD subpicture packets after MPEG program-stream headers are discarded.
 * No OCR, remote conversion, external binary or codec installation.
 */
(function(root,factory) {
  const api=factory();
  if(typeof module==="object" && module.exports)module.exports=api;
  else root.DKVobSub=api;
})(typeof globalThis!=="undefined"?globalThis:window,function(){
  "use strict";
  const MAX_PIXELS=1920*1080, MAX_EVENTS=2500, MAX_RGBA=64*1024*1024;
  const canRender=codec=>String(codec||"").toUpperCase()==="S_VOBSUB";
  const word=(b,i)=>((b[i]<<8)|b[i+1])>>>0;
  const parsePrivate=value=>{
    const text=typeof value==="string"?value:
      new TextDecoder().decode(value||new Uint8Array());
    const size=/^size:\s*(\d+)\s*x\s*(\d+)/im.exec(text);
    const colors=/^palette:\s*([^\r\n]+)/im.exec(text);
    if(!size||!colors)throw Error("VobSub screen size or palette is missing");
    const width=Number(size[1]),height=Number(size[2]);
    if(!width||!height||width*height>MAX_PIXELS)
      throw Error("VobSub canvas dimensions exceed the safety limit");
    const names=colors[1].split(",").map(v=>v.trim());
    if(names.length!==16||names.some(x=>!/^[0-9a-fA-F]{6}$/.test(x)))
      throw Error("VobSub requires a 16-color palette");
    return {width,height,palette:names.map(x=>{
      const code=parseInt(x,16);
      return [(code>>16)&255,(code>>8)&255,code&255];
    })};
  };
  const nibbleReader=(bytes,start,limit)=>{
    let offset=start*2;
    const nibble=()=>{
      if(offset>=limit*2)throw Error("Truncated DVD subtitle RLE data");
      const byte=bytes[offset>>1];
      const value=(offset&1)?byte&15:byte>>4;
      offset++;
      return value;
    };
    // DVD 2-bit RLE is 1–4 nibbles. A single nibble >=4 is already
    // a complete code; only a value below the current threshold continues.
    const code=()=>{
      let n=0;
      for(let threshold=1;n<threshold&&threshold<=0x40;threshold*=4)
        n=(n<<4)|nibble();
      return n;
    };
    return {code,align:()=>{if(offset&1)offset++;}};
  };
  function unpackPacket(packet, privateData, packetTime=0, duration=null) {
    if(!(packet instanceof Uint8Array))packet=new Uint8Array(packet);
    const meta=typeof privateData==="object" && "palette" in privateData?
      privateData:parsePrivate(privateData);
    if(packet.length<8||packet.length>2*1024*1024)
      throw Error("Invalid VobSub packet length");
    const length=word(packet,0),controlAt=word(packet,2);
    if(length>packet.length||length<8||controlAt<4||controlAt>=length)
      throw Error("Invalid VobSub SPU header");
    let at=controlAt,segments=0;
    let startDelay=0,stopDelay=null;
    let palettes=0,alphas=0;
    let coords=null,offsets=null,enabled=false;
    const visited=new Set();
    while(at+4<=length&&!visited.has(at)&&segments++<64){
      visited.add(at);
      const delay=word(packet,at),next=word(packet,at+2);
      let pos=at+4;
      while(pos<length){
        const opcode=packet[pos++];
        if(opcode===0xff)break;
        if(opcode===0x00||opcode===0x01){enabled=true;startDelay=delay;}
        else if(opcode===0x02){stopDelay=delay;}
        else if(opcode===0x03){
          if(pos+2>length)throw Error("Incomplete VobSub palette command");
          palettes=word(packet,pos);pos+=2;
        }else if(opcode===0x04){
          if(pos+2>length)throw Error("Incomplete VobSub alpha command");
          alphas=word(packet,pos);pos+=2;
        }else if(opcode===0x05){
          if(pos+6>length)throw Error("Incomplete VobSub coordinates");
          const x1=(packet[pos]<<4)|(packet[pos+1]>>4);
          const x2=((packet[pos+1]&15)<<8)|packet[pos+2];
          const y1=(packet[pos+3]<<4)|(packet[pos+4]>>4);
          const y2=((packet[pos+4]&15)<<8)|packet[pos+5];
          coords={x:x1,y:y1,width:x2-x1+1,height:y2-y1+1};pos+=6;
        }else if(opcode===0x06){
          if(pos+4>length)throw Error("Incomplete VobSub data offsets");
          offsets=[word(packet,pos),word(packet,pos+2)];pos+=4;
        }else{
          // Command 7 is the DVD change-color/contrast table, unsupported.
          // Reject rather than silently claiming a correct subtitle picture.
          throw Error("Unsupported VobSub display control");
        }
      }
      if(next===at||next<controlAt||next>=length)break;
      at=next;
    }
    if(!enabled||!coords||!offsets)return null;
    const {x,y,width,height}=coords;
    if(width<1||height<1||width*height>MAX_PIXELS||x<0||y<0||
       x+width>meta.width||y+height>meta.height)
      throw Error("VobSub bitmap is outside the declared frame");
    if(offsets.some(off=>off<4||off>=controlAt))
      throw Error("VobSub bitmap data offsets are invalid");
    const pixels=new Uint8ClampedArray(width*height*4);
    for(let parity=0;parity<2;parity++){
      const reader=nibbleReader(packet,offsets[parity],controlAt);
      for(let row=parity;row<height;row+=2){
        let col=0,visits=0;
        while(col<width){
          if(++visits>width*4+256)throw Error("Invalid VobSub run sequence");
          const code=reader.code();
          const run=Math.min(code>>2||width-col,width-col);
          const index=code&3;
          const color=meta.palette[(palettes>>(4*index))&15];
          const alpha=((alphas>>(4*index))&15)*17;
          for(let k=0;k<run;k++){
            const off=(row*width+col++)*4;
            pixels[off]=color[0];pixels[off+1]=color[1];
            pixels[off+2]=color[2];pixels[off+3]=alpha;
          }
        }
        reader.align();
      }
    }
    const start=Math.max(0,packetTime+startDelay*1024/90000);
    const end=stopDelay!==null?
      Math.max(start+.001,packetTime+stopDelay*1024/90000):
      duration!==null?start+Math.max(.001,duration):null;
    return {start,end,width:meta.width,height:meta.height,
      x,y,bitmapWidth:width,bitmapHeight:height,pixels};
  }
  async function extract(file,track,options={}) {
    if(!canRender(track?.codec)||!globalThis.DKMkvSubtitles?.scanTrackPackets)
      throw Error("VobSub packet scanner unavailable");
    const meta=parsePrivate(track.privateData);
    const events=[];let rgbaBytes=0;
    const count=await globalThis.DKMkvSubtitles.scanTrackPackets(file,track,
      packet=>{
        const event=unpackPacket(packet.data,meta,packet.time,packet.duration);
        if(!event)return;
        rgbaBytes+=event.pixels.byteLength;
        if(events.length>=MAX_EVENTS||rgbaBytes>MAX_RGBA)
          throw Error("VobSub subtitles exceed the memory safety limit");
        events.push(event);
      },options);
    events.sort((a,b)=>a.start-b.start);
    for(let i=0;i<events.length-1;i++){
      const next=events[i+1].start;
      if(events[i].end===null||events[i].end>next)events[i].end=next;
    }
    if(!events.length)throw Error("No playable VobSub bitmap packets found");
    return {events,packets:count};
  }
  const frameAt=(events,time)=>{
    if(!events?.length||!Number.isFinite(time))return null;
    let lo=0,hi=events.length-1,found=-1;
    while(lo<=hi){const mid=(lo+hi)>>>1;
      if(events[mid].start<=time){found=mid;lo=mid+1;}else hi=mid-1;
    }
    const e=events[found];
    return e&&(e.end===null||time<e.end)?e:null;
  };
  const render=(canvas,frame)=>{
    if(!canvas||!frame)return;
    if(canvas.width!==frame.width)canvas.width=frame.width;
    if(canvas.height!==frame.height)canvas.height=frame.height;
    const ctx=canvas.getContext("2d");
    if(!ctx)throw Error("VobSub canvas unavailable");
    ctx.clearRect(0,0,frame.width,frame.height);
    const img=ctx.createImageData(frame.bitmapWidth,frame.bitmapHeight);
    img.data.set(frame.pixels);
    ctx.putImageData(img,frame.x,frame.y);
  };
  return {canRender,parsePrivate,unpackPacket,extract,frameAt,render};
});
