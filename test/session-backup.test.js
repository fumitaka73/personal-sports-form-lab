import test from 'node:test';import assert from 'node:assert/strict';
import {describeBackupSource,prepareSessionBackup} from '../src/session-backup.js';
import {packFrame,POSE_STRIDE} from '../src/pose-archive.js';
import {frames} from '../test-support/shot-frames.js';
import {hashBlob} from '../src/backup-hash.js';
function fixture(){const buffer=new Float32Array(frames().slice(0,4).flatMap(f=>packFrame({...f,time:100+f.time,aspect:1},100))).buffer;
 const session={id:'practice',kind:'live-coach',appVersion:'0.21.6',createdAt:1700000000000,endedAt:1700000010000,poseOrigin:100,metadata:{hand:'right'},recordingStatus:'incomplete',shots:[{number:1,timestamp:1700000001000,detectorEvent:{phases:{start:100,release:101,end:102}},analysis:{phases:{start:100,release:101,end:102},metrics:{wristHeight:.8}},comparison:{overall:77},coachFeedback:{text:{ja:'グッド！'}}}]};
 const rows=[{id:'segment',sessionId:'practice',start:100,end:103,blob:new Blob(['movie'],{type:'video/mp4;codecs=avc1'}),bytes:5},{id:'unavailable',sessionId:'practice',start:103,end:105,blob:new Blob(),bytes:1},{id:'other',sessionId:'different',start:1,end:2,blob:new Blob(['private'])}];
 const pose={id:'practice',origin:100,end:100.25,count:4,bytes:buffer.byteLength,chunks:1,complete:true,schema:'pose-trace-1',status:'complete'},chunks=[{id:'practice:000000',index:0,bytes:buffer.byteLength,count:4,first:0,last:.25}];
 const review={cases:{a:{id:'live:practice:1',source:{mode:'live',recordId:'practice'},analysis:{phases:{release:101}},labels:{detection:'false-positive'},annotationHistory:[{at:1,labels:{detection:'correct'}}],humanFeedback:[{original:'comment'}]},other:{id:'other',source:{mode:'live',recordId:'different'},labels:{notes:'private'}}},sessionFeedback:{'live:practice':{comments:['comment']}}};
 const detectionCheck={sessionId:'practice',items:[{id:'manual',kind:'manual',time:101.5,originalTime:null,label:'yes',timeBasis:'release-estimate'}],history:[{type:'add',at:3}]};
 return {session,rows,pose,chunks,review,detectionCheck,buffer};}
test('portable JSON maps videos and pose clocks, preserves originals and human changes separately',async()=>{
 const f=fixture(),before=structuredClone(f),source=describeBackupSource(f),plan=await prepareSessionBackup(source,{results:true,form:true,reviews:true,pose:true,diagnostics:true,videoIds:['segment']},{readChunk:async()=>({buffer:f.buffer}),exporterVersion:'0.22.0'});
 const read=async path=>JSON.parse(await (await plan.files.find(f=>f.path===path).makeBlob()).text());
 const shots=await read('shots.json');assert.equal(shots.shots[0].releaseSeconds,1);assert.equal(shots.shots[0].videoReferences[0].releaseInVideoSeconds,1);assert.equal(shots.shots[0].formEvaluation.overall,77);assert.equal(shots.shots[0].provenance,'automatic');
 const reviews=await read('reviews.json');assert.equal(reviews.cases[0].labels.detection,'false-positive');assert.equal(reviews.cases[0].annotationHistory[0].labels.detection,'correct');assert.equal(reviews.detectionCheck.items[0].positionSeconds,1.5);assert.equal(reviews.cases.length,1);
 const pose=await read('pose/landmarks-0000.json');assert.equal(pose.frames[0].timeSeconds,0);assert.equal(pose.frames[0].landmarks.length,14);assert.equal(pose.zAvailable,false);assert.equal(pose.frames[0].landmarks[0].length,4);assert.equal(plan.base.localAvailability.videos.length,2);assert.equal(plan.base.localAvailability.videos[1].available,false);
 assert.deepEqual(f,before);assert.equal(plan.base.schemaVersion,1);assert.equal(plan.base.appVersion,'0.21.6');assert.equal(plan.base.exporter.appVersion,'0.22.0');
});
test('same source/selection has stable snapshot ID; human edits produce a new immutable version; JSON-only excludes video bytes',async()=>{
 const f=fixture(),source=describeBackupSource(f),choice={results:true,reviews:true,videoIds:[]};const a=await prepareSessionBackup(source,choice),b=await prepareSessionBackup(source,choice);assert.equal(a.snapshotId,b.snapshotId);assert.ok(a.files.every(f=>!f.path.startsWith('videos/')));
 f.review.cases.a.labels.detection='correct';const c=await prepareSessionBackup(describeBackupSource(f),choice);assert.notEqual(a.snapshotId,c.snapshotId);
});
test('missing and partial pose cannot be reported as a complete skeleton; missing selected video rejects',async()=>{
 const f=fixture();f.pose.complete=false;assert.equal(describeBackupSource(f).poseInfo.complete,false);f.chunks=[];const s=describeBackupSource(f);assert.equal(s.poseInfo.available,false);
 await assert.rejects(prepareSessionBackup(s,{pose:true}),/骨格/);await assert.rejects(prepareSessionBackup(s,{videoIds:['unavailable']}),/動画/);
 const plan=await prepareSessionBackup(s,{results:true});assert.equal(plan.base.localAvailability.pose.available,false);assert.equal(plan.base.localAvailability.pose.selected,false);
});
test('hashing uses bounded slices and standard SHA256/MD5',async()=>{
 const blob=new Blob(['abc']),r=await hashBlob(blob);assert.equal(r.sha256,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');assert.equal(r.md5,'900150983cd24fb0d6963f7d28e17f72');
 const large=new Blob([new Uint8Array(2300000)]),sizes=[],slice=large.slice.bind(large);large.slice=(start,end)=>{sizes.push(end-start);return slice(start,end);};await hashBlob(large);assert.ok(sizes.every(n=>n<=1048576));assert.equal(sizes.length,3);
 const controller=new AbortController();controller.abort();await assert.rejects(hashBlob(large,{signal:controller.signal}),{name:'AbortError'});assert.equal(POSE_STRIDE,45);
});
