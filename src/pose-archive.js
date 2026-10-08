// Only the 14 joints needed to replay the pose-only shot detector; no video.
export const POSE_IDS=[11,12,13,14,15,16,19,20,23,24,25,26,27,28];
export const POSE_STRIDE=3+POSE_IDS.length*3;
export const POSE_BUDGET=32*1024*1024;
export const POSE_SCHEMA='pose-trace-1';
export function packFrame(frame,origin){
 const row=[frame.time-origin,frame.aspect??1,frame.landmarks?1:0];
 for(const id of POSE_IDS){const p=frame.landmarks?.[id];row.push(Number.isFinite(p?.x)?p.x:0,Number.isFinite(p?.y)?p.y:0,Number.isFinite(p?.visibility)?p.visibility:0);}
 return row;
}
// Decode one frame at a time so replay never expands an entire session in memory.
export function* iterateChunks(chunks,origin){for(const chunk of chunks){const a=new Float32Array(chunk.buffer);for(let i=0;i<a.length;i+=POSE_STRIDE){const landmarks=a[i+2]?Array.from({length:33},()=>({x:0,y:0,visibility:0})):null;POSE_IDS.forEach((id,j)=>{if(landmarks)landmarks[id]={x:a[i+3+j*3],y:a[i+4+j*3],visibility:a[i+5+j*3]};});yield {time:origin+a[i],aspect:a[i+1],landmarks};}}}
export function unpackChunks(chunks,origin){return [...iterateChunks(chunks,origin)];}
export class PoseArchive{
 constructor({session,remaining=POSE_BUDGET,saveChunk,saveSession,onStatus=()=>{}}){this.session={...session,schema:POSE_SCHEMA,origin:session.origin??performance.now()/1000,count:0,bytes:0,chunks:0,status:'recording',complete:false,maxFPS:20};this.remaining=remaining;this.saveChunk=saveChunk;this.saveSession=saveSession;this.onStatus=onStatus;this.rows=[];this.last=-Infinity;this.queue=Promise.resolve();this.pending=false;this.failed=false;this.stopped=false;}
 add(frame){
  if(this.stopped||this.failed||frame.time<this.session.origin||frame.time-this.last<.049)return;
  if(frame.time-this.session.origin>3600||this.session.bytes+(this.rows.length+POSE_STRIDE)*4>this.remaining){this.failed=true;this.onStatus('姿勢時系列の保存上限。練習は継続します。データは削除しません。');return;}
  if(frame.time<this.last)return;this.last=frame.time;
  if(this.session.aspect&&Math.abs(this.session.aspect-(frame.aspect??1))>.02)this.session.orientationChanged=true;
  this.session.aspect??=frame.aspect??1;this.session.end=frame.time;this.rows.push(...packFrame(frame,this.session.origin));
  if(this.rows.length>=POSE_STRIDE*100){if(this.pending){this.failed=true;this.onStatus('姿勢時系列の保存が追いつかないため停止しました。');}else this.flush();}
 }
 flush(){if(!this.rows.length)return;const buffer=new Float32Array(this.rows).buffer;this.rows=[];this.session.count+=buffer.byteLength/(POSE_STRIDE*4);this.session.bytes+=buffer.byteLength;const index=this.session.chunks++;const chunk={id:`${this.session.id}:${String(index).padStart(6,'0')}`,sessionId:this.session.id,index,buffer};const snapshot=structuredClone(this.session);this.pending=true;this.queue=this.queue.then(()=>this.saveChunk(chunk,snapshot)).catch(()=>{this.failed=true;this.onStatus('姿勢時系列を保存できません。空き容量を確認してください。');}).finally(()=>{this.pending=false;});}
 async stop(){this.stopped=true;await this.queue;this.flush();await this.queue;this.session.complete=!this.failed;this.session.status=this.failed?'incomplete':'complete';await this.saveSession(structuredClone(this.session)).catch(()=>{this.session.complete=false;this.session.status='incomplete';this.failed=true;});this.onStatus(`姿勢時系列 ${(this.session.bytes/1048576).toFixed(2)} MB · ${this.session.complete?'保存完了':'不完全（検出評価には使いません）'}`);return structuredClone(this.session);}
}
