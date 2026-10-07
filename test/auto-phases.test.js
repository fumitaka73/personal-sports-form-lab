import test from 'node:test';
import assert from 'node:assert/strict';
import {detectBallCandidates,BallTracker} from '../src/ball-tracking.js';
import {detectShotPhases} from '../src/auto-phases.js';
import {evaluateCheckpoints} from '../src/checkpoints.js';
function image(shapes=[]){
 const width=160,height=120,data=new Uint8ClampedArray(width*height*4);
 for(let i=0;i<width*height;i++){data[i*4+1]=30;data[i*4+3]=255;}
 for(const shape of shapes)for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  if(shape.kind==='rectangle'?Math.abs(x-shape.x)<=shape.r&&Math.abs(y-shape.y)<=shape.r:Math.hypot(x-shape.x,y-shape.y)<=shape.r){const i=(y*width+x)*4;data[i]=210;data[i+1]=110;data[i+2]=25;}
 }
 return {width,height,data};
}
function landmarks(time,hand='right'){
 const p=Array.from({length:33},()=>({x:0.5,y:0.5,z:0,visibility:0.99}));
 const [s,e,w,h,k,a,index]=hand==='right'?[12,14,16,24,26,28,20]:[11,13,15,23,25,27,19];
 p[0]={x:0.56,y:0.25,visibility:0.99};p[s]={x:0.5,y:0.4,visibility:0.99};p[h]={x:0.5,y:0.7,visibility:0.99};
 p[e]={x:0.58,y:0.45-Math.min(time,1)*0.15,visibility:0.99};p[w]={x:0.55,y:0.6-Math.min(time,1)*0.3,visibility:0.99};p[index]={...p[w],x:p[w].x+0.025};
 p[k]={x:0.51,y:0.85,visibility:0.99};p[a]={x:0.51,y:0.98,visibility:0.99};return p;
}
function trackedFrames(hand='right'){
 return Array.from({length:25},(_,i)=>{
  const time=i/12,p=landmarks(time,hand),w=p[hand==='right'?16:15];
  const ball=i<=12?{x:w.x+0.015,y:w.y,radius:0.025,confidence:0.9,trackId:1}:{x:0.565+(i-12)*0.035,y:0.3-(i-12)*0.05,radius:0.025,confidence:0.9,trackId:1};
  return {time,landmarks:p,ball};
 });
}
const range={start:0,end:2};
test('orange round pixels are detected at their actual center',()=>{
 const found=detectBallCandidates(image([{x:70,y:60,r:8}]));assert.equal(found.length,1);
 assert.ok(Math.abs(found[0].x-70/160)<0.02);assert.ok(Math.abs(found[0].y-0.5)<0.02);
});
test('empty images and solid orange squares do not invent a ball',()=>{
 assert.equal(detectBallCandidates(image()).length,0);
 assert.equal(detectBallCandidates(image([{kind:'rectangle',x:70,y:60,r:15}])).length,0);
});
test('tracker acquires near the shooting hand and rejects a distant orange object',()=>{
 const tracker=new BallTracker(1);const p=landmarks(0);
 assert.equal(tracker.update([{x:0.95,y:0.05,radius:0.03,confidence:0.9}],p,0),null);
 const ball={x:0.56,y:0.6,radius:0.03,confidence:0.9};assert.ok(tracker.update([ball],p,0));
 assert.ok(tracker.update([{...ball,x:0.58,y:0.57}],p,1/12));
 assert.equal(tracker.update([],p,2/12),null);assert.equal(tracker.history.length,2);
});
test('tracked departure from the hand sets release between last contact and first departure',()=>{
 const result=detectShotPhases(trackedFrames(),'right',1,range);
 assert.equal(result.source,'ball');assert.equal(result.confidence,'Medium');
 assert.ok(result.phases.release>=1&&result.phases.release<=1.15);
 assert.ok(result.phases.start<result.phases.release&&result.phases.release<result.phases.end);
 assert.ok(result.releaseWindow.from<result.releaseWindow.to);
});
test('left handed tracking uses the selected shooting hand',()=>{
 assert.equal(detectShotPhases(trackedFrames('left'),'left',1,range).source,'ball');
});
test('missing ball falls back to pose movement, not an asserted ball release',()=>{
 const frames=trackedFrames().map(f=>({...f,ball:null}));
 const result=detectShotPhases(frames,'right',1,range);
 assert.equal(result.source,'pose');assert.equal(result.confidence,'Low');assert.equal(result.releaseWindow,null);
});
test('no ball or person is accepted with explicitly labelled midpoint fallback',()=>{
 const result=detectShotPhases(Array.from({length:25},(_,i)=>({time:i/12,landmarks:null,ball:null})),'right',1,range);
 assert.equal(result.source,'midpoint');assert.deepEqual(result.phases,{start:0,release:1,end:2});
});
test('occlusion and a new track identity are not mistaken for hand departure',()=>{
 const frames=trackedFrames().map((f,i)=>({...f,ball:{...f.ball,trackId:i>12?2:1}}));
 assert.notEqual(detectShotPhases(frames,'right',1,range).source,'ball');
});
test('stationary colored object does not generate a ball-release event',()=>{
 const frames=trackedFrames().map(f=>({...f,ball:{...f.ball,x:0.565,y:0.3}}));
 assert.notEqual(detectShotPhases(frames,'right',1,range).source,'ball');
});
test('detected ball position is used for release-height checks with candidate labeling',()=>{
 const frames=trackedFrames().map(f=>({...f,ball:{...f.ball,y:0.02}}));
 const analysis={frames,hand:'right',aspect:1,phases:{start:0,release:1,end:2}};
 const check=evaluateCheckpoints(analysis,{cameraAngle:'side'}).mandatory[0];
 assert.ok(check.score<100);assert.match(check.comment,/ボール候補/);assert.match(check.note,/色・輪郭/);
});
test('automatic inference is repeatable for identical inputs',()=>{
 assert.deepEqual(detectShotPhases(trackedFrames(),'right',1,range),detectShotPhases(trackedFrames(),'right',1,range));
});
