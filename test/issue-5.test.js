import test from 'node:test';import assert from 'node:assert/strict';
import {frames} from '../test-support/shot-frames.js';
import {ShotDetector} from '../src/shot-detector.js';
import {shootingPose} from '../src/pose-presence.js';
import {LiveBallSampler,previewPoint,hoopFromCorners} from '../src/live-objects.js';
import {singleShotRanges,mayExpire} from '../src/temporary-video.js';
import {conditionKey,basisKey} from '../src/session-report.js';
import {reviewGroups} from '../src/review-order.js';
import {selectCoachFeedback,explainCoachMetric} from '../src/coach-feedback.js';
function count(f){const d=new ShotDetector({live:true});for(const row of f)d.processFrame(row.time*1000,row.landmarks);return d;}
const weak=f=>f.map(row=>({...row,landmarks:row.landmarks?.map(p=>({...p,visibility:.3}))}));
test('empty, weak, cropped and static poses do not count; full real motions still count',()=>{
 const f=frames();assert.equal(count(f.map(r=>({...r,landmarks:null}))).count,0);assert.equal(count(weak(f)).count,0);
 for(const id of [12,14,16,24,26,28])assert.equal(count(f.map(r=>({...r,landmarks:r.landmarks.map((p,i)=>i===id?{...p,visibility:.1}:p)}))).count,0);
 assert.equal(count(f.map(r=>({...r,landmarks:f[0].landmarks}))).count,0);assert.equal(count(f).count,1);
 const left=f.map(r=>({...r,landmarks:r.landmarks.map((p,i)=>[12,14,16,24,26,28].includes(i)?{...p,visibility:.1}:p)}));assert.equal(shootingPose(left[0].landmarks,'left').valid,true);
 const d=new ShotDetector({live:true,hand:'left'});left.forEach(r=>d.processFrame(r.time*1000,r.landmarks));assert.equal(d.count,1);
});
test('exit before completion, discontinuity, rotation and re-entry cannot replay stale shots',()=>{
 const f=frames(),d=count(f.slice(0,9));d.processFrame(750,null);f.slice(9).forEach(r=>d.processFrame(r.time*1000,r.landmarks));assert.equal(d.count,0);
 d.resetContinuity('回転');f.slice(12).forEach(r=>d.processFrame((r.time+3)*1000,r.landmarks));assert.equal(d.count,0);
 f.forEach(r=>d.processFrame((r.time+6)*1000,r.landmarks));assert.equal(d.count,1);d.processFrame(9000,null);
 f.forEach(r=>d.processFrame((r.time+10)*1000,r.landmarks));assert.equal(d.count,2);
 const jump=f.map((r,i)=>({...r,landmarks:r.landmarks.map(p=>({...p,x:p.x+(i>=8?.3:0)}))}));assert.equal(count(jump).count,0);
 const gap=[...f.slice(0,9),...f.slice(9).map(r=>({...r,time:r.time+1}))];assert.equal(count(gap).count,0);
});
test('short visibility spikes and many static follow frames cannot duplicate detections',()=>{
 const f=frames(),d=count([...weak(f.slice(0,8)),...f.slice(8,10),...weak(f.slice(10))]);assert.equal(d.count,0);
 const normal=count(f);for(let i=25;i<150;i++)normal.processFrame(i/12*1000,f.at(-1).landmarks);assert.equal(normal.count,1);assert.ok(normal.frames.length<=121);
});
function orangeImage(){const width=120,height=120,data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(Math.hypot(x-74,y-53)<=6){const i=(y*width+x)*4;data.set([200,110,40,255],i);}return {width,height,data};}
test('live ball is an observed color/shape candidate only, missing frame and stale observation clear marker',()=>{
 const s=new LiveBallSampler();s.enabled=true;assert.ok(s.sample(orangeImage(),frames()[0].landmarks,1000));assert.ok(s.current(1100));assert.equal(s.current(1300),null);
 s.sample({width:120,height:120,data:new Uint8ClampedArray(120*120*4)},frames()[0].landmarks,1400);assert.equal(s.current(1400),null);s.reset();assert.equal(s.sample(orangeImage(),null,1600),null);s.enabled=false;assert.equal(s.current(1600),null);assert.ok(s.tracker.history.length<=2);
});
test('Hoop tap/drag source coordinates invert contain and mirror without using letterbox as image',()=>{
 const video={videoWidth:720,videoHeight:1280},rect={left:10,top:20,width:400,height:300};assert.equal(previewPoint(video,rect,12,170),null);
 const center=previewPoint(video,rect,210,170,true);assert.deepEqual(center,{x:.5,y:.5});const a=previewPoint({videoWidth:1280,videoHeight:720},{left:0,top:0,width:400,height:300},100,150,true);assert.equal(a.x,.75);assert.equal(a.y,.5);
 assert.equal(hoopFromCorners({x:.5,y:.5},{x:.5,y:.5}),null);assert.equal(hoopFromCorners({x:.4,y:.3},{x:.6,y:.35}).source,'manual');
});
test('one-shot ranges have short margins, no neighboring release, stop clamp and original immutability',()=>{
 const shots=[1,2,3].map((number,i)=>({number,detectorEvent:{phases:{start:10+i*2,release:11+i*2,end:12+i*2}}})),copy=structuredClone(shots),ranges=singleShotRanges(shots,10,15.4);
 assert.equal(ranges.get(1).start,10);assert.ok(ranges.get(1).end<=ranges.get(2).start);assert.ok(ranges.get(2).end<=ranges.get(3).start);assert.equal(ranges.get(3).end,15.4);assert.deepEqual(shots,copy);assert.equal(mayExpire({keep:true,expiresAt:0},100),false);
});
test('legacy unspecified and 2pt/3pt remain separate progress conditions; sessions descend, shots follow capture time',()=>{
 const s={goodFormReference:{id:'g'},metadata:{shotType:'jump',cameraAngle:'side',hand:'right'}};assert.equal(conditionKey(s),conditionKey({...s,metadata:{...s.metadata,points:'unspecified'}}));assert.notEqual(conditionKey({...s,metadata:{...s.metadata,points:'2pt'}}),conditionKey({...s,metadata:{...s.metadata,points:'3pt'}}));
 const c=(recordId,shotNumber,time,release)=>({source:{mode:'live',recordId,shotNumber},createdAt:time,analysis:{phases:{release}}});assert.deepEqual(reviewGroups([c('old',2,100,2),c('new',1,200,1),c('old',1,99,1)]).map(g=>g.map(c=>c.source.shotNumber)),[[1],[1,2]]);assert.equal(conditionKey(s),JSON.stringify(['g','jump','side','right']));const basis={...s,goodFormReference:{id:'g',analysis:{version:'analysis-1',metrics:{}}},shots:[{scoreVersion:'score-1'}]};assert.equal(basisKey(basis),JSON.stringify([JSON.stringify(['g','jump','side','right']),['score-1'],{metrics:{},version:'analysis-1'},null]));assert.notEqual(basisKey(basis),basisKey({...basis,captureVersion:'live-capture-0.17'}));
});
test('live timing and follow-through phrases state the actual movement, not abstract speed',()=>{
 for(const [key,group,delta,word] of [['kneeArmTiming','lower',.3,'脚の伸ばし遅い'],['armLead','release',.3,'腕の伸ばし早い'],['wristPeakTiming','release',.3,'腕の上げ終わり遅い'],['followWrist','follow',.3,'リリース後も腕を伸ばして']]){const m={key,group,delta,tolerance:.4,weight:1,label:key},f=selectCoachFeedback({overall:60,confidence:'Medium',metrics:[m]});assert.equal(f.text.ja,word);assert.match(f.reason,/Good Form|リリース後/);assert.ok(explainCoachMetric(m).length);}
});
