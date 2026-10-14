import {POSE_IDS,POSE_STRIDE} from './pose-archive.js';
import {hashBlob,hashText,jsonBlob,jsonText,checkAbort} from './backup-hash.js';
export const BACKUP_SCHEMA='personal-sports-form-lab-session';
export const BACKUP_VERSION=1;
const iso=t=>Number.isFinite(t)?new Date(t).toISOString():null;
const copy=v=>v===undefined?null:JSON.parse(JSON.stringify(v));
const relative=(t,origin)=>Number.isFinite(t)&&Number.isFinite(origin)?t-origin:null;
const phaseOffsets=(p,origin)=>p?Object.fromEntries(Object.entries(p).map(([k,v])=>[k,relative(v,origin)])):null;
export const shotId=(sessionId,number)=>`live:${sessionId}:${number}`;
const prefix=(session,kind)=>({schema:BACKUP_SCHEMA,schemaVersion:BACKUP_VERSION,kind,sessionId:session.id,appVersion:session.appVersion??null});
export function describeBackupSource({session,rows=[],pose=null,chunks=[],review={},detectionCheck=null,localResultStored=true,warnings=[]}){
 if(!session?.id||session.kind!=='live-coach'||!session.endedAt)throw new Error('終了したLive Coachのセッションを選んでください。');
 rows=rows.filter(r=>r.sessionId===session.id).sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id));
 const validChunks=chunks.every((c,i)=>Number.isInteger(c.count)&&c.count>0&&c.bytes===c.count*POSE_STRIDE*4&&c.index===i&&Number.isFinite(c.first)&&Number.isFinite(c.last)&&c.first<=c.last&&(i===0||c.first>chunks[i-1].last));
 const poseCount=validChunks?chunks.reduce((n,c)=>n+c.count,0):0,poseBytes=chunks.reduce((n,c)=>n+c.bytes,0);
 const poseAvailable=!!pose&&poseCount>0&&Number.isFinite(pose.origin)&&validChunks;
 const origin=Number.isFinite(pose?.origin)?pose.origin:Number.isFinite(session.poseOrigin)?session.poseOrigin:Number.isFinite(session.recordingOrigin)?session.recordingOrigin:rows.find(r=>Number.isFinite(r.start))?.start??null;
 return {session:copy(session),rows,pose:copy(pose),chunks,review:copy(review),detectionCheck:copy(detectionCheck),localResultStored,warnings,origin,
  poseInfo:{available:poseAvailable,count:poseCount,sourceCount:pose?.count??0,complete:poseAvailable&&pose.complete===true&&poseCount===pose.count&&poseBytes===pose.bytes&&chunks.length===pose.chunks,reason:poseAvailable?null:pose?'保存された骨格を読み出せません（空・破損・記録不足）':'この練習の骨格時系列は保存されていません'},
  videoInfo:rows.map(r=>({id:r.id,kind:r.kind??'segment',available:r.blob instanceof Blob&&r.blob.size>0,bytes:r.blob?.size??0,startSeconds:relative(r.start,origin),endSeconds:relative(r.end,origin),sourceStatus:session.recordingStatus??'unknown'}))};
}
export async function prepareSessionBackup(source,selection,{readChunk,signal,onProgress=()=>{},exporterVersion=null}={}){
 const {session,rows,pose,origin}=source,selected=new Set(selection.videoIds??[]),files=[];
 const chosen={results:!!selection.results,form:!!selection.form,reviews:!!selection.reviews,pose:!!selection.pose,diagnostics:!!selection.diagnostics,videoIds:[...selected].sort()};
 if(chosen.pose&&!source.poseInfo.available)throw new Error('保存された骨格時系列を取得できません。骨格を外してJSONのみ保存してください。');
 for(const id of selected)if(!source.videoInfo.some(v=>v.id===id&&v.available))throw new Error('選択した動画が端末にありません。対象を選び直してください。');
 const videoEntries=[];
 for(const r of rows){const info=source.videoInfo.find(v=>v.id===r.id),ext=r.blob?.type?.includes('mp4')?'mp4':r.blob?.type?.includes('webm')?'webm':'bin',path=`videos/${hashText(r.id).slice(0,24)}.${ext}`;
  const entry={...info,sessionId:session.id,selected:selected.has(r.id),path:selected.has(r.id)?path:null,mimeType:r.blob?.type??null,sourceMonotonicStart:r.start??null,sourceMonotonicEnd:r.end??null,shotId:r.shotId??null,camera:copy(r.camera),keep:!!r.keep,createdAtUtc:iso(r.createdAt),timeMapping:'estimated-from-recording-boundaries'};
  videoEntries.push(entry);if(entry.selected)files.push({path,mimeType:r.blob.type?.split(';')[0]||'application/octet-stream',makeBlob:async()=>r.blob});
 }
 const videoLinks=(start,end,release)=>videoEntries.filter(v=>v.selected&&Number.isFinite(v.startSeconds)&&Number.isFinite(v.endSeconds)&&v.startSeconds<(end??release??-Infinity)&&v.endSeconds>(start??release??Infinity)).map(v=>({path:v.path,sourceVideoId:v.id,startInVideoSeconds:start===null?null:Math.max(0,start-v.startSeconds),endInVideoSeconds:end===null?null:Math.min(v.endSeconds-v.startSeconds,end-v.startSeconds),releaseInVideoSeconds:release!==null&&release>=v.startSeconds&&release<=v.endSeconds?release-v.startSeconds:null}));
 const addJSON=(path,data)=>files.push({path,mimeType:'application/json',makeBlob:async()=>jsonBlob(data)});
 if(chosen.results||chosen.form){
  const shots=(session.shots??[]).map(s=>{const phases=s.detectorEvent?.phases??s.analysis?.phases,offsets=phaseOffsets(phases,origin),release=offsets?.release??null;
   return {sessionId:session.id,shotId:shotId(session.id,s.number),number:s.number,observedAtUtc:iso(s.timestamp),provenance:'automatic',releaseSeconds:release,phasesSeconds:offsets,videoReferences:videoLinks(offsets?.start??null,offsets?.end??null,release),
    ...(chosen.results?{detectorEvent:copy(s.detectorEvent),detectorNumber:s.detectorNumber??s.number,originalSourceTimeBasis:'monotonic-seconds',excluded:!!s.excluded}:{}),
    ...(chosen.form?{analysis:copy(s.analysis),formEvaluation:copy(s.comparison),trunkEstimate:copy(s.trunkEstimate),voiceFeedback:copy(s.coachFeedback),calibrationVersionId:s.calibrationVersionId??session.calibrationVersionId??null}: {})};});
  addJSON('shots.json',{...prefix(session,'shots'),shots,reference:chosen.form?copy(session.goodFormReference):null,calibration:chosen.form?{id:session.calibrationVersionId??null,engine:session.calibrationEngine??null,parameters:copy(session.calibrationParameters)}:null});
 }
 if(chosen.reviews){
  const cases=Object.values(source.review.cases??{}).filter(c=>c.source?.mode==='live'&&c.source.recordId===session.id).sort((a,b)=>a.id.localeCompare(b.id)).map(c=>({shotId:c.id,sessionId:session.id,provenance:c.manualAdded?'manual-added':'human-review',manualAdded:!!c.manualAdded,releaseSeconds:relative(c.analysis?.phases?.release,origin),phasesSeconds:phaseOffsets(c.analysis?.phases,origin),timeBasis:c.manualAdded?'unspecified-unless-labelled':'detector-release',labels:copy(c.labels),annotationHistory:copy(c.annotationHistory??[]),humanFeedback:copy(c.humanFeedback??[]),videoRangeSeconds:phaseOffsets(c.videoRange,origin),originalSourceTimeBasis:'monotonic-seconds'}));
  const check=source.detectionCheck?.sessionId===session.id?source.detectionCheck:null;
  const items=(check?.items??[]).map(i=>({...copy(i),sessionId:session.id,shotId:i.externalReviewId??(i.shotNumber?shotId(session.id,i.shotNumber):`check:${session.id}:${i.id}`),positionSeconds:relative(i.time,origin),originalPositionSeconds:relative(i.originalTime,origin),provenance:i.kind==='manual'?'manual-added':i.kind==='candidate'?'algorithm-candidate':'automatic-detection-reviewed',timeBasis:i.timeBasis??(i.kind==='detected'?'detector-release':'unspecified'),videoReferences:videoLinks(relative(i.time-.1,origin),relative(i.time+.1,origin),relative(i.time,origin))}));
  addJSON('reviews.json',{...prefix(session,'reviews'),cases,detectionCheck:check?{...copy(check),items,sourceTimeBasis:'monotonic-seconds'}:null,sessionFeedback:copy(source.review.sessionFeedback?.[`live:${session.id}`]),verification:copy(source.review.verification?.[`live:${session.id}`]),note:'人による確認は自動判定を上書きしません。未確認・時点不明のラベルを正解と見なしません。'});
 }
 const poseParts=[];
 if(chosen.pose){
  let group=[],count=0;const groups=[];for(const c of source.chunks){if(count&&count+c.count>1000){groups.push(group);group=[];count=0;}group.push(c);count+=c.count;}if(group.length)groups.push(group);
  for(const [index,part]of groups.entries()){
   const path=`pose/landmarks-${String(index).padStart(4,'0')}.json`;poseParts.push({path,count:part.reduce((n,c)=>n+c.count,0),startSeconds:pose.origin+part[0].first-origin,endSeconds:pose.origin+part.at(-1).last-origin});
   files.push({path,mimeType:'application/json',makeBlob:async()=>{
    const frames=[];for(const info of part){checkAbort(signal);const chunk=await readChunk(info.id);if(!chunk?.buffer||chunk.buffer.byteLength!==info.bytes)throw new Error('骨格データが変更・削除されました。保存対象を読み込み直してください。');const a=new Float32Array(chunk.buffer);
     for(let i=0;i<a.length;i+=POSE_STRIDE){const timeSeconds=pose.origin+a[i]-origin,aspect=a[i+1];if(!Number.isFinite(timeSeconds)||!Number.isFinite(aspect)||aspect<=0||![0,1].includes(a[i+2]))throw new Error('骨格の時系列が不正です。');
      const landmarks=a[i+2]?POSE_IDS.map((id,j)=>[id,a[i+3+j*3],a[i+4+j*3],a[i+5+j*3]]):null;if(landmarks?.some(([,x,y,v])=>![x,y,v].every(Number.isFinite)||v<0||v>1))throw new Error('骨格座標が不正です。');frames.push({timeSeconds,aspect,landmarks});}
    }
    return jsonBlob({...prefix(session,'pose-landmarks'),coordinateSystem:'normalized-image-unmirrored-2d',landmarkColumns:['id','x','y','visibility'],landmarkIds:POSE_IDS,zAvailable:false,partIndex:index,frames});
   }});
  }
 }
 if(chosen.diagnostics)addJSON('diagnostics.json',{...prefix(session,'diagnostics'),provenance:'saved-session-diagnostics',poseModel:session.poseModel??null,detectorRuleVersion:session.detectorRuleVersion??null,detectionGuardVersion:session.detectionGuardVersion??null,safetyPolicy:copy(session.safetyPolicy),safetySnapshot:copy(session.safetySnapshot),safetyWarning:copy(session.safetyWarning),endReason:copy(session.endReason),recordingStatus:session.recordingStatus??null,poseStatus:session.poseStatus??null});
 // Hash one file at a time; pose JSON is recreated lazily for uploading.
 for(const [index,f]of files.entries()){checkAbort(signal);const blob=await f.makeBlob();Object.assign(f,await hashBlob(blob,{signal,onProgress:(done,total)=>onProgress({phase:'prepare',file:f.path,index,totalFiles:files.length,done,total})}));}
 const base={...prefix(session,'metadata'),exporter:{name:'Personal Sports Form Lab',appVersion:exporterVersion},createdAtUtc:iso(session.createdAt),endedAtUtc:iso(session.endedAt),sessionRecordVersion:session.version??null,recognition:chosen.results||chosen.diagnostics?{poseModel:session.poseModel??null,detectorRuleVersion:session.detectorRuleVersion??null,detectionGuardVersion:session.detectionGuardVersion??null,calibrationVersionId:session.calibrationVersionId??null,detectorParameters:copy(session.calibrationParameters?.detector)}:null,metadata:copy(session.metadata),timeline:{unit:'seconds',basis:'offset-from-session-monotonic-origin',sourceOriginSeconds:origin,wallClockMapping:'capture dates only; per-frame UTC is not guaranteed'},selection:chosen,
  localAvailability:{results:source.localResultStored,videos:videoEntries,pose:{...source.poseInfo,selected:chosen.pose,parts:poseParts,sourceSchema:pose?.schema??null,sourceStatus:pose?.status??null,orientationChanged:pose?.orientationChanged??null,landmarkIds:POSE_IDS,maxRecordedFPS:pose?.maxFPS??20,coordinates:'2d-normalized-unmirrored',zAvailable:false}},warnings:source.warnings,
  files:files.map(f=>({path:f.path,mimeType:f.mimeType,bytes:f.bytes,sha256:f.sha256,md5:f.md5})),note:'各動画は独立した録画ファイルです。分割境界の空白を詰めたりバイナリ結合したりしません。'};
 const snapshotId=hashText(jsonText(base));
 return {sessionId:session.id,snapshotId,base,files};
}
