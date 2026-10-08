import {coachMetricReliability} from '../src/coach-analysis.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {trunkProfile,estimateTrunk,trunkHTML} from '../src/trunk-proxy.js';
import {selectCoachFeedback} from '../src/coach-feedback.js';
import {annotateCase,emptyReviewData,collectCases,exportReviewData,validateReviewImport} from '../src/review-data.js';
import {calculateMetrics} from '../src/metrics.js';
import {reviewShot} from '../src/shot-engine.js';
const phases={start:0,release:1,end:1.5},metadata={hand:'right',cameraAngle:'side',shotType:'jump'};
function series(amount=0,projection=1,visibility=.99){return Array.from({length:21},(_,i)=>{const time=i/20,x=.5-amount*Math.min(1,time*2)*projection,p=Array.from({length:33},()=>({x:.5,y:.5,visibility}));p[0]={x:x+.1*projection,y:.15,visibility};for(const id of [11,12])p[id]={x,y:.3,visibility};for(const id of [23,24])p[id]={x:.5,y:.6,visibility};for(const id of [25,26])p[id]={x:.5,y:.85,visibility};return {time,landmarks:p,aspect:1};});}
const evaluate=(a,b=series(),angle='side')=>estimateTrunk(trunkProfile(a,phases),trunkProfile(b,phases),angle,angle);
test('side and diagonal projected trunk excess stays independent, mirrors and compares aligned phases',()=>{
 const side=evaluate(series(.15));assert.equal(side.confidence,'High');assert.equal(side.audioEligible,true);assert.ok(side.persistentSeconds>=.12);
 const diagonal=evaluate(series(.15,.707),series(0,.707),'diagonal');assert.equal(diagonal.confidence,'Medium');assert.equal(diagonal.audioEligible,true);
 const mirror=series(.15).map(f=>({...f,landmarks:f.landmarks.map(p=>({...p,x:1-p.x}))}));assert.ok(Math.abs(evaluate(mirror).lean-side.lean)<1e-8);
 const ref=series(.15).map(f=>({...f,time:f.time*2}));const aligned=estimateTrunk(trunkProfile(series(.15),phases),trunkProfile(ref,{start:0,release:2,end:3}));assert.equal(aligned.alert,false);
});
test('Low remains numeric, missing required joints is N/A, isolated spike and gaps never produce voice',()=>{
 const low=evaluate(series(.15,1,.35));assert.equal(low.confidence,'Low');assert.ok(Number.isFinite(low.lean));assert.equal(low.audioEligible,false);assert.match(trunkHTML(low),/Low/);
 const absent=series().map(f=>({...f,landmarks:f.landmarks.map((p,i)=>[25,26].includes(i)?{...p,visibility:0}:p)}));assert.equal(evaluate(absent).status,'unavailable');
 const spike=series();spike[10]=series(.25)[10];assert.equal(evaluate(spike).alert,false);
 const gaps=series(.15).filter((f,i)=>i%10===0);assert.equal(evaluate(gaps).alert,false);
 assert.equal(estimateTrunk(trunkProfile(series(.15),phases),null).audioEligible,false);
});
const comparison={overall:60,confidence:'Medium',groups:[],metrics:[{key:'kneeAngle',label:'膝',group:'lower',delta:20,tolerance:25,weight:8},{key:'wristHeight',label:'高さ',group:'release',delta:-.4,tolerance:.6,weight:.3}]};
test('one short utterance contains at most two reliable items, respects priorities and suppresses per-item repetition',()=>{
 const t=evaluate(series(.15)),snapshot=structuredClone(comparison);const first=selectCoachFeedback(comparison,{trunkEstimate:t,now:10000,shotNumber:1});assert.equal(first.triggers.length,2);assert.match(first.text.ja,/ディップ浅い/);assert.match(first.text.ja,/腰反りすぎ/);assert.equal(first.text.ja.split('、').length,2);assert.ok(first.triggers[0].priority>=first.triggers[1].priority);assert.deepEqual(comparison,snapshot);
 const recent=[{number:1,timestamp:10000,coachFeedback:first}];const next=selectCoachFeedback(comparison,{trunkEstimate:t,recent,now:11000,shotNumber:2});assert.equal(next.speak,false);const later=selectCoachFeedback(comparison,{trunkEstimate:t,recent,now:17000,shotNumber:4});assert.equal(later.speak,true);
 const low=selectCoachFeedback({...comparison,confidence:'Low'},{trunkEstimate:{...t,confidence:'Low',audioEligible:false}});assert.equal(low.trigger,null);assert.doesNotMatch(low.text.ja,/腰反りすぎ/);
 const priority=selectCoachFeedback(comparison,{parameters:{priorityWeights:{kneeAngle:.5,wristHeight:2}}});assert.ok(priority.triggers.length<=2);
 const perfect=selectCoachFeedback({...comparison,overall:100,metrics:comparison.metrics.map(m=>({...m,delta:0}))});assert.equal(perfect.text.ja,'パーフェクト！');assert.equal(selectCoachFeedback({...comparison,overall:100,metrics:[]}).speak,false);
});
test('trunk review labels and two-item feedback round trip without rewriting original estimates or score',()=>{
 const analysis=calculateMetrics(series(),phases,'right'),review=reviewShot(analysis,analysis,metadata,metadata),shot={number:1,analysis,...review,coachFeedback:selectCoachFeedback(comparison,{trunkEstimate:evaluate(series(.15))})};
 const session={id:'s',createdAt:1,metadata,goodFormReference:{id:'g',title:'基準',...metadata,analysis},shots:[shot]};const c=collectCases([],[],[session])[0],copy=structuredClone(c),fixed=annotateCase(c,{...c.labels,submetrics:{trunk:'incorrect'}});const data=validateReviewImport(JSON.parse(JSON.stringify(exportReviewData(emptyReviewData(),[fixed]))));assert.equal(data.cases[c.id].labels.submetrics.trunk,'incorrect');assert.equal(data.cases[c.id].annotationHistory.length,1);assert.deepEqual(fixed.trunkEstimate,copy.trunkEstimate);assert.equal(fixed.comparison.overall,copy.comparison.overall);assert.deepEqual(c,copy);
});

test('two-item feedback requires independent strong landmark evidence for each item',()=>{
 const poses=series(),weak=poses.map(f=>({...f,landmarks:f.landmarks.map((p,i)=>[25,26].includes(i)?{...p,visibility:.3}:p)}));
 const reliability=coachMetricReliability(weak,poses,'right','Medium');assert.equal(reliability.kneeAngle,'Low');assert.equal(reliability.wristHeight,'Medium');
 const f=selectCoachFeedback(comparison,{metricReliability:reliability});assert.equal(f.triggers.length,1);assert.equal(f.triggers[0].key,'wristHeight');assert.equal(f.text.ja,'リリース低い');
 const p=selectCoachFeedback({...comparison,overall:100,metrics:comparison.metrics.map(m=>({...m,delta:0}))},{metricReliability:Object.fromEntries(comparison.metrics.map(m=>[m.key,'Low']))});assert.equal(p.speak,false);
});
