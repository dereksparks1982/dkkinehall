"use strict";
/* Validate codec requests without accepting a fabricated native file path.
 * User-picked File paths are resolved by Electron webUtils in the preload;
 * auto-discovered items carry an ID checked again in Electron main.
 */
const path=require("node:path");
const nativeId=/^(?:native|restore):[a-f0-9]{64}$/;
function validPath(value){
  return typeof value==="string"&&value.length>0&&value.length<=4096&&
    !value.includes("\0")&&path.isAbsolute(value);
}
function parseSource(value){
  if(typeof value==="string"){
    if(!validPath(value))throw Error("A selected local file is required");
    return {kind:"picked",path:value};
  }
  if(!value||typeof value!=="object"||Array.isArray(value)||
     value.kind!=="native"||!nativeId.test(String(value.id||""))||
     !validPath(value.path))
    throw Error("Invalid discovered video selection");
  return {kind:"native",id:value.id,path:value.path};
}
async function resolveSource(value,checkNative){
  const source=parseSource(value);
  if(source.kind==="picked")return source.path;
  if(typeof checkNative!=="function")
    throw Error("Native video verification is unavailable");
  const verified=await checkNative(source.id,source.path);
  if(!verified||!validPath(verified.target))
    throw Error("Native video verification failed");
  return verified.target;
}
module.exports={parseSource,resolveSource};
