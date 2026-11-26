/* A lightweight local-file adapter for discovered native videos.
 * It uses the original player, player controls, and Electron's local file:
 * URL. MKV inspection reads bounded byte ranges only when requested;
 * no video is loaded wholesale into memory or copied to the catalog.
 */
(function(root){
"use strict";
function create(row,opened,bridge){
  if(!bridge?.readRange||!opened?.url?.startsWith("file://")||
     !row?.nativePath||!Number.isFinite(row.size))
    throw Error("Local video is unavailable");
  // The IndexedDB record can be older than the actual file. Use the
  // freshly validated disk metadata returned by Electron on each opening.
  const size=Number.isSafeInteger(opened.size)&&opened.size>=0?
    opened.size:row.size;
  const modified=Number.isFinite(opened.modified)?
    opened.modified:row.modified;
  const mime=/\.(mp4|m4v|mov)$/i.test(row.filename)?"video/mp4":
    /\.webm$/i.test(row.filename)?"video/webm":
    /\.mkv$/i.test(row.filename)?"video/x-matroska":"video/octet-stream";
  const virtual=Object.freeze({
    nativeVirtual:true,nativeId:row.id,nativePath:row.nativePath,
    name:row.filename,type:mime,size,
    lastModified:Number(modified)||Date.now(),
    webkitRelativePath:row.relative||"",
    slice(start=0,end=size){
      const from=Math.max(0,Math.min(size,Math.trunc(start)||0));
      const to=Math.max(from,Math.min(size,Math.trunc(end)||0));
      return {
        size:to-from,
        async arrayBuffer(){
          const data=await bridge.readRange(row.id,row.nativePath,from,to);
          const bytes=new Uint8Array(data);
          return bytes.slice().buffer;
        }
      };
    }
  });
  return {file:virtual,src:opened.url};
}
root.DKNativeFile={create};
})(typeof window!=="undefined"?window:globalThis);
