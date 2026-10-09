import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionReport,previousReport,progressSeries,basisKey,localPeriod} from '../src/session-report.js';
import {reportHTML} from '../src/session-report-ui.js';
import {ratingEntry} from '../src/session-feedback.js';
const now=new Date(2026,9,9,12).getTime();
function session(id='s',score=80,count=30,time=now){return {id,createdAt:time,endedAt:time+1000,version:'live-coach-0.6',metadata:{shotType:'jump',cameraAngle:'side',hand:'right'},goodFormReference:{id:'good',title:'Good',analysis:{version:'test',metrics:{kneeAngle:140},phases:{start:0,release:1,end:2}}},shots:Array.from({length:count},(_,i)=>({number:i+1,scoreVersion:'test',comparison:{version:'test',overall:score,confidence:'High',groups:[],metrics:[{key:'kneeAngle',score,delta:15,tolerance:35},{key:'kneeArmTiming',score:10,delta:0,tolerance:.4},{key:'wristHeight',score:60,delta:-.3,tolerance:.6}]},trunkEstimate:{status:'estimated',confidence:'Medium',lean:15,excess:10,alert:true}}))};}
test('30 candidates use actual metric keys and exclude Low without changing legacy scores',()=>{
 const s=session();s.shots[0].comparison.confidence='Low';s.shots[1].comparison.metrics[0].excluded='撮影角度が不一致';s.shots[2].comparison.metrics=[];const original=structuredClone(s),r=sessionReport(s);assert.equal(r.total,30);assert.equal(r.count,29);assert.equal(r.lowCount,1);assert.equal(r.average,80);assert.equal(r.items.dip.count,27);assert.equal(r.items.dip.score,80);assert.equal(r.items.timing.score,10);assert.equal(r.items.release.score,60);assert.equal(r.items.elbow.score,null);assert.equal(r.trunk.lean,15);assert.equal(r.trunk.count,29);assert.deepEqual(s,original);assert.match(reportHTML(s),/代理指標/);
});
test('empty, missing and Low-only never produce invented zero percentages',()=>{
 for(const s of [session('zero',80,0),{...session('low'),shots:session().shots.map(shot=>({...shot,comparison:{...shot.comparison,confidence:'Low'},trunkEstimate:null}))},{...session('missing'),shots:[{number:1}]}]){const r=sessionReport(s);assert.equal(r.average,null);assert.equal(r.items.dip.score,null);assert.equal(r.trunk.lean,null);assert.doesNotMatch(reportHTML(s).split('従来の集計')[0],/0\.0%/);}
});
test('previous comparison rejects conditions, revisions and calibration changes and tolerates key order',()=>{
 const s=session(),previous=session('prev',70,10,now-86400000);assert.equal(previousReport(s,[previous]).delta,10);assert.equal(previousReport(s,[{...previous,metadata:{...previous.metadata,hand:'left'}}]).previous,null);
 for(const p of [{...previous,calibrationVersionId:'new'}, {...previous,shots:previous.shots.map(shot=>({...shot,scoreVersion:'new'}))},{...previous,goodFormReference:{...previous.goodFormReference,analysis:{...previous.goodFormReference.analysis,metrics:{kneeAngle:150}}}}])assert.equal(previousReport(s,[p]).delta,undefined);
 const reordered=structuredClone(s);reordered.goodFormReference.analysis={phases:s.goodFormReference.analysis.phases,metrics:s.goodFormReference.analysis.metrics,version:'test'};assert.equal(basisKey(s),basisKey(reordered));
});
test('periods weight valid shots, not session averages; empty points keep missing values',()=>{
 const a=session('a',100,1,now-86400000),b=session('b',0,9,now),series=progressSeries([a,b],b,{now,unit:'month'});assert.equal(series.average,10);assert.equal(series.count,10);assert.equal(series.points.length,1);assert.equal(series.sessions,2);assert.equal(progressSeries([a,b],b,{now,days:7,item:'elbow'}).average,null);assert.equal(progressSeries([{...a,calibrationVersionId:'changed'},b],b,{now}).excluded,1);
 const old=session('old',80,30,now-31*86400000);assert.equal(progressSeries([old],b,{now,days:30}).count,0);
});
test('week/month boundaries use local calendars in Tokyo and DST timezones',()=>{
 const original=process.env.TZ;try{for(const [zone,time,week,month]of [['Asia/Tokyo','2026-10-04T15:30:00Z','2026/10/05','2026/10'],['America/Los_Angeles','2026-10-05T00:30:00Z','2026/09/28','2026/10'],['America/Los_Angeles','2026-03-09T07:30:00Z','2026/03/09','2026/03'],['Asia/Tokyo','2026-09-30T15:30:00Z','2026/09/28','2026/10'],['America/Los_Angeles','2026-09-30T15:30:00Z','2026/09/28','2026/09'],['America/Los_Angeles','2026-11-02T08:30:00Z','2026/11/02','2026/11']]){process.env.TZ=zone;assert.deepEqual([localPeriod(Date.parse(time),'week').label,localPeriod(Date.parse(time),'month').label],[week,month]);}}finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
 assert.equal(localPeriod(new Date(2026,9,5),'week').label,'2026/10/05');
});
test('weak batch feedback preserves comments, timestamps and original session; no shot labels created',()=>{
 const s=session(),before=structuredClone(s),comments=[{id:'coach',originalComment:'Keep'}],old={mode:'live',recordId:s.id,title:'Good',appFeedback:{text:'Original'},comments};const first=ratingEntry(s,old,{dip:'inaccurate',release:'accurate',trunk:'unknown'},'note','scope',basisKey(s),1),second=ratingEntry(s,first,{dip:'accurate'},'edited','scope',basisKey(s),2);assert.deepEqual(second.comments,comments);assert.equal(second.batchRating.createdAt,1);assert.equal(second.batchRating.updatedAt,2);assert.deepEqual(second.batchRating.scoreVersions,['test']);assert.equal(second.cases,undefined);assert.deepEqual(s,before);assert.throws(()=>ratingEntry(s,old,{dip:'made-up'},'','',null));
});

test('rolling calendar days retain correct boundaries across daylight saving time',()=>{
 const original=process.env.TZ;try{process.env.TZ='America/Los_Angeles';const end=Date.parse('2026-03-09T07:30:00Z'),anchor=session('anchor',80,1,end),before=session('before',50,1,Date.parse('2026-03-03T07:59:59Z')),inside=session('inside',60,1,Date.parse('2026-03-03T08:00:00Z'));const r=progressSeries([before,inside,anchor],anchor,{now:end,days:7,unit:'day'});assert.equal(r.count,2);assert.equal(r.average,70);assert.equal(r.points[0].label,'2026/03/03');}finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
});
