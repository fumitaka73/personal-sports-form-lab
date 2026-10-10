import test from 'node:test';
import assert from 'node:assert/strict';
import {frames} from '../test-support/shot-frames.js';
import {packFrame,unpackChunks,PoseArchive,POSE_STRIDE} from '../src/pose-archive.js';
import {exportPoseTrace,readPoseTrace} from '../src/pose-backup.js';
import {defaultParameters,validateParameters,reviewFingerprint,compareDetection,replayDetection,compareFeedback,validateCalibrationBackup,CALIBRATION_ENGINE,CALIBRATION_SCHEMA,scopeKey,detectionMetrics} from '../src/personal-calibration.js';
import {selectLegacyCoachFeedback as selectCoachFeedback} from '../src/coach-feedback.js';
const metadata={shotType:'jump',cameraAngle:'side',hand:'right'};
function dataset(weak=true){
 const cases=[],sessions=[];
 for(const [index,id]of ['train-a','train-b','val-a','val-b'].entries()){
  const base=100+index*100,sFrames=Array.from({length:10},(_,shot)=>frames().map(f=>{const p=structuredClone(f.landmarks),x=Math.min(1,f.time);if(weak){p[16].y=.26-.18*x;p[14].y=.35-.06*x;}return {time:base+shot*3.2+f.time,landmarks:p,aspect:1};})).flat();
  const session={id,origin:base,end:sFrames.at(-1).time,complete:true,metadata,aspect:1,frames:sFrames,split:index<2?'training':'validation'};
  const events=replayDetection(session,{...defaultParameters().detector,minExtension:5,minExtendedElbow:90});assert.equal(events.length,10);
  const group=events.map((e,j)=>({id:`live:${id}:${j+1}`,source:{mode:'live',recordId:id,shotNumber:j+1},metadata,analysis:{phases:e.phases},labels:{detection:'correct'},manualAdded:weak}));cases.push(...group);session.truth={confirmed:true,actualShots:10,events:events.map((e,j)=>({caseId:group[j].id,time:e.time})),reviewFingerprint:reviewFingerprint(group)};sessions.push(session);
 }
 return {cases,sessions};
}
test('pose-only compact trace retains detector joints, null poses and timestamp alignment',()=>{
 const original=frames(),packed=new Float32Array(original.flatMap(f=>packFrame({...f,aspect:1},0))).buffer;
 const decoded=unpackChunks([{buffer:packed}],0);assert.equal(decoded.length,original.length);assert.ok(Math.abs(decoded[5].time-original[5].time)<1e-6);assert.equal(decoded[5].landmarks[12].visibility>0,true);assert.equal(decoded[5].landmarks[0].visibility,0);
 const a={metadata,frames:original},b={metadata,frames:decoded};assert.equal(replayDetection(a,defaultParameters().detector).length,replayDetection(b,defaultParameters().detector).length);
 assert.equal(unpackChunks([{buffer:new Float32Array(packFrame({time:5,landmarks:null},4)).buffer}],4)[0].landmarks,null);
});
test('bounded pose archive saves without video and rejects negative-origin frames; failures are not evaluation data',async()=>{
 const chunks=[],saved=[],archive=new PoseArchive({session:{id:'pose',origin:0,metadata,goodFormId:'g',createdAt:1},remaining:20000,saveChunk:async c=>chunks.push(c),saveSession:async s=>saved.push(s)});
 archive.add({time:-1,landmarks:null});for(const f of frames())archive.add({...f,aspect:1});const session=await archive.stop();assert.equal(session.complete,true);assert.equal(session.count,25);assert.equal(chunks.length,2);assert.equal(session.bytes,25*POSE_STRIDE*4);
 const blob=exportPoseTrace(session,chunks),imported=await readPoseTrace(blob);assert.equal(imported.session.count,25);assert.equal(imported.chunks.reduce((n,c)=>n+c.buffer.byteLength,0),session.bytes);
 const failed=new PoseArchive({session:{id:'fail',origin:0},remaining:100,saveChunk:async()=>{},saveSession:async()=>{}});failed.add({time:1,landmarks:null});assert.equal((await failed.stop()).complete,false);
 const quota=new PoseArchive({session:{id:'quota',origin:0},saveChunk:async()=>{throw new Error('quota');},saveSession:async()=>{}});quota.add({time:1,landmarks:null});assert.equal((await quota.stop()).complete,false);
});
test('one-to-one detection matching does not reward duplicate detections',()=>{const m=detectionMetrics([{time:1},{time:1.1}],[{time:1}]);assert.equal(m.tp,1);assert.equal(m.fp,1);assert.equal(m.precision,.5);});
test('training-only detector selection requires separate validated improvement and preserves labels',()=>{
 const d=dataset(),before=structuredClone(d);const r=compareDetection(d.sessions,d.cases);assert.ok(r.recommended);assert.equal(r.before.training.fn,20);assert.equal(r.recommended.validation.fn,0);assert.ok(r.trainingIds.every(id=>!r.validationIds.includes(id)));assert.deepEqual(d,before);
 const strong=dataset(false);const mixed={sessions:[...d.sessions.slice(0,2),...strong.sessions.slice(2)],cases:[...d.cases.slice(0,20),...strong.cases.slice(20)]};const bad=compareDetection(mixed.sessions,mixed.cases);assert.equal(bad.recommended,null);assert.ok(bad.selected);assert.equal(bad.selected.label,r.selected.label);assert.match(bad.reason,/検証/);
 const sparse=compareDetection(d.sessions.slice(0,2),d.cases);assert.equal(sparse.recommended,null);assert.match(sparse.reason,/不足/);
 const edited=structuredClone(d);edited.cases[0].labels.detection='false-positive';assert.ok(compareDetection(edited.sessions,edited.cases).exclusions.some(e=>e.id==='train-a'));
 const duplicate=compareDetection([...d.sessions,{...d.sessions[0],split:'validation'}],d.cases);assert.equal(duplicate.recommended,null);assert.match(duplicate.reason,/同じセッション/);
});
function voiceDataset(){const sessions=[],cases=[];for(const [index,id]of ['train-a','train-b','val-a','val-b'].entries()){sessions.push({id,split:index<2?'training':'validation',focus:'automatic'});for(let j=0;j<10;j++){const time=100000+index*100000+Math.floor(j/3)*10000+j%3*1000,comparison={overall:70,confidence:'Medium',metrics:[{key:'wristHeight',group:'release',label:'Release',unit:'ratio',tolerance:.6,delta:-.4,weight:.5}],groups:[]},original=selectCoachFeedback(comparison);cases.push({id:`live:${id}:${j+1}`,createdAt:time,source:{mode:'live',recordId:id,shotNumber:j+1},comparison,appFeedback:{original},labels:{detection:'correct',feedbackRating:j%3===0?'useful':'repetitive',submetrics:{release:'too-low'}}});}}return {sessions,cases};}
test('feedback labels can recommend repetition suppression only when useful cues survive validation',()=>{
 const d=voiceDataset(),snapshot=structuredClone(d),r=compareFeedback(d.cases,d.sessions);assert.ok(r.recommended);assert.equal(r.recommended.parameters.suppressCorrections,true);assert.equal(r.recommended.validation.good,r.before.validation.good);assert.ok(r.recommended.validation.repeated<r.before.validation.repeated);assert.deepEqual(d,snapshot);
 const v=structuredClone(d);for(const c of v.cases)if(c.source.recordId.startsWith('val'))c.labels.feedbackRating='useful';const no=compareFeedback(v.cases,v.sessions);assert.equal(no.recommended,null);assert.match(no.reason,/検証/);
 assert.equal(compareFeedback(d.cases.slice(0,10),d.sessions).recommended,null);
});
test('bounded replay streams packed chunks without expanding the full pose archive',()=>{
 const d=dataset();const packed=d.sessions.map(s=>{const buffer=new Float32Array(s.frames.flatMap(f=>packFrame(f,s.origin))).buffer;const {frames:raw,...rest}=s;return {...rest,count:raw.length,bytes:buffer.byteLength,chunks:[{buffer}]};});
 const result=compareDetection(packed,d.cases);assert.ok(result.recommended);assert.equal(result.recommended.validation.fn,0);assert.equal(result.before.validation.fn,20);
});
test('parameter validation and version imports cannot activate or leak splits; score is untouched',()=>{
 const params=defaultParameters();assert.deepEqual(validateParameters(params),params);assert.throws(()=>validateParameters({...params,detector:{...params.detector,minRise:-1}}));
 const v={id:'v1',scope:scopeKey(metadata,'g'),engine:CALIBRATION_ENGINE,createdAt:1,parameters:params,trainingIds:['a'],validationIds:['b']};const backup={schema:CALIBRATION_SCHEMA,version:1,versions:[v]};assert.equal(validateCalibrationBackup(backup)[0].imported,true);assert.throws(()=>validateCalibrationBackup({...backup,versions:[{...v,validationIds:['a']}]}));
 const comparison={overall:70,confidence:'Medium',metrics:[{key:'wristHeight',group:'release',delta:-.4,tolerance:.6}]},snapshot=structuredClone(comparison);selectCoachFeedback(comparison,{parameters:{meaningfulDeviation:.3,priorityWeights:{wristHeight:.75}}});assert.deepEqual(comparison,snapshot);
});
test('bad advice is negative evidence for the original advice; generic bad form cannot invent direction',()=>{
 const d=voiceDataset();for(const c of d.cases){c.labels.feedbackRating='bad';c.labels.voiceJudgment='correct';}
 const r=compareFeedback(d.cases,d.sessions);assert.equal(r.before.training.bad,20);assert.equal(r.before.training.good,0);assert.ok(r.candidates.every(v=>v.training.good===0));
 const low=structuredClone(d);low.cases[0].comparison.confidence='Low';const insufficient=compareFeedback(low.cases,low.sessions);assert.equal(insufficient.recommended,null);assert.equal(insufficient.progress.training.items,19);
 const f=voiceDataset();for(const c of f.cases){c.labels.feedbackRating='unreviewed';c.labels.submetrics.release='bad';}
 const unknown=compareFeedback(f.cases,f.sessions);assert.equal(unknown.recommended,null);assert.equal(unknown.before,undefined);assert.equal(unknown.progress.training.items,0);
});
