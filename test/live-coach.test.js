import test from 'node:test';
import assert from 'node:assert/strict';
import {frames} from '../test-support/shot-frames.js';
import {calculateMetrics} from '../src/metrics.js';
import {reviewShot} from '../src/shot-engine.js';
import {analyzeCompletedShot,compactAnalysis} from '../src/coach-analysis.js';
import {ShotDetector} from '../src/shot-detector.js';
import {selectCoachFeedback,coachDeviations} from '../src/coach-feedback.js';
import {summarizeCoach,buildCoachInput} from '../src/coach-summary.js';
import {CoachVoice} from '../src/coach-voice.js';
const meta={shotType:'jump',cameraAngle:'side',hand:'right'},phases={start:0,release:1,end:2};
const reference={...meta,analysis:calculateMetrics(frames(),phases,'right',1,false)};
const comparison=(overall=70,confidence='Medium',delta=-.4)=>({overall,confidence,groups:[],metrics:[{key:'wristHeight',label:'Release height',group:'release',unit:'胴長比',weight:.5,tolerance:.6,delta}]});
test('Live and Single use identical numeric metrics and weighted scores, with explicit timing cap',()=>{
 const live=analyzeCompletedShot(frames(),{phases},reference,meta);
 const single=reviewShot(reference.analysis,calculateMetrics(frames(),phases,'right',1,true),meta,meta);
 assert.deepEqual(live.analysis.metrics,calculateMetrics(frames(),phases,'right',1,true).metrics);
 assert.equal(live.comparison.overall,single.comparison.overall);assert.deepEqual(live.comparison.groups,single.comparison.groups);
 assert.equal(live.comparison.confidence,'Medium');assert.equal(live.comparison.phaseConfidence,'Low');assert.equal(single.comparison.confidence,'Low');assert.equal(compactAnalysis(live.analysis).frames,undefined);
});
test('Live missing poses and camera mismatch stay Low and prohibit biomechanical correction',()=>{
 for(const [f,m]of [[frames().map(f=>({...f,landmarks:null})),meta],[frames(),{...meta,cameraAngle:'front'}]]){const r=analyzeCompletedShot(f,{phases},reference,m);assert.equal(r.comparison.confidence,'Low');assert.equal(selectCoachFeedback(r.comparison).code,'view');}
});
test('feedback chooses one meaningful correction with direction, focus and positive thresholds',()=>{
 assert.equal(selectCoachFeedback(comparison(100)).code,'perfect');assert.equal(selectCoachFeedback(comparison(90,'Medium',-.1)).code,'good');assert.equal(selectCoachFeedback(comparison()).code,'higher');assert.equal(selectCoachFeedback(comparison(),{focus:'elbow'}).code,'good');
 assert.equal(selectCoachFeedback(comparison(70,'Medium',.4)).code,'lowerRelease');assert.equal(selectCoachFeedback(comparison(30,'Low')).code,'view');assert.equal(coachDeviations({...comparison(),metrics:[{key:'followWrist',group:'follow',delta:-1,tolerance:.3}]}).length,0);
});
test('persistent corrections stay concise; praise retains cooldown',()=>{
 const c=comparison(),first=selectCoachFeedback(c,{now:10000,shotNumber:1}),recent=[{number:1,timestamp:10000,coachFeedback:first}];
 const second=selectCoachFeedback(c,{recent,now:11000,shotNumber:2});assert.equal(second.speak,true);assert.equal(second.text.ja,'リリース低い');assert.equal(second.repeatCount,2);
 recent.push({number:2,timestamp:11000,coachFeedback:second});const third=selectCoachFeedback(c,{recent,now:12000,shotNumber:3});assert.equal(third.speak,true);assert.equal(third.text.ja,second.text.ja);assert.equal(third.repeatCount,3);
 const changed=selectCoachFeedback(comparison(70,'Medium',.4),{recent,now:12100,shotNumber:3});assert.equal(changed.text.ja,'リリース高い');assert.equal(changed.repeatCount,1);
 const praise=selectCoachFeedback(comparison(100),{now:20000});assert.equal(selectCoachFeedback(comparison(100),{recent:[{number:1,timestamp:20000,coachFeedback:praise}],now:21000,shotNumber:2}).speak,false);
 const low=selectCoachFeedback(comparison(30,'Low'),{recent,now:12100,shotNumber:3});assert.equal(low.code,'view');assert.equal(low.trigger,null);assert.equal(low.repeatCount,1);
});
test('COMPLETE events are delivered once even with pose loss and many follow-through frames',()=>{
 const d=new ShotDetector({live:true}),events=[];for(const f of frames())events.push(...d.processFrame(f.time*1000,f.landmarks).events);for(let i=25;i<80;i++)events.push(...d.processFrame(i/12*1000,i===30?null:frames().at(-1).landmarks).events);assert.equal(events.length,1);assert.equal(d.count,1);
});
test('summary uses chronological thirds, excludes weak corrections, and leaves unavailable consistency empty',()=>{
 const shots=[60,80,100].map((v,i)=>({number:i+1,timestamp:1000+i,comparison:comparison(v,i===2?'Low':'Medium'),analysis:{metrics:{}},coachFeedback:selectCoachFeedback(comparison(v))}));const s=summarizeCoach(shots);assert.equal(s.total,3);assert.equal(s.average,80);assert.equal(s.best,100);assert.deepEqual(s.thirds,[60,80,100]);assert.equal(s.mostCommon.count,2);assert.equal(s.mostConsistent,null);const input=buildCoachInput({shots,focus:'release',goodFormReference:{id:'good'}});assert.equal(input.selectedFocus,'release');assert.equal(input.shots[0].madeMissed,null);assert.equal(input.aiCoach,null);assert.equal(summarizeCoach([]).average,null);
});
test('voice Japanese/English, volume/off and latest feedback cancels stale speech',()=>{
 const spoken=[],synthesis={cancel(){spoken.length=0;},speak(u){spoken.push(u);},getVoices(){return [];}},Utterance=class{constructor(text){this.text=text;}};
 const voice=new CoachVoice({synthesis,Utterance});voice.deliver(selectCoachFeedback(comparison()));assert.equal(spoken[0].text,'リリース低い');assert.equal(spoken[0].lang,'ja-JP');assert.equal(spoken[0].rate,1.25);voice.configure({language:'en',volume:.4});voice.deliver(selectCoachFeedback(comparison(100)));assert.equal(spoken.length,1);assert.equal(spoken[0].text,'Perfect');assert.equal(spoken[0].volume,.4);voice.deliver({...selectCoachFeedback(comparison()),speak:false});assert.equal(spoken.length,0);voice.configure({enabled:false});assert.equal(voice.prime(),false);assert.equal(spoken.length,0);
});

