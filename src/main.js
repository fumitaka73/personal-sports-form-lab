import './style.css';
import { listVideos, listResults, getSetting, saveVideo, deleteVideo, deleteResult, commitAnalysis } from './storage.js';
import { analyzeVideo, seekVideo } from './pose.js';
import { compareAnalyses, validatePhases } from './metrics.js';
import { generateFeedback } from './feedback.js';
import { evaluateCheckpoints } from './checkpoints.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const date = value => new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const shotLabels = { jump: 'ジャンプシュート', set: 'セットシュート', free: 'フリースロー' };
const cameraLabels = { front: '正面', side: '横', diagonal: '45度' };
const confidenceLabels = { High: '高（High）', Medium: '中（Medium）', Low: '低（精度低・Low）' };
let videos = [], results = [], referenceId = null, activePage = 'good', activeResult = null;
let urls = [], cleanup = () => {}, controller = null, busy = false, noteDirty = false;
const app = document.querySelector('#app');
app.innerHTML = `<header><a class="brand" href="./"><span class="brand-mark">↗</span> SPORTS FORM LAB</a><span class="header-label">BASKETBALL · PERSONAL BASELINE</span></header>
<main><section class="intro"><div><p class="eyebrow">BASKETBALL SHOOTING / VERSION 0.5</p><h1>いいフォームを、<br>次のシュートへ。</h1><p class="lead">自分のGood Formと比較して、次に意識することを見つける。</p></div><div class="intro-aside"><span class="circle">↗</span><p>YOUR FORM. YOUR REFERENCE.</p></div></section>
<nav class="tabs" aria-label="画面選択"><button data-page="good">01 Good Form</button><button data-page="analyze">02 新しいシュート</button><button data-page="results">03 比較結果</button><button data-page="history">履歴</button><button data-page="library">動画・メモ</button></nav>
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
  else if (activePage === 'results') renderResult();
  else if (activePage === 'history') renderHistory();
  else renderLibrary();
}
const reference = () => videos.find(v => v.id === referenceId);
const videoAnalysisLabel = () => reference()?.analysis?.lowQuality ? '（精度低の参考分析）' : '';
const options = (values, selected) => Object.entries(values).map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');
function renderUpload(isReference) {
  const good = reference();
  if (!isReference && !good?.analysis) {
    screen.innerHTML = `<div class="panel empty"><span class="empty-icon">01</span><h2>まずGood Formを登録しましょう。</h2><p>コーチが評価した自分のシュート動画を、比較の基準にします。</p><button class="primary" id="go-good">Good Formを登録</button></div>`;
    document.querySelector('#go-good').onclick = () => navigate('good'); return;
  }
  screen.innerHTML = `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">${isReference ? 'YOUR PERSONAL BASELINE' : 'COMPARE YOUR NEXT SHOT'}</p><h2>${isReference ? 'Good Formを登録' : '新しいシュートを分析'}</h2></div><span class="badge">ローカル分析</span></div>
    ${good ? `<p class="reference-summary">現在のGood Form：<strong>${escape(good.title)}</strong> · ${shotLabels[good.shotType]} / ${cameraLabels[good.cameraAngle]}${good.analysis?.lowQuality ? ' · 精度低（登録済み）' : ''}</p>${isReference ? (good.analysis?.warnings ?? []).map(w => `<p class="warning">${escape(w)}</p>`).join('') : ''}` : ''}
    <p class="instruction">撮影角度が違う動画や、一部の関節が見えにくい動画も受け付けます。検出できた範囲で分析し、条件が悪い場合は「精度低」と表示します。同じカメラ位置で1人のシュートを撮ると比較しやすくなります。</p>
    <div class="upload-layout"><div><label class="upload" for="upload">＋ ${isReference ? 'Good Formの動画を選ぶ' : '新しい動画を選ぶ'}<input id="upload" type="file" accept="video/*"></label><p class="upload-hint">MP4（H.264）/ WebM推奨 · 保存できる容量はブラウザによります</p>
    <label class="field">保存済みの動画から選ぶ<select id="existing"><option value="">動画を選択</option>${videos.map(v => `<option value="${escape(v.id)}">${escape(v.title)}</option>`).join('')}</select></label>
    <p id="file-name" class="filename"></p><video id="preview" controls playsinline preload="auto" hidden></video>
    <p id="video-error" class="error" role="alert" hidden>この形式を再生できません。MP4（H.264）またはWebMをお試しください。</p>
    <div id="phase-controls" hidden><label class="auto-setting"><input id="auto-phases" type="checkbox" checked> 開始・リリース・終了を自動設定</label><p class="instruction">分析ボタンを押すと、先頭30秒以内からボール離れ候補・姿勢の動きを探します。手動入力は不要です。追跡できない場合も姿勢推定または仮設定で分析を続けます。</p><p id="auto-info" class="fineprint"></p><details id="manual-phases"><summary>手動で修正する（任意）</summary>
      <div class="phase-grid">${[['start', '開始'], ['release', 'リリース'], ['end', '終了']].map(([id, label]) => `<label class="field">${label}（秒）<input id="${id}" type="number" min="0" step="0.01" required><button type="button" class="secondary mark" data-mark="${id}">現在の位置を指定</button></label>`).join('')}</div>
      <button class="secondary" id="slow" type="button">0.5倍速にする</button></details></div></div>
    <form id="analysis-form"><label class="field">シュート種別<select id="shot-type">${options(shotLabels, good?.shotType ?? 'jump')}</select></label>
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
  let draft = null, phaseEstimated = true;
  function selectVideo(video) {
    draft = video; message(''); preview.hidden = false;
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
      const analysis = await analyzeVideo(preview, phases, metadata.hand, onProgress, signal, phaseEstimated, { autoPhases });
      if (signal.aborted) throw new DOMException('キャンセル', 'AbortError');
      const video = { ...draft, ...metadata, notes, analysis, updatedAt: Date.now() };
      let result;
      if (!isReference) {
        onProgress('Good Formと比較し、計測値からフィードバックを生成しています', 95);
        const comparison = compareAnalyses(good.analysis, analysis, good, video);
        result = { id: crypto.randomUUID(), referenceVideoId: good.id, newVideoId: video.id, referenceTitle: good.title, newTitle: video.title, referenceMeta: { shotType: good.shotType, cameraAngle: good.cameraAngle, hand: good.hand }, newMeta: metadata, referenceAnalysis: good.analysis, newAnalysis: analysis, comparison, checkpointReview: evaluateCheckpoints(analysis, metadata, good.analysis, good), feedback: generateFeedback(comparison), createdAt: Date.now() };
      }
      await commitAnalysis(video, isReference ? video.id : referenceId, result);
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
  if (isReference && good) { existingSelect.value = good.id; selectVideo(good); }
}
function renderResult() {
  const result = results.find(r => r.id === activeResult) ?? results[0];
  if (!result) { screen.innerHTML = '<div class="panel empty"><h2>比較結果はまだありません。</h2><p>Good Formを登録して、新しいシュートを分析してください。</p></div>'; return; }
  activeResult = result.id;
  const { comparison, feedback } = result;
  const checkpointReview = result.checkpointReview ?? evaluateCheckpoints(result.newAnalysis, result.newMeta, result.referenceAnalysis, result.referenceMeta);
  const goodVideo = videos.find(v => v.id === result.referenceVideoId), newVideo = videos.find(v => v.id === result.newVideoId);
  screen.innerHTML = `<section class="panel">${renderCheckpointReview(checkpointReview)}<div class="result-top"><div><p class="eyebrow">FORM MATCH</p><div class="score">${comparison.overall ?? '—'}<span>${comparison.overall === null ? '' : '%'}</span></div><p class="instruction">自分のGood Formとの一致度。<br>シュートの絶対的な品質や成功率の点数ではありません。</p></div><div class="result-meta"><span class="badge">分析信頼度：${confidenceLabels[comparison.confidence]}</span><p>${date(result.createdAt)}<br>${shotLabels[result.newMeta.shotType]} / ${cameraLabels[result.newMeta.cameraAngle]}</p><p class="fineprint">信頼度は姿勢の検出率・比較項目数・撮影条件による目安です。</p></div></div>
    ${comparison.warnings.map(w => `<p class="warning">${escape(w)}</p>`).join('')}
    <p class="fineprint">計測できた比較項目：${comparison.usedMetricCount ?? comparison.metrics.filter(m => m.score !== null).length} / ${comparison.metrics.length}。不足する項目は採点しません。${comparison.overall === null ? ' 点数未算出でも、比較再生と履歴を利用できます。' : ''}</p><div class="metric-grid">${comparison.groups.map(g => `<article class="metric-card"><h3>${g.label}</h3><strong>${g.score === null ? '対象外' : `${Math.round(g.score)}%`}</strong><p>${g.score === null ? '比較できる指標なし' : 'Good Formへの一致度'}</p></article>`).join('')}</div>
    <div class="auto-report"><h3>自動設定・ボール追跡</h3>${[result.referenceAnalysis,result.newAnalysis].map((a,i) => `<p><strong>${i === 0 ? 'Good Form' : '今回'}</strong>：開始 ${a.phases.start.toFixed(2)}秒 / リリース ${a.phases.release.toFixed(2)}秒 / 終了 ${a.phases.end.toFixed(2)}秒<br>方法：${({ball:'ボール離れ候補',pose:'姿勢からの推定',midpoint:'区間中央の仮設定'})[a.autoDetection?.source] ?? '手動・従来の設定'}${a.autoDetection ? ' / 自動設定の信頼度：' + confidenceLabels[a.autoDetection.confidence] : ''}<br>${escape(a.autoDetection?.reason ?? '保存済み・手動または従来の仮設定')}<br>ボール追跡：${a.ballTracking?.detectedFrames ?? 0}フレーム${a.autoDetection?.releaseWindow ? ` · 離れ候補の区間 ${a.autoDetection.releaseWindow.from.toFixed(2)}〜${a.autoDetection.releaseWindow.to.toFixed(2)}秒` : ''}</p>`).join('')}<p class="fineprint">水色の輪と線は検出できたボールの位置・軌道です。見失った区間の位置は補完しません。旧履歴にボール追跡を追加するには、保存済み動画を選んで再分析してください。</p></div><div class="comparison-videos"><div><h3>GOOD FORM</h3><p class="filename">${escape(result.referenceTitle)}</p>${goodVideo ? `<div class="video-wrap"><video id="ref-player" controls playsinline src="${url(goodVideo.blob)}"></video><canvas id="ref-overlay" aria-hidden="true"></canvas></div>` : '<p>元の動画がありません。</p>'}<p class="fineprint">${shotLabels[result.referenceMeta.shotType]} / ${cameraLabels[result.referenceMeta.cameraAngle]}</p></div><div><h3>NEW SHOT</h3><p class="filename">${escape(result.newTitle)}</p>${newVideo ? `<div class="video-wrap"><video id="new-player" controls playsinline src="${url(newVideo.blob)}"></video><canvas id="new-overlay" aria-hidden="true"></canvas></div>` : '<p>元の動画がありません。</p>'}<p class="fineprint">${shotLabels[result.newMeta.shotType]} / ${cameraLabels[result.newMeta.cameraAngle]}</p></div></div>
    <div class="sync-controls"><button class="primary" id="sync"${!goodVideo || !newVideo ? ' disabled' : ''}>リリースを合わせて同時再生</button><button class="secondary" id="pause">両方を停止</button><label>再生速度 <select id="speed"><option value="1">1倍</option><option value="0.5" selected>0.5倍</option><option value="0.25">0.25倍</option></select></label><label><input id="show-ball" type="checkbox" checked> ボール軌道を表示</label><label><input id="show-pose" type="checkbox" checked> 推定姿勢を表示</label></div><p class="fineprint">指定したリリース時刻をそろえ、両動画の区間が重なる範囲を同時再生します。骨格は近い分析フレームの推定結果です。点線は検出確度の低い関節を表します。</p>
    <div class="feedback-grid"><article><p class="eyebrow">WHAT’S WORKING</p><h3>近いところ</h3><p>${escape(feedback.working)}</p></article><article><p class="eyebrow">MAIN DIFFERENCE</p><h3>主な違い</h3><p>${escape(feedback.difference)}</p></article><article class="focus-card"><p class="eyebrow">NEXT SHOT FOCUS</p><h3>次の1本で意識すること</h3><ol>${feedback.focus.map(f => `<li>${escape(f)}</li>`).join('')}</ol></article></div>
    <details class="metric-details"><summary>計測値と採点の根拠</summary><p class="instruction">各指標の一致度 = max(0, 100 × (1 − |今回 − Good Form| ÷ 許容差))。各分類内で指標の重み付き平均を計算し、総合点は分類の重み付き平均です。対象外の項目は重みを除き再配分します。値が高いほど良いという意味ではありません。</p><p class="fineprint">分析版：${escape(comparison.version)} · Good Form検出率 ${Math.round(result.referenceAnalysis.coverage * 100)}% / 今回 ${Math.round(result.newAnalysis.coverage * 100)}% · 12フレーム/秒。基準の重み：下半身20%・バランス20%・肘20%・リリース25%・フォロースルー15%。</p>
    <div class="table-scroll"><table><thead><tr><th>指標</th><th>Good Form</th><th>今回</th><th>差</th><th>許容差 / 重み</th><th>一致度 / 除外理由</th></tr></thead><tbody>${comparison.metrics.map(m => `<tr><td>${m.label}<small>${m.unit}</small></td><td>${format(m.refValue)}</td><td>${format(m.value)}</td><td>${format(m.delta)}</td><td>${m.tolerance} / ${m.weight}</td><td>${m.excluded ? escape(m.excluded) : `${Math.round(m.score)}%`}</td></tr>`).join('')}</tbody></table></div></details>
    <p class="fineprint">助言は計測差から生成するルールベースのフィードバックです。医療・生体力学的な精度や、コーチの判断を代替するものではありません。映像と照らし合わせて確認してください。</p></section>`;
  if (goodVideo && newVideo) setupComparison(result);
}
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
  const pairs = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
  function overlay(player, canvas, analysis) {
    const width = player.clientWidth, height = player.clientHeight;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, width, height);
    if (!player.videoWidth) return;
    const scale = Math.min(width / player.videoWidth, height / player.videoHeight);
    const vw = player.videoWidth * scale, vh = player.videoHeight * scale;
    const x = p => (width - vw) / 2 + p.x * vw, y = p => (height - vh) / 2 + p.y * vh;
    if (document.querySelector('#show-ball').checked) {
      const points = (analysis.ballTracking?.points ?? []).filter(p => p.time <= player.currentTime + 0.04 && p.time >= player.currentTime - 0.7);
      ctx.strokeStyle = '#59e5f7'; ctx.lineWidth = 2; ctx.setLineDash([]);
      for (let i=1;i<points.length;i++) { const a=points[i-1],b=points[i]; if(b.trackId!==a.trackId || b.time-a.time>0.2) continue; ctx.beginPath();ctx.moveTo(x(a),y(a));ctx.lineTo(x(b),y(b));ctx.stroke(); }
      const nearest=(analysis.ballTracking?.points ?? []).reduce((best,p)=>!best||Math.abs(p.time-player.currentTime)<Math.abs(best.time-player.currentTime)?p:best,null);
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
function renderHistory() {
  screen.innerHTML = `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">YOUR TRAINING RECORDS</p><h2>分析履歴</h2></div><span class="badge">${results.length} 件</span></div>${!results.length ? '<p class="instruction">新しいシュートを分析すると、ここに記録されます。</p>' : `<div class="table-scroll"><table><thead><tr><th>日時・動画</th><th>シュート種別</th><th>Form Match</th><th>信頼度</th><th>操作</th></tr></thead><tbody>${results.map(r => `<tr><td>${date(r.createdAt)}<small>${escape(r.newTitle)}</small></td><td>${shotLabels[r.newMeta.shotType]}</td><td>${r.comparison.overall === null ? '—' : `${r.comparison.overall}%`}</td><td>${confidenceLabels[r.comparison.confidence]}</td><td><button class="secondary" data-result="${r.id}">結果を見る</button> <button class="delete" data-delete-result="${r.id}">削除</button></td></tr>`).join('')}</tbody></table></div>`}<p class="fineprint">履歴は分析時点の基準と計測値を保存します。別のGood Form・撮影角度・分析版の点数は、そのまま比較しないでください。</p></section>`;
  screen.querySelectorAll('[data-result]').forEach(b => b.onclick = () => { activeResult = b.dataset.result; navigate('results'); });
  screen.querySelectorAll('[data-delete-result]').forEach(b => b.onclick = async () => {
    if (!confirm('この分析結果を削除しますか？動画は残ります。')) return;
    try { await deleteResult(b.dataset.deleteResult); results = results.filter(r => r.id !== b.dataset.deleteResult); render(); }
    catch { message('履歴を削除できませんでした。', true); }
  });
}
function renderLibrary() {
  screen.innerHTML = `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">VIDEOS & NOTES</p><h2>動画・メモ</h2></div><span class="badge">${videos.length} 本</span></div><p class="instruction">これまで保存した動画とメモも引き続き利用できます。Good Formや分析画面で、保存済みの動画を選ぶこともできます。</p><div class="library-layout"><div id="video-list">${videos.map(v => `<button class="video-item" data-video="${v.id}"><span class="video-icon">▷</span><span><strong>${escape(v.title)}</strong><small>${date(v.createdAt)}${v.id === referenceId ? ' · Good Form' : ''}</small></span></button>`).join('')}</div><div id="library-detail"><p class="instruction">動画を選んでください。</p></div></div></section>`;
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
      if (video.id === referenceId || results.some(r => r.newVideoId === video.id || r.referenceVideoId === video.id)) { message('この動画はGood Formまたは分析履歴で使用中です。基準を変更し、関連する履歴を削除してから動画を削除できます。', true); return; }
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
  const [savedVideos, savedResults, savedReference] = await Promise.all([listVideos(), listResults(), getSetting('referenceId')]);
  videos = savedVideos.sort((a,b) => b.createdAt - a.createdAt); results = savedResults.sort((a,b) => b.createdAt - a.createdAt); referenceId = savedReference?.value ?? null; render();
} catch (error) {
  screen.innerHTML = '<div class="panel empty"><h2>ブラウザの保存機能を利用できません</h2><p>別のタブを閉じ、通常のブラウザウィンドウで開き直してください。</p></div>';
  document.querySelectorAll('[data-page]').forEach(b => b.disabled = true); message(error.message, true);
}
