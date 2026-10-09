import {voiceReviewed} from './quick-review.js';
import {iterateChunks} from './pose-archive.js';
import {SESSION_POSE_THRESHOLDS} from './session.js';
import {ShotDetector} from './shot-detector.js';
import {COACH_RULES,selectCoachFeedback,selectLegacyCoachFeedback} from './coach-feedback.js';
export const CALIBRATION_SCHEMA='personal-calibration-1';
export const CALIBRATION_ENGINE='personal-rules-1';
export const EVIDENCE_MIN={sessions:2,detectTrainShots:20,detectValidationShots:10,feedbackTrain:20,feedbackValidation:10};
export const defaultParameters=()=>({detector:{...SESSION_POSE_THRESHOLDS},feedback:{meaningfulDeviation:COACH_RULES.meaningfulDeviation,smallDeviation:COACH_RULES.smallDeviation,repeatShots:COACH_RULES.repeatShots,cooldownMs:COACH_RULES.cooldownMs,suppressCorrections:false,priorityWeights:{}}});
export const scopeKey=(metadata,referenceId)=>JSON.stringify([metadata.shotType,metadata.cameraAngle,metadata.hand,referenceId]);
export function validateParameters(value){
 const d=value?.detector,f=value?.feedback;if(!d||!f)throw new Error('設定がありません');
 const limits={prepHeight:[.3,1],prepElbow:[145,175],peakHeight:[0,.4],minRise:[.15,.5],minExtendedElbow:[80,130],minExtension:[4,20],minStrength:[.06,.3]};
 for(const [key,[min,max]]of Object.entries(limits))if(!Number.isFinite(d[key])||d[key]<min||d[key]>max)throw new Error(`検出設定 ${key} が範囲外です`);
 for(const [key,min,max]of [['meaningfulDeviation',.1,.5],['smallDeviation',.2,.5],['repeatShots',1,5],['cooldownMs',1000,15000]])if(!Number.isFinite(f[key])||f[key]<min||f[key]>max)throw new Error(`音声設定 ${key} が範囲外です`);
 if(!Number.isInteger(f.repeatShots)||typeof f.suppressCorrections!=='boolean'||!f.priorityWeights||Array.isArray(f.priorityWeights))throw new Error('音声設定が不正です');
 const keys=['kneeArmTiming','torsoLean','bodyOffset','verticalRise','elbowAngle','shoulderAngle','kneeAngle','hipAngle','armLead','wristPeakTiming','wristHeight','followWrist','followElbow'];
 if(Object.entries(f.priorityWeights).some(([k,v])=>!keys.includes(k)||!Number.isFinite(v)||v<.5||v>2))throw new Error('助言の重みが不正です');
 return {detector:Object.fromEntries(Object.keys(limits).map(k=>[k,d[k]])),feedback:{meaningfulDeviation:f.meaningfulDeviation,smallDeviation:f.smallDeviation,repeatShots:f.repeatShots,cooldownMs:f.cooldownMs,suppressCorrections:f.suppressCorrections,priorityWeights:{...f.priorityWeights}}};
}
export function reviewFingerprint(cases){return JSON.stringify(cases.map(c=>[c.id,c.labels.detection,!!c.manualAdded,c.analysis.phases?.release,c.videoRange,c.labels.conditions]).sort((a,b)=>a[0].localeCompare(b[0])));}
export function usableDetectionSession(s,cases){
 const group=cases.filter(c=>c.source.mode==='live'&&c.source.recordId===s.id);
 if(s.poseIntegrityError)return s.poseIntegrityError;
 if(!s.complete||s.orientationChanged||!(s.frames?.length||s.count&&s.chunks?.length))return '完全な姿勢時系列がありません（旧記録・中断・回転など）';
 if((s.frames?.length??s.count)>30000)return '再検証の処理上限（30,000フレーム）を超えています';
 if(!s.truth?.confirmed||s.truth.reviewFingerprint!==reviewFingerprint(group))return '全区間のシュート時刻を確認してください（ラベル変更後は再確認）';
 if(group.some(c=>c.labels.detection==='unreviewed'))return '未確認の検出候補があります';
 if(group.some(c=>c.labels.conditions&&['shotType','cameraAngle','hand'].some(k=>c.labels.conditions[k]!==s.metadata[k])))return '撮影条件の修正とセッション条件が一致しません';
 const correct=group.filter(c=>c.labels.detection==='correct');
 if(s.truth.actualShots!==correct.length||s.truth.events.length!==correct.length||new Set(s.truth.events.map(e=>e.caseId)).size!==correct.length||s.truth.events.some(e=>!correct.some(c=>c.id===e.caseId)||!Number.isFinite(e.time)||e.time<s.origin||e.time>s.end))return '本数とシュート時刻の確認が一致しません';
 return null;
}
export function replayDetection(session,parameters){
 const detector=new ShotDetector({hand:session.metadata.hand,aspect:session.aspect??1,live:true,parameters}),events=[];
 for(const f of session.frames??iterateChunks(session.chunks,session.origin)){detector.aspect=f.aspect??session.aspect??1;events.push(...detector.processFrame(f.time*1000,f.landmarks).events);}
 return events.map(e=>({time:e.phases.release,phases:e.phases}));
}
export function detectionMetrics(predictions,truth,tolerance=.5){
 const matched=new Set();let tp=0;
 for(const p of [...predictions].sort((a,b)=>a.time-b.time)){let best=-1,distance=Infinity;truth.forEach((t,i)=>{const d=Math.abs(p.time-t.time);if(!matched.has(i)&&d<=tolerance&&d<distance){best=i;distance=d;}});if(best>=0){matched.add(best);tp++;}}
 const fp=predictions.length-tp,fn=truth.length-tp;return counts({tp,fp,fn});
}
function counts(m){return {...m,precision:m.tp+m.fp?m.tp/(m.tp+m.fp):null,recall:m.tp+m.fn?m.tp/(m.tp+m.fn):null,f1:2*m.tp+m.fp+m.fn?2*m.tp/(2*m.tp+m.fp+m.fn):0};}
function sumDetection(sessions,parameters){const m={tp:0,fp:0,fn:0};for(const s of sessions){const v=detectionMetrics(replayDetection(s,parameters),s.truth.events);for(const k of ['tp','fp','fn'])m[k]+=v[k];}return counts(m);}
function improveDetection(before,after){return after.f1>before.f1+.005&&after.fp<=before.fp&&after.fn<=before.fn;}
export function compareDetection(sessions,cases,baseline=defaultParameters().detector){
 const exclusions=[],usable=[];for(const s of sessions){const reason=usableDetectionSession(s,cases);if(reason)exclusions.push({id:s.id,reason});else usable.push(s);}
 const training=usable.filter(s=>s.split==='training'),validation=usable.filter(s=>s.split==='validation');
 const result={kind:'detector',trainingIds:training.map(s=>s.id),validationIds:validation.map(s=>s.id),exclusions,candidates:[],recommended:null,baselineParameters:baseline};
 result.progress={training:{sessions:training.length,items:training.reduce((n,s)=>n+s.truth.events.length,0),requiredSessions:2,requiredItems:20},validation:{sessions:validation.length,items:validation.reduce((n,s)=>n+s.truth.events.length,0),requiredSessions:2,requiredItems:10}};
 if(training.some(s=>validation.some(v=>v.id===s.id))){result.reason='同じセッションを学習と検証に使えません。';return result;}
 if(training.length<EVIDENCE_MIN.sessions||validation.length<EVIDENCE_MIN.sessions||training.reduce((n,s)=>n+s.truth.events.length,0)<EVIDENCE_MIN.detectTrainShots||validation.reduce((n,s)=>n+s.truth.events.length,0)<EVIDENCE_MIN.detectValidationShots){result.reason='データ不足：学習・検証それぞれ2セッション、実シュート20本／10本が必要です。';return result;}
 // Candidate selection uses training only. Validation does not rank candidates.
 const choices=[['手首の上昇幅を少し緩める',{minRise:.22}],['手首の上昇幅を少し厳しくする',{minRise:.35}],['肘の伸び条件を少し緩める',{minExtension:5,minExtendedElbow:90}],['肘の伸び条件を少し厳しくする',{minExtension:12,minExtendedElbow:110}],['弱い動作の検出を抑える',{minStrength:.18}],['弱い動作も候補にする',{minStrength:.08}]];
 result.before={training:sumDetection(training,baseline),validation:sumDetection(validation,baseline)};
 for(const [label,change]of choices){const parameters={...baseline,...change};result.candidates.push({label,parameters,training:sumDetection(training,parameters)});}
 const best=result.candidates.filter(c=>improveDetection(result.before.training,c.training)).sort((a,b)=>b.training.f1-a.training.f1||a.label.localeCompare(b.label))[0];
 if(!best){result.reason='学習データで見逃し・誤検出の悪化を伴わない改善候補がありません。';return result;}
 best.validation=sumDetection(validation,best.parameters);result.selected=best;
 if(improveDetection(result.before.validation,best.validation)){result.recommended=best;result.reason='独立した検証データでもF1が改善し、見逃し・誤検出は増えませんでした。';}else result.reason='検証データで改善が確認できないため、変更を推奨しません。';return result;
}
const metricLabel={kneeAngle:'dip',kneeArmTiming:'timing',wristHeight:'release',elbowAngle:'elbow',shoulderAngle:'elbow',torsoLean:'balance',bodyOffset:'balance',hipAngle:'balance',verticalRise:'balance',armLead:'timing',wristPeakTiming:'timing',followWrist:'follow',followElbow:'follow'};
function semantic(f){if(f.triggers?.length)return f.triggers.map(t=>`${t.key}:${Math.sign(t.delta)}`).sort().join('|');return f.trigger?`${f.trigger.key}:${Math.sign(f.trigger.delta)}`:['good','perfect'].includes(f.code)?'praise':f.code;}
function appropriateness(c,f){
 const original=c.appFeedback?.original,rating=c.labels.feedbackRating;
 if(f.speak&&voiceReviewed(c)&&c.labels.voiceJudgment){const cues=f.triggers?.length?f.triggers:f.trigger?[f.trigger]:[];const values=cues.map(t=>c.labels.cueLabels?.[`${t.key}:${Math.sign(t.delta)}`]);if(values.includes('incorrect'))return 'bad';if(values.length&&values.every(v=>v==='correct'))return 'good';if(original&&semantic(original)===semantic(f)&&c.labels.voiceJudgment==='correct')return 'good';if(original&&semantic(original)===semantic(f)&&c.labels.voiceJudgment==='incorrect')return 'bad';return 'unknown';}

 if(!f.speak)return 'silent';
 if(original&&semantic(original)===semantic(f)){if(rating==='useful')return 'good';if(rating==='inaccurate')return 'bad';if(rating==='repetitive')return 'repeated';}
 if(f.triggers?.length>1)return 'unknown';
 if(!f.trigger)return 'unknown';
 const label=c.labels.submetrics?.[metricLabel[f.trigger.key]];
 if(!label||['unreviewed','not-assessable'].includes(label))return 'unknown';
 if(label==='good')return 'bad';
 const sign=Math.sign(f.trigger.delta),key=f.trigger.key;
 if(key==='kneeAngle')return (label==='too-shallow'&&sign>0||label==='too-deep'&&sign<0)?'good':'bad';
 if(key==='wristHeight')return (label==='too-high'&&sign>0||label==='too-low'&&sign<0)?'good':'bad';
 if(['kneeArmTiming','armLead','wristPeakTiming'].includes(key)&&label==='timing-issue')return 'good';
 return 'unknown';
}
export const feedbackEligible=c=>c.labels.detection==='correct'&&c.comparison.confidence!=='Low'&&(!c.labels.conditions||['shotType','cameraAngle','hand'].every(k=>c.labels.conditions[k]===c.metadata[k]));
export function feedbackMetrics(cases,parameters,sessions){
 const totals={good:0,bad:0,repeated:0,unknown:0,silent:0,reviewed:0},ordered=[...cases].sort((a,b)=>a.source.recordId.localeCompare(b.source.recordId)||a.createdAt-b.createdAt||a.source.shotNumber-b.source.shotNumber);let current=null,recent=[];
 for(const c of ordered){if(c.source.recordId!==current){current=c.source.recordId;recent=[];}const s=sessions.find(s=>s.id===current),now=c.createdAt,f=(c.appFeedback.original?.version==='live-coach-0.6'?selectCoachFeedback:selectLegacyCoachFeedback)(c.comparison,{trunkEstimate:c.trunkEstimate,metricReliability:c.analysis?.voiceReliability,maxItems:c.analysis?.voiceMaxItems,focus:s?.focus??c.appFeedback.original?.focus??'automatic',recent,now,shotNumber:recent.length+1,thresholds:s?.feedbackThresholds??COACH_RULES,parameters});recent.push({number:recent.length+1,timestamp:now,coachFeedback:f});
  if(!feedbackEligible(c)||!voiceReviewed(c))continue;totals.reviewed++;totals[appropriateness(c,f)]++;
 }
 const known=totals.good+totals.bad+totals.repeated;return {...totals,known,agreement:known?totals.good/known:null};
}
function improveFeedback(before,after){return after.good>=before.good&&after.bad<=before.bad&&after.repeated<=before.repeated&&after.bad+after.repeated<before.bad+before.repeated&&after.unknown<=before.unknown;}
export function compareFeedback(cases,sessions,baseline=defaultParameters().feedback){
 const eligible=cases.filter(c=>c.source.mode==='live'&&!c.manualAdded);
 const ids=split=>sessions.filter(s=>s.split===split).map(s=>s.id),trainIds=ids('training'),valIds=ids('validation');
 const train=eligible.filter(c=>trainIds.includes(c.source.recordId)),val=eligible.filter(c=>valIds.includes(c.source.recordId));
 const result={kind:'feedback',trainingIds:trainIds,validationIds:valIds,baselineParameters:baseline,candidates:[],recommended:null};
 if(trainIds.some(id=>valIds.includes(id))){result.reason='同じセッションを学習と検証に使えません。';return result;}
 const before={training:feedbackMetrics(train,baseline,sessions),validation:feedbackMetrics(val,baseline,sessions)};const reviewedSessionCount=group=>new Set(group.filter(c=>feedbackEligible(c)&&voiceReviewed(c)).map(c=>c.source.recordId)).size;result.progress={training:{sessions:reviewedSessionCount(train),items:before.training.reviewed,requiredSessions:2,requiredItems:20},validation:{sessions:reviewedSessionCount(val),items:before.validation.reviewed,requiredSessions:2,requiredItems:10}};
 if(new Set(train.filter(c=>feedbackEligible(c)&&voiceReviewed(c)).map(c=>c.source.recordId)).size<2||new Set(val.filter(c=>feedbackEligible(c)&&voiceReviewed(c)).map(c=>c.source.recordId)).size<2||before.training.reviewed<EVIDENCE_MIN.feedbackTrain||before.validation.reviewed<EVIDENCE_MIN.feedbackValidation){result.reason='音声ラベル不足：学習・検証それぞれ2セッション、評価済み20件／10件が必要です。';return result;}
 result.before=before;
 const weights={...baseline.priorityWeights},rated=new Map();
 for(const c of train){if(!feedbackEligible(c)||!voiceReviewed(c))continue;const original=c.appFeedback.original;
  const cues=original?.triggers?.length?original.triggers:original?.trigger?[original.trigger]:[];
  for(const t of cues){if(!Object.hasOwn(metricLabel,t.key))continue;const value=c.labels.voiceJudgment!==undefined?c.labels.cueLabels?.[`${t.key}:${Math.sign(t.delta)}`]:c.labels.feedbackRating==='useful'?'correct':c.labels.feedbackRating==='inaccurate'?'incorrect':null;
   if(!['correct','incorrect'].includes(value))continue;const counts=rated.get(t.key)??{correct:0,incorrect:0};counts[value]++;rated.set(t.key,counts);
  }
 }
 for(const [key,value]of rated)if(value.correct+value.incorrect>=5)weights[key]=value.incorrect>value.correct ? .75 : 1.25;
 const choices=[['助言を出す差を少し大きくする',{meaningfulDeviation:.3}],['小さい差も助言候補にする',{meaningfulDeviation:.15}],['評価済み助言の優先順位を調整',{priorityWeights:weights}],['修正助言の繰り返しも抑える',{suppressCorrections:true,repeatShots:3,cooldownMs:6000}]];
 for(const [label,change]of choices){const parameters={...baseline,...change};result.candidates.push({label,parameters,training:feedbackMetrics(train,parameters,sessions)});}
 const best=result.candidates.filter(c=>improveFeedback(before.training,c.training)).sort((a,b)=>(a.training.bad+a.training.repeated)-(b.training.bad+b.training.repeated)||a.label.localeCompare(b.label))[0];
 if(!best){result.reason='役立つ助言を減らさずに、不正確・繰り返しを減らす学習候補がありません。';return result;}
 best.validation=feedbackMetrics(val,best.parameters,sessions);result.selected=best;
 if(improveFeedback(before.validation,best.validation)){result.recommended=best;result.reason='検証データでも既知の不正確・繰り返しが減り、役立つ助言は減りませんでした。';}else result.reason='検証データで改善が確認できないため、変更を推奨しません。';return result;
}
export function validateCalibrationBackup(input){
 if(input?.schema!==CALIBRATION_SCHEMA||input.version!==1||!Array.isArray(input.versions)||input.versions.length>1000)throw new Error('対応するCalibration JSONではありません');
 const safe=JSON.stringify(input);if(safe.length>5*1024*1024||/"(?:__proto__|constructor|prototype)"\s*:/.test(safe))throw new Error('Calibration JSONが不正です');
 const records=input.versions.map(v=>{if(typeof v.id!=='string'||v.id.length>200||typeof v.scope!=='string'||v.scope.length>1000||v.engine!==CALIBRATION_ENGINE||!Number.isFinite(v.createdAt)||!Array.isArray(v.trainingIds)||!Array.isArray(v.validationIds)||v.trainingIds.some(id=>v.validationIds.includes(id)))throw new Error('Calibration Versionが不正です');return {...v,parameters:validateParameters(v.parameters),imported:true};});return records;
}
