import {mountPersonalCalibration} from './calibration-ui.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountWholePracticeReview(container,config){
 let disposed=false,controller,selected=config.initialSessionId??config.sessions.at(0)?.id,opened=null;
 container.innerHTML=`<section class="whole-practice"><h3>練習全体を確認</h3><p>AIが見逃したシュートも確認してください。先に各シュートを確認し、見逃しを追加してから、ボールを放したタイミングと本数を確認します。</p><label class="field">確認する練習<select id="whole-session">${config.sessions.map(s=>`<option value="${esc(s.id)}" ${s.id===selected?'selected':''}>${new Date(s.createdAt).toLocaleString('ja-JP')} · ${esc(s.goodFormReference.title)}</option>`).join('')}</select></label><button id="whole-cases" class="primary">この練習のシュートを確認する</button><p id="whole-status" role="status" aria-live="polite"></p><div id="whole-editor"></div></section>`;
 const status=container.querySelector('#whole-status'),host=container.querySelector('#whole-editor');
 const hide=()=>host.querySelectorAll('.personal-calibration> *').forEach(n=>n.hidden=!['personal-truth','personal-status'].includes(n.id));
 async function open(){if(disposed||!controller||opened===selected)return;opened=selected;container.querySelector('#whole-session').disabled=true;status.textContent='練習全体の確認を読み込み中…';config.onContext?.(selected);try{await controller.openTruth(selected);if(!disposed)status.textContent='各シュートの確認が済んだら、下の本数とタイミングを確認して保存してください。';}catch(e){if(!disposed)status.textContent=`確認を開けません：${e.message}。上の「この練習のシュートを確認する」から確認・追加してください。`; }finally{if(!disposed){hide();container.querySelector('#whole-session').disabled=false;}}}
 container.querySelector('#whole-session').onchange=e=>{selected=e.target.value;opened=null;void open();};container.querySelector('#whole-cases').onclick=()=>config.openCases(selected);
 const cleanup=mountPersonalCalibration(host,{...config,autoAllocate:true,onBusy:v=>{container.querySelector('#whole-session').disabled=v;container.querySelector('#whole-cases').disabled=v;config.onBusy?.(v);},onReady:c=>controller=c,onRefresh:()=>{hide();void open();}});
 return ()=>{disposed=true;cleanup();};
}
