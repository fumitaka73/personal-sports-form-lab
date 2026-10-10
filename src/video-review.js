import {listTemporaryVideos,saveTemporaryVideo,deleteTemporaryVideo,saveShotClip} from './storage.js';
import {intersects,mayExpire,supportedMime,sameRange,RETENTION_MS} from './temporary-video.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function expireTemporaryVideos(){const rows=await listTemporaryVideos();for(const row of rows)if(mayExpire(row))await deleteTemporaryVideo(row.id);}
export function mountVideoReview(container,c,onRange){
 let disposed=false,rows=[],sourceRows=[],urls=[],index=0,range=c.videoRange,exporting=false,raf,playbackRAF,cachedClip=null,recorder,stream,finishPart=null,transitioning=false,run=0,full=false,completed=false,stallTimer;
 const el=id=>container.querySelector(`#${id}`),status=t=>{if(!disposed&&el('clip-status'))el('clip-status').textContent=t;};
 function cleanup(){++run;clearTimeout(stallTimer);cancelAnimationFrame(raf);cancelAnimationFrame(playbackRAF);if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(t=>t.stop());el('clip-player')?.pause();urls.forEach(URL.revokeObjectURL);urls=[];}
 const task=(fn)=>async()=>{try{await fn();}catch(e){console.error('Video review failed',e);status(`動画を最後まで再生できませんでした：${e.message}。「再試行」または元区間のダウンロードを使ってください。`);}};
 async function load(){
  const stored=(await listTemporaryVideos()).filter(r=>r.sessionId===c.source.recordId);sourceRows=stored.filter(r=>r.kind!=='shot-clip').sort((a,b)=>a.start-b.start);const clip=stored.find(r=>r.kind==='shot-clip'&&r.shotId===c.id&&sameRange(r,range));cachedClip=clip??null;rows=clip?[clip]:sourceRows;
  if(disposed)return;
  if(!rows.length||!range||!rows.some(r=>intersects(r,range))){container.innerHTML='<p>動画なし · 未録画、期限切れ、削除、または保存失敗。分析と修正記録は保持しています。</p>';return;}
  container.innerHTML=`<h3>シュート動画</h3><p>この端末の一時動画。未Keepは7日後に期限切れ。Keepは自動削除しません。1本の指定範囲だけを再生します。元区間の録画再開境界には短い欠落があり得ます。</p><video id="clip-player" controls playsinline preload="metadata" hidden></video><p id="clip-loading" role="status">動画を読み込み中…</p><div class="sync-controls"><button id="clip-play">このシュートを再生</button><button id="clip-retry">再試行</button><button id="clip-full">全動画を再生</button><p id="clip-state" role="status" aria-live="polite"></p><label>速度<select id="clip-speed"><option value="1">1倍</option><option value="0.5">0.5倍</option><option value="0.25">0.25倍</option></select></label></div><details id="clip-tools"><summary>切り出し・保存・共有</summary><label>開始（練習開始から秒）<input id="clip-start" type="number" min="0" step="0.1" value="${(range.start-(sourceRows[0]?.start??rows[0].start)).toFixed(2)}"></label><label>終了（秒）<input id="clip-end" type="number" min="0" step="0.1" value="${(range.end-(sourceRows[0]?.start??rows[0].start)).toFixed(2)}"></label><button id="clip-range">範囲を保存</button><div class="sync-controls"><button id="clip-keep">Keep</button><button id="clip-discard">この区間の一時動画をDiscard</button><button id="clip-export">この1本を保存・共有</button><button id="clip-source">元区間をダウンロード</button></div><p id="clip-status" role="status" aria-live="polite"></p><div id="clip-download"></div><p>クリップ生成は指定区間を実時間で再録画します（音声なし・長辺最大720px）。非対応なら元区間を保存してください（隣のシュートを含む可能性があります）。Safariでは共有から「ファイルに保存」、対応する場合は「ビデオを保存」を使用できます。元区間には隣のシュートも含まれます。</p></details>`;
  container.insertBefore(el('clip-status'),el('clip-tools'));const rangeOrigin=sourceRows[0]?.start??rows[0].start;const video=el('clip-player');urls=rows.map(r=>URL.createObjectURL(r.blob));
  const selected=()=>rows.map((r,i)=>({r,i})).filter(({r})=>intersects(r,range));
  const state=t=>{if(!disposed)el('clip-state').textContent=t;};
  function wait(event,ready){return new Promise((resolve,reject)=>{const done=e=>{clearTimeout(timer);video.removeEventListener(event,ok);video.removeEventListener('error',bad);e?reject(e):resolve();};const ok=()=>done(),bad=()=>done(new Error('動画の読み込み・デコードに失敗しました'));const timer=setTimeout(()=>done(new Error('動画の読み込み待ちが長すぎます')),10000);video.addEventListener(event,ok);video.addEventListener('error',bad);if(ready())ok();});}
  async function playPart(i){
   if(disposed)throw new Error('画面を閉じました');const token=++run;transitioning=true;completed=false;index=i;state('読み込み中…');cancelAnimationFrame(playbackRAF);
   try{video.src=urls[i];video.load();await wait('loadedmetadata',()=>video.readyState>=1);if(disposed||token!==run)return;
    video.hidden=false;el('clip-loading').textContent='';
    const start=full?0:Math.max(0,range.start-rows[i].start);
    if(Number.isFinite(video.duration)&&start>=video.duration)throw new Error('指定区間の開始が動画の末尾を超えています');
    video.currentTime=start;await wait('seeked',()=>!video.seeking);if(disposed||token!==run)return;
    video.playbackRate=exporting?1:Number(el('clip-speed').value);await video.play();
    if(disposed||token!==run){video.pause();return;}transitioning=false;
    const watch=()=>{if(disposed||token!==run)return;boundary();if(!video.paused)playbackRAF=requestAnimationFrame(watch);};playbackRAF=requestAnimationFrame(watch);
   }catch(e){transitioning=false;state('再生エラー');throw e;}
  }
  function boundary(ended=false){
   if(disposed||transitioning)return;
   const end=full?rows[index].end:Math.min(range.end,rows[index].end),duration=video.duration;
   // Wall-clock recording metadata can extend past the encoded media's duration.
   const target=Number.isFinite(duration)?Math.min(duration,end-rows[index].start):end-rows[index].start;
   if(!ended&&video.currentTime<target-.03)return;
   transitioning=true;video.pause();clearTimeout(stallTimer);
   if(Number.isFinite(duration)&&end-rows[index].start-duration>.3)status('保存映像が記録区間より短いため、全区間を再現できません。保存された映像を再生します。元区間の保存も確認してください。');
   if(finishPart){const f=finishPart;finishPart=null;transitioning=false;f();return;}
   const next=(full?rows.map((r,i)=>({r,i})):selected()).find(s=>s.i>index);
   if(next){if(next.r.start-rows[index].end>.15)status('録画再開の境界に欠落があります。保存された次の区間を再生します。');void playPart(next.i).catch(e=>{console.error('Video next part failed',e);status(`動画を最後まで再生できませんでした：${e.message}。再試行・元区間の保存を使ってください。`);});}
   else{transitioning=false;completed=true;state('再生完了');}
  }
  video.ontimeupdate=()=>boundary();video.onended=()=>boundary(true);
  video.onplaying=()=>{clearTimeout(stallTimer);state('再生中');};
  video.onpause=()=>{if(!transitioning&&!completed)state('一時停止');};
  video.onwaiting=video.onstalled=()=>{state('読み込み待ち…');clearTimeout(stallTimer);stallTimer=setTimeout(()=>{if(!disposed){video.pause();status('動画を最後まで再生できませんでした。再試行、または元区間をダウンロードしてください。');}},10000);};
  const replay=task(async()=>{if(exporting)return;full=false;const part=selected()[0];if(!part)throw new Error('指定範囲の動画がありません');await playPart(part.i);});
  el('clip-play').onclick=replay;el('clip-retry').onclick=replay;
  el('clip-full').onclick=task(async()=>{if(exporting)return;full=true;if(sourceRows.length&&rows!==sourceRows){video.pause();el('clip-download').replaceChildren();urls.forEach(URL.revokeObjectURL);rows=sourceRows;urls=rows.map(r=>URL.createObjectURL(r.blob));}await playPart(0);});
  el('clip-speed').onchange=()=>{if(!exporting)video.playbackRate=Number(el('clip-speed').value);};
  el('clip-range').onclick=task(async()=>{const start=Number(el('clip-start').value)+rangeOrigin,end=Number(el('clip-end').value)+rangeOrigin;if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||start<(sourceRows[0]?.start??rows[0].start)||end>(sourceRows.at(-1)?.end??rows.at(-1).end)+.1)throw new Error('保存済み動画内で開始 < 終了を指定してください');await onRange({start,end});range={start,end};status('範囲を保存しました。');});
  el('clip-keep').onclick=task(async()=>{for(const {r}of selected()){await saveTemporaryVideo({...r,keep:true});r.keep=true;}status('Keep済み。共有する元区間全体を保護しました。自動削除しません。');});
  el('clip-discard').onclick=task(async()=>{const parts=selected();if(parts.some(({r})=>r.keep))throw new Error('Keep区間は保護されています。下の確認操作で削除してください。');if(!confirm('同じ元区間の他のシュート動画も利用できなくなります。削除しますか？'))return;for(const {r}of parts)await deleteTemporaryVideo(r.id);cleanup();await load();});
  function downloadable(blob,name){const url=URL.createObjectURL(blob);urls.push(url);const a=document.createElement('a');a.href=url;a.download=name;a.textContent=`${name} をダウンロード`;el('clip-download').append(a,document.createElement('br'));const button=document.createElement('button');button.textContent='共有';button.onclick=task(async()=>{const file=new File([blob],name,{type:blob.type});if(!navigator.canShare?.({files:[file]}))throw new Error('ファイル共有は非対応です。ダウンロードを使ってください。');await navigator.share({files:[file]});});el('clip-download').append(button);}
  const filename=()=>`${new Date(c.createdAt).toISOString().slice(0,10)}-shot-${c.source.shotNumber}-score-${(Number.isFinite(c.comparison.overall)?Math.round(c.comparison.overall):'NA')}`;
  el('clip-source').onclick=()=>{el('clip-download').replaceChildren();for(const [i,r]of (sourceRows.length?sourceRows:rows).filter(r=>full||intersects(r,range)).entries())downloadable(r.blob,`${filename()}-source-${i+1}.${r.blob.type.includes('mp4')?'mp4':'webm'}`);};
  el('clip-export').onclick=task(async()=>{
   if(exporting)return;const existing=cachedClip&&sameRange(cachedClip,range)?cachedClip:null;if(existing){el('clip-download').replaceChildren();downloadable(existing.blob,`${filename()}.${existing.blob.type.includes('mp4')?'mp4':'webm'}`);status('この1本の保存済みクリップ。ダウンロード／共有できます。');return;}if(!HTMLCanvasElement.prototype.captureStream||supportedMime()===null)throw new Error('クリップ生成非対応です。元区間をダウンロードしてください。');
   const parts=selected();if(!parts.length)throw new Error('動画がありません');if(range.end-range.start>30)throw new Error('クリップは30秒以内で指定してください。');
   full=false;exporting=true;status('生成中。この画面を開いたままお待ちください。');
   const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),chunks=[];
   try{
    await playPart(parts[0].i);video.pause();const scale=Math.min(1,720/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);if(!canvas.width)throw new Error('動画を読み込めません');
    stream=canvas.captureStream(30);const mime=supportedMime();recorder=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:1500000}:{videoBitsPerSecond:1500000});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    const done=new Promise(resolve=>recorder.addEventListener('stop',resolve,{once:true}));recorder.start(1000);
    const draw=()=>{ctx.drawImage(video,0,0,canvas.width,canvas.height);raf=requestAnimationFrame(draw);};draw();
    for(const part of parts){if(disposed)break;await playPart(part.i);await new Promise((resolve,reject)=>{finishPart=resolve;const timer=setTimeout(()=>{finishPart=null;reject(new Error('再生が中断されました。元区間を保存してください。'));},35000);const finish=finishPart;finishPart=()=>{clearTimeout(timer);finish();};});}
    if(recorder.state!=='inactive')recorder.stop();await done;if(disposed)return;const blob=new Blob(chunks,{type:recorder.mimeType});if(!blob.size)throw new Error('クリップのデータを取得できませんでした');const clip={id:`clip:${c.id}`,kind:'shot-clip',shotId:c.id,sessionId:c.source.recordId,start:range.start,end:range.end,blob,bytes:blob.size,keep:false,createdAt:Date.now(),expiresAt:Date.now()+RETENTION_MS};await saveShotClip(clip);cachedClip=clip;el('clip-download').replaceChildren();downloadable(blob,`${filename()}.${blob.type.includes('mp4')?'mp4':'webm'}`);status('この1本を端末内に保存しました。ダウンロード／共有でiPhoneへ書き出せます。元区間は保持します。');
   }finally{exporting=false;cancelAnimationFrame(raf);if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(t=>t.stop());video.pause();}
  });
  video.onloadedmetadata=()=>{video.currentTime=Math.max(0,range.start-rows[index].start);};video.onloadeddata=()=>{video.hidden=false;el('clip-loading').textContent='';};video.onerror=()=>{console.error('Video decode error',video.error);state('再生エラー');status('動画を最後まで再生できませんでした。再試行または元区間をダウンロードしてください。分析・レビューは保持しています。');};index=selected()[0].i;video.src=urls[index];status(`${(rows.reduce((n,r)=>n+r.bytes,0)/1048576).toFixed(1)} MB · ${selected().some(({r})=>r.keep)?'Keep保護済み':'未Keep'}`);
  const del=document.createElement('button');del.textContent='保存を確認したKeep区間も削除';del.onclick=task(async()=>{if(!confirm('必要な動画の端末への保存を確認しましたか？同区間の他のシュートも削除されます。'))return;for(const {r}of selected())await deleteTemporaryVideo(r.id);cleanup();await load();});el('clip-tools').append(del);
 }
 void load().catch(e=>{if(!disposed)container.textContent=`動画を読み込めません: ${e.message}`;});return ()=>{disposed=true;cleanup();finishPart?.();};
}
