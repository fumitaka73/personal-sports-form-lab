import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMetrics } from '../src/metrics.js';
import { detectSessionShots, summarizeSession } from '../src/session.js';
import { reviewShot } from '../src/shot-engine.js';
import {ShotDetector} from '../src/shot-detector.js';
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

test('tracked ball departure is retained even with low/cropped shooting posture',()=>{
 const lowered=sessionFrames().map(f=>({...f,landmarks:f.landmarks.map((p,i)=>i===16?{...p,y:p.y+.3}:p),ball:{...f.ball,y:f.ball.y+.3}}));
 const shots=detectSessionShots(lowered,'right',1,{start:0,end:10});assert.equal(shots.length,3);assert.ok(shots.every(s=>s.source==='ball'));
});

test('a compact pose-only shooting arc is retained without demanding a very high wrist',()=>{
 const compact=frames().map(f=>{const p=structuredClone(f.landmarks),v=Math.min(1,f.time);p[12]={x:.5,y:.35,visibility:.99};p[24]={x:.5,y:.6,visibility:.99};p[14]={x:.55,y:.39-.08*v,visibility:.99};p[16]={x:.55+.03*v,y:.4-.12*v,visibility:.99};return {...f,landmarks:p};});
 assert.equal(detectSessionShots(compact,'right',1,{start:0,end:2}).length,1);
});

// Entirely synthetic geometry; no exported personal trace is used in this fixture.
function delayedExtension(extend=true){
 const base=frames()[0].landmarks;
 return Array.from({length:61},(_,i)=>{const time=i/20,p=structuredClone(base),rise=Math.max(0,Math.min(1,(time-.5)/.5)),w={x:.61,y:.48-.3*rise,visibility:.99},s=p[12];
 const angle=time<.5?100:extend&&time>=1.1?165:65,dx=w.x-s.x,dy=w.y-s.y,d=Math.hypot(dx,dy),h=d/(2*Math.tan(angle*Math.PI/360));
 p[16]=w;p[14]={x:(s.x+w.x)/2-dy/d*h,y:(s.y+w.y)/2+dx/d*h,visibility:.99};return {time,landmarks:p};});
}
test('pose-only shot can extend after the first sustained raised-hand frames',()=>{
 const trace=delayedExtension(),shots=detectSessionShots(trace,'right',1,{start:0,end:3});assert.equal(shots.length,1);assert.equal(shots[0].confidence,'Low');assert.ok(shots[0].phases.release>=1.1);
});
test('raised hand without subsequent elbow extension remains rejected',()=>{
 assert.equal(detectSessionShots(delayedExtension(false),'right',1,{start:0,end:3}).length,0);
});

test('live adapter detects delayed extension once and retains nonshooting rejection',()=>{
 for(const extend of [true,false]){
  const detector=new ShotDetector({live:true}),events=[];
  for(const f of delayedExtension(extend))events.push(...detector.processFrame(f.time*1000,f.landmarks).events);
  assert.equal(events.length,extend?1:0);if(extend)assert.ok(events[0].phases.release>=1.1);
 }
});

