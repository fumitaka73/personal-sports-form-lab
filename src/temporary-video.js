// Each segment is an independently decodable recording, not an arbitrary MP4 fragment.
export const VIDEO_LIMIT=128*1024*1024;
export const RETENTION_MS=7*86400000;
export function supportedMime(Recorder=globalThis.MediaRecorder){
 if(!Recorder)return null;
 return ['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp8','video/webm'].find(t=>Recorder.isTypeSupported?.(t))??'';
}
export function clipRange(phases,origin=0,before=.75,after=.75){return {start:Math.max(origin,phases.start-before),end:phases.end+after};}
export function intersects(segment,range){return segment.start<range.end&&segment.end>range.start;}
export function mayExpire(segment,now=Date.now()){return !segment.keep&&segment.expiresAt<=now;}
export class TemporaryRecorder{
 constructor({save,onStatus=()=>{},onFailure=()=>{},onProgress=()=>{},limit=VIDEO_LIMIT}){this.onProgress=onProgress;this.onFailure=onFailure;this.save=save;this.writtenBytes=0;this.pendingBytes=0;this.rate=234375;this.onStatus=onStatus;this.limit=limit;this.bytes=0;this.queue=Promise.resolve();this.stopped=true;this.index=0;this.failed=false;}
 start(stream,sessionId){
  const mime=supportedMime();if(mime===null)throw new Error('録画非対応です。フォーム分析は利用できます。');
  this.stream=stream;this.sessionId=sessionId;this.mime=mime;this.stopped=false;this.origin=performance.now()/1000;this.segment();
 }
 segment(){
  if(this.stopped)return;
  const recorder=new MediaRecorder(this.stream,{...(this.mime?{mimeType:this.mime}:{}),videoBitsPerSecond:1500000});this.recorder=recorder;
  const start=performance.now()/1000,parts=[];this.segmentStart=start;this.lastDataAt=start;this.pendingBytes=0;this.segmentDone=new Promise(resolve=>this.resolveSegment=resolve);
  recorder.ondataavailable=e=>{if(e.data.size){parts.push(e.data);this.pendingBytes+=e.data.size;const now=performance.now()/1000;this.rate=Math.max(234375,this.rate*.7+e.data.size/Math.max(.1,now-this.lastDataAt)*.3);this.lastDataAt=now;this.onProgress(this.snapshot(now));if(this.bytes+this.pendingBytes>=this.limit){this.failed=true;this.stopped=true;this.onFailure('video-limit');this.onStatus('容量上限に到達。録画を停止しました。保存済み動画は保持します。');if(recorder.state!=='inactive')recorder.stop();}}};
  recorder.onerror=event=>{this.failed=true;this.stopped=true;this.onFailure('video-error',event?.error);if(recorder.state!=='inactive')recorder.stop();this.onStatus('録画が中断されました。保存済み区間はレビューできます。');};
  recorder.onstop=()=>{
   clearTimeout(this.timer);this.queuedAt=performance.now()/1000;const end=performance.now()/1000;this.end=end;const blob=new Blob(parts,{type:recorder.mimeType||this.mime});
   this.pendingBytes=0;const resolve=this.resolveSegment;if(blob.size){this.bytes+=blob.size;const row={id:`${this.sessionId}:${this.index++}`,sessionId:this.sessionId,start,end,blob,bytes:blob.size,keep:false,camera:this.stream.getVideoTracks()[0]?.getSettings?.()??{},createdAt:Date.now(),expiresAt:Date.now()+RETENTION_MS};
    this.queue=this.queue.then(()=>this.save(row)).then(()=>{this.writtenBytes+=blob.size;this.onStatus(`${this.stopped?'録画停止':'● 録画中'} · ${(this.bytes/1048576).toFixed(1)} / ${(this.limit/1048576).toFixed(0)} MB · この端末のみ`);if(!this.stopped)this.segment();}).catch(error=>{this.failed=true;this.stopped=true;if(this.recorder.state!=='inactive')this.recorder.stop();this.onFailure('video-save',error);this.onStatus('動画の保存に失敗（空き容量不足など）。保存済み区間だけ利用できます。');});
   }
   resolve?.();if(!blob.size&&!this.stopped)this.segment();
  };
  try{recorder.start(1000);}catch(error){this.failed=true;this.stopped=true;this.resolveSegment?.();throw error;}this.onStatus('● 録画中 · この端末のみ');this.timer=setTimeout(()=>{if(recorder.state!=='inactive')recorder.stop();},15000);
 }
 snapshot(now=performance.now()/1000){const unreceived=this.recorder?.state!=='recording'?0:Math.max(0,now-(this.lastDataAt??now))*this.rate;return {used:this.bytes+this.pendingBytes+unreceived,unsavedBytes:this.bytes-this.writtenBytes+this.pendingBytes+unreceived,rate:this.rate,saveWait:this.bytes>this.writtenBytes&&this.recorder?.state==='inactive'?now-(this.queuedAt??now):0,writtenBytes:this.writtenBytes};}
 stop(){if(this.stopPromise)return this.stopPromise;this.stopped=true;clearTimeout(this.timer);this.stopPromise=(async()=>{const r=this.recorder;if(r&&r.state!=='inactive')r.stop();await this.segmentDone;await this.queue;return {failed:this.failed,end:this.end};})();return this.stopPromise;}

}
// New clips use short margins and release-midpoint boundaries. Originals stay intact.
export function singleShotRanges(shots,origin=0,end=Infinity){
 const sorted=[...shots].filter(s=>s.detectorEvent?.phases).sort((a,b)=>a.detectorEvent.phases.release-b.detectorEvent.phases.release);
 return new Map(sorted.map((s,i)=>{const p=s.detectorEvent.phases,previous=sorted[i-1]?.detectorEvent.phases.release,next=sorted[i+1]?.detectorEvent.phases.release;
  const start=Math.max(origin,p.start-.2,p.release-1.7,previous===undefined?origin:(previous+p.release)/2),finish=Math.min(end,p.end+.2,p.release+1.2,next===undefined?end:(p.release+next)/2);
  return [s.number,finish>start?{start,end:finish}:null];
 }));
}
export function sameRange(a,b){return !!a&&!!b&&Math.abs(a.start-b.start)<.001&&Math.abs(a.end-b.end)<.001;}
