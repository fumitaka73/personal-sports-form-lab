import {pointValue} from './shot-metadata.js';
import {METRICS} from './scoring-config.js';
import {summarizeCoach} from './coach-summary.js';
export const REPORT_ITEMS={dip:{label:'ディップ（膝の曲げ）',keys:['kneeAngle']},release:{label:'リリース関連',keys:['armLead','wristPeakTiming','wristHeight']},elbow:{label:'肘・肩',keys:['elbowAngle','shoulderAngle']},balance:{label:'バランス',keys:['torsoLean','bodyOffset','verticalRise','hipAngle']},follow:{label:'フォロースルー',keys:['followWrist','followElbow']},timing:{label:'脚と腕のタイミング',keys:['kneeArmTiming']}};
const valid=n=>Number.isFinite(n)&&n>=0&&n<=100;
export const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
export const conditionKey=s=>{const keys=[s.goodFormReference?.id,...['shotType','cameraAngle','hand'].map(k=>s.metadata?.[k])],points=pointValue(s.metadata?.points);if(points!=='unspecified')keys.push(points);return JSON.stringify(keys);};
// The saved reference snapshot distinguishes updates under the same Good Form ID.
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
export function basisKey(s){
 const versions=[...new Set((s.shots??[]).map(shot=>shot.scoreVersion??shot.comparison?.version??'unknown'))].sort();
 const ref=s.goodFormReference?.analysis;
 if(!ref||typeof ref.version!=='string'||versions.length!==1||versions[0]==='unknown')return null;
 const parts=[conditionKey(s),versions,stable({version:ref.version,metrics:ref.metrics,phases:ref.phases,hand:ref.hand,aspect:ref.aspect,trunkProfile:ref.trunkProfile,analyzedAt:ref.analyzedAt}),s.calibrationVersionId??null];if(s.captureVersion)parts.push(s.captureVersion);return JSON.stringify(parts);
}
export function sessionReport(session){
 const shots=session.shots??[],legacy=summarizeCoach(shots.map(s=>({...s,comparison:{...s.comparison,overall:s.comparison?.overall??null,metrics:s.comparison?.metrics??[],groups:s.comparison?.groups??[]}})));
 const usable=s=>!s.excluded&&['High','Medium'].includes(s.comparison?.confidence),accepted=shots.filter(usable),scores=accepted.map(s=>s.comparison.overall).filter(valid);
 const metricRows=(shot,keys)=>(shot.comparison?.metrics??[]).filter(m=>keys.includes(m.key));
 const items=Object.fromEntries(Object.entries(REPORT_ITEMS).map(([key,item])=>{
  const values=[],thirds=[[],[],[]],issues=new Map(),reasons=new Map();
  shots.forEach((shot,index)=>{
   if(!usable(shot)){reasons.set('低信頼度・未評価・除外', (reasons.get('低信頼度・未評価・除外')??0)+1);return;}
   const rows=metricRows(shot,item.keys),available=rows.filter(m=>!m.excluded&&valid(m.score)),missing=item.keys.filter(k=>!rows.some(m=>m.key===k)).length+rows.filter(m=>!m.excluded&&!valid(m.score)).length;if(missing)reasons.set('保存された計測値の欠測',(reasons.get('保存された計測値の欠測')??0)+missing);
   for(const m of rows.filter(m=>m.excluded))reasons.set(m.excluded,(reasons.get(m.excluded)??0)+1);
   if(!available.length){reasons.set('比較できる計測値なし',(reasons.get('比較できる計測値なし')??0)+1);return;}
   const weight=m=>Number.isFinite(m.weight)&&m.weight>0?m.weight:METRICS[m.key].weight;const total=available.reduce((n,m)=>n+weight(m),0),score=available.reduce((n,m)=>n+m.score*weight(m),0)/total;
   values.push(score);thirds[Math.min(2,Math.floor(index*3/Math.max(1,shots.length)))].push(score);
   for(const m of available)if(Number.isFinite(m.delta)&&m.tolerance>0&&Math.abs(m.delta)/m.tolerance>=.2){const label=m.key==='kneeAngle'?(m.delta>0?'ディップ浅い':'ディップ深い'):m.key==='wristHeight'?(m.delta>0?'リリース高い':'リリース低い'):`${METRICS[m.key].label}（基準との差）`;issues.set(label,(issues.get(label)??0)+1);}
  });
  return [key,{...item,score:mean(values),count:values.length,values,thirds:thirds.map(mean),reasons:[...reasons].map(([reason,count])=>({reason,count})),issue:[...issues].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]??null}];
 }));
 const trunks=accepted.map(s=>s.trunkEstimate).filter(t=>t?.status==='estimated'&&['High','Medium'].includes(t.confidence)&&Number.isFinite(t.lean)&&Number.isFinite(t.excess));
 const overallThirds=[[],[],[]];shots.forEach((s,i)=>{if(usable(s)&&valid(s.comparison.overall))overallThirds[Math.min(2,Math.floor(i*3/Math.max(1,shots.length)))].push(s.comparison.overall);});
 return {total:shots.length,count:scores.length,lowCount:shots.filter(s=>s.comparison?.confidence==='Low').length,missingCount:shots.length-scores.length,average:mean(scores),scores,thirds:overallThirds.map(mean),items,trunk:{count:trunks.length,lean:mean(trunks.map(t=>t.lean)),excess:mean(trunks.map(t=>t.excess)),alerts:trunks.filter(t=>t.alert).length,excluded:shots.length-trunks.length},legacy};
}
export function previousReport(session,sessions){
 const previous=sessions.filter(s=>s.id!==session.id&&s.endedAt&&s.createdAt<session.createdAt&&conditionKey(s)===conditionKey(session)).sort((a,b)=>b.createdAt-a.createdAt)[0];
 if(!previous)return {previous:null,reason:'前回の同条件の終了済み記録がありません。'};
 if(!basisKey(session)||basisKey(session)!==basisKey(previous))return {previous,reason:'採点版・Good Formの保存内容・適用設定・撮影方式が異なる、または不明なため前回比は表示しません。'};
 const current=sessionReport(session),before=sessionReport(previous),delta=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?a-b:null;
 return {previous,before,delta:delta(current.average,before.average),items:Object.fromEntries(Object.keys(REPORT_ITEMS).map(k=>[k,delta(current.items[k].score,before.items[k].score)])),trunkDelta:delta(current.trunk.lean,before.trunk.lean),reason:current.count&&before.count?'':'比較できる評価本数がありません。'};
}
export function localPeriod(time,unit='week'){
 const d=new Date(time);d.setHours(0,0,0,0);if(unit==='week')d.setDate(d.getDate()-(d.getDay()+6)%7);if(unit==='month')d.setDate(1);
 return {time:d.getTime(),label:`${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}${unit==='month'?'':`/${String(d.getDate()).padStart(2,'0')}`}`};
}
export function progressSeries(sessions,anchor,{days=30,unit='week',item='overall',now=Date.now()}={}){
 const start=new Date(now);start.setHours(0,0,0,0);start.setDate(start.getDate()-(days-1));
 const basis=basisKey(anchor),condition=conditionKey(anchor),groups=new Map();let excluded=0,unfinished=0;
 for(const session of sessions){if(session.createdAt<start.getTime()||session.createdAt>now||conditionKey(session)!==condition)continue;if(!session.endedAt){unfinished++;continue;}if(!basis||basisKey(session)!==basis){excluded++;continue;}
  const report=sessionReport(session),period=localPeriod(session.createdAt,unit),entry=groups.get(period.time)??{...period,values:[],sessions:0,total:0,low:0};
  const values=item==='overall'?report.scores:item==='trunk'?session.shots.filter(s=>!s.excluded&&['High','Medium'].includes(s.comparison?.confidence)).map(s=>s.trunkEstimate).filter(t=>t?.status==='estimated'&&['High','Medium'].includes(t.confidence)&&Number.isFinite(t.lean)&&Number.isFinite(t.excess)).map(t=>t.lean):report.items[item]?.values??[];
  entry.values.push(...values);entry.sessions++;entry.total+=report.total;entry.low+=report.lowCount;groups.set(period.time,entry);
 }
 const points=[...groups.values()].sort((a,b)=>a.time-b.time).map(p=>({...p,count:p.values.length,value:mean(p.values)}));
 return {points,excluded,unfinished,average:mean(points.flatMap(p=>p.values)),count:points.reduce((n,p)=>n+p.count,0),sessions:points.reduce((n,p)=>n+p.sessions,0),unit:item==='trunk'?'°':'%',start:start.getTime()};
}
