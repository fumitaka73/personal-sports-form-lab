import {loadPoseWindow} from './storage.js';
import {drawPose} from './pose-coordinates.js';
export function mountPoseReview(container,c){
 let disposed=false,raf=null;container.innerHTML='<details><summary>動画なしでも姿勢記録で確認する</summary><p>保存された14関節の再表示です。映像・ボール・成否は復元しません。</p><button type="button">このシュートの姿勢を再生</button><p role="status"></p><canvas hidden class="pose-review-canvas" role="img" aria-label="保存されたシュートの姿勢"></canvas></details>';
 const button=container.querySelector('button'),canvas=container.querySelector('canvas'),status=container.querySelector('[role=status]');
 button.onclick=async()=>{button.disabled=true;status.textContent='姿勢を読み込み中…';try{const range=c.videoRange??c.analysis.phases;if(!range)throw new Error('時刻の記録がありません');const frames=await loadPoseWindow(c.source.recordId,range.start,Math.min(range.end,range.start+30));if(disposed)return;if(!frames.some(f=>f.landmarks))throw new Error('この範囲に人物の姿勢記録がありません');canvas.hidden=false;status.textContent=`${frames.length}フレーム · この区間のみ（最大30秒）`;const started=performance.now(),origin=frames[0].time;let index=0;cancelAnimationFrame(raf);
 const draw=()=>{if(disposed)return;const elapsed=(performance.now()-started)/1000;while(index+1<frames.length&&frames[index+1].time-origin<=elapsed)index++;const f=frames[index];drawPose(canvas,{videoWidth:f.aspect*480,videoHeight:480,getBoundingClientRect:()=>canvas.getBoundingClientRect()},f.landmarks);if(index<frames.length-1)raf=requestAnimationFrame(draw);else button.disabled=false;};draw();
 }catch(e){if(!disposed){status.textContent=e.message;button.disabled=false;}}};return ()=>{disposed=true;cancelAnimationFrame(raf);};
}
