// Each segment is an independently decodable recording, not an arbitrary MP4 fragment.
export const VIDEO_LIMIT=128*1024*1024;
export const RETENTION_MS=7*86400000;
export function supportedMime(Recorder=globalThis.MediaRecorder){
 if(!Recorder)return null;
 return ['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp8','video/webm'].find(t=>Recorder.isTypeSupported(t))??'';
}
export function clipRange(phases,origin=0,before=.75,after=.75){return {start:Math.max(origin,phases.start-before),end:phases.end+after};}
export function intersects(segment,range){return segment.start<range.end&&segment.end>range.start;}
export function mayExpire(segment,now=Date.now()){return !segment.keep&&segment.expiresAt<=now;}
export class TemporaryRecorder{
 constructor({save,onStatus=()=>{},limit=VIDEO_LIMIT}){this.save=save;this.onStatus=onStatus;this.limit=limit;this.bytes=0;this.queue=Promise.resolve();this.stopped=true;this.index=0;}
 start(stream,sessionId){
  const mime=supportedMime();if(mime===null)throw new Error('録画非対応です。フォーム分析は利用できます。');
  this.stream=stream;this.sessionId=sessionId;this.mime=mime;this.stopped=false;this.origin=performance.now()/1000;this.segment();
 }
 segment(){
  if(this.stopped)return;
  const recorder=new MediaRecorder(this.stream,{...(this.mime?{mimeType:this.mime}:{}),videoBitsPerSecond:1500000});this.recorder=recorder;
  const start=performance.now()/1000,parts=[];let pendingBytes=0;
  recorder.ondataavailable=e=>{if(e.data.size){parts.push(e.data);pendingBytes+=e.data.size;if(this.bytes+pendingBytes>=this.limit){this.stopped=true;this.onStatus('容量上限に到達。録画を停止しました。保存済み動画は保持します。');if(recorder.state!=='inactive')recorder.stop();}}};
  recorder.onerror=()=>{this.stopped=true;this.onStatus('録画が中断されました。保存済み区間はレビューできます。');};
  recorder.onstop=()=>{
   clearTimeout(this.timer);const end=performance.now()/1000,blob=new Blob(parts,{type:recorder.mimeType||this.mime});
   if(blob.size){this.bytes+=blob.size;const row={id:`${this.sessionId}:${this.index++}`,sessionId:this.sessionId,start,end,blob,bytes:blob.size,keep:false,camera:this.stream.getVideoTracks()[0]?.getSettings?.()??{},createdAt:Date.now(),expiresAt:Date.now()+RETENTION_MS};
    this.queue=this.queue.then(()=>this.save(row)).then(()=>{this.onStatus(`${this.stopped?'録画停止':'● 録画中'} · ${(this.bytes/1048576).toFixed(1)} / ${(this.limit/1048576).toFixed(0)} MB · この端末のみ`);if(!this.stopped)this.segment();}).catch(()=>{this.stopped=true;if(this.recorder.state!=='inactive')this.recorder.stop();this.onStatus('動画の保存に失敗（空き容量不足など）。保存済み区間だけ利用できます。');});
   }
   if(!blob.size&&!this.stopped)this.segment();
  };
  recorder.start(1000);this.onStatus('● 録画中 · この端末のみ');this.timer=setTimeout(()=>{if(recorder.state!=='inactive')recorder.stop();},15000);
 }
 async stop(){this.stopped=true;clearTimeout(this.timer);const r=this.recorder;if(r&&r.state!=='inactive')await new Promise(resolve=>{r.addEventListener('stop',resolve,{once:true});r.stop();});await this.queue;}
}
