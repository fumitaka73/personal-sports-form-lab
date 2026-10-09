import test from 'node:test';
import assert from 'node:assert/strict';
import {TemporaryRecorder,supportedMime,clipRange,intersects,mayExpire} from '../src/temporary-video.js';
import {annotateCase,manualCase,collectCases,evaluationReport,emptyReviewData,exportReviewData,validateReviewImport} from '../src/review-data.js';
import {calculateMetrics} from '../src/metrics.js';
import {reviewShot} from '../src/shot-engine.js';
import {frames} from '../test-support/shot-frames.js';
class FakeRecorder extends EventTarget{
 static isTypeSupported(type){return type==='video/mp4';}
 constructor(){super();this.state='inactive';this.mimeType='video/mp4';}
 start(){this.state='recording';}
 stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['segment'])});this.onstop?.();this.dispatchEvent(new Event('stop'));}
}
test('Safari codec detection, unsupported fallback and complete action margins',()=>{
 assert.equal(supportedMime(FakeRecorder),'video/mp4');assert.equal(supportedMime(null),null);
 assert.deepEqual(clipRange({start:11,end:14},10),{start:10.25,end:14.75});assert.equal(intersects({start:9,end:12},{start:10,end:16}),true);assert.equal(intersects({start:16,end:20},{start:10,end:16}),false);
 assert.equal(mayExpire({keep:true,expiresAt:0}),false);assert.equal(mayExpire({keep:false,expiresAt:0}),true);
});
test('recording stop flushes independent segment before resolving; quota stops future segments',async()=>{
 const original=globalThis.MediaRecorder;globalThis.MediaRecorder=FakeRecorder;
 try{const rows=[],rec=new TemporaryRecorder({save:async r=>rows.push(r),limit:1});rec.start({getVideoTracks:()=>[]},'session');await rec.stop();assert.equal(rows.length,1);assert.equal(rows[0].blob.type,'video/mp4');assert.equal(rows[0].keep,false);assert.equal(rec.stopped,true);assert.ok(rows[0].start<=rows[0].end);}finally{globalThis.MediaRecorder=original;}
});
test('failed local persistence stops recorder and reports failure',async()=>{
 const original=globalThis.MediaRecorder;globalThis.MediaRecorder=FakeRecorder;
 try{const notices=[],rec=new TemporaryRecorder({save:async()=>{throw new Error('quota');},onStatus:t=>notices.push(t)});rec.start({getVideoTracks:()=>[]},'session');await rec.stop();assert.equal(rec.stopped,true);assert.ok(notices.some(n=>n.includes('保存に失敗')));}finally{globalThis.MediaRecorder=original;}
});
function originalCase(){const metadata={shotType:'jump',cameraAngle:'side',hand:'right'},analysis=calculateMetrics(frames(),{start:0,release:1,end:2},'right',1,false),review=reviewShot(analysis,analysis,metadata,metadata);return collectCases([],[],[{id:'live',createdAt:1,metadata,goodFormReference:{id:'good',title:'Good',...metadata,analysis},shots:[{number:1,timestamp:1,analysis,comparison:review.comparison,coachFeedback:null,videoRange:{start:0,end:4}}]}])[0];}
test('annotations and undo snapshots do not change original predictions; JSON preserves manual misses and history',()=>{
 const c=originalCase(),snapshot=structuredClone(c),updated=annotateCase(c,{...c.labels,detection:'correct',subjectiveScore:30,feedbackRating:'inaccurate',submetrics:{dip:'too-shallow'}});
 assert.deepEqual(c,snapshot);assert.deepEqual(updated.analysis,c.analysis);assert.deepEqual(updated.comparison,c.comparison);assert.deepEqual(updated.annotationHistory[0].labels,c.labels);
 const missed=manualCase(c,2,{start:4,end:8});assert.equal(missed.comparison.overall,null);assert.equal(missed.manualAdded,true);assert.equal(missed.labels.detection,'correct');
 const data=emptyReviewData();data.verification['live:live']={actualShots:2,complete:true};const report=evaluationReport([updated,missed],data);assert.equal(report.detection.precision,1);assert.equal(report.detection.recall,.5);assert.equal(report.detection.manualMissed,1);assert.equal(report.selfFeedback.inaccurate,1);
 const imported=validateReviewImport(JSON.parse(JSON.stringify(exportReviewData(data,[updated,missed]))));assert.deepEqual(imported.cases[updated.id].annotationHistory,updated.annotationHistory);assert.equal(imported.cases[missed.id].manualAdded,true);
 const invalid=exportReviewData(data,[updated]);invalid.data.cases[updated.id].videoRange={start:4,end:2};assert.throws(()=>validateReviewImport(invalid));
});
test('individual cue labels and their history round-trip without changing existing review or analysis fields',()=>{
 const c=originalCase(),updated=annotateCase(c,{...c.labels,detection:'correct',voiceJudgment:'partial',cueLabels:{'kneeAngle:1':'correct','trunkExtension:1':'incorrect'}}),data=emptyReviewData(),json=exportReviewData(data,[updated]),read=validateReviewImport(JSON.parse(JSON.stringify(json))).cases[updated.id];assert.deepEqual(read.labels.cueLabels,updated.labels.cueLabels);assert.equal(read.labels.evaluation,c.labels.evaluation);assert.deepEqual(read.analysis,c.analysis);assert.deepEqual(read.annotationHistory,updated.annotationHistory);
 const invalid=structuredClone(json);invalid.data.cases[updated.id].labels.cueLabels['trunkExtension:1']='definitely';assert.throws(()=>validateReviewImport(invalid));
});
