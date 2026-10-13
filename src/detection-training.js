import {verificationExport} from './detection-check-data.js';
import {POSE_IDS,POSE_SCHEMA} from './pose-archive.js';
export const TRAINING_SCHEMA='shot-detection-dataset-1';
// Full source trace, bounded export. Partial exports explicitly enumerate coverage/gaps.
export function trainingExport(data,session,rows,pose,source,{frameCap=12000}={}){
 const output=verificationExport(data,session,rows,pose),frames=[],segments=[];let previous=null,truncated=false,excluded=0;const requested=data.items.map(i=>({start:i.time-2.5,end:i.time+2.5}));
 for(const f of source){if(requested.length&&!requested.some(w=>f.time>=w.start&&f.time<=w.end)){excluded++;continue;}if(frames.length>=frameCap){truncated=true;break;}if(!Number.isFinite(f.time)||!Number.isFinite(f.aspect)||f.aspect<=0)throw new Error('姿勢時系列の時刻・画面比率が不正です');
 if(previous===null||f.time-previous>.25||f.time<=previous)segments.push({start:f.time,end:f.time,count:0});const segment=segments.at(-1);segment.end=f.time;segment.count++;previous=f.time;
 frames.push({time:f.time,aspect:f.aspect,landmarks:f.landmarks?POSE_IDS.map(id=>{const p=f.landmarks[id];return [id,p.x,p.y,p.visibility];}):null});}
 const windows=data.items.map(i=>({id:i.id,label:i.label==='yes'?'positive':i.label==='no'?'negative':'unconfirmed',time:i.time,timeBasis:i.timeBasis??(i.kind==='detected'?'detector-release':'unspecified'),start:i.time-2.5,end:i.time+2.5}));
 for(const w of windows){w.poseFrameCount=frames.filter(f=>f.time>=w.start&&f.time<=w.end).length;w.frameNearPosition=frames.some(f=>Math.abs(f.time-w.time)<=.25);}
 output.training={schema:TRAINING_SCHEMA,poseSchema:pose?.schema??POSE_SCHEMA,timeUnit:'seconds',timeBasis:'session-monotonic',coordinateSystem:'normalized-image-unmirrored',confidence:'MediaPipe landmark visibility (not shot probability)',poseIds:POSE_IDS,frameCap,truncated,complete:!!pose?.complete&&!truncated&&excluded===0&&frames.length>0&&frames.length===pose.count,sourceComplete:!!pose?.complete,selection:requested.length?'review-and-detection-windows':'initial-trace',excludedFrames:excluded,segments,windows,poseFrames:frames,description:'確認・未確認・元検出の前後2.5秒のPose（登録なしなら先頭のPose）を含みます。空白区間は連結せず、未確認は正解に扱いません。局所ラベルであり、全練習の見逃し率を保証しません。動画・自動学習・外部送信なし。'};return output;
}
export function readTraining(input){const d=typeof input==='string'?JSON.parse(input):input,t=d?.training;if(d?.schema!=='detection-check-1'||t?.schema!==TRAINING_SCHEMA||t.poseSchema!==POSE_SCHEMA||t.timeUnit!=='seconds'||t.timeBasis!=='session-monotonic'||!Array.isArray(t.poseFrames)||t.poseFrames.length>12000||!Array.isArray(t.windows)||!d.session?.id)throw new Error('未対応・不正な検証データです');
 const frames=t.poseFrames.map(f=>{if(!Number.isFinite(f.time)||!Number.isFinite(f.aspect)||f.aspect<=0||f.landmarks!==null&&!Array.isArray(f.landmarks))throw new Error('不正な姿勢フレームです');const landmarks=f.landmarks?Array.from({length:33},()=>({x:0,y:0,visibility:0})):null,seen=new Set();for(const row of f.landmarks??[]){const [id,x,y,v]=row;if(!POSE_IDS.includes(id)||seen.has(id)||![x,y,v].every(Number.isFinite)||v<0||v>1)throw new Error('不正な関節データです');seen.add(id);landmarks[id]={x,y,visibility:v};}if(landmarks&&seen.size!==POSE_IDS.length)throw new Error('関節が不足しています');return {time:f.time,aspect:f.aspect,landmarks};});
 for(const w of t.windows)if(!['positive','negative','unconfirmed'].includes(w.label)||![w.time,w.start,w.end].every(Number.isFinite)||w.end<w.start)throw new Error('不正な正解ラベルです');
 return {session:d.session,frames,labels:t.windows,segments:t.segments,complete:t.complete,truncated:t.truncated};
}
