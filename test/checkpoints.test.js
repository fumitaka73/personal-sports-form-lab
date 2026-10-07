import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheckpoints,targetScore} from '../src/checkpoints.js';
import {CHECK_TARGETS} from '../src/checkpoint-config.js';
function fixture({high=false,arch=false,hidden=false,shoulder=false,hipsMissing=false}={}) {
 const frames=Array.from({length:25},(_,i)=>{
  const p=Array.from({length:33},()=>({x:0.5,y:0.5,z:0,visibility:hidden?0:0.99}));
  const put=(id,x,y,z=0)=>p[id]={x,y,z,visibility:hidden?0:0.99};
  put(0,0.56,0.25);put(7,0.51,0.24);put(8,0.51,0.24);
  put(11,0.42,0.4);put(12,arch?0.42:0.58,0.4,shoulder?-0.1:0);
  put(13,0.44,0.35);put(14,0.6,0.35);
  put(15,0.55,0.25);put(16,0.57,high?0.02:0.25);
  put(23,0.45,0.7);put(24,0.58,0.7);put(25,0.45,0.88);put(26,0.58,0.88);
  put(27,0.43,0.98);put(28,0.57,0.98);put(20,0.61,high?0.02:0.25);
  if(hipsMissing) for(const id of [23,24,25,26,27,28])p[id].visibility=0;
  return {time:i/12,landmarks:hidden?null:p};
 });
 return {frames,hand:'right',aspect:1,phases:{start:0,release:1,end:2},phaseEstimated:false};
}
test('all eight checks and three mandatory checks always have a numeric score',()=>{
 for(const metadata of [{cameraAngle:'side'},{cameraAngle:'front'},{cameraAngle:'diagonal'}]){
  const r=evaluateCheckpoints(fixture(),metadata);
  assert.equal(r.checks.length,8);assert.equal(r.mandatory.length,3);
  for(const p of [...r.checks,...r.mandatory,...r.checks.flatMap(c=>c.parts)]) assert.ok(Number.isInteger(p.score)&&p.score>=0&&p.score<=100);
 }
});
test('release too high receives lower height/nose scores and a specific comment',()=>{
 const ideal=evaluateCheckpoints(fixture(),{cameraAngle:'side'}), high=evaluateCheckpoints(fixture({high:true}),{cameraAngle:'side'});
 assert.equal(ideal.mandatory[0].score,100);
 assert.ok(high.mandatory[0].score<ideal.mandatory[0].score);
 assert.ok(high.mandatory[1].score<ideal.mandatory[1].score);
 assert.match(high.mandatory[0].comment,/高すぎる/);
 assert.equal(high.issues[0].priority,0);
 assert.match(high.mandatory[0].note,/手首/);
});
test('backward torso proxy detects an arch possibility without claiming lumbar measurement',()=>{
 const r=evaluateCheckpoints(fixture({arch:true}),{cameraAngle:'side'});
 assert.ok(r.mandatory[2].score<100);
 assert.match(r.mandatory[2].comment,/反り腰の可能性・推定/);
 assert.match(r.mandatory[2].note,/腰椎.*計測していません/);
});
test('front view cannot directly rate lumbar arch and marks neutral score as unrated',()=>{
 const back=evaluateCheckpoints(fixture({arch:true}),{cameraAngle:'front'}).mandatory[2];
 assert.equal(back.score,50);assert.equal(back.status,'unrated');assert.match(back.source,/仮置き/);
});
test('undetected poses return explicit placeholder scores without invented criticism',()=>{
 const r=evaluateCheckpoints(fixture({hidden:true}),{cameraAngle:'side'});
 assert.equal(r.overall,50);assert.equal(r.status,'unrated');assert.equal(r.issues.length,0);
 assert.ok(r.checks.every(c=>c.status==='unrated'&&c.score===50));
 assert.ok(r.mandatory.every(p=>p.status==='unrated'&&p.value===null));
});
test('unrated palm/contact/middle-finger subitems never become measured values',()=>{
 const r=evaluateCheckpoints(fixture(),{cameraAngle:'front',goalDirection:'right'});
 for(const p of [...r.checks[6].parts.slice(1),r.checks[7].parts[1]]){
  assert.equal(p.score,50);assert.equal(p.value,null);assert.equal(p.status,'unrated');
 }
 assert.match(r.checks[7].parts[0].label,/人差し指/);
});
test('right shoulder protrusion proxy produces a directional estimated comment',()=>{
 const r=evaluateCheckpoints(fixture({shoulder:true}),{cameraAngle:'front'});
 const p=r.checks[3].parts[1];assert.ok(p.score<100);assert.match(p.comment,/右肩が前に出ている可能性/);assert.equal(p.status,'estimated');
});
test('same-angle Good Form calibrates shoulder depth rather than penalizing the camera',()=>{
 const a=fixture({shoulder:true});
 const r=evaluateCheckpoints(a,{cameraAngle:'front'},a,{cameraAngle:'front'});
 assert.equal(r.checks[3].parts[1].score,100);
 assert.equal(evaluateCheckpoints(a,{cameraAngle:'diagonal'},a,{cameraAngle:'side'}).checks[3].parts[1].status,'unrated');
});
test('upper-body crop uses a labelled scale estimate for mandatory release checks',()=>{
 const r=evaluateCheckpoints(fixture({hipsMissing:true}),{cameraAngle:'front'});
 assert.equal(r.mandatory[0].status,'estimated');assert.match(r.mandatory[0].note,/肩幅または顔/);
 assert.ok(Number.isFinite(r.checks[3].parts[0].value));
});
test('personal score calculation is deterministic and bounded',()=>{
 assert.deepEqual(evaluateCheckpoints(fixture(),{cameraAngle:'side'}),evaluateCheckpoints(fixture(),{cameraAngle:'side'}));
 assert.equal(targetScore(0,CHECK_TARGETS.releaseHeight),100);
 assert.equal(targetScore(10,CHECK_TARGETS.releaseHeight),0);
 assert.equal(targetScore(null,CHECK_TARGETS.releaseHeight),50);
});
