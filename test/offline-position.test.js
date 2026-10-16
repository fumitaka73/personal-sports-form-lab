import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflinePosition,groupTimelineMarkers} from '../src/offline-position.js';

test('delayed media seek keeps requested position visible and registration locked until correct frame arrives',()=>{
  let actual=1,requested;
  const video={get currentTime(){return actual},set currentTime(t){requested=t},readyState:2,seeking:false,pause(){}};
  const p=createOfflinePosition(video,()=>145);
  p.seek(25);
  // Represents delayed media events/currentTime after an iPhone seek request.
  assert.equal(video.currentTime,1);
  assert.equal(requested,25);
  assert.equal(p.displayTime(),25);
  assert.equal(p.ready(),false);
  assert.equal(p.settle(),false); // stale old seeked must not unlock
  p.seek(45);
  actual=25;
  assert.equal(p.settle(),false);
  actual=45; video.seeking=true;
  assert.equal(p.settle(),false);
  video.seeking=false;
  assert.equal(p.settle(),true);
  assert.equal(p.displayTime(),45);
});
test('same-position, start/end, loading, reset and native seeks do not invent usable media frames',()=>{
  const video={currentTime:0,readyState:2,seeking:false,pause(){}};
  const p=createOfflinePosition(video,()=>14);
  p.seek(0); assert.equal(p.ready(),true);
  p.seek(20); assert.equal(video.currentTime,13.999); assert.equal(p.ready(),false);
  video.readyState=1; assert.equal(p.settle(),false);
  video.readyState=2; assert.equal(p.settle(),true);
  video.seeking=true; assert.equal(p.ready(),false);
  p.reset(); assert.equal(p.pending(),false); assert.equal(p.ready(),false);
  video.seeking=false; p.seek(-1); assert.equal(video.currentTime,0);
  assert.equal(p.settle(),true);
});
test('close timeline markers share one finger-sized group; separate positions and lanes retain all IDs',()=>{
  const entries=[{id:'b',time:2},{id:'c',time:35},{id:'a',time:1}];
  assert.deepEqual(groupTimelineMarkers(entries,145,240).map(g=>g.map(i=>i.id)),[['a','b'],['c']]);
  assert.deepEqual(entries.map(i=>i.id),['b','c','a']);
  assert.deepEqual(groupTimelineMarkers([],145,0),[]);
});

test('position diagnostic distinguishes requested, pending, actual media and displayed positions without changing the video',()=>{
 let actual=20;
 const video={get currentTime(){return actual;},set currentTime(t){},readyState:2,seeking:false,pause(){}};
 const p=createOfflinePosition(video,()=>145);
 p.seek(30);
 assert.deepEqual(p.snapshot(),{mediaTime:20,displayTime:30,pendingTarget:30,lastSeekTarget:30,seeking:false,readyState:2});
 actual=30;p.settle();
 assert.deepEqual(p.snapshot(),{mediaTime:30,displayTime:30,pendingTarget:null,lastSeekTarget:30,seeking:false,readyState:2});
 p.reset();assert.equal(p.snapshot().lastSeekTarget,null);
});

test('selected marker stays at its own release and its finger target does not cover a separate group',()=>{
 const entries=[{key:'a',time:1},{key:'selected',time:20},{key:'b',time:30},{key:'c',time:70}];
 const groups=groupTimelineMarkers(entries,145,240,'selected');
 assert.deepEqual(groups.map(g=>g.map(e=>e.key)),[['a','selected','b'],['c']]);
 const anchors=groups.map(g=>(g.find(e=>e.key==='selected')??g[0]).time);
 assert.equal(anchors[0],20);assert.ok((anchors[1]-anchors[0])/145*240>=44);
});