test('fast complete cycles are analyzed independently and preserve shot order',()=>{
 const d=new ShotDetector({live:true}),f=[0,2.5,5].flatMap(offset=>frames().map(f=>({...f,time:f.time+offset}))),events=[];for(const frame of f)events.push(...d.processFrame(frame.time*1000,frame.landmarks).events);assert.equal(events.length,3);const scores=events.map(e=>analyzeCompletedShot(f,e,reference,meta).comparison.overall);assert.ok(scores.every(Number.isFinite));assert.deepEqual(events.map(e=>e.number),[1,2,3]);
});

test('voice threshold overrides preserve scores and dip focus can outrank release',()=>{
 const c=comparison(92);const before=structuredClone(c);assert.equal(selectCoachFeedback(c,{thresholds:{good:80,perfect:90}}).code,'perfect');assert.deepEqual(c,before);
 c.metrics.push({key:'kneeAngle',label:'Dip',group:'lower',unit:'deg',delta:20,tolerance:25});const f=selectCoachFeedback(c,{focus:'dip'});assert.equal(f.code,'legs');assert.equal(f.text.ja,'ディップ浅い');c.metrics.at(-1).delta=-20;assert.equal(selectCoachFeedback(c,{focus:'dip'}).text.ja,'ディップ深い');
});

test('coach phrases identify specific timing and focus without vague rhythm or reference wording',()=>{
 const metric=(key,group,delta,temporal=false)=>({key,group,delta,tolerance:.4,temporal,weight:1});
 const c=metrics=>({overall:60,confidence:'Medium',metrics});
 assert.equal(selectCoachFeedback(c([metric('kneeArmTiming','lower',.2,true)]),{focus:'lower'}).text.ja,'脚の伸ばし始めが遅い');
 assert.equal(selectCoachFeedback(c([metric('kneeArmTiming','lower',-.2,true)]),{focus:'lower'}).text.ja,'脚の伸ばし始めが早い');
 assert.equal(selectCoachFeedback(c([metric('armLead','release',.2,true)]),{focus:'rhythm'}).text.ja,'腕の伸ばし始めが早い');
 assert.equal(selectCoachFeedback(c([metric('wristPeakTiming','release',.2,true)]),{focus:'rhythm'}).text.ja,'腕の上げ終わりが遅い');
 const dip=c([metric('kneeAngle','lower',.6),metric('kneeArmTiming','lower',-.8,true)]);
 assert.equal(selectCoachFeedback(dip,{focus:'dip'}).text.ja,'ディップ浅すぎ');
 assert.equal(selectCoachFeedback(dip,{focus:'lower'}).text.ja,'脚の伸ばし始めが早い');
 assert.equal(selectCoachFeedback({...dip,metrics:[metric('kneeAngle','lower',-.6)]},{focus:'dip'}).text.ja,'ディップ深すぎ');
 assert.equal(selectCoachFeedback({...dip,overall:90,metrics:[metric('kneeAngle','lower',0)]},{focus:'dip'}).text.ja,'ディップちょうどいい');
 assert.equal(selectCoachFeedback({...dip,overall:90,metrics:[metric('wristHeight','release',0)]},{focus:'release'}).text.ja,'リリースいいです');
});
