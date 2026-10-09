import test from 'node:test';
import assert from 'node:assert/strict';
import {PoseArchive,POSE_STRIDE,poseSize} from '../src/pose-archive.js';
import {allocateDatasets,evidenceProgress,sufficient} from '../src/calibration-allocation.js';
import {quickLabels,reviewCues,voiceReviewed} from '../src/quick-review.js';
import {feedbackMetrics,defaultParameters} from '../src/personal-calibration.js';
const metadata={shotType:'jump',cameraAngle:'side',hand:'right'};
const cueCase=(id='s',n=1)=>({id:`${id}:${n}`,createdAt:n*10000,source:{mode:'live',recordId:id,shotNumber:n},metadata,analysis:{},comparison:{confidence:'Medium',overall:60,metrics:[{key:'kneeAngle',group:'lower',delta:20,tolerance:25,weight:8,score:60}],groups:[]},labels:{detection:'unreviewed',evaluation:'unsure',outcome:'unknown'},appFeedback:{original:{version:'live-coach-0.6',speak:true,triggers:[{key:'kneeAngle',delta:20},{key:'trunkExtension',delta:10}],text:{ja:'ディップ浅い、腰反りすぎ'}}}});
test('first pose frame persists before stop; small traces display bytes; failures count only committed frames',async()=>{
 const chunks=[],a=new PoseArchive({session:{id:'s',origin:0},saveChunk:async(c,s)=>chunks.push({c,s}),saveSession:async()=>{}});a.add({time:0,landmarks:null});await a.queue;assert.equal(chunks.length,1);assert.equal(a.session.bytes,POSE_STRIDE*4);assert.equal(poseSize(a.session.bytes),'180 B');assert.equal(a.session.complete,false);const stopped=await a.stop();assert.equal(stopped.complete,true);
 const bad=new PoseArchive({session:{id:'bad',origin:0},saveChunk:async()=>{throw Object.assign(new Error(),{name:'QuotaExceededError'});},saveSession:async()=>{}});bad.add({time:0,landmarks:null});const result=await bad.stop();assert.equal(result.bytes,0);assert.equal(result.count,0);assert.equal(result.complete,false);assert.match(result.failureReason,/空き容量不足/);
 const empty=new PoseArchive({session:{id:'empty',origin:0},saveChunk:async()=>{},saveSession:async()=>{}});assert.match((await empty.stop()).failureReason,/フレーム未取得/);
});
test('safe automatic allocation preserves existing held-out and locked exclusions and meets exact voice minima',()=>{
 const sessions=Array.from({length:4},(_,i)=>({id:`s${i}`,createdAt:i,metadata})),cases=sessions.flatMap(s=>Array.from({length:10},(_,i)=>{const c=cueCase(s.id,i+1);c.labels=quickLabels(c,'correct');return c;}));
 const allocation=allocateDatasets(sessions,cases,{});assert.deepEqual(sessions.map(s=>allocation[s.id].split),['training','training','validation','validation']);const progress=evidenceProgress(sessions,cases,allocation);assert.equal(sufficient(progress.feedback),true);assert.equal(sufficient(progress.detector),false);assert.equal(progress.detector.training.items,0);
 const locked={s0:{split:'excluded',lockedAt:1},s1:{split:'validation',lockedAt:2},s2:{split:'validation'}};const changed=allocateDatasets(sessions,cases,locked);for(const id of ['s0','s1','s2'])assert.deepEqual(changed[id],locked[id]);assert.deepEqual(locked,{s0:{split:'excluded',lockedAt:1},s1:{split:'validation',lockedAt:2},s2:{split:'validation'}});
});
test('quick labels keep subjective Form Match and outcome separate; two cues have independent truth',()=>{
 const c=cueCase(),before=structuredClone(c);assert.deepEqual(reviewCues(c).map(t=>t.text),['ディップ浅い','腰反りすぎ']);const labels=quickLabels(c,'correct');assert.equal(labels.detection,'correct');assert.equal(labels.evaluation,'unsure');assert.equal(labels.outcome,'unknown');assert.equal(labels.feedbackRating,undefined);assert.deepEqual(c,before);assert.equal(voiceReviewed({...c,labels}),true);assert.equal(voiceReviewed({...c,labels:quickLabels(c,'unknown')}),false);assert.equal(voiceReviewed({...c,appFeedback:{original:{speak:false}},labels}),false);
 labels.voiceJudgment='partial';labels.cueLabels['trunkExtension:1']='incorrect';const metrics=feedbackMetrics([{...c,labels}],defaultParameters().feedback,[{id:'s',focus:'dip'}]);assert.equal(metrics.reviewed,1);assert.equal(metrics.good,1); // The retained, independently confirmed dip cue is correct.
});
test('automatic allocation avoids wasting large sessions and respects explicit manual exclusions',()=>{
 const sessions=Array.from({length:4},(_,i)=>({id:`skew${i}`,createdAt:i,metadata})),cases=sessions.flatMap((s,i)=>Array.from({length:[19,19,1,1][i]},(_,n)=>{const c=cueCase(s.id,n+1);c.labels=quickLabels(c,'correct');return c;}));const datasets=allocateDatasets(sessions,cases,{});assert.equal(sufficient(evidenceProgress(sessions,cases,datasets).feedback),true);
 const excluded={skew0:{split:'excluded',manualAssignedAt:1}};assert.deepEqual(allocateDatasets(sessions,cases,excluded).skew0,excluded.skew0);
});
test('frequent pose commits remain compatible with long and single-frame pose backups',async()=>{
 const {exportPoseTrace,readPoseTrace}=await import('../src/pose-backup.js');const chunks=Array.from({length:1100},(_,i)=>({index:i,buffer:new Float32Array([i,1,0,...Array(POSE_STRIDE-3).fill(0)]).buffer})),session={id:'long',metadata,goodFormId:'good',complete:true,status:'complete',origin:0,end:1099,createdAt:1,count:1100,bytes:1100*POSE_STRIDE*4};assert.equal((await readPoseTrace(exportPoseTrace(session,chunks))).chunks.length,1100);
 const single={...session,count:1,bytes:POSE_STRIDE*4,end:0};assert.equal((await readPoseTrace(exportPoseTrace(single,chunks.slice(0,1)))).session.count,1);
});
test('pose diagnostics distinguish missing historical chunks from valid small saves without fabricating frames',async()=>{
 const {poseIntegrity}=await import('../src/pose-diagnostics.js'),session={id:'s',count:1,bytes:POSE_STRIDE*4,chunks:1};assert.match(poseIntegrity(session,[]).error,/なし/);assert.equal(poseIntegrity(session,[{sessionId:'s',index:0,buffer:new ArrayBuffer(POSE_STRIDE*4)}]).error,null);assert.match(poseIntegrity(session,[{sessionId:'other',index:0,buffer:new ArrayBuffer(POSE_STRIDE*4)}]).error,/ID/);
});
