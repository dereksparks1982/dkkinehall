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
const customKey="dk-kinehall.library.collections.v1";
let custom={groups:[],editions:{}};
try{const x=JSON.parse(localStorage.getItem(customKey)||"null");if(x&&Array.isArray(x.groups)&&x.editions&&typeof x.editions==="object")custom={groups:x.groups.filter(g=>g&&typeof g.name==="string"&&Array.isArray(g.members)).slice(0,200),editions:x.editions};}catch(_){}
const persist=next=>{try{localStorage.setItem(customKey,JSON.stringify(next));custom=next;return true;}catch(_){return false;}};
const autoKey="dk-kinehall.library.verified-boxsets.v1",excludedKey="dk-kinehall.library.collection-exclusions.v1";
let automatic=[],excluded={};
try{const data=JSON.parse(localStorage.getItem(autoKey)||"[]");if(Array.isArray(data))automatic=data.slice(0,500);}catch(_){}
try{const data=JSON.parse(localStorage.getItem(excludedKey)||"{}");if(data&&typeof data==="object"&&!Array.isArray(data))excluded=data;}catch(_){}
const manualGroups=()=>custom.groups.map(g=>({name:g.name,members:[...g.members]}));
function setAutomatic(data){
 if(!Array.isArray(data))return false;
 const next=data.filter(g=>g&&typeof g.name==="string"&&typeof g.id==="string"&&/^[a-f0-9]{32}$/i.test(g.id)&&Array.isArray(g.members)).slice(0,500).map(g=>({id:g.id,name:g.name.slice(0,180),description:String(g.description||"").slice(0,3000),members:g.members.filter(x=>typeof x==="string"&&x.length<=160).slice(0,5000)}));
 try{localStorage.setItem(autoKey,JSON.stringify(next));}catch(_){}
 automatic=next;return true;
}
function groups(){
 const result=new Map();
 for(const g of automatic){if(!g||typeof g.name!=="string"||!Array.isArray(g.members))continue;const key=norm(g.name),blocked=Array.isArray(excluded[key])?excluded[key]:[];const prev=result.get(key);
  if(prev){prev.members=[...new Set([...prev.members,...g.members.filter(id=>!blocked.includes(id))])];continue;}
  result.set(key,{...g,members:g.members.filter(id=>!blocked.includes(id)),automatic:true});
 }
 for(const g of manualGroups()){const key=norm(g.name),prev=result.get(key);if(prev)prev.members=[...new Set([...prev.members,...g.members])];else result.set(key,g);}
 return [...result.values()].filter(g=>g.members.length);
}
const groupNames=row=>groups().filter(g=>g.members.includes(row.id)).map(g=>g.name);
function setMembership(row,name,enabled){
 const title=String(name||"").trim().slice(0,100);if(!title||row.kind!=="movie"||typeof row.id!=="string")return false;
 const key=norm(title),auto=automatic.some(g=>norm(g.name)===key&&g.members.includes(row.id));
 const next=manualGroups(),existing=next.find(g=>norm(g.name)===key);
 if(auto){
  const previous=Array.isArray(excluded[key])?excluded[key]:[];
  const blocked={...excluded,[key]:enabled?previous.filter(x=>x!==row.id):[...new Set([...previous,row.id])]};
  try{localStorage.setItem(excludedKey,JSON.stringify(blocked));excluded=blocked;}catch(_){return false;}
  if(!existing)return true;
 }
 if(existing){existing.members=enabled?[...new Set([...existing.members,row.id])]:existing.members.filter(x=>x!==row.id);}
 else if(enabled&&next.length<200)next.push({name:title,members:[row.id]});else return false;
 if(next.some(g=>g.members.length>10000))return false;
 return persist({...custom,groups:next.filter(g=>g.members.length)});
}
function setEdition(row,value){
 const allowed=["director","extended","theatrical","unrated","special","standard",""];
 if(!allowed.includes(value)||row.kind!=="movie"||typeof row.id!=="string")return false;
 const editions={...custom.editions};if(value)editions[row.id]=value;else delete editions[row.id];
 return persist({...custom,editions});
}
function movieIdentity(row){
 if(row.kind!=="movie")return "";
 const title=norm(row.title).replace(/\b(?:director(?:'s|s)? cut|extended (?:cut|edition)|theatrical (?:cut|edition)|unrated (?:cut|edition)|special edition)\b/g,"").replace(/\s+/g," ").trim();
 const year=Number(row.year);
 return title&&Number.isInteger(year)&&year>=1880&&year<=2100?title+" ("+year+")":"";
}
function relatedEditions(row,rows){const key=movieIdentity(row);return key?rows.filter(x=>movieIdentity(x)===key):[];}

const edition=row=>{
 const override=custom.editions[row.id];if(typeof override==="string"&&["director","extended","theatrical","unrated","special","standard"].includes(override))return override;
 const s=String(row.filename||"").replace(/[._-]+/g," ").toLowerCase();
 if(/\bdirector(?:'s|s)? cut\b/.test(s))return "director";
 if(/\bextended(?: cut| edition)?\b/.test(s))return "extended";
 if(/\btheatrical(?: cut| edition)?\b/.test(s))return "theatrical";
 if(/\bunrated(?: cut| edition)?\b/.test(s))return "unrated";
 if(/\bspecial edition\b/.test(s))return "special";
 return "";
};
function values(row,kind){
 const d=row.movieDetails||{};
 if(kind==="collection")return groupNames(row);
 if(kind==="versions"){const key=movieIdentity(row);return key?[key]:[];}
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
window.DKCollections=Object.freeze({has,toggle,options,filter,edition,groups,groupNames,setMembership,setEdition,relatedEditions,movieIdentity,setAutomatic});
})();