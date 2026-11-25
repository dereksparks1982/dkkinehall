/* MKV AAC/Opus audio selection for the Chromium DK Kinehall player.
 * Local File reads, Matroska demuxing, WebCodecs decoding and WebAudio output.
 * Unsupported codecs are not treated as playable. No uploads or DRM bypass.
 */
(function(root,factory) {
  const api=factory();
  if (typeof module==="object" && module.exports) module.exports=api;
  else root.DKMkvAudio=api;
})(typeof globalThis!=="undefined"?globalThis:window,function(){
  "use strict";
  const SEGMENT=0x18538067,INFO=0x1549A966,TRACKS=0x1654AE6B;
  const ENTRY=0xAE,NUMBER=0xD7,CODEC=0x86,PRIVATE=0x63A2,AUDIO=0xE1;
  const CHANNELS=0x9F,RATE=0xB5,DEFAULT_DURATION=0x23E383,SCALE=0x2AD7B1;
  const CLUSTER=0x1F43B675,CLUSTER_TIME=0xE7,SIMPLE=0xA3,GROUP=0xA0,BLOCK=0xA1;
  const MAX_PACKET=2*1024*1024;
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const contextType=()=>globalThis.AudioContext||globalThis.webkitAudioContext;
  const CODECS=new Set(["A_OPUS","A_MPEG/L3","A_FLAC","A_VORBIS"]);
  const canAttempt=track=>Boolean(track &&
    (CODECS.has(track.codec)||String(track.codec||"").startsWith("A_AAC")) &&
    (!["A_FLAC","A_VORBIS"].includes(track.codec)||
      (track.privateData && track.privateData.length>=4)) &&
    typeof globalThis.AudioDecoder==="function" &&
    typeof globalThis.EncodedAudioChunk==="function" && contextType());
  const vint=(bytes,at,strip=false)=>{
    if(at>=bytes.length||!bytes[at]) throw new Error("Invalid EBML integer");
    let mask=128,width=1;
    while(!(bytes[at]&mask)&&width<=8){width++;mask>>=1;}
    if(width>(strip?8:4)||at+width>bytes.length) throw new Error("Invalid EBML width");
    let value=strip?bytes[at]&(mask-1):bytes[at];
    let unknown=strip&&value===mask-1;
    for(let i=1;i<width;i++){
      value=value*256+bytes[at+i];
      unknown=unknown&&bytes[at+i]===255;
    }
    if(!Number.isSafeInteger(value)) throw new Error("EBML value too large");
    return {value,width,unknown};
  };
  const unsigned=bytes=>{
    if(bytes.length>8) throw new Error("Invalid MKV integer");
    let n=0;for(const b of bytes)n=n*256+b;
    if(!Number.isSafeInteger(n)) throw new Error("MKV integer too large");
    return n;
  };
  const readerFor=file=>{
    let cacheStart=-1,cache=new Uint8Array();
    const read=async(at,length)=>{
      if(!Number.isSafeInteger(at)||!Number.isSafeInteger(length)||
         at<0||length<0||at+length>file.size) throw new Error("Invalid MKV byte range");
      if(!length)return new Uint8Array();
      if(at<cacheStart||at+length>cacheStart+cache.length){
        cache=new Uint8Array(await file.slice(at,Math.min(file.size,
          at+Math.max(length,256*1024))).arrayBuffer());
        cacheStart=at;
      }
      return cache.subarray(at-cacheStart,at-cacheStart+length);
    };
    const element=async(at,limit)=>{
      if(at+2>limit)return null;
      const head=await read(at,Math.min(12,limit-at));
      const id=vint(head,0),size=vint(head,id.width,true);
      const start=at+id.width+size.width;
      const end=size.unknown?limit:start+size.value;
      if(end>limit||end<start||!Number.isSafeInteger(end))
        throw new Error("Invalid MKV element size");
      return {id:id.value,start,end,unknown:size.unknown};
    };
    const children=async function*(from,to){
      let at=from,visits=0;
      while(at+2<=to){
        const node=await element(at,to);
        if(!node)break;
        yield node;
        if(node.unknown||node.end<=at)break;
        at=node.end;
        if(++visits%1024===0)await sleep(0);
      }
    };
    return {read,children};
  };
  const parseTrack=async(reader,entry)=>{
    const result={number:0,codec:"",privateData:null,channels:2,rate:48000,defaultDuration:0};
    for await(const field of reader.children(entry.start,entry.end)){
      const size=field.end-field.start;
      if(field.id===NUMBER)result.number=unsigned(await reader.read(field.start,size));
      else if(field.id===CODEC&&size<256)
        result.codec=new TextDecoder().decode(await reader.read(field.start,size));
      else if(field.id===PRIVATE&&size<=65536)
        result.privateData=(await reader.read(field.start,size)).slice();
      else if(field.id===DEFAULT_DURATION)
        result.defaultDuration=unsigned(await reader.read(field.start,size));
      else if(field.id===AUDIO){
        for await(const detail of reader.children(field.start,field.end)){
          const bytes=await reader.read(detail.start,detail.end-detail.start);
          if(detail.id===CHANNELS)result.channels=unsigned(bytes);
          if(detail.id===RATE){
            const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
            if(bytes.length===4)result.rate=dv.getFloat32(0,false);
            if(bytes.length===8)result.rate=dv.getFloat64(0,false);
          }
        }
      }
    }
    return result;
  };
  // Matroska stores three Vorbis setup packets in Xiph-laced CodecPrivate.
  // WebCodecs expects Ogg's page_segments, segment_table, then those bytes.
  // Header type and bounds are checked before allocating decoder memory.
  const vorbisDescription=privateData=>{
    const bytes=privateData instanceof Uint8Array?privateData:new Uint8Array(privateData||[]);
    if(bytes.length<12||bytes[0]!==2||bytes.length>65536)
      throw new Error("Invalid Matroska Vorbis initialization headers");
    let at=1;
    const sizes=[];
    for(let i=0;i<2;i++){
      let size=0,part=255;
      while(part===255){
        if(at>=bytes.length)throw new Error("Truncated Vorbis header lacing");
        part=bytes[at++];size+=part;
        if(size>65536)throw new Error("Oversized Vorbis header");
      }
      sizes.push(size);
    }
    const third=bytes.length-at-sizes[0]-sizes[1];
    sizes.push(third);
    if(sizes.some(n=>n<7))throw new Error("Incomplete Vorbis headers");
    let pos=at;
    const ids=[1,3,5];
    for(let i=0;i<3;i++){
      if(bytes[pos]!==ids[i]||String.fromCharCode(...bytes.subarray(pos+1,pos+7))!=="vorbis")
        throw new Error("Incorrect Vorbis header packet");
      pos+=sizes[i];
    }
    const segments=[];
    for(const size of sizes){
      let remaining=size;
      while(remaining>=255){segments.push(255);remaining-=255;}
      segments.push(remaining);
    }
    if(segments.length>255)throw new Error("Vorbis setup requires too many segments");
    const result=new Uint8Array(1+segments.length+bytes.length-at);
    result[0]=segments.length;
    result.set(segments,1);
    result.set(bytes.subarray(at),1+segments.length);
    return result;
  };
  const flacDescription=privateData=>{
    const bytes=privateData instanceof Uint8Array?privateData:new Uint8Array(privateData||[]);
    if(bytes.length<42||bytes[0]!==102||bytes[1]!==76||bytes[2]!==97||bytes[3]!==67)
      throw new Error("MKV FLAC requires a fLaC stream header");
    // STREAMINFO is the first metadata block (type 0, size exactly 34).
    if((bytes[4]&127)!==0||bytes[5]!==0||bytes[6]!==0||bytes[7]!==34)
      throw new Error("Invalid FLAC STREAMINFO block");
    return bytes;
  };
  const mp3Samples=bytes=>{
    if(!bytes||bytes.length<4||bytes[0]!==255||(bytes[1]&224)!==224)
      return null;
    const version=(bytes[1]>>3)&3,layer=(bytes[1]>>1)&3;
    if(version===1||layer!==1)return null; // MP3 is Layer III.
    return version===3?1152:576;
  };
  const flacSamples=bytes=>{
    if(!bytes||bytes.length<4||bytes[0]!==255||(bytes[1]&254)!==248)return null;
    const code=bytes[2]>>4;
    if(code===1)return 192;
    if(code>=2&&code<=5)return 576*Math.pow(2,code-2);
    if(code>=8&&code<=15)return 256*Math.pow(2,code-8);
    // Blocksize codes 6/7 require scanning variable-sized frame numbers.
    return null;
  };
  const configFor=meta=>{
    if(!Number.isInteger(meta.channels)||meta.channels<1||meta.channels>8||
       !Number.isFinite(meta.rate)||meta.rate<8000||meta.rate>192000)
      throw new Error("Invalid MKV audio channel or sample rate");
    if(meta.codec==="A_OPUS")return {codec:"opus",sampleRate:48000,
      numberOfChannels:meta.channels,
      ...(meta.privateData?{description:meta.privateData}:{})};
    if(meta.codec==="A_MPEG/L3")return {codec:"mp3",
      sampleRate:Math.round(meta.rate),numberOfChannels:meta.channels};
    if(meta.codec==="A_FLAC")return {codec:"flac",
      sampleRate:Math.round(meta.rate),numberOfChannels:meta.channels,
      description:flacDescription(meta.privateData)};
    if(meta.codec==="A_VORBIS")return {codec:"vorbis",
      sampleRate:Math.round(meta.rate),numberOfChannels:meta.channels,
      description:vorbisDescription(meta.privateData)};
    if(meta.codec.startsWith("A_AAC")&&meta.privateData&&meta.privateData.length>=2){
      let profile=(meta.privateData[0]>>3)&31;
      if(profile===31)profile=32+((meta.privateData[0]&7)<<3)+(meta.privateData[1]>>5);
      return {codec:"mp4a.40."+profile,sampleRate:Math.round(meta.rate),
        numberOfChannels:meta.channels,description:meta.privateData};
    }
    throw new Error("This MKV audio track has no supported WebCodecs configuration");
  };
  const discover=async(file,number)=>{
    const reader=readerFor(file);
    for await(const node of reader.children(0,file.size)){
      if(node.id!==SEGMENT)continue;
      let scale=1000000;
      for await(const part of reader.children(node.start,node.end)){
        if(part.id===INFO){
          for await(const info of reader.children(part.start,part.end)){
            if(info.id===SCALE)scale=unsigned(await reader.read(info.start,info.end-info.start));
          }
        }else if(part.id===TRACKS){
          for await(const entry of reader.children(part.start,part.end)){
            if(entry.id!==ENTRY)continue;
            const meta=await parseTrack(reader,entry);
            if(meta.number===number)return {reader,segment:node,meta,scale};
          }
        }
      }
      break;
    }
    throw new Error("Selected MKV audio stream was not found");
  };
  const opusDuration=bytes=>{
    if(!bytes.length)return 20000;
    const c=bytes[0]>>3;
    const frame=c<12?[10000,20000,40000,60000][c%4]:
      c<16?[10000,20000][c%2]:[2500,5000,10000,20000][c%4];
    const mode=bytes[0]&3;
    const count=mode===0?1:mode===3?(bytes[1]||0)&63:2;
    return Math.min(120000,frame*Math.max(1,count));
  };
  const frameDuration=(bytes,meta)=>{
    if(meta.defaultDuration)return meta.defaultDuration/1000;
    if(meta.codec==="A_OPUS")return opusDuration(bytes);
    if(meta.codec==="A_MPEG/L3")
      return (mp3Samples(bytes)||1152)*1000000/meta.rate;
    if(meta.codec==="A_FLAC")
      return (flacSamples(bytes)||1024)*1000000/meta.rate;
    if(meta.codec==="A_VORBIS")return 20000; // nominal; prefer DefaultDuration
    return 1024*1000000/meta.rate;
  };
  const splitBlock=async(reader,part,number)=>{
    const size=part.end-part.start;
    if(size<4)return [];
    const head=await reader.read(part.start,Math.min(20,size));
    const id=vint(head,0,true);
    if(id.value!==number)return [];
    if(size>MAX_PACKET)throw new Error("MKV audio block exceeds safe size");
    const bytes=await reader.read(part.start,size);
    const displacement=(bytes[id.width]<<8)|bytes[id.width+1];
    const relative=displacement&32768?displacement-65536:displacement;
    const flags=bytes[id.width+2],lace=flags&6;
    let p=id.width+3;
    let count=1,sizes=[];
    if(lace){
      count=bytes[p++]+1;
      if(count>256)throw new Error("Invalid MKV lacing");
      if(lace===4){
        const remain=size-p;
        if(remain%count)throw new Error("Invalid fixed-size MKV lacing");
        sizes=Array(count).fill(remain/count);
      }else{
        let total=0,previous=0;
        for(let i=0;i<count-1;i++){
          let length=0;
          if(lace===2){
            let digit;
            do{
              if(p>=size)throw new Error("Invalid Xiph lacing");
              digit=bytes[p++];length+=digit;
            }while(digit===255);
          }else{
            const value=vint(bytes,p,true);p+=value.width;
            length=i===0?value.value:previous+value.value-
              (Math.pow(2,7*value.width-1)-1);
          }
          if(!Number.isSafeInteger(length)||length<0)throw new Error("Invalid audio frame size");
          sizes.push(length);previous=length;total+=length;
        }
        sizes.push(size-p-total);
      }
    }else sizes=[size-p];
    if(sizes.some(n=>n<0)||sizes.reduce((a,b)=>a+b,0)!==size-p)
      throw new Error("Corrupt MKV audio frame boundaries");
    return sizes.map(length=>{const data=bytes.slice(p,p+length);p+=length;return {data,relative};});
  };
  // Test fixture inspection uses the same local Matroska reader, lacing
  // parser and decoder configuration as the live track player. No server.
  // Keep this bounded; never read a whole feature-length movie into memory.
  const inspectAudioPackets=async(file,number,maxFrames=12)=>{
    const info=await discover(file,number);
    const {reader,segment,meta,scale}=info;
    const config=configFor(meta),frames=[];
    let clusters=0,bytes=0;
    for await(const part of reader.children(segment.start,segment.end)){
      if(part.id!==CLUSTER)continue;
      if(++clusters>16)break;
      let clusterTime=0;
      for await(const child of reader.children(part.start,part.end)){
        if(child.id===CLUSTER_TIME){
          clusterTime=unsigned(await reader.read(child.start,child.end-child.start));
          continue;
        }
        const blocks=[];
        if(child.id===SIMPLE)blocks.push(child);
        else if(child.id===GROUP){
          for await(const gc of reader.children(child.start,child.end))
            if(gc.id===BLOCK)blocks.push(gc);
        }
        for(const block of blocks){
          bytes+=block.end-block.start;
          if(bytes>4*1024*1024)break;
          const packets=await splitBlock(reader,block,meta.number);
          let timestamp=null;
          for(const packet of packets){
            if(timestamp===null)timestamp=(clusterTime+packet.relative)*scale/1000;
            frames.push({timestamp:Math.round(timestamp),
              duration:Math.max(1,Math.round(frameDuration(packet.data,meta))),
              data:packet.data});
            if(frames.length>=maxFrames)return {config,frames};
            timestamp+=frameDuration(packet.data,meta);
          }
        }
        if(bytes>4*1024*1024)break;
      }
      if(bytes>4*1024*1024)break;
    }
    return {config,frames};
  };
  const create=({media,onError=()=>{},isMuted=()=>false})=>{
    let epoch=0,ctx=null,gain=null,decoder=null,selection=null;
    let level=1,scheduled=new Set(),recovering=false,pausedAt=0;
    const selectedNumber=()=>selection?selection.track.number:null;
    const active=()=>Boolean(selection&&decoder);
    const setVolume=value=>{
      level=Math.max(0,Math.min(1,Number(value)||0));
      if(gain)gain.gain.value=level;
    };
    const stop=()=>{
      ++epoch;
      selection=null;
      const old=decoder;decoder=null;
      if(old){try{old.close();}catch(_){}}
      for(const node of scheduled){try{node.stop();}catch(_){}}
      scheduled.clear();
      pausedAt=0;
      const previous=ctx;ctx=null;gain=null;
      if(previous)void previous.close().catch(()=>{});
      media.muted=Boolean(isMuted());
    };
    const fail=(err,token)=>{
      if(token!==epoch||recovering)return;
      recovering=true;
      stop();
      recovering=false;
      onError(err);
    };
    const output=(frame,token)=>{
      try{
        if(token!==epoch||!ctx||!gain||media.seeking||media.paused)return;
        const seconds=frame.timestamp/1000000;
        const difference=seconds-media.currentTime;
        if(!Number.isFinite(difference)||difference<-.18||difference>2.4)return;
        const channels=frame.numberOfChannels;
        if(channels<1||channels>8||frame.numberOfFrames<1)return;
        const buffer=ctx.createBuffer(channels,frame.numberOfFrames,frame.sampleRate);
        for(let c=0;c<channels;c++){
          const plane=new Float32Array(frame.numberOfFrames);
          frame.copyTo(plane,{planeIndex:c,format:"f32-planar"});
          buffer.copyToChannel(plane,c);
        }
        const node=ctx.createBufferSource();
        node.buffer=buffer;
        node.playbackRate.value=media.playbackRate||1;
        node.connect(gain);
        scheduled.add(node);
        node.onended=()=>{scheduled.delete(node);node.disconnect();};
        node.start(Math.max(ctx.currentTime+.008,
          ctx.currentTime+difference/(media.playbackRate||1)+.04));
      }catch(err){fail(err,token);}
      finally{frame.close();}
    };
    const run=async(info,token)=>{
      const {reader,segment,meta,scale}=info;
      let localDecoder=decoder;
      for await(const part of reader.children(segment.start,segment.end)){
        if(token!==epoch)return;
        if(part.id!==CLUSTER)continue;
        let clusterTime=0;
        for await(const child of reader.children(part.start,part.end)){
          if(token!==epoch)return;
          if(child.id===CLUSTER_TIME){
            clusterTime=unsigned(await reader.read(child.start,child.end-child.start));
            continue;
          }
          const blocks=[];
          if(child.id===SIMPLE)blocks.push(child);
          else if(child.id===GROUP){
            for await(const groupChild of reader.children(child.start,child.end))
              if(groupChild.id===BLOCK)blocks.push(groupChild);
          }
          for(const block of blocks){
            const frames=await splitBlock(reader,block,meta.number);
            if(!frames.length)continue;
            let timestamp=null;
            for(const frame of frames){
              if(timestamp===null)timestamp=(clusterTime+frame.relative)*scale/1000;
              const seconds=timestamp/1000000;
              while(token===epoch&&(media.paused||media.seeking||
                    seconds>media.currentTime+1.6))await sleep(40);
              if(token!==epoch)return;
              if(seconds>=media.currentTime-.15){
                while(token===epoch&&localDecoder.decodeQueueSize>12)await sleep(12);
                if(token!==epoch)return;
                localDecoder.decode(new EncodedAudioChunk({type:"key",
                  timestamp:Math.round(timestamp),
                  duration:Math.max(1,Math.round(frameDuration(frame.data,meta))),
                  data:frame.data}));
              }
              timestamp+=frameDuration(frame.data,meta);
            }
          }
        }
      }
      if(token===epoch)await localDecoder.flush();
    };
    const start=async(file,track)=>{
      if(!canAttempt(track))throw new Error("Chromium WebCodecs cannot decode this audio codec");
      stop();
      const token=epoch;
      selection={file,track};
      const AudioContext=contextType();
      ctx=new AudioContext();
      gain=ctx.createGain();gain.gain.value=level;gain.connect(ctx.destination);
      try{
        const info=await discover(file,track.number);
        if(token!==epoch)return false;
        const config=configFor(info.meta);
        const support=await AudioDecoder.isConfigSupported(config);
        if(token!==epoch)return false;
        if(!support.supported)throw new Error("Chromium does not support this MKV audio codec");
        decoder=new AudioDecoder({
          output:frame=>output(frame,token),
          error:err=>fail(err,token)
        });
        decoder.configure(config);
        media.muted=true;
        if(!media.paused)await ctx.resume();
        if(token!==epoch)return false;
        void run(info,token).catch(err=>fail(err,token));
        return true;
      }catch(err){
        if(token===epoch)stop();
        throw err;
      }
    };
    const hold=()=>{
      if(!ctx)return;
      for(const node of scheduled){try{node.stop();}catch(_){}}
      scheduled.clear();
      void ctx.suspend().catch(()=>{});
    };
    const restart=()=>{
      if(!selection)return;
      const {file,track}=selection;
      void start(file,track).catch(err=>onError(err));
    };
    media.addEventListener("pause",()=>{
      if(selection)pausedAt=Date.now();
      if(ctx)void ctx.suspend().catch(()=>{});
    });
    media.addEventListener("play",()=>{
      if(!ctx)return;
      // Decoder output may be discarded while paused. Reprime from the
      // current video timestamp instead of resuming with an audio gap.
      if(selection&&pausedAt&&Date.now()-pausedAt>200)restart();
      else void ctx.resume().catch(()=>{});
      pausedAt=0;
    });
    return {start,stop,hold,restart,active,selectedNumber,setVolume,canAttempt};
  };
  return {create,canAttempt,configFor,opusDuration,frameDuration,splitBlock,
    flacDescription,vorbisDescription,mp3Samples,flacSamples,inspectAudioPackets};
});
