/* Local-only watchlist and metadata facets; no network or media reads. */
(() => {
"use strict";
if(!window.DKLibraryBridge?.internalPages)return;
const key="dk-kinehall.library.watchlist.v1",norm=s=>String(s??"").normalize("NFKC").trim().toLocaleLowerCase();
const words=v=>Array.isArray(v)?v.filter(x=>typeof x==="string"&&x.trim()).map(x=>x.trim()):[];
let saved=new Set();
try{const v=JSON.parse(localStorage.getItem(key)||"[]");if(Array.isArray(v))saved=new Set(v.filter(x=>typeof x==="string").slice(0,20000));}catch(_){}
const seriesId=r=>"series:"+norm(r.series||r.title);
const id=r=>r.kind==="tv"?seriesId(r):"movie:"+r.id;
function toggle(row){
 const k=id(row),next=new Set(saved);
 if(next.has(k))next.delete(k);else{if(next.size>=20000)return false;next.add(k);}
 try{localStorage.setItem(key,JSON.stringify([...next]));saved=next;return true;}catch(_){return false;}
}
const has=row=>saved.has(id(row));
const edition=row=>{
 const s=String(row.filename||"").replace(/[._-]+/g," ").toLowerCase();
 if(/\bdirector(?:'s|s)? cut\b/.test(s))return "director";
 if(/\bextended(?: cut| edition)?\b/.test(s))return "extended";
 if(/\btheatrical(?: cut| edition)?\b/.test(s))return "theatrical";
 if(/\bunrated(?: cut| edition)?\b/.test(s))return "unrated";
 return "";
};
function values(row,kind){
 const d=row.movieDetails||{};
 if(kind==="genre")return words(d.genres);
 if(kind==="actor")return words(d.cast);
 if(kind==="director")return words(d.directors);
 if(kind==="decade"){const y=Number(row.year);return Number.isInteger(y)&&y>=1880&&y<=2100?[String(Math.floor(y/10)*10)]:[];}
 if(kind==="edition"){const e=edition(row);return e?[e]:[];}
 return [];
}
function options(rows,kind){
 const found=new Map();
 for(const row of rows)for(const v of values(row,kind)){const n=norm(v);if(n&&!found.has(n))found.set(n,v);}
 return [...found.values()].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
}
function filter(rows,kind,value,query,onlySaved){
 const q=norm(query),v=norm(value);
 return rows.filter(row=>{
  if(onlySaved&&!has(row))return false;
  if(kind&&v&&!values(row,kind).some(x=>norm(x)===v))return false;
  return !q||[row.title,row.series,row.episodeTitle,row.filename,...words(row.movieDetails?.cast),...words(row.movieDetails?.directors),...words(row.movieDetails?.genres)].some(x=>norm(x).includes(q));
 });
}
window.DKCollections=Object.freeze({has,toggle,options,filter,edition});
})();