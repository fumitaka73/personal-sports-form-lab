import appPackage from '../package.json';
import {driveAuth} from './drive-auth.js';
import {DriveAPI} from './drive-api.js';
import {DriveBackup} from './drive-backup.js';
import {describeBackupSource,prepareSessionBackup} from './session-backup.js';
import {hashText} from './backup-hash.js';
import {getCoachSession,getPoseSession,getPoseChunk,poseChunkInventory,listTemporaryVideos,getSetting,setSetting,reserveDriveId} from './storage.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const position=s=>Number.isFinite(s)?`${Math.floor(Math.max(0,s)/60)}:${String(Math.floor(Math.max(0,s)%60)).padStart(2,'0')}`:'位置不明';
const CLIENT_SETTING='google-drive-client-id-1';
async function sourceFor(session){
 const [record,videos,pose,review,check,chunks]=await Promise.allSettled([getCoachSession(session.id),listTemporaryVideos(),getPoseSession(session.id),getSetting('review-v04'),getSetting('detection-check:'+session.id),poseChunkInventory(session.id)]);
 if(review.status==='rejected'||check.status==='rejected'||record.status==='rejected')throw new Error('保存済み結果・レビューを読み込めません。端末の保存機能を確認してください。');
 const warnings=[];if(videos.status==='rejected')warnings.push('動画一覧を読み込めません。');if(pose.status==='rejected'||chunks.status==='rejected')warnings.push('骨格の保存情報を読み込めません。');
 return describeBackupSource({session:record.value?.endedAt?record.value:session,localResultStored:!!record.value?.endedAt,rows:videos.status==='fulfilled'?videos.value:[],pose:pose.status==='fulfilled'?pose.value:null,chunks:chunks.status==='fulfilled'?chunks.value:[],review:review.value?.value,detectionCheck:check.value?.value,warnings});
}
export function mountDriveBackup(container,session,{onBusy=()=>{},hasDirty=()=>false,auth=driveAuth}={}){
 container.hidden=false;container.innerHTML=`<section class="drive-save panel"><h3>Google Driveに保存</h3><p class="fineprint">選んだデータだけを、本人のDriveの「Personal Sports Form Lab」に保存します。自動送信・自動削除はしません。<a href="${esc(new URL('privacy.html',document.baseURI).href)}" target="_blank" rel="noopener noreferrer">データの扱い</a></p><details id="drive-settings"><summary>Google連携の初期設定（1回だけ）</summary><label class="field">OAuth Client ID（Web用・公開識別子）<input id="drive-client-id" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Google Cloudで作成したClient ID"></label><p class="fineprint">Client Secretは入力しません。Drive APIとJavaScriptオリジンの設定が必要です。</p><p><a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">Google側の許可を確認・解除</a></p><button id="drive-configure" class="secondary">Client IDを保存</button></details><p id="drive-account" role="status">未連携</p><div class="sync-controls"><button id="drive-connect" disabled>Googleアカウントと連携</button><button id="drive-disconnect" disabled>連携を解除</button></div><div id="drive-selection">保存対象を確認中…</div><div class="sync-controls"><button id="drive-upload" class="primary" disabled>選んだデータを保存</button><button id="drive-json" disabled>JSONだけ保存</button><button id="drive-cancel" hidden>中断</button></div><progress id="drive-progress" max="1" value="0" aria-label="Google Drive保存の進捗"></progress><p id="drive-status" role="status" aria-live="polite"></p><div id="drive-link"></div><p class="fineprint">保存中はSafariを開いたままにしてください。同じ内容の再試行では保存先を再利用します。修正後は新しい保存版を作り、前の版は消しません。</p></section>`;
 const el=id=>container.querySelector('#'+id),status=t=>{if(!disposed)el('drive-status').textContent=t;};
 let disposed=false,busy=false,authorizing=false,source=null,controller=null,api=null,apiScope=null,ready=false,configuring=false;
 function controls(){if(disposed)return;el('drive-connect').disabled=busy||authorizing||!ready;el('drive-disconnect').disabled=busy||authorizing||!auth.token;for(const id of ['drive-upload','drive-json'])el(id).disabled=busy||authorizing||!source||!auth.connected;el('drive-configure').disabled=busy||authorizing||configuring;el('drive-client-id').disabled=busy||authorizing;el('drive-cancel').hidden=!busy;container.querySelectorAll('[data-drive-all],[data-drive-none]').forEach(v=>v.disabled=busy);container.querySelectorAll('#drive-selection input').forEach(v=>v.disabled=busy||v.dataset.unavailable==='true');el('drive-account').textContent=auth.connected?`連携中：${auth.account.email??auth.account.name}`:'未連携・期限切れの場合は再接続してください。';}
 async function configure(id,persist=false){configuring=true;controls();try{await auth.prepare(id);if(persist)await setSetting(CLIENT_SETTING,id);ready=true;status(auth.connected?'連携済みです。保存対象を選んでください。':'Google連携の準備ができました。「Googleアカウントと連携」を押してください。');}catch(error){ready=false;status(error.message);}finally{configuring=false;controls();}}
 async function inventory(){source=await sourceFor(session);if(disposed)return;
  const poseLabel=source.poseInfo.available?`骨格時系列：${source.poseInfo.count}フレーム${source.poseInfo.complete?'':'（保存された一部のみ）'}・2D 14点`:'骨格時系列：保存データなし／読み出し不可';
  el('drive-selection').innerHTML=`<fieldset><legend>JSONの保存対象</legend>${[['results','ショット認識結果'],['form','フォーム評価・音声助言'],['reviews','保存済みレビュー修正・検出チェック'],['pose',poseLabel],['diagnostics','保存済みの診断情報（任意）']].map(([id,label])=>`<label><input type="checkbox" data-drive-kind="${id}" ${id!=='diagnostics'&&(id!=='pose'||source.poseInfo.available)?'checked':''} ${id==='pose'&&!source.poseInfo.available?'disabled data-unavailable="true"':''}> ${esc(label)}</label>`).join('')}</fieldset><details id="drive-videos"><summary>動画を選ぶ（初期は未選択・${source.videoInfo.filter(v=>v.available).length}ファイル）</summary><div class="sync-controls"><button data-drive-all>録画区間をまとめて選ぶ</button><button data-drive-none>動画の選択を外す</button></div><fieldset><legend>必要な動画だけ選択</legend>${source.videoInfo.length?source.videoInfo.map((v,i)=>`<label><input type="checkbox" data-drive-video="${esc(v.id)}" ${!v.available?'disabled data-unavailable="true"':''}> ${v.kind==='shot-clip'?'切り出し':'録画区間'} ${i+1} · ${position(v.startSeconds)}–${position(v.endSeconds)} · ${(v.bytes/1048576).toFixed(1)} MiB${v.available?'':' · 未保存／利用不可'}</label>`).join(''):'<p>保存済み動画がありません。JSONのみ保存できます。</p>'}</fieldset></details><p class="fineprint">${source.session.recordingStatus==='incomplete'?'動画は保存済み区間のみです。未保存区間は送信できません。 ':''}${!source.localResultStored?'分析結果は画面にのみあります（ローカル未保存）。 ':''}${source.warnings.map(esc).join(' ')}基本情報（セッションID・日時・保存状態）は必ず含みます。骨格は保存済みの14点・最大20fpsです。33点や3Dは含みません。未選択／未取得のデータは保存済みと表示しません。</p>`;
  container.querySelector('[data-drive-all]').onclick=()=>container.querySelectorAll('[data-drive-video]').forEach(v=>{const row=source.videoInfo.find(r=>r.id===v.dataset.driveVideo);v.checked=!!row?.available&&row.kind!=='shot-clip';});
  container.querySelector('[data-drive-none]').onclick=()=>container.querySelectorAll('[data-drive-video]').forEach(v=>v.checked=false);controls();
 }
 el('drive-configure').onclick=()=>void configure(el('drive-client-id').value.trim(),true);
 el('drive-connect').onclick=()=>{
  authorizing=true;controls();status('Googleの画面でアカウントと許可を確認してください。');
  const authorization=auth.connect(); // Must remain synchronous with the tap.
  void authorization.then(async()=>{if(disposed)return;const nextAPI=new DriveAPI({token:()=>auth.getToken()});auth.setAccount(await nextAPI.account());const nextScope=hashText(auth.clientId+':'+auth.account.id);if(!api||apiScope!==nextScope)api=nextAPI;apiScope=nextScope;status('Googleアカウントを確認しました。保存するデータを選んでください。');}).catch(error=>{auth.clear();status(error.message);}).finally(()=>{authorizing=false;controls();});
 };
 el('drive-disconnect').onclick=async()=>{authorizing=true;controls();const revoked=await auth.disconnect();api=null;apiScope=null;status(revoked?'Google連携を解除しました。Driveの保存済みファイルと端末のデータは残っています。':'この画面の連携情報を消しました。Google側の許可解除はGoogleアカウントの「サードパーティとの接続」で確認してください。Drive・端末のデータは残っています。');authorizing=false;controls();};
 function selection(jsonOnly=false){return {...Object.fromEntries([...container.querySelectorAll('[data-drive-kind]')].map(v=>[v.dataset.driveKind,v.checked&&!v.disabled])),videoIds:jsonOnly?[]:[...container.querySelectorAll('[data-drive-video]:checked')].map(v=>v.dataset.driveVideo)};}
 function progress(p){if(disposed)return;
  const labels={prepare:'保存データを準備',upload:'送信中',confirm:'保存の完了を確認',complete:'保存完了'},names={'shots.json':'ショットの記録','reviews.json':'レビュー修正','diagnostics.json':'診断情報','metadata.json':'管理情報'};
  const name=p.file?.startsWith('videos/')?'動画':p.file?.startsWith('pose/')?'骨格データ':names[p.file]??'';
  const fraction=p.total?p.done/p.total:0,overall=p.phase==='prepare'?(p.index+fraction)/Math.max(1,p.totalFiles):p.phase==='complete'?1:Math.min(.99,fraction*.99);
  el('drive-progress').value=overall;status(`${labels[p.phase]}${name?`：${name}`:''}${p.totalFiles?`（${p.index+1}/${p.totalFiles}）`:''} · ${Math.floor(overall*100)}%`);
 }

 async function upload(jsonOnly){
  if(busy)return;if(hasDirty()){status('未保存の評価・メモがあります。先に保存してください。Driveには保存済みの修正のみ含まれます。');return;}
  const chosen=selection(jsonOnly);if(jsonOnly)container.querySelectorAll('[data-drive-video]').forEach(v=>v.checked=false);
  try{auth.getToken();if(!auth.account)throw new Error('Googleアカウントを再連携してください。');}catch(error){status(error.message);controls();return;}
  busy=true;status('保存対象を読み込み、送信の準備をしています…');controller=new AbortController();onBusy(true);container.dispatchEvent(new CustomEvent('drive-upload-busy',{bubbles:true,detail:true}));controls();el('drive-link').replaceChildren();el('drive-progress').value=0;
  try{
   const latest=await sourceFor(session),plan=await prepareSessionBackup(latest,chosen,{readChunk:getPoseChunk,signal:controller.signal,onProgress:progress,exporterVersion:appPackage.version});
   const scope=hashText(auth.clientId+':'+auth.account.id);if(!api||apiScope!==scope)api=new DriveAPI({token:()=>auth.getToken()});apiScope=scope;
   const saver=new DriveBackup({api,scope,readId:async key=>(await getSetting(key))?.value?.id,reserveId:reserveDriveId,saveReceipt:setSetting});
   const result=await saver.save(plan,{signal:controller.signal,onProgress:progress});if(disposed)return;
   const link=document.createElement('a');link.href=result.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Google Driveの保存版を開く';el('drive-link').append(link);
   status(`選んだデータのDrive保存を確認しました。動画 ${chosen.videoIds.length}区間${chosen.pose?` · 骨格 ${latest.poseInfo.count}フレーム`:''}。未選択・未保存のデータは含みません。${result.localReceiptSaved?'':'端末には保存完了メモを書けませんでしたが、Drive上の確認は完了しています。'}`);
  }catch(error){if(error.code==='auth')auth.clear();status(error.name==='AbortError'?'中断しました。送信済み区間と端末データは残っています。再試行できます。':`${error.message} 端末の練習データは削除していません。同じ選択で再試行できます。`);}
  finally{busy=false;onBusy(false);if(!disposed)container.dispatchEvent(new CustomEvent('drive-upload-busy',{bubbles:true,detail:false}));controller=null;controls();}
 }
 el('drive-upload').onclick=()=>void upload(false);el('drive-json').onclick=()=>void upload(true);el('drive-cancel').onclick=()=>controller?.abort();
 const interrupt=()=>{if(document.hidden&&busy)controller?.abort();},leave=()=>controller?.abort();document.addEventListener('visibilitychange',interrupt);window.addEventListener('pagehide',leave);
 void inventory().catch(error=>status(error.message));
 void getSetting(CLIENT_SETTING).then(saved=>{if(disposed)return;const id=saved?.value??import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID??'';el('drive-client-id').value=id;if(id)void configure(id);else{el('drive-settings').open=true;status('Google Cloudの設定とOAuth Client IDが必要です。未設定のため、まだDriveへ保存できません。');}}).catch(()=>status('Google連携の設定を読み込めません。Client IDを入力して再試行してください。'));
 controls();return ()=>{disposed=true;controller?.abort();document.removeEventListener('visibilitychange',interrupt);window.removeEventListener('pagehide',leave);};
}
