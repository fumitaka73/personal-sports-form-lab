import {listTemporaryVideos,saveTemporaryVideo,deleteTemporaryVideo} from './storage.js';
import {intersects,mayExpire,supportedMime} from './temporary-video.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function expireTemporaryVideos(){const rows=await listTemporaryVideos();for(const row of rows)if(mayExpire(row))await deleteTemporaryVideo(row.id);}
export function mountVideoReview(container,c,onRange){
 let disposed=false,rows=[],urls=[],index=0,range=c.videoRange,exporting=false,raf,recorder,stream,finishPart=null;
 const el=id=>container.querySelector(`#${id}`),status=t=>{if(!disposed&&el('clip-status'))el('clip-status').textContent=t;};
 function cleanup(){cancelAnimationFrame(raf);if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(t=>t.stop());el('clip-player')?.pause();urls.forEach(URL.revokeObjectURL);urls=[];}
 const task=(fn)=>async()=>{try{await fn();}catch(e){status(e.message);}};
 async function load(){
  rows=(await listTemporaryVideos()).filter(r=>r.sessionId===c.source.recordId).sort((a,b)=>a.start-b.start);
  if(disposed)return;
  if(!rows.length||!range){container.innerHTML='<p>Video unavailable · 未録画、期限切れ、削除、または保存失敗。分析と修正記録は保持しています。</p>';return;}
  container.innerHTML=`<h3>Session Review · 動画</h3><p>この端末の一時動画。未Keepは7日後に期限切れ。Keepは自動削除しません。録画の再開境界には短い欠落があり得ます。</p><video id="clip-player" controls playsinline preload="metadata"></video><div class="sync-controls"><button id="clip-play">このシュートを再生</button><label>速度<select id="clip-speed"><option value="1">1倍</option><option value="0.5">0.5倍</option><option value="0.25">0.25倍</option></select></label></div><label>開始（練習開始から秒）<input id="clip-start" type="number" min="0" step="0.1" value="${(range.start-rows[0].start).toFixed(2)}"></label><label>終了（秒）<input id="clip-end" type="number" min="0" step="0.1" value="${(range.end-rows[0].start).toFixed(2)}"></label><button id="clip-range">範囲を保存</button><div class="sync-controls"><button id="clip-keep">Keep</button><button id="clip-discard">この区間の一時動画をDiscard</button><button id="clip-export">クリップを生成</button><button id="clip-source">元区間をダウンロード</button></div><p id="clip-status" role="status"></p><div id="clip-download"></div><p>クリップ生成は指定区間を実時間で再録画します（音声なし）。非対応なら元区間を保存してください。Safariでは共有から「ファイルに保存」、対応する場合は「ビデオを保存」を使用できます。元区間には隣のシュートも含まれます。</p>`;
  const video=el('clip-player');urls=rows.map(r=>URL.createObjectURL(r.blob));
  const selected=()=>rows.map((r,i)=>({r,i})).filter(({r})=>intersects(r,range));
  async function playPart(i){if(disposed)throw new Error('画面を閉じました');index=i;video.src=urls[i];await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error('この動画形式を再生できません。元区間を保存してください。'));});video.currentTime=Math.max(0,range.start-rows[i].start);await new Promise(resolve=>{if(!video.seeking)resolve();else video.addEventListener('seeked',resolve,{once:true});});video.playbackRate=exporting?1:Number(el('clip-speed').value);await video.play();}

  video.ontimeupdate=()=>{if(video.currentTime+rows[index].start>=Math.min(range.end,rows[index].end)-.03){video.pause();if(finishPart){const f=finishPart;finishPart=null;f();}else{const next=selected().find(s=>s.i>index);if(next)void playPart(next.i).catch(e=>status(e.message));}}};
  video.onended=()=>{if(finishPart){const f=finishPart;finishPart=null;f();}else{const next=selected().find(s=>s.i>index);if(next)void playPart(next.i).catch(e=>status(e.message));}};
  el('clip-play').onclick=task(async()=>{if(exporting)return;const part=selected()[0];if(!part)throw new Error('指定範囲の動画がありません');await playPart(part.i);});
  el('clip-speed').onchange=()=>{if(!exporting)video.playbackRate=Number(el('clip-speed').value);};
  el('clip-range').onclick=task(async()=>{const start=Number(el('clip-start').value)+rows[0].start,end=Number(el('clip-end').value)+rows[0].start;if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||start<rows[0].start||end>rows.at(-1).end+.1)throw new Error('保存済み動画内で開始 < 終了を指定してください');await onRange({start,end});range={start,end};status('範囲を保存しました。');});
  el('clip-keep').onclick=task(async()=>{for(const {r}of selected()){await saveTemporaryVideo({...r,keep:true});r.keep=true;}status('Keep済み。共有する元区間全体を保護しました。自動削除しません。');});
  el('clip-discard').onclick=task(async()=>{const parts=selected();if(parts.some(({r})=>r.keep))throw new Error('Keep区間は保護されています。下の確認操作で削除してください。');if(!confirm('同じ元区間の他のシュート動画も利用できなくなります。削除しますか？'))return;for(const {r}of parts)await deleteTemporaryVideo(r.id);cleanup();await load();});
  function downloadable(blob,name){const url=URL.createObjectURL(blob);urls.push(url);const a=document.createElement('a');a.href=url;a.download=name;a.textContent=`${name} をダウンロード`;el('clip-download').append(a,document.createElement('br'));const button=document.createElement('button');button.textContent='共有';button.onclick=task(async()=>{const file=new File([blob],name,{type:blob.type});if(!navigator.canShare?.({files:[file]}))throw new Error('ファイル共有は非対応です。ダウンロードを使ってください。');await navigator.share({files:[file]});});el('clip-download').append(button);}
  const filename=()=>`${new Date(c.createdAt).toISOString().slice(0,10)}-shot-${c.source.shotNumber}-score-${Math.round(c.comparison.overall??0)}`;
  el('clip-source').onclick=()=>{el('clip-download').replaceChildren();for(const {r,i}of selected())downloadable(r.blob,`${filename()}-source-${i+1}.${r.blob.type.includes('mp4')?'mp4':'webm'}`);};
  el('clip-export').onclick=task(async()=>{
   if(exporting)return;if(!HTMLCanvasElement.prototype.captureStream||supportedMime()===null)throw new Error('クリップ生成非対応です。元区間をダウンロードしてください。');
   const parts=selected();if(!parts.length)throw new Error('動画がありません');if(range.end-range.start>30)throw new Error('クリップは30秒以内で指定してください。');
   exporting=true;status('生成中。この画面を開いたままお待ちください。');
   const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),chunks=[];
   try{
    await playPart(parts[0].i);video.pause();canvas.width=video.videoWidth;canvas.height=video.videoHeight;if(!canvas.width)throw new Error('動画を読み込めません');
    stream=canvas.captureStream(30);const mime=supportedMime();recorder=new MediaRecorder(stream,mime?{mimeType:mime}:{});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    const done=new Promise(resolve=>recorder.addEventListener('stop',resolve,{once:true}));recorder.start(1000);
    const draw=()=>{ctx.drawImage(video,0,0,canvas.width,canvas.height);raf=requestAnimationFrame(draw);};draw();
    for(const part of parts){if(disposed)break;await playPart(part.i);await new Promise((resolve,reject)=>{finishPart=resolve;const timer=setTimeout(()=>{finishPart=null;reject(new Error('再生が中断されました。元区間を保存してください。'));},35000);const finish=finishPart;finishPart=()=>{clearTimeout(timer);finish();};});}
    if(recorder.state!=='inactive')recorder.stop();await done;if(disposed)return;const blob=new Blob(chunks,{type:recorder.mimeType});el('clip-download').replaceChildren();downloadable(blob,`${filename()}.${blob.type.includes('mp4')?'mp4':'webm'}`);status('生成完了。ダウンロード／共有で端末へ保存してください。元動画は削除しません。');
   }finally{exporting=false;cancelAnimationFrame(raf);if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(t=>t.stop());video.pause();}
  });
  video.src=urls[selected()[0]?.i??0];status(`${(rows.reduce((n,r)=>n+r.bytes,0)/1048576).toFixed(1)} MB · ${selected().some(({r})=>r.keep)?'Keep保護済み':'未Keep'}`);
  const del=document.createElement('button');del.textContent='保存を確認したKeep区間も削除';del.onclick=task(async()=>{if(!confirm('必要な動画の端末への保存を確認しましたか？同区間の他のシュートも削除されます。'))return;for(const {r}of selected())await deleteTemporaryVideo(r.id);cleanup();await load();});container.append(del);
 }
 void load().catch(e=>{if(!disposed)container.textContent=`動画を読み込めません: ${e.message}`;});return ()=>{disposed=true;cleanup();finishPart?.();};
}