function liveEvents(trace){
 const detector=new ShotDetector({live:true}),events=[];
 for(const f of trace)events.push(...detector.processFrame(f.time*1000,f.landmarks,f.ball).events);
 return events;
}
function setElbowAngle(p,angle){
 const s=p[12],w=p[16],dx=w.x-s.x,dy=w.y-s.y,d=Math.hypot(dx,dy),h=d/(2*Math.tan(angle*Math.PI/360));
 p[14]={x:(s.x+w.x)/2-dy/d*h,y:(s.y+w.y)/2+dx/d*h,visibility:.99};
}
test('already straight arm raising and ball-held horizontal extension stay rejected',()=>{
 const armRaise=delayedExtension().map(f=>{const p=structuredClone(f.landmarks);setElbowAngle(p,170);return {...f,landmarks:p};});
 const chestPass=delayedExtension().map(f=>{const p=structuredClone(f.landmarks),v=Math.max(0,Math.min(1,(f.time-.5)/.6));p[16]={x:.61+.2*v,y:.43,visibility:.99};setElbowAngle(p,80+85*v);return {...f,landmarks:p};});
 const held=chestPass.map(f=>({...f,ball:{...f.landmarks[16],radius:.025,confidence:.9,trackId:1}}));
 for(const trace of [armRaise,chestPass,held]){
  assert.equal(detectSessionShots(trace,'right',1,{start:0,end:3}).length,0);
  assert.equal(liveEvents(trace).length,0);
 }
});
test('delayed extension with long raised follow-through is counted once offline and live',()=>{
 const trace=delayedExtension();for(let i=61;i<=160;i++){const p=structuredClone(trace.at(-1).landmarks);p[16].y=.18+.015*Math.sin(i*.5);setElbowAngle(p,165);trace.push({time:i/20,landmarks:p});}
 assert.equal(detectSessionShots(trace,'right',1,{start:0,end:8}).length,1);assert.equal(liveEvents(trace).length,1);
});
test('live tracking interruption cannot connect preparation to a later raised arm',()=>{
 for(const mode of ['missing','low-visibility','time-gap']){
  const interrupted=delayedExtension().flatMap(f=>{
   if(f.time<.7||f.time>1.2)return [f];
   if(mode==='time-gap')return [];
   return [{...f,landmarks:mode==='missing'?null:f.landmarks.map(p=>({...p,visibility:.1}))}];
  });
  assert.equal(liveEvents(interrupted).length,0,mode);
  const recovery=delayedExtension().map(f=>({...f,time:f.time+4}));
  assert.equal(liveEvents([...interrupted,...recovery]).length,1,mode+' recovery');
 }
});
test('ordinary repeated shots retain their count offline and live',()=>{
 const trace=[0,4,8,12].flatMap(offset=>frames().map(f=>({...f,time:f.time+offset})));
 const before=structuredClone(trace);
 assert.equal(detectSessionShots(trace,'right',1,{start:0,end:14}).length,4);
 assert.equal(liveEvents(trace).length,4);assert.deepEqual(trace,before);
});
// Pose-only detection cannot prove ball release. Record this boundary rather
// than pretending that every overhead pass or ball-held shooting arc is rejected.
test('shoot-like held-ball arc remains a Low-confidence pose candidate',()=>{
 const trace=delayedExtension().map(f=>({...f,ball:{...f.landmarks[16],radius:.025,confidence:.9,trackId:1}}));
 const events=liveEvents(trace);assert.equal(events.length,1);assert.equal(events[0].source,'pose');assert.equal(events[0].confidence,'Low');
});

// Anonymous analytic motion, not sampled or rescaled from a personal trace.
function receivingMotion(hold=.1){
 return Array.from({length:61},(_,i)=>{
  const time=i/20,p=structuredClone(frames()[0].landmarks);
  const rise=Math.max(0,Math.min(1,(time-.5)/.5)),fall=Math.max(0,Math.min(1,(time-1-hold)/.2));
  p[16]={x:.64,y:.48-.21*rise+.21*fall,visibility:.99};
  setElbowAngle(p,time>=1&&time<1+hold?165:100);
  return {time,landmarks:p};
 });
}
test('brief arm extension while receiving a ball is not a sustained pose shooting cycle',()=>{
 const trace=receivingMotion();assert.equal(detectSessionShots(trace,'right',1,{start:0,end:3}).length,0);assert.equal(liveEvents(trace).length,0);
});
test('raised follow-through supported for 0.25s still detects once without promoting confidence',()=>{
 const trace=receivingMotion(.35),events=liveEvents(trace);
 assert.equal(detectSessionShots(trace,'right',1,{start:0,end:3}).length,1);assert.equal(events.length,1);assert.equal(events[0].confidence,'Low');
});
test('live confirms 0.8s after observed motion before a later tracking break, without polling overshoot',()=>{
 const trace=delayedExtension().map(f=>f.time>=1.95?{...f,landmarks:null}:f),events=liveEvents(trace);
 assert.equal(events.length,1);assert.ok(events[0].at-events[0].motionTime>=.8-1e-5);assert.ok(events[0].at<1.95);assert.equal(events[0].confidence,'Low');
});
test('break before the evidence deadline clears the deadline and cannot emit a stale shot',()=>{
 for(const mode of ['missing','low-visibility','time-gap']){
  const trace=delayedExtension().flatMap(f=>f.time<1.85?[f]:mode==='time-gap'?[]:[{...f,landmarks:mode==='missing'?null:f.landmarks.map(p=>({...p,visibility:.1}))}]);
  assert.equal(liveEvents(trace).length,0,mode);
  assert.equal(liveEvents([...trace,...delayedExtension().map(f=>({...f,time:f.time+4}))]).length,1,mode+' new independent cycle');
 }
});
test('camera geometry reset discards the scheduled deadline while keeping past shot count',()=>{
 const detector=new ShotDetector({live:true});for(const f of delayedExtension().filter(f=>f.time<1.85))detector.processFrame(f.time*1000,f.landmarks);
 assert.ok(Number.isFinite(detector.evidenceAt));detector.resetContinuity();assert.equal(detector.evidenceAt,Infinity);
 const events=[];for(const f of delayedExtension().filter(f=>f.time>=1.85))events.push(...detector.processFrame(f.time*1000,f.landmarks).events);
 assert.equal(events.length,0);
});
