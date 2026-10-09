import {compactAnalysis} from './coach-analysis.js';
export const REVIEW_SCHEMA='sports-form-lab-review';
export const emptyReviewData=()=>({version:1,cases:{},references:{},sessionFeedback:{},verification:{}});
const clone=v=>structuredClone(v);
const labels=()=>({detection:'unreviewed',evaluation:'unsure',outcome:'unknown',notes:''});
const ref=(id,title,metadata,analysis)=>({id,title,...metadata,analysis:compactAnalysis(analysis)});
function makeCase(id,source,shot,reference,metadata,createdAt){
 const analysis=shot.newAnalysis??shot.analysis,feedback=shot.coachFeedback??shot.feedback;
 const comparison=clone(shot.comparison);comparison.metrics=comparison.metrics.map(m=>({...m,...Object.fromEntries(['score','delta','refValue','value'].map(k=>[k,Number.isFinite(m[k])?m[k]:null]))}));
 return {id,caseVersion:1,source,createdAt,metadata:clone(metadata),analysis:compactAnalysis(clone(analysis)),comparison,scoreVersion:shot.comparison.version,goodFormReference:{...clone(reference),hand:reference.hand??reference.analysis?.hand},appFeedback:{origin:'rule-based',original:clone(feedback),reason:feedback?.reason??feedback?.difference??'旧結果に助言の理由がありません'},videoRange:clone(shot.videoRange??null),detectorEvent:clone(shot.detectorEvent??{number:shot.detectorNumber??shot.number,confidence:shot.comparison.confidence}),trunkEstimate:clone(shot.trunkEstimate??null),calibrationVersionId:shot.calibrationVersionId??null,annotationHistory:[],labels:labels(),humanFeedback:[],aiInterpretation:null};
}
export function collectCases(results,sessions,liveSessions,saved={}){
 const entries=[];
 for(const r of results)entries.push(makeCase(`single:${r.id}`,{mode:'single',recordId:r.id,videoId:r.newVideoId},r,ref(r.referenceVideoId,r.referenceTitle,r.referenceMeta,r.referenceAnalysis),r.newMeta,r.createdAt));
 for(const s of sessions)for(const shot of s.shots)entries.push(makeCase(`session:${s.id}:${shot.number}`,{mode:'session',recordId:s.id,shotNumber:shot.number,videoId:s.videoId},shot,ref(s.referenceVideoId,s.referenceTitle,s.referenceMeta,s.referenceAnalysis),s.metadata,s.createdAt));
 for(const s of liveSessions)for(const shot of s.shots)entries.push(makeCase(`live:${s.id}:${shot.number}`,{mode:'live',recordId:s.id,shotNumber:shot.number},shot,s.goodFormReference,s.metadata,shot.timestamp??s.createdAt));
 const map=new Map(entries.map(c=>[c.id,c]));for(const c of Object.values(saved))map.set(c.id,c);
 return [...map.values()].sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id));
}
export function referenceCatalog(videos,results,sessions,live,activeId,saved={}){
 const ids=new Set([activeId,...results.map(r=>r.referenceVideoId),...sessions.map(s=>s.referenceVideoId),...live.map(s=>s.goodFormReference.id)]);
 const map={...saved};for(const v of videos)if(v.analysis&&(ids.has(v.id)||v.isGoodForm)&&!map[v.id]){const {blob,...record}=v;map[v.id]=clone(record);}
 return map;
}
export function feedbackText(c){const f=c.appFeedback?.original;return f?.text?.ja??[f?.working,f?.difference,...(f?.focus??[])].filter(Boolean).join('\n');}
export function evaluationReport(cases,data){
 const tp=cases.filter(c=>c.labels.detection==='correct'&&!c.manualAdded).length,fp=cases.filter(c=>c.labels.detection==='false-positive'&&!c.manualAdded).length;
 const byMode=Object.fromEntries(['single','session','live'].map(mode=>{const group=cases.filter(c=>c.source.mode===mode),correct=group.filter(c=>c.labels.detection==='correct'&&!c.manualAdded).length,falsePositive=group.filter(c=>c.labels.detection==='false-positive'&&!c.manualAdded).length;return [mode,{tp:correct,fp:falsePositive,unreviewed:group.filter(c=>!c.manualAdded).length-correct-falsePositive,precision:correct+falsePositive?correct/(correct+falsePositive):null}];}));
 const groups=new Map();for(const c of cases){const key=`${c.source.mode}:${c.source.recordId}`;const group=groups.get(key)??[];group.push(c);groups.set(key,group);}
 let recallTP=0,actual=0;const scopes=[];
 for(const [key,v]of Object.entries(data.verification)){const shots=groups.get(key)??[];const verified=shots.every(c=>c.labels.detection!=='unreviewed'),correct=shots.filter(c=>c.labels.detection==='correct'&&!c.manualAdded).length;
  const usable=v.complete&&Number.isInteger(v.actualShots)&&v.actualShots>=correct&&v.actualShots>=0&&verified;
  scopes.push({key,...v,usable,reason:!v.complete?'全区間の検証が未完了':!verified?'未確認の候補があります':v.actualShots<correct?'実際の本数よりCorrectが多いため無効':null});
  if(usable){recallTP+=correct;actual+=v.actualShots;}
 }
 const human=cases.flatMap(c=>c.humanFeedback).concat(Object.values(data.sessionFeedback).flatMap(s=>s.comments));
 const agree=human.filter(h=>h.agreement==='agree').length,disagree=human.filter(h=>h.agreement==='disagree').length;
 const distribution=[0,0,0,0,0],confidence={High:0,Medium:0,Low:0},corrections={};let unscored=0;
 for(const c of cases){confidence[c.comparison.confidence]++;const score=c.comparison.overall;if(Number.isFinite(score))distribution[Math.min(4,Math.floor(score/20))]++;else unscored++;
  if(c.comparison.confidence==='Low')continue;const f=c.appFeedback.original;const metric=typeof f?.code==='string'?f.trigger:c.comparison.metrics.filter(m=>!m.excluded&&Number.isFinite(m.score)&&m.score<90).sort((a,b)=>a.score-b.score)[0];if(!metric)continue;const key=`${c.metadata.shotType}:${metric.key}`;const entry=corrections[key]??{shotType:c.metadata.shotType,key:metric.key,label:metric.label,count:0};entry.count++;corrections[key]=entry;
 }
 const reviewed=cases.filter(c=>['useful','inaccurate'].includes(c.labels.feedbackRating));
 return {selfFeedback:{useful:reviewed.filter(c=>c.labels.feedbackRating==='useful').length,inaccurate:reviewed.filter(c=>c.labels.feedbackRating==='inaccurate').length,total:reviewed.length},total:cases.length,detection:{tp,fp,byMode,unreviewed:cases.filter(c=>!c.manualAdded).length-tp-fp,manualMissed:cases.filter(c=>c.manualAdded&&c.labels.detection==='correct').length,precision:tp+fp?tp/(tp+fp):null,recall:actual?recallTP/actual:null,recallTP,actual,falseNegatives:actual-recallTP,scopes},human:{agree,disagree,unsure:human.length-agree-disagree,agreement:agree+disagree?agree/(agree+disagree):null},distribution,confidence,unscored,corrections:Object.values(corrections).sort((a,b)=>b.count-a.count)};
}
// JSON import is inert data. Reject unsafe keys, invalid measurements and labels
// before a transaction; never execute content or replace existing records.
export function validateReviewImport(input){
 let nodes=0;const walk=(v,depth=0)=>{if(++nodes>1500000||depth>50)throw new Error('データが複雑すぎます');if(typeof v==='number'&&!Number.isFinite(v))throw new Error('不正な数値');if(typeof v==='string'&&v.length>100000)throw new Error('テキストが長すぎます');if(v&&typeof v==='object')for(const [key,item]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(key))throw new Error('不正なデータキー');walk(item,depth+1);}};walk(input);
 const obj=v=>v&&typeof v==='object'&&!Array.isArray(v),id=v=>typeof v==='string'&&v.length>0&&v.length<=250;
 if(input?.schema!==REVIEW_SCHEMA||input.version!==1||!obj(input.data))throw new Error('対応するShot Review JSONではありません');
 const data=input.data;if(data.version!==1||!['cases','references','sessionFeedback','verification'].every(k=>obj(data[k])))throw new Error('保存データの構造が不正です');
 if(Object.keys(data.cases).length>10000||Object.keys(data.references).length>500)throw new Error('記録数が多すぎます');
 const text=v=>v===undefined||v===null||typeof v==='string';
 const meta=v=>obj(v)&&['jump','set','free'].includes(v.shotType)&&['front','side','diagonal'].includes(v.cameraAngle)&&['left','right'].includes(v.hand);
 const profile=p=>p===undefined||p===null||obj(p)&&p.version==='trunk-proxy-1'&&Number.isFinite(p.coverage)&&p.coverage>=0&&p.coverage<=1&&Number.isFinite(p.duration)&&p.duration>0&&Array.isArray(p.rows)&&p.rows.length<=80&&p.rows.every(r=>obj(r)&&['time','lean','extension','phase','visibility'].every(k=>Number.isFinite(r[k]))&&r.phase>=0&&r.phase<=1&&[-1,0,1].includes(r.facing));
 const analysis=v=>obj(v)&&profile(v.trunkProfile)&&!(v.frames?.length&&!v.phases)&&obj(v.metrics)&&Object.values(v.metrics).every(n=>n===null||Number.isFinite(n))&&(!v.warnings||Array.isArray(v.warnings)&&v.warnings.every(w=>typeof w==='string'))&&(!v.phases||obj(v.phases)&&['start','release','end'].every(k=>Number.isFinite(v.phases[k]))&&v.phases.start<v.phases.release&&v.phases.release<v.phases.end)&&(!v.frames||Array.isArray(v.frames)&&v.frames.every(f=>obj(f)&&Number.isFinite(f.time)&&(f.landmarks===null||Array.isArray(f.landmarks)&&f.landmarks.length<=100&&f.landmarks.every(p=>obj(p)&&Number.isFinite(p.x)&&Number.isFinite(p.y)))));
 const comments=v=>Array.isArray(v)&&v.every(h=>obj(h)&&id(h.id)&&typeof h.coachName==='string'&&typeof h.originalComment==='string'&&(!h.appFeedbackSnapshot||obj(h.appFeedbackSnapshot)&&text(h.appFeedbackSnapshot.text))&&['agree','disagree','unsure'].includes(h.agreement)&&['observedIssue','priorityCorrection','practiceCue','improvementNotes'].every(k=>typeof h[k]==='string'));
 for(const [key,c]of Object.entries(data.cases)){
  if(c.trunkEstimate!==undefined&&c.trunkEstimate!==null){const t=c.trunkEstimate;if(!obj(t)||!profile(t.profile)||t.version!=='trunk-proxy-1'||!['High','Medium','Low'].includes(t.confidence)||!['estimated','unavailable'].includes(t.status)||typeof t.reason!=='string'||typeof t.alert!=='boolean'||typeof t.audioEligible!=='boolean'||!['lean','extension','excess','changeExcess'].every(k=>t[k]===null||Number.isFinite(t[k]))||!Number.isFinite(t.persistentSeconds)||t.persistentSeconds<0||t.persistentSeconds>3600)throw new Error('体幹の推定記録が不正です');}
  const range=c.videoRange;if(range!==undefined&&range!==null&&(!obj(range)||!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||range.start>=range.end||range.end-range.start>3600))throw new Error('動画範囲が不正です');
  if(c.manualAdded!==undefined&&typeof c.manualAdded!=='boolean')throw new Error('手動検出ラベルが不正です');
  if(c.annotationHistory!==undefined&&(!Array.isArray(c.annotationHistory)||c.annotationHistory.length>10000||c.annotationHistory.some(h=>!obj(h)||!Number.isFinite(h.timestamp)||!obj(h.labels))))throw new Error('修正履歴が不正です');
  const checkLabels=l=>{if(l.voiceJudgment!==undefined&&!['correct','partial','incorrect','unknown'].includes(l.voiceJudgment))throw new Error('指摘確認が不正です');if(l.cueLabels!==undefined&&(!obj(l.cueLabels)||Object.keys(l.cueLabels).length>2||Object.entries(l.cueLabels).some(([k,v])=>k.length>100||!['correct','incorrect','unknown'].includes(v))))throw new Error('個別指摘が不正です');if(l.subjectiveScore!==undefined&&l.subjectiveScore!==null&&(!Number.isFinite(l.subjectiveScore)||l.subjectiveScore<0||l.subjectiveScore>100))throw new Error('主観評価が不正です');if(l.feedbackRating!==undefined&&!['unreviewed','useful','inaccurate','repetitive','not-assessable'].includes(l.feedbackRating))throw new Error('助言評価が不正です');if(l.submetrics!==undefined&&(!obj(l.submetrics)||Object.entries(l.submetrics).some(([k,v])=>!['dip','timing','release','elbow','balance','follow','trunk'].includes(k)||!['unreviewed','good','too-deep','too-shallow','too-high','too-low','timing-issue','not-assessable','correct','incorrect'].includes(v))))throw new Error('フォーム修正が不正です');};if(obj(c.labels))checkLabels(c.labels);for(const h of c.annotationHistory??[])checkLabels(h.labels);
if(!obj(c)||key!==c.id||!id(c.id)||c.caseVersion!==1||!Number.isFinite(c.createdAt)||!obj(c.source)||!['single','session','live'].includes(c.source.mode)||!id(c.source.recordId)||!meta(c.metadata)||!analysis(c.analysis)||!obj(c.comparison)||!['High','Medium','Low'].includes(c.comparison.confidence)||(c.comparison.overall!==null&&(!Number.isFinite(c.comparison.overall)||c.comparison.overall<0||c.comparison.overall>100))||!Array.isArray(c.comparison.metrics)||!Array.isArray(c.comparison.groups)||!obj(c.goodFormReference)||!id(c.goodFormReference.id)||!obj(c.appFeedback)||!obj(c.labels)||!['unreviewed','correct','false-positive'].includes(c.labels.detection)||!['agree','disagree','unsure'].includes(c.labels.evaluation)||!['made','missed','unknown'].includes(c.labels.outcome)||typeof c.labels.notes!=='string'||!comments(c.humanFeedback))throw new Error('Shot Review記録が不正です');
  if(!text(c.scoreVersion)||!text(c.goodFormReference.title)||!analysis(c.goodFormReference.analysis)||!text(c.appFeedback.reason))throw new Error('分析スナップショットが不正です');
  const feedback=c.appFeedback.original;if(feedback&&(!obj(feedback)||!['code','working','difference','reason'].every(k=>text(feedback[k]))||feedback.text&&(!obj(feedback.text)||typeof feedback.text.ja!=='string'||typeof feedback.text.en!=='string')||feedback.focus&&!(['automatic','rhythm','lower','dip','release','elbow','follow'].includes(feedback.focus)||Array.isArray(feedback.focus)&&feedback.focus.every(v=>typeof v==='string'))||feedback.trigger&&(!obj(feedback.trigger)||typeof feedback.trigger.key!=='string'||!text(feedback.trigger.label)||!Number.isFinite(feedback.trigger.delta))))throw new Error('助言の形式が不正です');
  if(feedback?.triggers!==undefined&&(!Array.isArray(feedback.triggers)||feedback.triggers.length>2||feedback.triggers.some(t=>!obj(t)||typeof t.key!=='string'||!Number.isFinite(t.delta))))throw new Error('複数項目の助言が不正です');
  if(c.comparison.warnings&&(!Array.isArray(c.comparison.warnings)||!c.comparison.warnings.every(w=>typeof w==='string')))throw new Error('警告の形式が不正です');
  if(c.appFeedback.original?.focus&&!(['automatic','rhythm','lower','dip','release','elbow','follow'].includes(c.appFeedback.original.focus)||Array.isArray(c.appFeedback.original.focus)))throw new Error('助言の形式が不正です');
  for(const g of c.comparison.groups)if(!obj(g)||typeof g.key!=='string'||!text(g.label)||g.score!==null&&(!Number.isFinite(g.score)||g.score<0||g.score>100))throw new Error('分類の点数が不正です');
  const prefix=c.source.mode==='single'?'single':c.source.mode==='session'?'session':'live';
  const expected=`${prefix}:${c.source.recordId}${c.source.mode==='single'?'':':'+c.source.shotNumber}`;
  if(c.id!==expected||c.source.mode!=='single'&&(!Number.isInteger(c.source.shotNumber)||c.source.shotNumber<1))throw new Error('ShotのリンクIDが不正です');
  for(const m of c.comparison.metrics)if(!obj(m)||typeof m.key!=='string'||!['label','unit','excluded'].every(k=>text(m[k]))||m.score!==null&&(m.score<0||m.score>100)||!['score','delta','refValue','value'].every(k=>m[k]===null||Number.isFinite(m[k])))throw new Error('比較指標が不正です');
 }
 for(const [key,r]of Object.entries(data.references))if(key!==r.id||!id(key)||typeof r.title!=='string'||!text(r.notes)||!meta(r)||!analysis(r.analysis))throw new Error('Good Formが不正です');
 for(const s of Object.values(data.sessionFeedback))if(!obj(s)||!['session','live'].includes(s.mode)||!id(s.recordId)||typeof s.title!=='string'||!obj(s.appFeedback)||typeof s.appFeedback.text!=='string'||!comments(s.comments))throw new Error('コーチコメントが不正です');
 for(const [key,v] of Object.entries(data.verification))if(!/^(session|live):.+/.test(key)||!obj(v)||!Number.isInteger(v.actualShots)||v.actualShots<0||v.actualShots>100000||typeof v.complete!=='boolean')throw new Error('検証本数が不正です');
 return clone(data);
}
export function exportReviewData(data,cases){return {schema:REVIEW_SCHEMA,version:1,exportedAt:new Date().toISOString(),data:{...clone(data),cases:Object.fromEntries(cases.map(c=>[c.id,clone(c)]))}};}
export function mergeReviewImport(existing,incoming){const result=clone(existing);let added=0,skipped=0;for(const field of ['cases','references','sessionFeedback','verification'])for(const [id,value]of Object.entries(incoming[field])){if(Object.hasOwn(result[field],id)){skipped++;continue;}result[field][id]=clone(value);added++;}return {data:result,added,skipped};}

export function annotateCase(c,labels,range=c.videoRange){return {...c,labels:clone(labels),annotatedAt:Date.now(),reviewer:'self',videoRange:clone(range??null),annotationHistory:[...(c.annotationHistory??[]),{timestamp:Date.now(),reviewer:'self',labels:clone(c.labels),videoRange:clone(c.videoRange??null)}]};}
export function manualCase(template,number,range){const c=clone(template);return {...c,id:`live:${c.source.recordId}:${number}`,source:{...c.source,shotNumber:number},manualAdded:true,createdAt:Date.now(),analysis:{metrics:{},phases:{start:range.start,release:(range.start+range.end)/2,end:range.end},warnings:['手動追加。自動分析・リリース時刻の計測なし'],phaseEstimated:true},comparison:{overall:null,confidence:'Low',metrics:[],groups:[],warnings:[]},detectorEvent:null,appFeedback:{origin:'manual',original:null,reason:'検出されなかったシュートを手動追加'},videoRange:range,labels:{...labels(),detection:'correct'},annotationHistory:[],humanFeedback:[]};}
