import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyOutcome,validHoop} from '../src/shot-outcome.js';
const hoop={x:.5,y:.4,width:.2,height:.035};
const path=(x=.5)=>[.3,.38,.43,.49].map((y,i)=>({x,y,time:1.3+i/24,radius:.02,trackId:1}));
test('no visible/selected hoop means form only, irrespective of ball trajectory',()=>{
 assert.equal(classifyOutcome(path(),null,1).status,'not-applicable');
 assert.equal(classifyOutcome(path(),{...hoop,width:NaN},1).status,'not-applicable');
 assert.equal(validHoop({...hoop,x:2}),false);
});
test('observed downward passage inside rim is explicitly estimated, never confirmed',()=>{
 const result=classifyOutcome(path(),hoop,1);assert.equal(result.status,'likely-made');assert.equal(result.confidence,'Low');assert.ok(result.label.includes('推定'));assert.ok(result.reason.includes('成功確定ではありません'));
});
test('a descending ball clearly beside the rim is a possible miss',()=>assert.equal(classifyOutcome(path(.67),hoop,1).status,'likely-missed'));
test('rim-edge overlap cannot determine made or missed',()=>assert.equal(classifyOutcome(path(.59),hoop,1).status,'unknown'));
test('tracking gaps, changed identities, upward movement and no ball remain unknown',()=>{
 const variants=[[],path().map((p,i)=>({...p,time:i<2?p.time:p.time+.5})),path().map((p,i)=>({...p,trackId:i<2?1:2})),path().map(p=>({...p,y:.8-p.y}))];
 for(const points of variants)assert.equal(classifyOutcome(points,hoop,1).status,'unknown');
});
test('trajectory before release or belonging to a later shot is ignored',()=>{
 assert.equal(classifyOutcome(path(),hoop,2).status,'unknown');assert.equal(classifyOutcome(path().map(p=>({...p,time:p.time+5})),hoop,1).status,'unknown');
});
test('duplicated decoded frames in a lower-fps video do not hide a downward rim crossing',()=>{
 const repeated=path().flatMap(p=>[p,{...p,time:p.time+1/48}]);assert.equal(classifyOutcome(repeated,hoop,1).status,'likely-made');
});
