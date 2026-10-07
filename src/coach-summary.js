import {coachDeviations} from './coach-feedback.js';
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
export function summarizeCoach(shots){
 const scored=shots.filter(s=>Number.isFinite(s.comparison.overall)),scores=scored.map(s=>s.comparison.overall);
 const bins=[[],[],[]];shots.forEach((shot,i)=>{if(Number.isFinite(shot.comparison.overall))bins[Math.min(2,Math.floor(i*3/Math.max(1,shots.length)))].push(shot.comparison.overall);});
 const deviations=new Map(),observations=new Map();
 for(const shot of shots){
  for(const d of coachDeviations(shot.comparison)){const entry=deviations.get(d.key)??{key:d.key,label:d.label,group:d.group,count:0,severity:0};entry.count++;entry.severity+=d.normalizedDeviation;deviations.set(d.key,entry);}
  if(shot.comparison.confidence!=='Low')for(const m of shot.comparison.metrics){if(m.excluded||!Number.isFinite(m.delta)||!m.tolerance)continue;const values=observations.get(m.key)??{key:m.key,label:m.label,values:[]};values.values.push(m.delta/m.tolerance);observations.set(m.key,values);}
 }
 const common=[...deviations.values()].sort((a,b)=>b.count-a.count||b.severity-a.severity||a.key.localeCompare(b.key));
 const consistent=[...observations.values()].filter(m=>m.values.length>=3).map(m=>({...m,normalizedSD:Math.sqrt(mean(m.values.map(v=>(v-mean(m.values))**2)))})).sort((a,b)=>a.normalizedSD-b.normalizedSD||a.key.localeCompare(b.key))[0];
 return {total:shots.length,scoredCount:scores.length,average:mean(scores),best:scores.length?Math.max(...scores):null,bestShot:scored.length?scored.reduce((best,s)=>s.comparison.overall>best.comparison.overall?s:best).number:null,thirds:bins.map(mean),mostConsistent:consistent?{key:consistent.key,label:consistent.label,normalizedSD:consistent.normalizedSD,observations:consistent.values.length}:null,commonDeviations:common,mostCommon:common[0]??null,nextFocus:common[0]?{group:common[0].group,label:common[0].label,reason:`信頼度が低くない${common[0].count}本で、意味のある差が繰り返し観測されました。`}:{group:'automatic',label:'Automatic',reason:'信頼できる修正対象のデータがまだ不足しています。'}};
}
export function buildCoachInput(session){
 const summary=summarizeCoach(session.shots);
 return {schemaVersion:'coach-input-1',sessionSummary:summary,shots:session.shots.map(s=>({number:s.number,timestamp:s.timestamp,metrics:s.analysis.metrics,formMatch:s.comparison.overall,subScores:s.comparison.groups,metricDeviations:s.comparison.metrics,confidence:s.comparison.confidence,phaseConfidence:s.comparison.phaseConfidence,feedback:s.coachFeedback,madeMissed:null,ballTracking:null})),trends:{thirds:summary.thirds},mostCommonDeviations:summary.commonDeviations,goodFormReference:session.goodFormReference,selectedFocus:session.focus,coachProfile:null,aiCoach:null};
}
