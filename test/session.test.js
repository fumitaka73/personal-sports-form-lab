import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMetrics } from '../src/metrics.js';
import { detectSessionShots, summarizeSession } from '../src/session.js';
import { reviewShot } from '../src/shot-engine.js';
import { frames } from '../test-support/shot-frames.js';
function sessionFrames(){
  return [0,4,8].flatMap((offset,track)=>frames().map((f,i)=>{
    const p=structuredClone(f.landmarks),w=p[16];
    // Two consecutive contact frames followed by actual upward departure.
    const ball=i<=12?{x:w.x,y:w.y,radius:.025,confidence:.9,trackId:track+1}:{x:w.x+(i-12)*.07,y:w.y-(i-12)*.06,radius:.025,confidence:.9,trackId:track+1};
    return {time:f.time+offset,landmarks:p,ball};
  }));
}
const meta={hand:'right',cameraAngle:'side',shotType:'jump'};
test('multiple shots are detected in time order without duplicate arm/ball candidates',()=>{
 const candidates=detectSessionShots(sessionFrames(),'right',1,{start:0,end:10});
 assert.equal(candidates.length,3);assert.ok(candidates.every(c=>c.source==='ball'));
 assert.ok(candidates[0].phases.release<2);assert.ok(candidates[1].phases.release>4);assert.ok(candidates[2].phases.release>8);
 for(let i=1;i<candidates.length;i++)assert.ok(candidates[i-1].phases.end<=candidates[i].phases.start);
});
test('missing and stationary footage does not fabricate session shots',()=>{
 assert.deepEqual(detectSessionShots([{time:0,landmarks:null},{time:10,landmarks:null}],'right',1,{start:0,end:10}),[]);
 const still=frames().map(f=>({...f,landmarks:frames()[0].landmarks}));
 assert.deepEqual(detectSessionShots(still,'right',1,{start:0,end:2}),[]);
});
test('pose-only session detection remains possible and explicitly Low confidence',()=>{
 const candidates=detectSessionShots(sessionFrames().map(f=>({...f,ball:null})),'right',1,{start:0,end:10});
 assert.equal(candidates.length,3);assert.ok(candidates.every(c=>c.confidence==='Low'&&c.source==='pose'));
});
test('an extracted session shot and the exact standalone clip share metrics, scores and feedback',()=>{
 const reference=calculateMetrics(frames(),{start:0,release:1,end:2},'right');
 for(const detection of detectSessionShots(sessionFrames(),'right',1,{start:0,end:10})){
  const phase=detection.phases,window=sessionFrames().filter(f=>f.time>=phase.start&&f.time<=phase.end);
  const session=calculateMetrics(window,phase,'right',1,true);
  const clip=calculateMetrics(window.map(f=>({...f,time:f.time-phase.start})),{start:0,release:phase.release-phase.start,end:phase.end-phase.start},'right',1,true);
  for(const key of Object.keys(session.metrics))assert.ok(session.metrics[key]===clip.metrics[key]||Math.abs(session.metrics[key]-clip.metrics[key])<1e-8,key);
  const a=reviewShot(reference,session,meta,meta),b=reviewShot(reference,clip,meta,meta);
  assert.equal(a.comparison.overall,b.comparison.overall);assert.deepEqual(a.comparison.groups,b.comparison.groups);assert.deepEqual(a.feedback,b.feedback);assert.deepEqual(a.checkpointReview,b.checkpointReview);
 }
});
test('session summary excludes unscored shots and shows chronological half trend',()=>{
 assert.deepEqual(summarizeSession([{comparison:{overall:20}},{comparison:{overall:null}},{comparison:{overall:80}}]),{count:3,scoredCount:2,average:50,best:80,change:60});
 assert.deepEqual(summarizeSession([]),{count:0,scoredCount:0,average:null,best:null,change:null});
});

test('low arm swings and dribbling below the shoulder are not session shots',()=>{
 const swings=Array.from({length:121},(_,i)=>{const time=i/12,p=structuredClone(frames()[0].landmarks);p[16].y=.48+.06*Math.sin(time*4);p[14].y=.42+.025*Math.sin(time*4);return {time,landmarks:p};});
 assert.equal(detectSessionShots(swings,'right',1,{start:0,end:10}).length,0);
});
test('one-frame tracking spikes are not complete shooting cycles',()=>{
 const jitter=Array.from({length:61},(_,i)=>{const p=structuredClone(frames()[0].landmarks);if(i===24){p[16].y=.05;p[14].y=.15;}return {time:i/12,landmarks:p};});
 assert.equal(detectSessionShots(jitter,'right',1,{start:0,end:5}).length,0);
});
test('a long follow-through with repeated arm rises is counted once until a new preparation',()=>{
 const follow=Array.from({length:97},(_,i)=>{const time=i/12,p=structuredClone(frames()[Math.min(i,24)].landmarks);if(time>2){p[16].y=.10+.035*Math.sin(time*4);p[14].y=.22+.025*Math.sin(time*4);}return {time,landmarks:p};});
 assert.equal(detectSessionShots(follow,'right',1,{start:0,end:8}).length,1);
});
test('excluded false detections do not contribute to counts, scores or trends',()=>{
 assert.deepEqual(summarizeSession([{comparison:{overall:20}},{excluded:true,comparison:{overall:100}},{comparison:{overall:80}}]),{count:2,scoredCount:2,average:50,best:80,change:60});
});

test('14 complete shots mixed with low nonshooting movements stay at 14 candidates',()=>{
 const mixed=[];
 for(let shot=0;shot<14;shot++){
  for(const f of frames())mixed.push({...f,time:f.time+shot*5});
  for(let i=1;i<36;i++){
   const p=structuredClone(frames()[0].landmarks),time=shot*5+2+i/12;
   p[16].y=.38+.035*Math.sin(i*.8);p[14].y=.38+.02*Math.sin(i*.8);
   mixed.push({time,landmarks:p});
  }
 }
 assert.equal(detectSessionShots(mixed,'right',1,{start:0,end:70}).length,14);
});
