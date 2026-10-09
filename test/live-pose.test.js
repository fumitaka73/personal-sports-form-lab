import test from 'node:test';
import assert from 'node:assert/strict';
import {videoTransform} from '../src/pose-coordinates.js';
import {liveMetrics} from '../src/live-metrics.js';
import {ShotDetector,detectSessionWithAdapter} from '../src/shot-detector.js';
import {detectSessionShots} from '../src/session.js';
import {frames} from '../test-support/shot-frames.js';
test('contain projection aligns portrait video and horizontal letterboxing',()=>{
 const t=videoTransform(720,1280,400,300);assert.equal(t.x({x:.5}),200);assert.equal(t.y({y:0}),0);assert.equal(t.y({y:1}),300);assert.ok(t.x({x:0})>0);
});
test('front mirror changes X only; rear mapping remains unmirrored',()=>{
 const rear=videoTransform(1280,720,400,300),front=videoTransform(1280,720,400,300,true);assert.equal(rear.x({x:0}),0);assert.equal(front.x({x:0}),400);assert.equal(rear.y({y:.2}),front.y({y:.2}));
});
test('coordinate projection updates for landscape orientation and letterboxes',()=>{
 const t=videoTransform(1280,720,300,600);assert.equal(t.x({x:1}),300);assert.ok(t.y({y:0})>0);assert.equal(t.y({y:.5}),300);
});
test('live angles reuse geometry and missing/weak joints never invent metrics',()=>{
 const p=frames()[0].landmarks;const m=liveMetrics(p);assert.ok(Number.isFinite(m.rightElbow));assert.equal(m.visibleCount,12);
 const partial=structuredClone(p);partial[16].visibility=.1;const crop=liveMetrics(partial);assert.equal(crop.rightElbow,null);assert.ok(Number.isFinite(crop.leftElbow));assert.equal(crop.quality,'Partial body');
 assert.equal(liveMetrics(null).rightElbow,null);assert.equal(liveMetrics(null).visibleCount,0);
});
test('torso lean uses video aspect ratio and reliable shoulders/hips',()=>{
 const p=frames()[0].landmarks;p[11].x+=.1;p[12].x+=.1;const a=liveMetrics(p,1).torsoLean,b=liveMetrics(p,2).torsoLean;assert.ok(b>a);p[11].visibility=.1;assert.equal(liveMetrics(p).torsoLean,null);
});
test('Session frame interface is exactly equivalent to the existing batch detector',()=>{
 const f=[0,4,8].flatMap(offset=>frames().map(f=>({...f,time:f.time+offset}))),range={start:0,end:10};assert.deepEqual(detectSessionWithAdapter(f,'right',1,range),detectSessionShots(f,'right',1,range));
});
test('Live receives every frame and counts one complete motion only once',()=>{
 const d=new ShotDetector({live:true});for(const f of frames())d.processFrame(f.time*1000,f.landmarks);
 assert.equal(d.count,1);assert.ok(d.history.length);assert.ok(d.lastEvent);
 for(let i=25;i<120;i++)d.processFrame(i/12*1000,frames().at(-1).landmarks);
 assert.equal(d.count,1);assert.equal(d.signals.shoulderToWrist,'above');
});
test('multiple live motions share the Session candidate count',()=>{
 const d=new ShotDetector({live:true});for(const offset of [0,4,8])for(const f of frames())d.processFrame((f.time+offset)*1000,f.landmarks);
 assert.equal(d.count,3);
});
test('temporary pose loss clears live signals and later frames recover',()=>{
 const d=new ShotDetector({live:true});d.processFrame(0,frames()[0].landmarks);d.processFrame(100,null);assert.equal(d.state,'IDLE');assert.equal(d.signals.wristHeight??null,null);d.processFrame(200,frames()[0].landmarks);assert.equal(d.presence.ready,false);for(const t of [300,400,500])d.processFrame(t,frames()[0].landmarks);assert.ok(Number.isFinite(d.signals.wristHeight));assert.equal(d.count,0);
});
test('out of order timestamps are ignored and rolling history is bounded',()=>{
 const d=new ShotDetector({live:true});for(let i=0;i<200;i++)d.processFrame(i*100,null);const count=d.frames.length;d.processFrame(1,null);assert.equal(d.frames.length,count);assert.ok(count<=101);assert.ok(d.history.length<=101);
});
