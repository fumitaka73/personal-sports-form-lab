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
export function poseSize(bytes=0){return bytes<1024?`${bytes} B`:bytes<1048576?`${(bytes/1024).toFixed(1)} KiB`:`${(bytes/1048576).toFixed(2)} MiB`;}
export class PoseArchive{
 constructor({session,remaining=POSE_BUDGET,saveChunk,saveSession,onStatus=()=>{}}){Object.assign(this,{session:{...session,schema:POSE_SCHEMA,origin:session.origin??performance.now()/1000,count:0,bytes:0,chunks:0,status:'recording',complete:false,maxFPS:20},remaining,saveChunk,saveSession,onStatus,rows:[],last:-Infinity,queue:Promise.resolve(),pending:false,inFlightBytes:0,failed:false,stopped:false});}
 fail(reason){this.failed=true;this.session.failureReason=reason;this.onStatus(`姿勢保存: ${reason}。練習は継続します。`);}
 add(frame){
  if(this.stopped||this.failed||!Number.isFinite(frame.time)||frame.time<this.session.origin||frame.time-this.last<.049)return;
  if(frame.time-this.session.origin>3600||this.session.bytes+this.inFlightBytes+(this.rows.length+POSE_STRIDE)*4>this.remaining){this.fail('保存上限');return;}
  this.last=frame.time;
  if(this.session.aspect&&Math.abs(this.session.aspect-(frame.aspect??1))>.02)this.session.orientationChanged=true;
  this.session.aspect??=frame.aspect??1;this.session.end=frame.time;this.rows.push(...packFrame(frame,this.session.origin));
  if(this.rows.length>=POSE_STRIDE*100&&this.pending)this.fail('保存処理の遅延');
  else if(!this.pending&&(this.session.count===0||this.rows.length>=POSE_STRIDE*20||frame.time-this.session.origin-this.rows[0]>=1))this.flush();
 }
 flush(){
  if(!this.rows.length||this.pending||this.failed)return this.queue;
  const buffer=new Float32Array(this.rows).buffer;this.rows=[];
  const index=this.session.chunks,snapshot={...this.session,count:this.session.count+buffer.byteLength/(POSE_STRIDE*4),bytes:this.session.bytes+buffer.byteLength,chunks:index+1};
  const chunk={id:`${this.session.id}:${String(index).padStart(6,'0')}`,sessionId:this.session.id,index,buffer};this.pending=true;this.inFlightBytes=buffer.byteLength;
  this.queue=this.queue.then(async()=>{await this.saveChunk(chunk,structuredClone(snapshot));Object.assign(this.session,{count:snapshot.count,bytes:snapshot.bytes,chunks:snapshot.chunks});this.onStatus(`姿勢保存中: ${poseSize(this.session.bytes)} · ${this.session.count}フレーム`);}).catch(error=>this.fail(error?.name==='QuotaExceededError'?'空き容量不足':`書き込み失敗 (${error?.name??'Error'})`)).finally(()=>{this.pending=false;this.inFlightBytes=0;});return this.queue;
 }
 async stop(){this.stopped=true;await this.queue;await this.flush();if(!this.session.count&&!this.failed)this.fail('フレーム未取得');this.session.complete=!this.failed;this.session.status=this.failed?'incomplete':'complete';try{await this.saveSession(structuredClone(this.session));}catch(error){this.session.complete=false;this.session.status='incomplete';this.fail(`終了記録の書き込み失敗 (${error?.name??'Error'})`);}this.onStatus(`姿勢 ${poseSize(this.session.bytes)} · ${this.session.count}フレーム · ${this.session.complete?'保存完了':`不完全: ${this.session.failureReason}（検出評価には使いません）`}`);return structuredClone(this.session);}
}
