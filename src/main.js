import {mountPersonalCalibration} from './calibration-ui.js';
import {expireTemporaryVideos} from './video-review.js';
import {mountReviewHub} from './review-ui.js';
import {emptyReviewData,collectCases,referenceCatalog} from './review-data.js';
import './style.css';
import { videoTransform, POSE_CONNECTIONS } from './pose-coordinates.js';
import {mountLiveCoach,coachSummaryHTML} from './live-coach.js';
import { saveCoachSession, listVideos, listResults, getSetting, saveVideo, deleteVideo, deleteResult, commitAnalysis, commitSession, setSetting } from './storage.js';
import { analyzeVideo, seekVideo } from './pose.js';
import { validatePhases } from './metrics.js';
import { reviewShot } from './shot-engine.js';
import { summarizeSession } from './session.js';
import { detectSessionWithAdapter } from './shot-detector.js';
import { drawFlightOverlay } from './flight-overlay.js';
import { mountHoopSelector } from './hoop-selector.js';
import { setupShotPlayback } from './shot-playback.js';
import { evaluateCheckpoints } from './checkpoints.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const date = value => new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const shotLabels = { jump: 'ジャンプシュート', set: 'セットシュート', free: 'フリースロー' };
const cameraLabels = { front: '正面', side: '横', diagonal: '45度' };
const confidenceLabels = { High: '高（High）', Medium: '中（Medium）', Low: '低（精度低・Low）' };
let reviewData=emptyReviewData(),reviewCaseId=null;
let coachSessions = [];
let sessions = [], activeSession = null, sessionShotResult = null;
let videos = [], results = [], referenceId = null, activePage = 'good', activeResult = null;
let urls = [], cleanup = () => {}, controller = null, busy = false, noteDirty = false;
const app = document.querySelector('#app');
app.innerHTML = `<header><a class="brand" href="./"><span class="brand-mark">↗</span> SPORTS FORM LAB</a><span class="header-label">BASKETBALL · PERSONAL BASELINE</span></header>
<main><section class="intro"><div><p class="eyebrow">BASKETBALL SHOOTING / VERSION 0.13 · PERSONAL CALIBRATION v0.5</p><h1>いいフォームを、<br>次のシュートへ。</h1><p class="lead">自分のGood Formと比較して、次に意識することを見つける。</p></div><div class="intro-aside"><span class="circle">↗</span><p>YOUR FORM. YOUR REFERENCE.</p></div></section>
<nav class="tabs" aria-label="画面選択"><button data-page="good">Good Form登録</button><button data-page="analyze">Single Shot</button><button data-page="session">Session</button><button data-page="coach">Live Coach</button><button data-page="review">Shot Review / Calibration</button><button data-page="calibration">Personal Calibration</button><button data-page="history">履歴</button><button data-page="library">保存済み動画・メモ</button></nav>
<p id="status" role="status" aria-live="polite"></p><section id="screen"></section>
<footer><span>PERSONAL SPORTS FORM LAB</span><span>動画・分析結果はこのブラウザに保存。動画の外部送信なし。<br>ブラウザのデータを消すと記録も消えます。元の動画は別途保管してください。</span></footer></main>`;
const screen = document.querySelector('#screen');
const status = document.querySelector('#status');
function message(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
function url(blob) { const value = URL.createObjectURL(blob); urls.push(value); return value; }
function clearScreen() { cleanup(); cleanup = () => {}; screen.querySelectorAll('video').forEach(v => v.pause()); urls.forEach(URL.revokeObjectURL); urls = []; noteDirty = false; }
function navigate(page) {
  if (busy) return;
  if (noteDirty && !confirm('未保存のメモがあります。変更を破棄しますか？')) return;
  activePage = page; message(''); render();
}
function render() {
  clearScreen();
  document.querySelectorAll('[data-page]').forEach(button => { button.classList.toggle('active', button.dataset.page === activePage); button.setAttribute('aria-current', button.dataset.page === activePage ? 'page' : 'false'); });
  if (activePage === 'good' || activePage === 'analyze') renderUpload(activePage === 'good');
  else if (activePage === 'session') renderSession();
  else if (activePage === 'review') renderReview();
  else if (activePage === 'calibration') cleanup=mountPersonalCalibration(screen,{sessions:coachSessions,cases:collectCases(results,sessions,coachSessions,reviewData.cases),getFreshCases:async()=>{const saved=await getSetting('review-v04');return collectCases(results,sessions,coachSessions,saved?.value?.cases??reviewData.cases);}});
  else if (activePage === 'coach') cleanup=mountLiveCoach(screen,{videos:Object.values(catalog()),referenceId,onSave:async session=>{await saveCoachSession(session);coachSessions=[session,...coachSessions.filter(s=>s.id!==session.id)];}});
  else if (activePage === 'results') renderResult();
  else if (activePage === 'history') renderHistory();
  else renderLibrary();
}
const catalog=()=>referenceCatalog(videos,results,sessions,coachSessions,referenceId,reviewData.references);
const reference = () => {const video=videos.find(v=>v.id===referenceId),saved=catalog()[referenceId];return saved?{...saved,blob:video?.blob,notes:video?.notes??saved.notes}:video;};
function renderReview(){
 const cases=collectCases(results,sessions,coachSessions,reviewData.cases),videoUrls=new Map();
 const sessionTargets=[...sessions.map(s=>({mode:'session',recordId:s.id,title:s.title,appFeedback:{text:[...new Set(s.shots.flatMap(shot=>shot.feedback?.focus??[]))].join('\n')||'助言なし',summary:s.summary,shots:s.shots.map(shot=>({number:shot.number,feedback:shot.feedback}))}})),...coachSessions.map(s=>({mode:'live',recordId:s.id,title:s.goodFormReference.title,appFeedback:{text:[...new Set(s.shots.map(shot=>shot.coachFeedback?.text?.ja).filter(Boolean))].join('\n')||'助言なし',summary:s.summary,shots:s.shots.map(shot=>({number:shot.number,feedback:shot.coachFeedback}))}}))];
 for(const entry of Object.values(reviewData.sessionFeedback))if(!sessionTargets.some(s=>s.mode===entry.mode&&s.recordId===entry.recordId))sessionTargets.push(entry);
 for(const c of cases)if(c.source.mode!=='single'&&!sessionTargets.some(s=>s.mode===c.source.mode&&s.recordId===c.source.recordId))sessionTargets.push({mode:c.source.mode,recordId:c.source.recordId,title:'移行したセッション',appFeedback:{text:'元のセッションまとめはN/A'}});
 cleanup=mountReviewHub(screen,{data:{...reviewData,references:catalog()},cases,sessionTargets,videos,openCalibration:()=>navigate('calibration'),manualTemplate:id=>{const s=coachSessions.find(s=>s.id===id);return s?{source:{mode:'live',recordId:id},metadata:s.metadata,goodFormReference:s.goodFormReference,scoreVersion:s.version}:null;},activeReferenceId:referenceId,initialCaseId:reviewCaseId,onDirty:value=>noteDirty=value,onSave:async data=>{busy=true;try{await setSetting('review-v04',data);reviewData=data;}finally{busy=false;}},onActivateReference:async id=>{await setSetting('referenceId',id);referenceId=id;},getVideoUrl:c=>{const video=videos.find(v=>v.id===c.source.videoId);if(!video?.blob)return null;if(!videoUrls.has(video.id))videoUrls.set(video.id,url(video.blob));return videoUrls.get(video.id);}});reviewCaseId=null;
}
screen.addEventListener('click',event=>{const button=event.target.closest('[data-open-review]');if(button){reviewCaseId=button.dataset.openReview;navigate('review');}});
const videoAnalysisLabel = () => reference()?.analysis?.lowQuality ? '（精度低の参考分析）' : '';
const options = (values, selected) => Object.entries(values).map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');
function renderUpload(isReference) {
  const good = reference();
  if (!isReference && !good?.analysis) {
    screen.innerHTML = `<div class="panel empty"><span class="empty-icon">01</span><h2>まずGood Formを登録しましょう。</h2><p>コーチが評価した自分のシュート動画を、比較の基準にします。</p><button class="primary" id="go-good">Good Formを登録</button></div>`;
    document.querySelector('#go-good').onclick = () => navigate('good'); return;
  }
  screen.innerHTML = `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">${isReference ? 'YOUR PERSONAL BASELINE' : 'COMPARE YOUR NEXT SHOT'}</p><h2>${isReference ? 'Good Form登録' : '新しいシュートを分析'}</h2></div><span class="badge">ローカル分析</span></div>
    ${good ? `<p class="reference-summary">現在のGood Form：<strong>${escape(good.title)}</strong> · ${shotLabels[good.shotType]} / ${cameraLabels[good.cameraAngle]}${good.analysis?.lowQuality ? ' · 精度低（登録済み）' : ''}</p>${isReference ? (good.analysis?.warnings ?? []).map(w => `<p class="warning">${escape(w)}</p>`).join('') : ''}` : ''}
    <p class="instruction">撮影角度が違う動画や、一部の関節が見えにくい動画も受け付けます。検出できた範囲で分析し、条件が悪い場合は「精度低」と表示します。同じカメラ位置で1人のシュートを撮ると比較しやすくなります。</p>
    <div class="upload-layout"><div><label class="upload" for="upload">＋ ${isReference ? 'Good Formの動画を選ぶ' : '新しい動画を選ぶ'}<input id="upload" type="file" accept="video/*"></label><p class="upload-hint">MP4（H.264）/ WebM推奨 · 保存できる容量はブラウザによります</p>
    <label class="field">保存済みの動画から選ぶ<select id="existing"><option value="">動画を選択</option>${videos.map(v => `<option value="${escape(v.id)}">${escape(v.title)}</option>`).join('')}</select></label>
    <p id="file-name" class="filename"></p><video id="preview" controls playsinline preload="auto" hidden></video>
    <p id="video-error" class="error" role="alert" hidden>この形式を再生できません。MP4（H.264）またはWebMをお試しください。</p>
    <div id="phase-controls" hidden><label class="auto-setting"><input id="auto-phases" type="checkbox" checked> 開始・リリース・終了を自動設定</label><p class="instruction">分析ボタンを押すと、先頭30秒以内からボール離れ候補・姿勢の動きを探します。手動入力は不要です。追跡できない場合も姿勢推定または仮設定で分析を続けます。</p><p id="auto-info" class="fineprint"></p><details id="manual-phases"><summary>手動で修正する（任意）</summary>
      <div class="phase-grid">${[['start', '開始'], ['release', 'リリース'], ['end', '終了']].map(([id, label]) => `<label class="field">${label}（秒）<input id="${id}" type="number" min="0" step="0.01" required><button type="button" class="secondary mark" data-mark="${id}">現在の位置を指定</button></label>`).join('')}</div>
      <button class="secondary" id="slow" type="button">0.5倍速にする</button></details></div></div>
    <form id="analysis-form"><div id="hoop-controls"${isReference?' hidden':''}></div><label class="field">シュート種別<select id="shot-type">${options(shotLabels, good?.shotType ?? 'jump')}</select></label>
    <label class="field">撮影角度<select id="camera-angle">${options(cameraLabels, good?.cameraAngle ?? 'side')}</select></label>
    <label class="field">シュートする手<select id="hand"><option value="right"${good?.hand !== 'left' ? ' selected' : ''}>右手</option><option value="left"${good?.hand === 'left' ? ' selected' : ''}>左手</option></select></label>
    <label class="field">ゴールの方向（画面上・任意）<select id="goal-direction"><option value="unknown">指定なし</option><option value="right">画面右</option><option value="left">画面左</option><option value="up">画面上</option></select></label>
    <label class="field">${isReference ? 'Good Formのメモ' : '今回のメモ'}<textarea id="notes" rows="4" placeholder="コーチからのコメントや撮影条件など"></textarea></label>
    <p id="condition-warning" class="warning" hidden></p><button type="submit" class="primary full" id="analyze-button" disabled>${isReference ? '分析してGood Formに設定' : 'Analyze · 分析する'}</button>
    <p class="fineprint">MediaPipeで姿勢を推定し、計測差から点数を計算します。助言は計測値に基づくルールで生成します。LLMは点数を作りません。</p>
    <div id="progress-area" hidden><progress id="progress" max="100" value="0"></progress><p id="progress-text" role="status"></p><button id="cancel" class="secondary" type="button">分析をキャンセル</button></div></form></div>
    <p class="fineprint">2D映像による試作です。リリース位置の指定や撮影条件で計測値が変わります。ボールは色・丸い輪郭・連続する位置で追跡します（主にオレンジ・茶色）。誤検出や見失いがあります。手離れは2D映像からの推定です。シュート成功率は評価しません。</p></section>`;
  const preview = document.querySelector('#preview');
  const fileInput = document.querySelector('#upload');
  const existingSelect = document.querySelector('#existing');
  const button = document.querySelector('#analyze-button');
  const form = document.querySelector('#analysis-form');
  const hoopSelector=mountHoopSelector(document.querySelector('#hoop-controls'),preview);
  let draft = null, phaseEstimated = true;
  function selectVideo(video) {
    draft = video; hoopSelector.reset(video.hoop??video.analysis?.hoop);message(''); preview.hidden = false;
    document.querySelector('#file-name').textContent = video.title;
    document.querySelector('#phase-controls').hidden = true; document.querySelector('#video-error').hidden = true;
    button.disabled = true; preview.src = url(video.blob); preview.load();
    document.querySelector('#notes').value = video.notes ?? '';
    if (video.shotType) document.querySelector('#shot-type').value = video.shotType;
    if (video.cameraAngle) document.querySelector('#camera-angle').value = video.cameraAngle;
    if (video.hand) document.querySelector('#hand').value = video.hand;
    document.querySelector('#goal-direction').value = video.goalDirection ?? 'unknown';
    updateWarning();
  }
  preview.onloadeddata = () => {
    if (!Number.isFinite(preview.duration) || preview.duration <= 0) { message('再生可能な動画を選んでください。', true); return; }
    document.querySelector('#phase-controls').hidden = false;
    const phases = draft.analysis?.phases;
    document.querySelector('#start').value = phases?.start ?? 0;
    document.querySelector('#release').value = phases?.release ?? Math.min(preview.duration, 30) / 2;
    phaseEstimated = draft.analysis ? Boolean(draft.analysis.phaseEstimated) : true;
    document.querySelector('#end').value = phases?.end ?? Math.min(preview.duration, 30);
    document.querySelector('#auto-phases').checked = true;
    document.querySelector('#manual-phases').open = false;
    const automatic = draft.analysis?.autoDetection;
    document.querySelector('#auto-info').textContent = automatic ? `前回の自動設定：開始 ${automatic.phases.start.toFixed(2)}秒 / リリース ${automatic.phases.release.toFixed(2)}秒 / 終了 ${automatic.phases.end.toFixed(2)}秒。${automatic.reason}` : '自動検出の結果は分析後に表示します。';
    button.disabled = false;
  };
  preview.onerror = () => { button.disabled = true; document.querySelector('#video-error').hidden = false; };
  fileInput.onchange = () => {
    const file = fileInput.files[0]; fileInput.value = '';
    if (!file) return;
    if (!file.size) { message('空のファイルです。動画ファイルを選んでください。', true); return; }
    existingSelect.value = ''; selectVideo({ id: crypto.randomUUID(), blob: file, title: file.name, notes: '', createdAt: Date.now() });
  };
  existingSelect.onchange = () => { const video = videos.find(v => v.id === existingSelect.value); if (video) selectVideo(video); };
  document.querySelector('#auto-phases').onchange = () => { document.querySelector('#manual-phases').open = !document.querySelector('#auto-phases').checked; };
  const manualInput = key => { document.querySelector('#auto-phases').checked = false; if (key === 'release') phaseEstimated = false; };
  document.querySelectorAll('[data-mark]').forEach(mark => mark.onclick = () => { preview.pause(); document.querySelector(`#${mark.dataset.mark}`).value = preview.currentTime.toFixed(2); manualInput(mark.dataset.mark); });
  ['start', 'release', 'end'].forEach(key => document.querySelector(`#${key}`).oninput = () => manualInput(key));
  document.querySelector('#slow').onclick = event => { preview.playbackRate = preview.playbackRate === 0.5 ? 1 : 0.5; event.target.textContent = preview.playbackRate === 0.5 ? '通常速度に戻す' : '0.5倍速にする'; };
  function updateWarning() {
    const warnings = [];
    if (!isReference && document.querySelector('#camera-angle').value !== good.cameraAngle) warnings.push('撮影角度が異なっても分析できます。比較項目を時間指標に絞り、「精度低」と表示します。');
    if (!isReference && document.querySelector('#shot-type').value !== good.shotType) warnings.push('種別が異なります。下半身・跳躍に依存する項目は除外します。');
    const warning = document.querySelector('#condition-warning'); warning.textContent = warnings.join(' '); warning.hidden = !warnings.length;
  }
  document.querySelector('#camera-angle').onchange = updateWarning;
  document.querySelector('#shot-type').onchange = updateWarning;
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || !draft) return;
    const autoPhases = document.querySelector('#auto-phases').checked;
    const phases = autoPhases ? { start: 0, release: Math.min(preview.duration, 30) / 2, end: Math.min(preview.duration, 30) } : Object.fromEntries(['start', 'release', 'end'].map(key => [key, document.querySelector(`#${key}`).value === '' ? NaN : Number(document.querySelector(`#${key}`).value)]));
    try { validatePhases(phases, preview.duration); } catch (error) { message(error.message, true); return; }
    const metadata = { shotType: document.querySelector('#shot-type').value, cameraAngle: document.querySelector('#camera-angle').value, hand: document.querySelector('#hand').value, goalDirection: document.querySelector('#goal-direction').value };
    const notes = document.querySelector('#notes').value;
    busy = true; controller = new AbortController(); const signal = controller.signal;
    document.querySelector('#progress-area').hidden = false;
    const controls = [...screen.querySelectorAll('input, select, textarea, button')].filter(c => c.id !== 'cancel'); controls.forEach(c => c.disabled = true);
    document.querySelectorAll('[data-page]').forEach(c => c.disabled = true); preview.controls = false;
    document.querySelector('#cancel').onclick = () => { controller.abort(); document.querySelector('#progress-text').textContent = 'キャンセル処理中…'; };
    const onProgress = (text, progress) => { document.querySelector('#progress-text').textContent = text; document.querySelector('#progress').value = progress; };
    let completed = false;
    try {
      const analysis = await analyzeVideo(preview, phases, metadata.hand, onProgress, signal, phaseEstimated, { autoPhases,hoop:isReference?null:hoopSelector.value() });
      if (signal.aborted) throw new DOMException('キャンセル', 'AbortError');
      const video = { ...draft, ...metadata, isGoodForm:isReference||draft.isGoodForm, notes, analysis, hoop:analysis.hoop, updatedAt: Date.now() };
      let result;
      if (!isReference) {
        onProgress('Good Formと比較し、計測値からフィードバックを生成しています', 95);
        const review = reviewShot(good.analysis, analysis, good, video);
        result = { id: crypto.randomUUID(), referenceVideoId: good.id, newVideoId: video.id, referenceTitle: good.title, newTitle: video.title, referenceMeta: { shotType: good.shotType, cameraAngle: good.cameraAngle, hand: good.hand }, newMeta: metadata, referenceAnalysis: good.analysis, newAnalysis: analysis, ...review, scoreVersion:review.comparison.version,goodFormReferenceId:good.id, createdAt: Date.now() };
      }
      let nextReviewData=null;if(isReference){nextReviewData={...reviewData,references:{...catalog()}};const {blob,...record}=video;nextReviewData.references[video.id]=record;}
      await commitAnalysis(video, isReference ? video.id : referenceId, result,nextReviewData);if(nextReviewData)reviewData=nextReviewData;
      videos = [video, ...videos.filter(v => v.id !== video.id)];
      if (isReference) referenceId = video.id;
      else { results.unshift(result); activeResult = result.id; }
      completed = true;
    } catch (error) {
      message(error.name === 'AbortError' ? '分析をキャンセルしました。結果は保存していません。' : error.name === 'QuotaExceededError' ? 'ブラウザの保存容量が不足しています。不要な記録を削除してください。' : error.message || '保存に失敗しました。もう一度お試しください。', error.name !== 'AbortError');
    } finally {
      busy = false; controller = null; document.querySelectorAll('[data-page]').forEach(c => c.disabled = false);
      if (completed) { activePage = isReference ? 'good' : 'results'; render(); message(isReference ? `Good Formを登録しました${videoAnalysisLabel()}。「新しいシュート」で比較できます。` : '分析結果を保存しました。'); }
      else { controls.forEach(c => c.disabled = false); preview.controls = true; document.querySelector('#progress-area').hidden = true; }
    }
  };
  if (isReference && good?.blob) { existingSelect.value = good.id; selectVideo(good); }
}
function renderResult() {
  const result = sessionShotResult?.id === activeResult ? sessionShotResult : results.find(r => r.id === activeResult) ?? results[0];
  if (!result) { screen.innerHTML = '<div class="panel empty"><h2>比較結果はまだありません。</h2><p>Good Formを登録して、新しいシュートを分析してください。</p></div>'; return; }
  activeResult = result.id;
  const { comparison, feedback } = result;
  const checkpointReview = result.checkpointReview ?? evaluateCheckpoints(result.newAnalysis, result.newMeta, result.referenceAnalysis, result.referenceMeta);
  const goodVideo = videos.find(v => v.id === result.referenceVideoId), newVideo = videos.find(v => v.id === result.newVideoId);
  screen.innerHTML = `<section class="panel">${renderCheckpointReview(checkpointReview)}<div class="result-top"><div><p class="eyebrow">FORM MATCH</p><div class="score">${comparison.overall ?? '—'}<span>${comparison.overall === null ? '' : '%'}</span></div><p class="instruction">自分のGood Formとの一致度。<br>シュートの絶対的な品質や成功率の点数ではありません。</p></div><div class="result-meta"><span class="badge">分析信頼度：${confidenceLabels[comparison.confidence]}</span><p>${date(result.createdAt)}<br>${shotLabels[result.newMeta.shotType]} / ${cameraLabels[result.newMeta.cameraAngle]}</p><p class="fineprint">信頼度は姿勢の検出率・比較項目数・撮影条件による目安です。</p></div></div>
    ${comparison.warnings.map(w => `<p class="warning">${escape(w)}</p>`).join('')}
    <p class="fineprint">計測できた比較項目：${comparison.usedMetricCount ?? comparison.metrics.filter(m => m.score !== null).length} / ${comparison.metrics.length}。不足する項目は採点しません。${comparison.overall === null ? ' 点数未算出でも、比較再生と履歴を利用できます。' : ''}</p><div class="metric-grid">${comparison.groups.map(g => `<article class="metric-card"><h3>${g.label}</h3><strong>${g.score === null ? '対象外' : `${Math.round(g.score)}%`}</strong><p>${g.score === null ? '比較できる指標なし' : 'Good Formへの一致度'}</p></article>`).join('')}</div>
    ${renderOutcome(result.newAnalysis.outcome)}<div class="auto-report"><h3>自動設定・ボール追跡</h3>${[result.referenceAnalysis,result.newAnalysis].map((a,i) => `<p><strong>${i === 0 ? 'Good Form' : '今回'}</strong>：開始 ${(Number.isFinite(a.phases?.start)?a.phases.start.toFixed(2):'N/A')}秒 / リリース ${(Number.isFinite(a.phases?.release)?a.phases.release.toFixed(2):'N/A')}秒 / 終了 ${(Number.isFinite(a.phases?.end)?a.phases.end.toFixed(2):'N/A')}秒<br>方法：${({ball:'ボール離れ候補',pose:'姿勢からの推定',midpoint:'区間中央の仮設定'})[a.autoDetection?.source] ?? '手動・従来の設定'}${a.autoDetection ? ' / 自動設定の信頼度：' + confidenceLabels[a.autoDetection.confidence] : ''}<br>${escape(a.autoDetection?.reason ?? '保存済み・手動または従来の仮設定')}<br>ボール追跡：${a.ballTracking?.detectedFrames ?? 0}フレーム${a.autoDetection?.releaseWindow ? ` · 離れ候補の区間 ${a.autoDetection.releaseWindow.from.toFixed(2)}〜${a.autoDetection.releaseWindow.to.toFixed(2)}秒` : ''}</p>`).join('')}<p class="fineprint">水色の輪と線は検出できたボールの位置・軌道です。見失った区間の位置は補完しません。旧履歴にボール追跡を追加するには、保存済み動画を選んで再分析してください。</p></div><div class="comparison-videos"><div><h3>GOOD FORM</h3><p class="filename">${escape(result.referenceTitle)}</p>${goodVideo ? `<div class="video-wrap"><video id="ref-player" controls playsinline src="${url(goodVideo.blob)}"></video><canvas id="ref-overlay" aria-hidden="true"></canvas></div>` : '<p>元の動画がありません。</p>'}<p class="fineprint">${shotLabels[result.referenceMeta.shotType]} / ${cameraLabels[result.referenceMeta.cameraAngle]}</p></div><div><h3>NEW SHOT</h3><p class="filename">${escape(result.newTitle)}</p>${newVideo ? `<div class="video-wrap"><video id="new-player" controls playsinline src="${url(newVideo.blob)}"></video><canvas id="new-overlay" aria-hidden="true"></canvas></div>` : '<p>元の動画がありません。</p>'}<p class="fineprint">${shotLabels[result.newMeta.shotType]} / ${cameraLabels[result.newMeta.cameraAngle]}</p></div></div>
    <div class="sync-controls"><button class="primary" id="sync"${!goodVideo || !newVideo ? ' disabled' : ''}>リリースを合わせて同時再生</button><button class="secondary" id="pause">両方を停止</button><label>再生速度 <select id="speed"><option value="1">1倍</option><option value="0.5" selected>0.5倍</option><option value="0.25">0.25倍</option></select></label><label><input id="show-ball" type="checkbox" checked> ボール軌道を表示</label><label><input id="show-pose" type="checkbox" checked> 推定姿勢を表示</label></div><p class="fineprint">指定したリリース時刻をそろえ、両動画の区間が重なる範囲を同時再生します。骨格は近い分析フレームの推定結果です。点線は検出確度の低い関節を表します。</p>
    <div class="feedback-grid"><article><p class="eyebrow">WHAT’S WORKING</p><h3>近いところ</h3><p>${escape(feedback.working)}</p></article><article><p class="eyebrow">MAIN DIFFERENCE</p><h3>主な違い</h3><p>${escape(feedback.difference)}</p></article><article class="focus-card"><p class="eyebrow">NEXT SHOT FOCUS</p><h3>次の1本で意識すること</h3><ol>${feedback.focus.map(f => `<li>${escape(f)}</li>`).join('')}</ol></article></div>
    <details class="metric-details"><summary>計測値と採点の根拠</summary><p class="instruction">各指標の一致度 = max(0, 100 × (1 − |今回 − Good Form| ÷ 許容差))。各分類内で指標の重み付き平均を計算し、総合点は分類の重み付き平均です。対象外の項目は重みを除き再配分します。値が高いほど良いという意味ではありません。</p><p class="fineprint">分析版：${escape(comparison.version)} · Good Form検出率 ${Math.round(result.referenceAnalysis.coverage * 100)}% / 今回 ${Math.round(result.newAnalysis.coverage * 100)}% · 12フレーム/秒。基準の重み：下半身20%・バランス20%・肘20%・リリース25%・フォロースルー15%。</p>
    <div class="table-scroll"><table><thead><tr><th>指標</th><th>Good Form</th><th>今回</th><th>差</th><th>許容差 / 重み</th><th>一致度 / 除外理由</th></tr></thead><tbody>${comparison.metrics.map(m => `<tr><td>${m.label}<small>${m.unit}</small></td><td>${format(m.refValue)}</td><td>${format(m.value)}</td><td>${format(m.delta)}</td><td>${m.tolerance} / ${m.weight}</td><td>${m.excluded ? escape(m.excluded) : `${Math.round(m.score)}%`}</td></tr>`).join('')}</tbody></table></div></details>
    <p class="fineprint">助言は計測差から生成するルールベースのフィードバックです。医療・生体力学的な精度や、コーチの判断を代替するものではありません。映像と照らし合わせて確認してください。</p></section>`;
  screen.querySelector('section').insertAdjacentHTML('afterbegin',`<button class="secondary" data-open-review="${escape(result.reviewCaseId??`single:${result.id}`)}">Shot Review · ラベルと指導コメント</button>`);
  if(goodVideo&&newVideo)setupComparison(result);
}
function renderOutcome(outcome){return `<div class="shot-outcome"><h3>シュートの成否：${escape(outcome?.label??'旧結果・再分析すると利用できます')}</h3><p>${escape(outcome?.reason??'')}</p></div>`;}
function renderCheckpointReview(review) {
  const badge = part => part.status === 'unrated' ? '未評価・仮置き' : '推定・参考評価';
  const partHtml = part => `<li><div class="check-part-heading"><strong>${escape(part.label)}</strong><span>${part.score}/100 · ${badge(part)}</span></div><p>${escape(part.comment)}</p><p class="fineprint">${escape(part.source)}${part.note ? ' · ' + escape(part.note) : ''}</p>${part.target && Number.isFinite(part.value) ? `<p class="fineprint">計測値 ${part.value.toFixed(3)} ${escape(part.target.unit)} / 目標 ${part.target.min}〜${part.target.max} / 許容差 ${part.target.tolerance}</p>` : ''}</li>`;
  return `<section class="checkpoint-section" aria-label="シュートの確認ポイント評価"><div class="panel-heading"><div><p class="eyebrow">PERSONAL SHOOTING CHECKPOINTS</p><h2>確認ポイントの評価</h2></div><div class="checkpoint-total"><strong>${review.overall}<small>/100</small></strong><span>${review.status === 'unrated' ? '未評価・仮置き50' : '指定目標への推定スコア'}</span></div></div>
    <p class="instruction">鼻付近のリリースと姿勢など、指定された目標への参考評価です。下のGood Form一致度とは別のスコアです。</p>
    <p class="warning">推定結果です。未評価の50点は便宜上の仮置きで、映像から推定した数値でも「平均的」という評価でもありません。未評価項目は総合点に含めません。</p>
    <div class="mandatory-grid">${review.mandatory.map(part => `<article class="mandatory-card ${part.status === 'unrated' ? 'unrated' : ''}"><p class="eyebrow">必須チェック</p><h3>${escape(part.label)}</h3><strong>${part.score}<small>/100</small></strong><span class="check-status">${badge(part)}</span><p>${escape(part.comment)}</p><p class="fineprint">${escape(part.note ?? part.source)}</p></article>`).join('')}</div>
    ${review.issues.length ? `<div class="checkpoint-focus"><h3>指定した目標との主な違い</h3><ul>${review.issues.slice(0,2).map(issue => `<li>${escape(issue.comment)}</li>`).join('')}</ul><p class="fineprint">上の推定を動画のリリース位置で確認し、1〜2点に絞って練習してください。</p></div>` : `<p class="instruction">${review.status === 'unrated' ? '映像から良い・悪いを判定できませんでした。下の比較再生で確認してください。' : '計測できた項目は指定した目標に近い範囲です。未評価の項目が適切だと確認できたわけではありません。'}</p>`}
    <div class="checkpoint-grid">${review.checks.map(check => `<article class="checkpoint-card"><div class="check-card-heading"><h3>${escape(check.label)}</h3><strong>${check.score}<small>/100</small></strong></div><p class="check-status">${badge(check)}${check.partial ? ' · 一部は未評価' : ''}</p><p>${escape(check.comment)}</p><details><summary>項目別のスコア・理由</summary><ul class="check-parts">${check.parts.map(partHtml).join('')}</ul></details></article>`).join('')}</div>
    <details class="metric-details"><summary>このチェック評価の採点方法</summary><p class="instruction">計測できた値が指定の目標範囲にあれば100点。範囲からの距離を許容差で割り、100 × (1 − 範囲外の距離 / 許容差)、最低0点で計算します。S字は手首の軌道に両方向の曲がりがあれば85点、確認できなければ60点という仮のルールです。各項目は評価できた小項目の平均です。総合は鼻・リリースと足幅・腰の分類を重み3、その他を1にして平均します。仮置き50点は平均に含めません。${review.evaluatedCount} / 8分類を代用指標で評価。基準は利用者指定の目標で、検証済みの競技標準ではありません。</p><p class="fineprint">評価版：${escape(review.version)}。筋肉の力み、腰椎の反り、手の接触、中指・ボールの軌道は直接測っていません。</p></details>
    <hr class="check-divider"></section>`;
}
function format(value) { return Number.isFinite(value) ? value.toFixed(2) : '—'; }
function setupComparison(result) {
  const ref = document.querySelector('#ref-player'), next = document.querySelector('#new-player');
  const players = [ref, next], analyses = [result.referenceAnalysis, result.newAnalysis];
  let syncing = false, raf, starting = false, correcting = false, disposed = false;
  const before = Math.min(...analyses.map(a => a.phases.release - a.phases.start));
  const after = Math.min(...analyses.map(a => a.phases.end - a.phases.release));
  const starts = analyses.map(a => a.phases.release - before);
  const ends = analyses.map(a => a.phases.release + after);
  players.forEach(v => v.playbackRate = 0.5);
  function stop() { syncing = false; players.forEach(v => v.pause()); }
  const pairs = POSE_CONNECTIONS;
  function overlay(player, canvas, analysis) {
    const width = player.clientWidth, height = player.clientHeight;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, width, height);
    if (!player.videoWidth) return;
    const {width:vw,height:vh,x,y}=videoTransform(player.videoWidth,player.videoHeight,width,height);
    if(analysis.hoop){const h=analysis.hoop;ctx.strokeStyle='#59e5f7';ctx.lineWidth=2;ctx.setLineDash([]);ctx.strokeRect(x({x:h.x-h.width/2}),y({y:h.y-h.height/2}),h.width*vw,h.height*vh);}
    if (document.querySelector('#show-ball').checked) {
      const points = (analysis.flightTracking?.points ?? analysis.ballTracking?.points ?? []).filter(p => p.time <= player.currentTime + 0.04 && p.time >= player.currentTime - 0.7);
      ctx.strokeStyle = '#59e5f7'; ctx.lineWidth = 2; ctx.setLineDash([]);
      for (let i=1;i<points.length;i++) { const a=points[i-1],b=points[i]; if(b.trackId!==a.trackId || b.time-a.time>0.2) continue; ctx.beginPath();ctx.moveTo(x(a),y(a));ctx.lineTo(x(b),y(b));ctx.stroke(); }
      const nearest=(analysis.flightTracking?.points ?? analysis.ballTracking?.points ?? []).reduce((best,p)=>!best||Math.abs(p.time-player.currentTime)<Math.abs(best.time-player.currentTime)?p:best,null);
      if(nearest && Math.abs(nearest.time-player.currentTime)<0.12){ctx.beginPath();ctx.arc(x(nearest),y(nearest),nearest.radius*vh,0,Math.PI*2);ctx.stroke();}
    }
    const frame = analysis.frames.reduce((best, f) => Math.abs(f.time - player.currentTime) < Math.abs(best.time - player.currentTime) ? f : best, analysis.frames[0]);
    if (!document.querySelector('#show-pose').checked || !frame?.landmarks || Math.abs(frame.time - player.currentTime) > 0.12) return;
    ctx.strokeStyle = '#daf571'; ctx.fillStyle = '#daf571'; ctx.lineWidth = 2;
    for (const [i,j] of pairs) { const a = frame.landmarks[i], b = frame.landmarks[j]; if ((a?.visibility ?? 0) < 0.2 || (b?.visibility ?? 0) < 0.2) continue; ctx.setLineDash(Math.min(a.visibility, b.visibility) < 0.55 ? [4,4] : []); ctx.beginPath(); ctx.moveTo(x(a), y(a)); ctx.lineTo(x(b), y(b)); ctx.stroke(); }
    for (const p of frame.landmarks.slice(11,29)) if (p.visibility >= 0.2) { ctx.beginPath(); ctx.arc(x(p),y(p),3,0,Math.PI*2); ctx.fill(); }
  }
  function tick() {
    if (syncing && !correcting) {
      if (ref.currentTime >= ends[0] || next.currentTime >= ends[1] || ref.ended || next.ended) stop();
      else {
        const target = ref.currentTime - analyses[0].phases.release + analyses[1].phases.release;
        if (Math.abs(next.currentTime - target) > 0.15) { correcting = true; seekVideo(next, target).catch(() => { stop(); }).finally(() => { correcting = false; }); }
      }
    }
    overlay(ref, document.querySelector('#ref-overlay'), analyses[0]); overlay(next, document.querySelector('#new-overlay'), analyses[1]);
    raf = requestAnimationFrame(tick);
  }
  document.querySelector('#sync').onclick = async () => {
    if (starting) return; starting = true; stop();
    try { await Promise.all(players.map((v,i) => seekVideo(v, starts[i]))); if (disposed) return; syncing = true; await Promise.all(players.map(v => v.play())); }
    catch { stop(); message('同時再生できませんでした。動画を個別に再生してから再試行してください。', true); }
    finally { starting = false; }
  };
  document.querySelector('#pause').onclick = stop;
  document.querySelector('#speed').onchange = event => players.forEach(v => v.playbackRate = Number(event.target.value));
  players.forEach(v => { v.addEventListener('pause', () => { if (syncing) stop(); }); v.addEventListener('seeking', () => { if (syncing && !correcting) stop(); }); v.addEventListener('error', () => message('動画を再生できません。対応したブラウザで開いてください。', true)); });
  tick(); cleanup = () => { disposed = true; stop(); cancelAnimationFrame(raf); };
}
function sessionHistory(){
  return `<section class="panel"><h2>Session履歴</h2>${sessions.length?sessions.map(s=>`<p>${date(s.createdAt)} · ${escape(s.title)} · ${s.shots.length}本 <button class="secondary" data-session="${escape(s.id)}">Sessionを見る</button> <button class="delete" data-delete-session="${escape(s.id)}">削除</button></p>`).join(''):'<p>Sessionの分析結果はここに保存されます。</p>'}</section>`;
}
function bindSessionLinks(){
  screen.querySelectorAll('[data-session]').forEach(b=>b.onclick=()=>{activeSession=b.dataset.session;navigate('session');});
  screen.querySelectorAll('[data-delete-session]').forEach(b=>b.onclick=async()=>{
    if(!confirm('このSession結果を削除しますか？動画は残ります。'))return;
    try{const next=sessions.filter(s=>s.id!==b.dataset.deleteSession);await setSetting('sessions',next);sessions=next;render();}catch{message('Session履歴を削除できませんでした。',true);}
  });
}
function renderSession(){
  const good=reference();
  const saved=sessions.find(s=>s.id===activeSession);
  if(saved){renderSessionSummary(saved);return;}
  if(!good?.analysis){screen.innerHTML='<section class="panel"><h2>Session</h2><p>まずGood Formで基準のシュートを登録してください。</p><button class="primary" id="session-good">Good Form</button></section>';document.querySelector('#session-good').onclick=()=>navigate('good');return;}
  screen.innerHTML=`<section class="panel"><p class="eyebrow">SESSION · MULTIPLE SHOTS</p><h2>練習動画を分析</h2><p>長い動画からシュート候補を検出し、1本ずつSingle Shotと同じエンジンでGood Formと比較します。</p><p class="instruction">10分以内・1人の練習動画向けです。12フレーム/秒で全体を走査してから各候補を再分析するため、処理に時間がかかります。シュートの見逃しや誤検出があります。ゴール位置を指定すると、ボール軌道から成否を参考推定します。</p><label class="upload">＋ 練習動画を選ぶ<input id="session-upload" type="file" accept="video/*"></label><label class="field">保存済みの練習動画<select id="session-existing"><option value="">動画を選択</option>${videos.map(v=>`<option value="${escape(v.id)}">${escape(v.title)}</option>`).join('')}</select></label><p id="session-filename"></p><video id="session-preview" controls playsinline hidden></video><form id="session-form"><div id="session-hoop-controls"></div><label class="field">シュート種別<select id="session-type">${options(shotLabels,good.shotType)}</select></label><label class="field">撮影角度<select id="session-angle">${options(cameraLabels,good.cameraAngle)}</select></label><label class="field">シュートする手<select id="session-hand"><option value="right"${good.hand==='right'?' selected':''}>右手</option><option value="left"${good.hand==='left'?' selected':''}>左手</option></select></label><button class="primary" id="session-run" disabled>Sessionを分析</button><div id="session-progress-area" hidden><progress id="session-progress" max="100"></progress><p id="session-progress-text" role="status"></p><button class="secondary" type="button" id="session-cancel">キャンセル</button></div></form><p class="fineprint">ボール離れ、または手首上昇・肘伸展を候補にします。無検出時は架空のシュートを生成しません。Single Shotでは手動指定・低精度の分析も引き続き利用できます。</p></section>`;
  const player=document.querySelector('#session-preview'),upload=document.querySelector('#session-upload'),run=document.querySelector('#session-run');let file;
  const sessionHoop=mountHoopSelector(document.querySelector('#session-hoop-controls'),player);
  upload.onchange=()=>{file=upload.files[0];if(!file)return;sessionHoop.reset(null);run.disabled=true;player.hidden=false;player.src=url(file);player.load();document.querySelector('#session-filename').textContent=file.name;};
  document.querySelector('#session-existing').onchange=event=>{const video=videos.find(v=>v.id===event.target.value);if(!video)return;sessionHoop.reset(video.hoop);file=new File([video.blob],video.title,{type:video.blob.type});run.disabled=true;player.hidden=false;player.src=url(file);player.load();document.querySelector('#session-filename').textContent=video.title;};
  player.onloadeddata=()=>{run.disabled=!Number.isFinite(player.duration)||player.duration<=0||player.duration>600;if(run.disabled)message('10分以内の再生可能な動画を選んでください。',true);};
  player.onerror=()=>{run.disabled=true;message('この動画を再生できません。MP4（H.264）またはWebMをお試しください。',true);};
  document.querySelector('#session-form').onsubmit=async event=>{
    event.preventDefault();if(busy||!file)return;
    const meta={shotType:document.querySelector('#session-type').value,cameraAngle:document.querySelector('#session-angle').value,hand:document.querySelector('#session-hand').value,goalDirection:'unknown',hoop:sessionHoop.value()};
    busy=true;controller=new AbortController();const signal=controller.signal;let completed=false;
    const controls=[...screen.querySelectorAll('input,select,button')].filter(c=>c.id!=='session-cancel');controls.forEach(c=>c.disabled=true);document.querySelectorAll('[data-page]').forEach(c=>c.disabled=true);player.controls=false;
    document.querySelector('#session-progress-area').hidden=false;document.querySelector('#session-cancel').onclick=()=>controller.abort();
    const progress=(text,value)=>{document.querySelector('#session-progress-text').textContent=text;document.querySelector('#session-progress').value=value;};
    try{
      const scan=await analyzeVideo(player,null,meta.hand,(text,value)=>progress(`全体の検出：${text}`,value*0.5),signal,true,{session:true});
      const candidates=detectSessionWithAdapter(scan.frames,meta.hand,scan.aspect,scan.range),shots=[];
      for(let i=0;i<candidates.length;i++){
        const detection=candidates[i];
        // Re-run the exact Single Shot analyzer on each window, with fresh model state.
        const analysis=await analyzeVideo(player,detection.phases,meta.hand,(text,value)=>progress(`Shot #${i+1}/${candidates.length}：${text}`,50+45*(i+value/100)/candidates.length),signal,true,{detection,hoop:meta.hoop,outcomeEnd:candidates[i+1]?.phases.start});
        const review=reviewShot(good.analysis,analysis,good,meta);shots.push({number:i+1,newAnalysis:analysis,...review,scoreVersion:review.comparison.version,goodFormReferenceId:good.id});
      }
      if(signal.aborted)throw new DOMException('キャンセル','AbortError');
      const video={id:crypto.randomUUID(),blob:file,title:file.name,notes:'',createdAt:Date.now(),...meta,mode:'session'};
      const session={id:crypto.randomUUID(),videoId:video.id,title:file.name,referenceVideoId:good.id,referenceTitle:good.title,referenceAnalysis:good.analysis,referenceMeta:{shotType:good.shotType,cameraAngle:good.cameraAngle,hand:good.hand},metadata:meta,shots,summary:summarizeSession(shots),createdAt:Date.now()};
      await commitSession(video,[session,...sessions]);videos.unshift(video);sessions.unshift(session);activeSession=session.id;completed=true;
    }catch(error){message(error.name==='AbortError'?'分析をキャンセルしました。結果は保存していません。':error.name==='QuotaExceededError'?'保存容量が不足しています。不要な記録を削除してください。':error.message,true);}
    finally{busy=false;controller=null;document.querySelectorAll('[data-page]').forEach(c=>c.disabled=false);if(completed)render();else{controls.forEach(c=>c.disabled=false);player.controls=true;document.querySelector('#session-progress-area').hidden=true;}}
  };
}
function renderSessionSummary(session){
  const summary=summarizeSession(session.shots);
  const sessionVideo=videos.find(v=>v.id===session.videoId);
  const percent=value=>Number.isFinite(value)?`${value.toFixed(1)}%`:'未算出';
  screen.innerHTML=`<section class="panel"><div class="panel-heading"><div><p class="eyebrow">SESSION SUMMARY</p><h2>${escape(session.title)}</h2></div><button class="secondary" id="new-session">別のSessionを分析</button><button class="secondary" id="reanalyze-session"${sessionVideo?'':' disabled'}>この動画を再分析</button></div><p>Good Form：${escape(session.referenceTitle)} · ${date(session.createdAt)}</p><div class="metric-grid"><article class="metric-card"><h3>集計対象の候補</h3><strong>${summary.count}本</strong><p>採点可能 ${summary.scoredCount}本</p></article><article class="metric-card"><h3>平均 Form Match</h3><strong>${percent(summary.average)}</strong></article><article class="metric-card"><h3>最高 Form Match</h3><strong>${percent(summary.best)}</strong></article><article class="metric-card"><h3>後半 − 前半</h3><strong>${Number.isFinite(summary.change)?`${summary.change>0?'+':''}${summary.change.toFixed(1)}pt`:'未算出'}</strong><p>本数で前半・後半を分けた平均の差</p></article></div><p class="warning">候補の検出・リリース時刻は推定です。実際に打った本数とは異なる場合があります。「この1本を再生」で確認し、シュート以外は集計から除外できます。精度低のスコアも参考値として含み、未算出は平均から除きます。</p>${session.shots.length?`<div class="session-playback"><h3 id="session-shot-label">候補の「この1本を再生」を押してください</h3>${sessionVideo?`<div class="video-wrap"><video id="session-shot-player" controls playsinline preload="metadata" src="${url(sessionVideo.blob)}" hidden></video><canvas id="session-flight-overlay" aria-hidden="true"></canvas></div><div class="sync-controls"><button class="secondary" id="shot-replay" disabled>この1本をもう一度</button><button class="secondary" id="shot-release" disabled>リリース候補で停止</button><label>再生速度 <select id="shot-play-speed"><option value="1">1倍</option><option value="0.5">0.5倍</option><option value="0.25">0.25倍</option></select></label></div><p class="fineprint">選んだ候補の開始位置から再生し、終了位置で自動停止します。成否推定を行った候補は、ボール追跡の終了位置まで再生します。水色の枠が指定ゴール、輪と線が検出できたボールです。再生する動画は保存済みの練習動画です。</p>`:'<p>元の練習動画がありません。</p>'}</div><div class="table-scroll"><table><thead><tr><th>集計</th><th>候補</th><th>リリース候補</th><th>Form Match</th><th>信頼度</th><th>成否推定</th><th>結果</th></tr></thead><tbody>${session.shots.map((s,i)=>`<tr class="${s.excluded?'excluded-shot':''}"><td><label><input type="checkbox" data-include-shot="${i}"${s.excluded?'':' checked'}> 対象</label></td><td>#${s.number}</td><td>${s.newAnalysis.phases.release.toFixed(2)}秒 · ${s.newAnalysis.phaseSource==='ball'?'ボール':'姿勢推定'}</td><td>${percent(s.comparison.overall)}</td><td>${confidenceLabels[s.comparison.confidence]}</td><td>${escape(s.newAnalysis.outcome?.label??'旧結果・再分析')}<small>${escape(s.newAnalysis.outcome?.reason??'')}</small></td><td><button class="primary" data-play-session-shot="${i}"${sessionVideo?'':' disabled'}>この1本を再生</button> <button class="secondary" data-open-review="session:${escape(session.id)}:${s.number}">Shot Review</button> <button class="secondary" data-session-shot="${i}">詳細・比較再生</button></td></tr>`).join('')}</tbody></table></div><p class="fineprint">各行を時系列に並べたスコア推移です。撮影条件や検出精度が変わると点数も変わります。</p>`:'<p>シュート候補を検出できませんでした。Single Shotで区間を指定して分析するか、撮影条件を変えて再試行してください。</p>'}</section>`;
  document.querySelector('#new-session').onclick=()=>{activeSession=null;render();};
  document.querySelector('#reanalyze-session').onclick=()=>{
    activeSession=null;render();
    document.querySelector('#session-existing').value=session.videoId;
    document.querySelector('#session-existing').dispatchEvent(new Event('change'));
    document.querySelector('#session-type').value=session.metadata.shotType;document.querySelector('#session-angle').value=session.metadata.cameraAngle;document.querySelector('#session-hand').value=session.metadata.hand;
  };
  const player=document.querySelector('#session-shot-player');
  if(player){
    const playback=setupShotPlayback(player,seekVideo,shot=>{document.querySelector('#session-shot-label').textContent=`候補 #${shot.number}：${shot.start.toFixed(2)}〜${shot.end.toFixed(2)}秒（リリース候補 ${shot.release.toFixed(2)}秒）`;document.querySelector('#shot-replay').disabled=false;document.querySelector('#shot-release').disabled=false;},error=>message(error.message||'再生できませんでした。',true),(video,shot)=>drawFlightOverlay(video,document.querySelector('#session-flight-overlay'),shot?.analysis));
    screen.querySelectorAll('[data-play-session-shot]').forEach(b=>b.onclick=()=>{const shot=session.shots[Number(b.dataset.playSessionShot)];void playback.select({...shot.newAnalysis.phases,end:shot.newAnalysis.flightTracking?.range.end??shot.newAnalysis.phases.end,number:shot.number,analysis:shot.newAnalysis});});
    document.querySelector('#shot-replay').onclick=()=>void playback.replay();document.querySelector('#shot-release').onclick=()=>void playback.release();
    document.querySelector('#shot-play-speed').onchange=event=>player.playbackRate=Number(event.target.value);
    cleanup=()=>playback.dispose();
  }
  screen.querySelectorAll('[data-include-shot]').forEach(input=>input.onchange=async()=>{
    if(busy)return;busy=true;
    const index=Number(input.dataset.includeShot),excluded=!input.checked;screen.querySelectorAll('[data-include-shot]').forEach(c=>c.disabled=true);
    const shots=session.shots.map((shot,i)=>i===index?{...shot,excluded}:shot);
    const updated={...session,shots,summary:summarizeSession(shots)};
    const next=sessions.map(s=>s.id===session.id?updated:s);
    try{await setSetting('sessions',next);sessions=next;render();}catch{input.checked=!excluded;screen.querySelectorAll('[data-include-shot]').forEach(c=>c.disabled=false);message('集計対象の変更を保存できませんでした。',true);}finally{busy=false;}
  });
  screen.querySelectorAll('[data-session-shot]').forEach(b=>b.onclick=()=>{
    const shot=session.shots[Number(b.dataset.sessionShot)];
    const transient={...shot,id:`session-${session.id}-${shot.number}`,reviewCaseId:`session:${session.id}:${shot.number}`,referenceVideoId:session.referenceVideoId,newVideoId:session.videoId,referenceTitle:session.referenceTitle,newTitle:`${session.title} / Shot #${shot.number}`,referenceMeta:session.referenceMeta,newMeta:session.metadata,referenceAnalysis:session.referenceAnalysis,createdAt:session.createdAt};
    sessionShotResult=transient;activeResult=transient.id;navigate('results');
  });
}
function renderHistory() {
  screen.innerHTML = `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">YOUR TRAINING RECORDS</p><h2>分析履歴</h2></div><span class="badge">${results.length} 件</span></div>${!results.length ? '<p class="instruction">新しいシュートを分析すると、ここに記録されます。</p>' : `<div class="table-scroll"><table><thead><tr><th>日時・動画</th><th>シュート種別</th><th>Form Match</th><th>信頼度</th><th>操作</th></tr></thead><tbody>${results.map(r => `<tr><td>${date(r.createdAt)}<small>${escape(r.newTitle)}</small></td><td>${shotLabels[r.newMeta.shotType]}</td><td>${r.comparison.overall === null ? '—' : `${r.comparison.overall}%`}</td><td>${confidenceLabels[r.comparison.confidence]}</td><td><button class="secondary" data-result="${r.id}">結果を見る</button> <button class="delete" data-delete-result="${r.id}">削除</button></td></tr>`).join('')}</tbody></table></div>`}<p class="fineprint">履歴は分析時点の基準と計測値を保存します。別のGood Form・撮影角度・分析版の点数は、そのまま比較しないでください。</p></section>`;
  screen.insertAdjacentHTML('beforeend', sessionHistory());
  screen.insertAdjacentHTML('beforeend',`<section class="panel"><h2>Live Coach履歴</h2>${coachSessions.map(s=>`<p>${date(s.createdAt)} · ${escape(s.goodFormReference.title)} · ${s.shots.length}本 <button class="secondary" data-coach="${s.id}">まとめを見る</button> <button class="delete" data-delete-coach="${s.id}">削除</button></p>`).join('')||'<p>まだ記録がありません。</p>'}</section>`);
  screen.querySelectorAll('[data-coach]').forEach(b=>b.onclick=()=>{clearScreen();screen.innerHTML=coachSummaryHTML(coachSessions.find(s=>s.id===b.dataset.coach));});
  screen.querySelectorAll('[data-delete-coach]').forEach(b=>b.onclick=async()=>{if(!confirm('このLive Coach履歴を削除しますか？'))return;try{await deleteResult(b.dataset.deleteCoach);coachSessions=coachSessions.filter(s=>s.id!==b.dataset.deleteCoach);render();}catch{message('Live Coach履歴を削除できませんでした。',true);}});
  bindSessionLinks();
  screen.querySelectorAll('[data-result]').forEach(b => b.onclick = () => { activeResult = b.dataset.result; navigate('results'); });
  screen.querySelectorAll('[data-delete-result]').forEach(b => b.onclick = async () => {
    if (!confirm('この分析結果を削除しますか？動画は残ります。')) return;
    try { await deleteResult(b.dataset.deleteResult); results = results.filter(r => r.id !== b.dataset.deleteResult); render(); }
    catch { message('履歴を削除できませんでした。', true); }
  });
}
function renderLibrary() {
  screen.innerHTML = `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">VIDEOS & NOTES</p><h2>保存済み動画・メモ</h2></div><span class="badge">${videos.length} 本</span></div><p class="instruction">取り込んだGood Form・Single Shot・Sessionの元動画を再生し、メモを編集できます。Live Coachの一時動画はShot Reviewで管理します。Good Formや分析画面で、保存済みの動画を選ぶこともできます。</p><div class="library-layout"><div id="video-list">${videos.map(v => `<button class="video-item" data-video="${v.id}"><span class="video-icon">▷</span><span><strong>${escape(v.title)}</strong><small>${date(v.createdAt)}${v.id === referenceId ? ' · Good Form' : ''}</small></span></button>`).join('')}</div><div id="library-detail"><p class="instruction">動画を選んでください。</p></div></div></section>`;
  screen.querySelectorAll('[data-video]').forEach(b => b.onclick = () => {
    if (noteDirty && !confirm('未保存のメモを破棄しますか？')) return;
    noteDirty = false;
    const video = videos.find(v => v.id === b.dataset.video);
    const panel = document.querySelector('#library-detail'); panel.querySelector('video')?.pause();
    panel.innerHTML = `<h3>${escape(video.title)}</h3><video controls playsinline src="${url(video.blob)}"></video><label class="field">メモ<textarea id="library-notes" rows="5">${escape(video.notes)}</textarea></label><button id="save-notes" class="primary">メモを保存</button> <button id="delete-video" class="delete">動画を削除</button>`;
    const notes = document.querySelector('#library-notes'); notes.oninput = () => noteDirty = notes.value !== video.notes;
    document.querySelector('#save-notes').onclick = async () => {
      const updated = { ...video, notes: notes.value };
      try { await saveVideo(updated); Object.assign(video, updated); noteDirty = notes.value !== video.notes; message('メモを保存しました。'); }
      catch { message('メモを保存できませんでした。', true); }
    };
    document.querySelector('#delete-video').onclick = async () => {
      if (video.id === referenceId || results.some(r => r.newVideoId === video.id || r.referenceVideoId === video.id) || sessions.some(s=>s.videoId===video.id||s.referenceVideoId===video.id) || coachSessions.some(s=>s.goodFormReference.id===video.id)) { message('この動画はGood Formまたは分析履歴で使用中です。基準を変更し、関連する履歴を削除してから動画を削除できます。', true); return; }
      if (!confirm('この動画とメモを削除しますか？取り消せません。')) return;
      try { await deleteVideo(video.id); videos = videos.filter(v => v.id !== video.id); render(); message('動画を削除しました。'); }
      catch { message('動画を削除できませんでした。', true); }
    };
  });
}
document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => navigate(button.dataset.page));
window.addEventListener('beforeunload', event => { if (busy || noteDirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { controller?.abort(); cleanup(); });
try {
  const [savedVideos, savedResults, savedReference, savedSessions, savedReview] = await Promise.all([listVideos(), listResults(), getSetting('referenceId'), getSetting('sessions'), getSetting('review-v04')]);
  reviewData=savedReview?.value??emptyReviewData();
  await expireTemporaryVideos();
  videos = savedVideos.sort((a,b) => b.createdAt - a.createdAt); coachSessions=savedResults.filter(r=>r.kind==='live-coach').sort((a,b)=>b.createdAt-a.createdAt); results = savedResults.filter(r=>r.kind!=='live-coach').sort((a,b) => b.createdAt - a.createdAt); referenceId = savedReference?.value ?? null; sessions=savedSessions?.value ?? []; render();
} catch (error) {
  screen.innerHTML = '<div class="panel empty"><h2>ブラウザの保存機能を利用できません</h2><p>別のタブを閉じ、通常のブラウザウィンドウで開き直してください。</p></div>';
  document.querySelectorAll('[data-page]').forEach(b => b.disabled = true); message(error.message, true);
}
