"use strict";
// Only explicit chapter boundaries; never treat synthetic markers as evidence.
window.DKSegmentSkip=Object.freeze({identify:function identifySegments(chapters,duration){
 if(!Number.isFinite(duration)||duration<=0||!Array.isArray(chapters))return [];
 const rows=chapters.filter(c=>c&&!c.virtual&&Number.isFinite(c.startTime)&&c.startTime>=0&&c.startTime<duration).slice(0,500).sort((a,b)=>a.startTime-b.startTime);
 const intro=/^(?:(?:opening|main) (?:titles?|credits|theme)|intro(?:duction)?|opening|opening sequence|opening theme song|вступление|заставка|начальные титры)$/iu;
 const credits=/^(?:end credits|closing credits|final credits|credits|closing titles|end titles|outro|финальные титры|заключительные титры|титры)$/iu;
 const results=[];
 for(let i=0;i<rows.length;i++){
  const row=rows[i],label=String(row.text||"").normalize("NFKC").trim().replace(/\s+/g," ");
  const kind=intro.test(label)?"intro":credits.test(label)?"credits":"";
  if(!kind)continue;
  const next=rows.slice(i+1).find(c=>c.startTime>row.startTime+.05);
  const explicit=Number.isFinite(row.endTime)&&row.endTime>row.startTime&&row.endTime<=duration?row.endTime:null;
  const bound=explicit!==null?Math.min(explicit,next?.startTime??duration):next?.startTime;
  const end=bound??(kind==="credits"?duration:NaN),span=end-row.startTime;
  if(!Number.isFinite(end)||span<3||span>480)continue;
  if(kind==="intro"&&(row.startTime>Math.min(900,duration*.4)||end>=duration-.5))continue;
  if(kind==="credits"&&row.startTime<duration*.65)continue;
  results.push({kind,start:row.startTime,end,autoSafe:bound!==undefined&&end<duration-.5});
 }
 return results;
}});
