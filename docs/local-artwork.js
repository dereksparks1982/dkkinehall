/* DK Kinehall: local folder artwork matcher.
 * Works only with files from a folder explicitly chosen by the user.
 * No image bytes or names are sent to outside services. Never fetch paths.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.DKLocalArtwork=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  "use strict";
  const MAX_IMAGE_BYTES=8*1024*1024;
  const IMAGE=/\.(?:jpe?g|png|webp)$/i;
  const DEFAULTS=new Map([
    ["poster",65],["folder",60],["cover",58],["front",54],
    ["movie",50],["season",46],["series",44],["artwork",40]
  ]);
  function splitPath(path){
    const value=String(path||"").replace(/\\/g,"/");
    const i=value.lastIndexOf("/");
    return {folder:i===-1?"":value.slice(0,i+1),name:value.slice(i+1)};
  }
  function stem(name){return String(name||"").replace(/\.[^.]+$/,"")}
  function norm(value){
    return String(value||"").normalize("NFKD")
      .replace(/[\u0300-\u036f]/g,"")
      .replace(/[\[\](){}._-]+/g," ")
      .replace(/[^a-zA-Z0-9\u0400-\u04ff]+/g," ")
      .toLowerCase().replace(/\s+/g," ").trim();
  }
  function cleanMovie(name){
    return norm(stem(name)
      .replace(/\b(?:2160p|1080p|720p|480p|bluray|brrip|webrip|web.dl|hdr|x264|x265|h264|h265|hevc|aac|ac3|dts)\b.*$/i,""));
  }
  function commonName(name){
    const base=norm(stem(name));
    if(DEFAULTS.has(base))return DEFAULTS.get(base);
    if(/^season\s*\d{1,2}(?:\s*poster|\s*cover)?$/.test(base))return 48;
    if(/^series\s*(?:poster|cover|art)$/.test(base))return 47;
    return 0;
  }
  function score(video,poster,mediaCount){
    const v=splitPath(video.path||video.file?.name);
    const p=splitPath(poster.path||poster.file?.name);
    if(!IMAGE.test(p.name))return -1;
    const same=v.folder.toLowerCase()===p.folder.toLowerCase();
    const parent=v.folder.lastIndexOf("/",v.folder.length-2);
    const parentDir=parent<0?"":v.folder.slice(0,parent+1);
    const near=same||parentDir.toLowerCase()===p.folder.toLowerCase();
    if(!near)return -1;
    const videoStem=norm(stem(v.name)),posterStem=norm(stem(p.name));
    const base=cleanMovie(v.name);
    const common=commonName(p.name);
    if(same&&posterStem===videoStem)return 110;
    if(same&&posterStem===base)return 105;
    if(same&&posterStem===videoStem+" poster")return 100;
    if(same&&posterStem===videoStem+" cover")return 99;
    if(same&&base&&posterStem===base+" poster")return 96;
    if(same&&base&&posterStem===base+" cover")return 95;
    if(same&&common){
      // Do not assign a generic folder poster to unrelated movies that
      // happen to share a directory. Episodic series may share series art.
      const episodic=/\bs\d{1,2}\s*e\d{1,3}\b|(?:^|\s)\d{1,2}\s*x\s*\d{1,3}\b/i.test(videoStem);
      if(mediaCount>1&&!episodic)return -1;
      return common;
    }
    if(!same&&common)return common-30;
    return -1;
  }
  function match(mediaEntries,artworkEntries){
    const files=Array.isArray(mediaEntries)?mediaEntries:[];
    const images=(Array.isArray(artworkEntries)?artworkEntries:[])
      .filter(e=>e&&typeof e.path==="string"&&IMAGE.test(e.path))
      .slice(0,1000);
    const counts=new Map();
    for(const file of files){
      const dir=splitPath(file.path||file.file?.name).folder.toLowerCase();
      counts.set(dir,(counts.get(dir)||0)+1);
    }
    const result=new Map();
    for(const media of files){
      if(!media?.file||!media.path)continue;
      const dir=splitPath(media.path).folder.toLowerCase();
      let choice=null,best=-1;
      for(const image of images){
        const rank=score(media,image,counts.get(dir)||1);
        if(rank>best){choice=image;best=rank;}
      }
      if(best>=0&&choice)result.set(media.path,choice);
    }
    return result;
  }
  async function load(entry){
    if(!entry)return null;
    const file=entry.file || (entry.handle&&typeof entry.handle.getFile==="function"
      ?await entry.handle.getFile():null);
    if(!file||file.size<=0||file.size>MAX_IMAGE_BYTES||
       !IMAGE.test(file.name||entry.path||""))return null;
    // The browser decodes the image; never evaluate SVG, script, or HTML.
    if(file.type && !["image/jpeg","image/png","image/webp"].includes(file.type))
      return null;
    return file;
  }
  return Object.freeze({match,load,MAX_IMAGE_BYTES,score});
});