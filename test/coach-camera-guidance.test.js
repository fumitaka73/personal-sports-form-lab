import test from 'node:test';
import assert from 'node:assert/strict';
import {frames} from '../test-support/shot-frames.js';
import {cameraGuidance} from '../src/coach-camera-guidance.js';
import {detectSessionShots} from '../src/session.js';
import {ShotDetector} from '../src/shot-detector.js';
const sample=()=>Array.from({length:61},(_,i)=>({time:i/12,landmarks:structuredClone(frames()[0].landmarks)}));
test('healthy visible posture at rest has no camera complaint',()=>assert.equal(cameraGuidance(sample()),null));
test('sustained missing, distant, cropped and hidden shooting arm get evidence-based hints',()=>{
 const missing=sample().map(f=>({...f,landmarks:null}));assert.equal(cameraGuidance(missing).code,'missing');
 const far=sample();for(const f of far)for(const p of f.landmarks){p.x=.5+(p.x-.5)*.3;p.y=.5+(p.y-.5)*.3;}assert.equal(cameraGuidance(far).code,'far');
 const cropped=sample();for(const f of cropped)f.landmarks[28].y=1.05;assert.equal(cameraGuidance(cropped).code,'clipped');
 const hidden=sample();for(const f of hidden)f.landmarks[16].visibility=.1;assert.equal(cameraGuidance(hidden).code,'partial');assert.equal(cameraGuidance(hidden,'left'),null);
});
test('brief tracking loss and startup do not trigger intrusive instructions',()=>{
 const f=sample();f.at(-1).landmarks=null;assert.equal(cameraGuidance(f),null);assert.equal(cameraGuidance(f.slice(0,3)),null);
});
test('four-FPS shoot motion survives frame spacing that previously rejected high evidence',()=>{
 const f=frames().filter((_,i)=>i%3===0),shots=detectSessionShots(f,'right',1,{start:0,end:2});assert.equal(shots.length,1);
 const d=new ShotDetector({live:true});for(const frame of f)d.processFrame(frame.time*1000,frame.landmarks);assert.equal(d.count,1);
});
test('shorter rising wrist arc remains a shot while below-shoulder dribbles stay excluded',()=>{
 const f=frames();for(const frame of f){const v=Math.min(1,frame.time);for(const w of [15,16])frame.landmarks[w].y=.39-.17*v;}
 assert.equal(detectSessionShots(f,'right',1,{start:0,end:2}).length,1);
 for(const frame of f)for(const w of [15,16])frame.landmarks[w].y+=.3;
 assert.equal(detectSessionShots(f,'right',1,{start:0,end:2}).length,0);
});
