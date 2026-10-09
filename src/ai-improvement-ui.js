import {mountPersonalCalibration} from './calibration-ui.js';
import {allocateDatasets,evidenceProgress,sufficient} from './calibration-allocation.js';
import {scopeKey,defaultParameters,validateParameters,CALIBRATION_ENGINE} from './personal-calibration.js';
import {getSetting,setSetting,activeCalibration,commitCalibration} from './storage.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fingerprint=cases=>JSON.stringify(cases.map(c=>[c.id,c.labels,c.annotatedAt]).sort((a,b)=>a[0].localeCompare(b[0])));
const key='calibration-datasets-v05';
const rolesFingerprint=d=>JSON.stringify(Object.entries(d).map(([id,v])=>[id,v.split,v.truth]).sort((a,b)=>a[0].localeCompare(b[0])));
export function mountAIImprovement(container,config){
 let controller,state,disposed=false,busy=false,proposals=[],caseFingerprint='',datasetFingerprint='',message='';
 container.innerHTML='<section class="panel" id="ai-basic"></section><details class="panel" id="ai-advanced"><summary>詳細設定・データ管理</summary><div id="ai-advanced-content"></div></details>';
 const basic=container.querySelector('#ai-basic'),advanced=container.querySelector('#ai-advanced');
 const cohort=()=>config.sessions.filter(s=>scopeKey(s.metadata,s.goodFormReference.id)===state?.scope).map(s=>({...s,...state.trace.find(t=>t.id===s.id)}));
 async function draw(){
  if(disposed||!state)return;const cases=await config.getFreshCases();if(disposed)return;
  const progress=evidenceProgress(cohort(),cases,allocateDatasets(cohort(),cases,state.datasets));
  const metric=(v,kind)=>kind==='detector'?`見逃し ${v.fn} · 誤検出 ${v.fp}`:`合っている助言 ${v.good} · 不正確 ${v.bad} · 繰り返し ${v.repeated} · 判断未確定 ${v.unknown}`;
  basic.innerHTML=`<h2>AIの改善</h2><p>あなたが修正したシュートの記録を使って、AIの判定を改善します。改善案を確認して承認すると、次回の練習から反映されます。</p><p class="applied-setting">現在: ${state.baseline?'改善版':'標準ルール'}${state.baseline?` · ${esc(state.baseline.id.slice(0,8))}`:''}</p><p class="fineprint">レビューだけでは自動学習しません。検出と音声ルールを検証します。Form Matchの採点やMediaPipe自体の学習、腰の指標の最適化は行いません。</p><label class="field">撮影条件・Good Form<select id="ai-scope" ${busy?'disabled':''}>${[...new Map(config.sessions.map(s=>[scopeKey(s.metadata,s.goodFormReference.id),s]))].map(([k,s])=>`<option value="${esc(k)}" ${k===state.scope?'selected':''}>${esc(s.goodFormReference.title)} · ${{jump:'ジャンプ',set:'セット',free:'フリースロー'}[s.metadata.shotType]} / ${{side:'横',diagonal:'45度',front:'正面'}[s.metadata.cameraAngle]}</option>`).join('')}</select></label><button id="ai-review">シュートをレビューする</button>${Object.entries(progress).map(([kind,group])=>`<article class="progress-card"><h3>${kind==='detector'?'シュート検出':'音声助言'}</h3>${Object.entries(group).map(([split,v])=>`<p>${split==='training'?'改善用':'確認用'}: ${v.sessions}回・${v.items}件${v.sessions<v.requiredSessions||v.items<v.requiredItems?`（あと${Math.max(0,v.requiredSessions-v.sessions)}回・${Math.max(0,v.requiredItems-v.items)}件）`:' · 準備できています'}</p>`).join('')}</article>`).join('')}<p class="fineprint">検出には完全な姿勢記録と全区間・リリース時刻の確認が必要です。動画だけの旧記録は検出の再検証に使えません。音声は低信頼度・未確認・条件違いを除きます。記録は同じ撮影条件とGood Formごとに分け、改善用と確認用を自動割当します。固定済みの割当は変更しません。</p><button id="ai-generate" class="primary" ${busy?'disabled':''}>${busy?'検証中…':'AIの改善案を作成'}</button><p id="ai-message" role="status">${esc(message)}</p><div id="ai-proposals">${proposals.map((r,i)=>`<article class="proposal-setting"><h3>${r.kind==='detector'?'検出':'音声'} · 未適用の改善案</h3><p>${esc(r.reason)}</p>${r.before?`<p>確認用の記録で比較</p><p>変更前: ${metric(r.before.validation,r.kind)}</p><p>変更後: ${r.selected?.validation?metric(r.selected.validation,r.kind):'改善を確認できた案なし'}</p>`:''}<button data-approve="${i}" class="primary" ${r.recommended&&!busy?'':'disabled'}>この改善案を適用</button><button data-reject="${i}" ${busy?'disabled':''}>この案を見送る</button><details><summary>検証の詳細・使用記録</summary><pre>${esc(JSON.stringify(r,null,2))}</pre></details></article>`).join('')}</div><button id="ai-history">以前の設定に戻す</button><button id="ai-truth">検出時刻・保存データを確認する</button>${!state.scope?'<p>まずGood Formを選び、Live Coachで練習を保存してください。</p>':''}`;
  basic.querySelector('#ai-scope').onchange=()=>{const select=container.querySelector('#personal-scope');select.value=basic.querySelector('#ai-scope').value;select.dispatchEvent(new Event('change'));};
  basic.querySelector('#ai-review').onclick=()=>{if(!busy)config.openReview();};
  basic.querySelector('#ai-history').onclick=()=>{advanced.open=true;container.querySelector('#personal-history')?.scrollIntoView();};
  basic.querySelector('#ai-truth').onclick=()=>{advanced.open=true;container.querySelector('#personal-datasets')?.scrollIntoView();};
  basic.querySelector('#ai-generate').onclick=generate;
  basic.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>{proposals.splice(Number(b.dataset.reject),1);message='改善案を見送りました。適用設定は変更していません。';void draw();});
  basic.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>approve(Number(b.dataset.approve)));
 }
 async function generate(){if(busy||!controller||!state)return;busy=true;message='記録を自動割当し、使える項目だけを検証します。';await draw();try{
  const startingScope=state.scope,cases=await config.getFreshCases(),initialCasesFingerprint=fingerprint(cases.filter(c=>scopeKey(c.metadata,c.goodFormReference.id)===startingScope)),datasets=allocateDatasets(cohort(),cases,state.datasets);await setSetting(key,datasets);state.datasets=datasets;
  const initialRoles=rolesFingerprint(datasets),progress=evidenceProgress(cohort(),cases,datasets);proposals=[];
  for(const kind of ['detector','feedback'])if(sufficient(progress[kind])){const r=await controller.compare(kind);if(disposed)return;if(r)proposals.push(r);}
  caseFingerprint=fingerprint((await config.getFreshCases()).filter(c=>scopeKey(c.metadata,c.goodFormReference.id)===state.scope));const finalDatasets=(await getSetting(key))?.value??{};datasetFingerprint=JSON.stringify(finalDatasets);if(state.scope!==startingScope||caseFingerprint!==initialCasesFingerprint||rolesFingerprint(finalDatasets)!==initialRoles){proposals=[];throw new Error('検証中にレビュー・割当が変更されました。もう一度作成してください。');}
  message=proposals.length?'検証結果を確認してください。改善が確認できた案だけ適用できます。':'まだ検証に必要な記録が足りません。上の不足件数を確認してレビューし、検出用の時刻は詳細設定で確認してください。';
 }catch(e){message=`改善案を作成できません: ${e.message}`;}finally{busy=false;await draw();}}
 async function approve(index){const r=proposals[index];if(busy||!r?.recommended)return;busy=true;try{
  const cases=(await config.getFreshCases()).filter(c=>scopeKey(c.metadata,c.goodFormReference.id)===state.scope),datasets=(await getSetting(key))?.value??{},active=await activeCalibration(state.scope),part=r.kind==='detector'?'detector':'feedback',parameters=validateParameters(active?.parameters??defaultParameters());
  if(fingerprint(cases)!==caseFingerprint||JSON.stringify(datasets)!==datasetFingerprint||JSON.stringify(parameters[part])!==JSON.stringify(r.baselineParameters))throw new Error('レビュー・割当・現在の設定が変わりました。改善案を作り直してください。');
  if(!confirm('この改善案を承認し、次回のLive Coachから適用しますか？元の記録は保持します。'))return;
  parameters[part]=r.recommended.parameters;validateParameters(parameters);
  await commitCalibration({id:crypto.randomUUID(),scope:state.scope,engine:CALIBRATION_ENGINE,kind:r.kind,createdAt:Date.now(),approvedAt:Date.now(),previousId:active?.id??null,parameters,trainingIds:r.trainingIds,validationIds:r.validationIds,metrics:{before:r.before,after:{training:r.recommended.training,validation:r.recommended.validation}},evidenceFingerprint:caseFingerprint,proposal:r.recommended.label},active?.id??null);
  proposals.splice(index,1);await controller.refresh();message='承認した改善版を保存しました。次回のLive Coachから反映します。';
 }catch(e){message=e.message;}finally{busy=false;await draw();}}
 const cleanup=mountPersonalCalibration(container.querySelector('#ai-advanced-content'),{...config,autoAllocate:true,onReady:v=>controller=v,onRefresh:v=>{if(state&&state.scope!==v.scope)proposals=[];state=v;void draw();}});
 return ()=>{disposed=true;cleanup();};
}
