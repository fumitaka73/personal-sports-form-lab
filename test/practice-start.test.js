import test from 'node:test';import assert from 'node:assert/strict';
import {practiceCapacity,practiceError,START_RESERVE} from '../src/practice-start.js';
import {MIB,evaluateSafety} from '../src/coach-safety.js';
test('start capacity includes retained and old recordings without modifying records',()=>{
 const videos=[{id:'old',bytes:103*MIB,keep:true,expiresAt:0},{id:'blob',blob:new Blob(['1234'])}],poses=[{bytes:27*MIB}],before=structuredClone({videos,poses});
 const c=practiceCapacity(videos,poses);assert.equal(c.video.remaining,25*MIB-4);assert.equal(c.pose.remaining,5*MIB);assert.deepEqual({videos,poses},before);
 assert.ok(c.video.remaining>START_RESERVE.video);assert.equal(evaluateSafety({elapsed:0,video:{enabled:true,used:0},pose:{used:0}},{videoLimit:c.video.remaining,poseLimit:c.pose.remaining}).level,'ok');
 assert.equal(practiceCapacity([{bytes:130*MIB}],[]).video.remaining,0);
});
test('errors distinguish budget, unsupported, quota, permission and recorder failures without suggesting site reset',()=>{
 assert.match(practiceError('video',{code:'budget'}),/保存枠/);assert.match(practiceError('pose',{code:'budget'}),/姿勢記録/);
 assert.match(practiceError('video',{code:'unsupported'}),/録画を利用できません/);
 assert.match(practiceError('result',{name:'QuotaExceededError'}),/練習結果.*空き容量/);
 assert.match(practiceError('video',{name:'NotAllowedError'}),/許可されていません/);
 assert.match(practiceError('video',{code:'recorder'}),/中断/);
 assert.match(practiceError('pose',new Error('IO')),/IO/);
});
