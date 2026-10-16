import {
  importOfflineAsset,
  listOfflineAssets,
  getOfflineAsset,
  listOfflineCaches,
  listOfflineRuns,
  getOfflineAnnotations,
  saveOfflineAnnotations,
  loadOfflineWindow,
  removeOfflineVideo,
} from './offline-storage.js';
import { extractOfflinePose, runOfflineAnalysis } from './offline-analysis.js';
import {
  activeLabels,
  changeAnnotations,
  annotationCounts,
  benchmarkRuns,
} from './offline-data.js';
import { exportOfflineTraining } from './offline-export.js';
import { drawPose } from './pose-coordinates.js';
import { nearestPose } from './bone-comparison-data.js';
import { calculateMetrics } from './metrics.js';
import { reviewShot } from './shot-engine.js';
const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const seconds = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const pct = (x) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
const date = (t) => new Date(t).toLocaleString('ja-JP');
const msgError = (e) =>
  e?.name === 'QuotaExceededError'
    ? '保存容量が足りません。既存データは削除していません。写真・ファイルの原本を残し、不要な動画だけを確認して整理してください。'
    : e?.name === 'AbortError'
      ? '処理を中断しました。保存済みの元動画・修正・以前の解析結果は保持しています。'
      : (e?.message ?? '処理を完了できませんでした。保存済みデータは保持しています。');
export function mountOfflineAnalysis(
  container,
  { appVersion, onBusy = () => {}, onDirty = () => {}, getReference = () => null } = {}
) {
  let disposed = false,
    working = false,
    dirty = false,
    controller = null,
    asset = null,
    caches = [],
    cache = null,
    runs = [],
    run = null,
    annotations = null,
    selectedLabel = null,
    formReviewSnapshot = null,
    videoURL = null,
    exportURL = null,
    overlayFrames = [],
    overlayEpoch = 0,
    windowRange = null,
    frameCallback = null,
    benchmark = null;
  container.innerHTML = `<section class="panel offline-panel"><p class="eyebrow">保存した動画で検証</p><h2>動画を読み込んで再解析</h2><p>動画を保存 → シュートを確認・修正 → 同じ骨格で検出ルールを比較</p><div class="offline-import"><label class="upload">＋ 写真・ファイルから動画を選ぶ<input type="file" accept="video/*" id="offline-upload"></label><label class="field">読み込み済みの動画<select id="offline-assets"><option value="">動画を選択</option></select></label></div><p id="offline-status" role="status" aria-live="polite"></p><div id="offline-progress-area" hidden><progress id="offline-progress" max="1" value="0"></progress><p id="offline-progress-text" role="status"></p><button id="offline-cancel" type="button" class="secondary">処理を中断</button></div><section id="offline-workspace" hidden>
 <h3 id="offline-title"></h3><p id="offline-video-state" class="fineprint"></p><div class="offline-stage"><video id="offline-player" controls playsinline preload="metadata"></video><canvas id="offline-bones" aria-hidden="true"></canvas></div>
 <div class="offline-transport"><button type="button" class="secondary" id="offline-start">先頭へ</button><button type="button" class="secondary" data-offline-skip="-3">−3秒</button><output id="offline-position">0:00.00</output><button type="button" class="secondary" data-offline-skip="3">＋3秒</button></div>
 <label class="field offline-seek-label">動画の位置<input id="offline-seek" type="range" min="0" max="1" step="0.01" value="0" aria-label="動画の位置（開始から秒）"></label>
 <div class="offline-review-actions"><button type="button" class="primary" id="offline-add">ここがリリース · 追加</button><button type="button" class="secondary" id="offline-move" disabled>選んだシュートをここへ修正</button></div><p class="fineprint">ボールが手を離れる瞬間を登録します。ディップ開始ではありません。</p>
 <div id="offline-counts" class="offline-counts"></div><p id="offline-save" role="status"></p><div id="offline-shots"></div><div id="offline-label-editor" hidden><h3>確認したシュート</h3><label class="field">成否<select id="offline-outcome"><option value="unknown">未確認・不明</option><option value="made">成功</option><option value="missed">失敗</option></select></label><label class="field">表示されたフォーム評価は合っていますか？<select id="offline-form-rating"><option value="unreviewed">まだ確認していない</option><option value="good">合っている</option><option value="bad">間違っている</option><option value="unsure">判断できない</option></select></label><label class="field">メモ<textarea id="offline-note" rows="2"></textarea></label><button type="button" class="primary" id="offline-save-label">この確認を保存</button><button type="button" class="secondary" id="offline-remove-label">この登録を取り消す</button><p id="offline-label-analysis"></p></div>
 <label class="check"><input id="offline-complete" type="checkbox">動画の最後まで確認し、見逃し・誤検出の修正を終えた</label>
 <details id="offline-analysis-settings" class="app-help" open><summary>骨格の読み取り・再解析</summary><div class="offline-settings"><label class="field">シュートする手<select id="offline-hand"><option value="right">右手</option><option value="left">左手</option></select></label><label class="field">撮影角度<select id="offline-angle"><option value="side">横</option><option value="diagonal">斜め横</option><option value="front">正面</option></select></label><label class="field">種別<select id="offline-type"><option value="jump">ジャンプシュート</option><option value="set">セットシュート</option><option value="free">フリースロー</option></select></label><label class="field">読み取り間隔<select id="offline-fps"><option value="15">標準 · 毎秒15枚</option><option value="30">詳細 · 毎秒30枚（時間がかかります）</option></select></label></div><label class="field">使う骨格データ<select id="offline-caches"></select></label><p id="offline-cache-info" class="fineprint"></p><button type="button" class="secondary" id="offline-extract">動画から骨格を読み取る</button><label class="field">検出ルール<select id="offline-algorithm"><option value="current">現在のルール（PR #39後）</option><option value="legacy">比較用 · PR #39前</option></select></label><button type="button" class="primary" id="offline-replay">骨格を使って再解析</button><label class="field">保存した解析結果<select id="offline-runs"></select></label><p id="offline-form-info" class="fineprint"></p></details>
 <section class="offline-compare"><h3>同じ正解で比較する</h3><p>全編を確認した正解位置と、自動検出を±0.5秒で1本ずつ照合します。レビューしただけではライブの判定やAI設定は変わりません。</p><button type="button" class="primary" id="offline-compare">変更前後を比較</button><div id="offline-metrics"></div><button type="button" class="secondary" id="offline-export">正解・骨格・解析結果をJSONで書き出す</button><div id="offline-export-download"></div></section>
 <details class="app-help"><summary>元動画・保存・制限について</summary><p>元動画は解析より先にこのブラウザへ保存します。再解析では元動画を複製せず、手動修正と過去の解析を保持します。標準・詳細とも一定間隔の読み取りです。元動画の全フレームを取得した保証はありません。</p><p>Safariは画面を閉じると処理を止めることがあります。解析中はこの画面を開いてください。人物の取り違えや、他アプリの描画による推定への影響があります。シュートの成否は自動判定しません。</p><p>この読み込み動画のGoogle Drive直接保存は次の段階です。今はJSONと写真・ファイルの元動画を一緒に保管してください。既存のライブ練習のDrive保存は引き続き使えます。</p><button type="button" class="secondary danger" id="offline-remove-video">この元動画だけを端末から削除</button><p>削除しても骨格・解析・手動修正は残ります。同じファイルを選び直すと再び紐づきます。Safariのサイトデータは消さないでください。</p></details></section></section>`;
  const $ = (s) => container.querySelector(s),
    player = $('#offline-player'),
    status = $('#offline-status'),
    saveState = $('#offline-save');
  function message(text, error = false) {
    if (disposed) return;
    status.textContent = text;
    status.classList.toggle('error', error);
  }
  function markDirty(value) {
    dirty = value;
    onDirty(value);
    if (value) {
      saveState.textContent = '未保存の確認があります';
      saveState.className = 'warning';
    }
    updateButtons();
  }
  function lock(value) {
    working = value;
    onBusy(value);
    player.controls = !value;
    if (value) player.pause();
    container
      .querySelectorAll('input,select,button,textarea')
      .forEach((el) => (el.disabled = value));
    $('#offline-cancel').disabled = false;
    if (!value) updateButtons();
  }
  function updateButtons() {
    const hasVideo = !!asset?.blob,
      ready = player.readyState >= 2 && !player.seeking && hasVideo;
    $('#offline-add').disabled = working || !ready;
    $('#offline-move').disabled = working || !ready || !selectedLabel;
    $('#offline-extract').disabled = working || !hasVideo;
    $('#offline-replay').disabled = working || !cache;
    $('#offline-compare').disabled = working || dirty || !cache || !annotations?.complete;
    $('#offline-export').disabled = working || !cache;
    $('#offline-remove-video').disabled = working || !hasVideo;
    $('#offline-complete').disabled = working || !asset;
    $('#offline-start').disabled = working || !ready;
    $('#offline-seek').disabled = working || !ready;
    container
      .querySelectorAll('[data-offline-skip]')
      .forEach((b) => (b.disabled = working || !ready));
    container.querySelectorAll('[data-offline-confirm]').forEach((b) => {
      const shot = run?.shots.find((s) => s.id === b.dataset.offlineConfirm);
      b.disabled =
        working ||
        !shot ||
        annotations.decisions[`${run.id}:${shot.id}`]?.decision === 'false-positive' ||
        activeLabels(annotations).some((l) => Math.abs(l.time - shot.phases.release) < 0.5);
    });
  }
  async function task(action) {
    if (working) return;
    if (dirty) {
      message('先に入力中の確認を保存してください。', true);
      return;
    }
    lock(true);
    controller = new AbortController();
    $('#offline-progress-area').hidden = false;
    message('');
    try {
      await action(controller.signal);
      return true;
    } catch (error) {
      message(msgError(error), true);
      return false;
    } finally {
      controller = null;
      if (!disposed) {
        $('#offline-progress-area').hidden = true;
        lock(false);
      }
    }
  }
  function progress(text, value) {
    if (disposed) return;
    $('#offline-progress-text').textContent = text;
    $('#offline-progress').value = value;
  }
  async function refreshAssets() {
    const list = (await listOfflineAssets()).sort((a, b) => b.createdAt - a.createdAt);
    if (disposed) return;
    $('#offline-assets').innerHTML =
      '<option value="">動画を選択</option>' +
      list
        .map(
          (a) =>
            `<option value="${escape(a.id)}">${escape(a.title)}${a.hasVideo ? '' : '（元動画なし）'}</option>`
        )
        .join('');
    $('#offline-assets').value = asset?.id ?? '';
  }
  async function chooseAsset(id) {
    if (dirty && !confirm('未保存の確認を破棄しますか？')) return;
    markDirty(false);
    asset = await getOfflineAsset(id);
    if (disposed || !asset) return;
    caches = (await listOfflineCaches(id))
      .filter((c) => c.status === 'complete')
      .sort((a, b) => b.createdAt - a.createdAt);
    cache = caches[0] ?? null;
    runs = (await listOfflineRuns(id)).sort((a, b) => b.createdAt - a.createdAt);
    run = runs.find((r) => r.cacheId === cache?.id) ?? runs[0] ?? null;
    if (run) cache = caches.find((c) => c.id === run.cacheId) ?? cache;
    annotations = await getOfflineAnnotations(id);
    selectedLabel = null;
    benchmark = null;
    clearExport();
    windowRange = null;
    overlayFrames = [];
    overlayEpoch++;
    if (videoURL) URL.revokeObjectURL(videoURL);
    videoURL = null;
    player.pause();
    player.removeAttribute('src');
    player.load();
    if (asset.blob) {
      videoURL = URL.createObjectURL(asset.blob);
      player.src = videoURL;
      player.load();
    }
    if (run?.metadata) {
      $('#offline-hand').value = run.metadata.hand;
      $('#offline-angle').value = run.metadata.cameraAngle;
      $('#offline-type').value = run.metadata.shotType;
    }
    $('#offline-workspace').hidden = false;
    $('#offline-title').textContent = asset.title;
    container
      .querySelector('.offline-stage')
      .style.setProperty('--offline-ratio', String(asset.width / asset.height));
    $('#offline-video-state').textContent =
      `元動画：${asset.blob ? 'ローカル保存・内容照合済み' : '端末にはありません'} · ${(asset.bytes / 1024 / 1024).toFixed(1)} MiB · ${seconds(asset.duration)}`;
    $('#offline-assets').value = id;
    $('#offline-seek').max = asset.duration;
    $('#offline-label-editor').hidden = true;
    saveState.textContent = annotations.revision
      ? `ローカル保存・読み戻し確認済み（修正 ${annotations.revision} / ${date(annotations.updatedAt)}）`
      : '元動画は保存済みです。リリースの瞬間を追加できます。';
    renderOptions();
    renderShots();
    renderMetrics();
    updateButtons();
  }
  function clearExport() {
    if (exportURL) URL.revokeObjectURL(exportURL);
    exportURL = null;
    $('#offline-export-download').replaceChildren();
  }
  function renderOptions() {
    $('#offline-caches').innerHTML = caches.length
      ? caches
          .map(
            (c) =>
              `<option value="${escape(c.id)}">${date(c.createdAt)} · 毎秒${c.config.fps}枚 · ${c.frameCount}枚</option>`
          )
          .join('')
      : '<option value="">まだ骨格を読み取っていません</option>';
    $('#offline-caches').value = cache?.id ?? '';
    $('#offline-cache-info').textContent = cache
      ? `${cache.frameCount}枚を読み取り / 骨格あり ${cache.poseFrameCount}枚 / 最大間隔 ${cache.maxGap.toFixed(3)}秒 / 表示フレーム位置 ${cache.timing.presented}枚・シーク位置による近似 ${cache.timing.estimated}枚`
      : '最初に一度読み取ると、次の検出ルール比較では骨格の読み取りを省略できます。';
    const available = runs.filter((r) => r.cacheId === cache?.id);
    $('#offline-runs').innerHTML = available.length
      ? available
          .map(
            (r) =>
              `<option value="${escape(r.id)}">${date(r.createdAt)} · ${r.algorithm} · ${r.shots.length}本</option>`
          )
          .join('')
      : '<option value="">未解析</option>';
    $('#offline-runs').value = run?.id ?? '';
    $('#offline-form-info').textContent = run?.referenceId
      ? `フォーム評価の比較基準：${run.referenceSnapshot?.title ?? run.referenceId}。自動のリリース位置は推定のため参考評価です。`
      : '基準フォーム未選択でも検出・正解登録は可能です。フォーム一致度は基準フォームがある解析で表示します。';
  }
  function renderShots() {
    if (!annotations) return;
    const c = annotationCounts(annotations, run);
    $('#offline-counts').textContent =
      `自動候補 ${c.automatic}本 · 手動追加 ${c.manual}本 · 誤検出として除外 ${c.excluded}本 · 確認した正解 ${c.confirmed}本`;
    $('#offline-complete').checked = annotations.complete;
    const labels = [...activeLabels(annotations)].sort((a, b) => a.time - b.time);
    $('#offline-shots').innerHTML =
      `<h3>確認したシュート · ${labels.length}本</h3><div class="offline-shot-list">${labels.map((l, i) => `<button type="button" class="secondary${selectedLabel === l.id ? ' active' : ''}" data-offline-label="${escape(l.id)}">${i + 1} · ${seconds(l.time)}${l.origin === 'manual' ? ' 手動' : ''}${l.timeCorrected ? ' 修正' : ''}</button>`).join('') || '<p>0本でも手動で追加できます。</p>'}</div><details class="app-help"${run?.shots.length ? ' open' : ''}><summary>自動候補 · ${run?.shots.length ?? 0}本（正解とは未確定）</summary>${(
        run?.shots ?? []
      )
        .map((s) => {
          const rejected =
              annotations.decisions[`${run.id}:${s.id}`]?.decision === 'false-positive',
            near = labels.some((l) => Math.abs(l.time - s.phases.release) < 0.5);
          return `<article class="offline-candidate"><button type="button" class="secondary" data-offline-candidate="${escape(s.id)}">${s.number} · ${seconds(s.phases.release)}</button><span>${rejected ? '誤検出として除外' : near ? '確認した位置に近い' : '要確認'} · フォーム一致度 ${s.evaluation?.comparison.overall ?? '—'}${s.evaluation?.comparison.confidence === 'Low' ? '（参考値）' : ''}</span><div><button type="button" class="primary" data-offline-confirm="${escape(s.id)}"${rejected || near ? ' disabled' : ''}>正解に登録</button><button type="button" class="secondary" data-offline-reject="${escape(s.id)}">${rejected ? '除外を取り消す' : '誤検出'}</button></div><details><summary>判定理由</summary><p>${escape(s.reason)}</p><p>${escape(s.analysis.warnings.join(' '))}</p></details></article>`;
        })
        .join('')}</details>`;
  }
  async function apply(action) {
    if (!asset || !annotations || working) return;
    if (dirty && action.type !== 'edit') {
      message('先に入力中の成否・フォーム評価・メモを保存してください。', true);
      if (action.type === 'complete') $('#offline-complete').checked = annotations.complete;
      return;
    }
    lock(true);
    saveState.textContent = '保存中…';
    saveState.className = '';
    try {
      const previous = annotations,
        next = changeAnnotations(previous, action, { duration: asset.duration });
      annotations = await saveOfflineAnnotations(next, previous.revision);
      markDirty(false);
      benchmark = null;
      clearExport();
      saveState.textContent = `ローカル保存・読み戻し確認済み（修正 ${annotations.revision} / ${date(annotations.updatedAt)}）`;
      if (action.type === 'add') selectedLabel = annotations.items.at(-1).id;
      if (action.type === 'edit' && action.active === false) {
        selectedLabel = null;
        $('#offline-label-editor').hidden = true;
      }
      if (selectedLabel && !activeLabels(annotations).some((i) => i.id === selectedLabel)) {
        selectedLabel = null;
        $('#offline-label-editor').hidden = true;
      }
      renderShots();
      renderMetrics();
      if (selectedLabel) await showLabel(selectedLabel, false);
    } catch (error) {
      saveState.textContent = '保存に失敗しました。保存済みとは確認できません。';
      saveState.className = 'error';
      message(msgError(error), true);
      if (action.type === 'complete') $('#offline-complete').checked = annotations.complete;
    } finally {
      if (!disposed) lock(false);
    }
  }
  async function showLabel(id, seek = true) {
    const item = annotations.items.find((l) => l.id === id && l.active !== false);
    if (!item) return;
    if (dirty && selectedLabel !== id && !confirm('未保存の確認を破棄しますか？')) return;
    markDirty(false);
    selectedLabel = id;
    $('#offline-label-editor').hidden = false;
    $('#offline-outcome').value = item.outcome;
    $('#offline-form-rating').value = item.formRating;
    $('#offline-note').value = item.note;
    if (seek) seekTo(item.time);
    renderShots();
    updateButtons();
    const info = $('#offline-label-analysis');
    formReviewSnapshot = null;
    const originalRun = runs.find((r) => r.id === item.sourceRunId),
      originalShot = originalRun?.shots.find((s) => s.id === item.sourceShotId);
    if (originalShot?.evaluation && !item.timeCorrected) {
      formReviewSnapshot = {
        basis: 'original-automatic',
        runId: originalRun.id,
        shotId: originalShot.id,
        cacheId: originalRun.cacheId,
        referenceId: originalRun.referenceId,
        comparison: originalShot.evaluation.comparison,
      };
      info.textContent = `元の自動評価：フォーム一致度 ${originalShot.evaluation.comparison.overall ?? '—'} / 信頼度 ${originalShot.evaluation.comparison.confidence}。この保存済み評価の正誤を確認します。`;
      return;
    }
    info.textContent = cache
      ? 'フォームを確認しています…'
      : '骨格を読み取ると、この位置のフォームを確認できます。';
    const currentCache = cache,
      reference = getReference();
    if (!currentCache)
      return void (info.textContent = '骨格を読み取ると、この位置のフォームを確認できます。');
    if (!reference?.analysis)
      return void (info.textContent = '基準フォームが未選択のためフォーム一致度は未算出です。');
    const phases = {
      start: Math.max(0, item.time - 1.5),
      release: item.time,
      end: Math.min(asset.duration, item.time + 1),
    };
    if (!(phases.start < phases.release && phases.release < phases.end))
      return void (info.textContent = '動画の端のため前後のフォームを十分に評価できません。');
    try {
      const frames = await loadOfflineWindow(currentCache, phases.start, phases.end);
      if (disposed || selectedLabel !== id || cache?.id !== currentCache.id) return;
      const metadata = currentMetadata(),
        analysis = calculateMetrics(
          frames,
          phases,
          metadata.hand,
          asset.width / asset.height,
          false
        ),
        evaluation = reviewShot(reference.analysis, analysis, reference, metadata);
      formReviewSnapshot = {
        basis: 'manual-position-preview',
        cacheId: currentCache.id,
        referenceId: reference.id,
        metadata,
        phases,
        comparison: evaluation.comparison,
        computedAt: Date.now(),
      };
      info.textContent = `この位置の参考計算：フォーム一致度 ${evaluation.comparison.overall ?? '—'} / 信頼度 ${evaluation.comparison.confidence}。現在選択中の基準による表示です。元の自動評価は変更しません。`;
    } catch (error) {
      if (!disposed) info.textContent = msgError(error);
    }
  }
  function currentMetadata() {
    return {
      hand: $('#offline-hand').value,
      cameraAngle: $('#offline-angle').value,
      shotType: $('#offline-type').value,
    };
  }
  function seekTo(time) {
    if (!asset?.blob) return;
    player.pause();
    player.currentTime = Math.max(0, Math.min(asset.duration - 0.001, time));
    updatePosition();
  }
  function updatePosition() {
    if (disposed) return;
    $('#offline-position').textContent = seconds(player.currentTime || 0);
    $('#offline-seek').value = player.currentTime || 0;
    void updateOverlay();
  }
  async function updateOverlay() {
    if (working || player.seeking || !cache || !asset?.blob) return;
    const time = player.currentTime;
    if (!windowRange || time < windowRange.start || time > windowRange.end) {
      const epoch = ++overlayEpoch,
        currentCache = cache;
      windowRange = { start: Math.max(0, time - 0.5), end: time + 1 };
      try {
        const f = await loadOfflineWindow(cache, windowRange.start, windowRange.end);
        if (disposed || epoch !== overlayEpoch || cache?.id !== currentCache.id) return;
        overlayFrames = f;
      } catch {
        overlayFrames = [];
      }
    }
    drawPose(
      $('#offline-bones'),
      player,
      nearestPose(overlayFrames, time, 0.12)?.landmarks ?? null
    );
  }
  function scheduleFrame() {
    if (disposed || player.paused) return;
    if (player.requestVideoFrameCallback)
      frameCallback = player.requestVideoFrameCallback(() => {
        updatePosition();
        scheduleFrame();
      });
  }
  function renderMetrics() {
    if (!benchmark) {
      $('#offline-metrics').innerHTML =
        '<p class="fineprint">全編の正解を確認後、現在のルールとPR #39前を同じ骨格で比較できます。これだけで一般的な認識精度の改善を証明するものではありません。</p>';
      return;
    }
    $('#offline-metrics').innerHTML =
      `<p>正解の修正 ${benchmark.labelRevision} / 同じ骨格 / 照合幅 ±0.5秒</p><div class="offline-metric-cards">${benchmark.results.map((r) => `<article><strong>${r.algorithm === 'session-pose-1.2' ? '現在のルール' : 'PR #39前'}</strong><p>正解 ${r.truthCount}本 / 検出 ${r.detectedCount}本</p><p>一致 ${r.tp}本 / 見逃し ${r.fn}本 / 誤検出 ${r.fp}本</p><dl><dt>検出したシュートの正確さ</dt><dd>${pct(r.precision)}</dd><dt>正解シュートの検出率</dt><dd>${pct(r.recall)}</dd><dt>両方を合わせた指標（F1）</dt><dd>${pct(r.f1)}</dd></dl></article>`).join('')}</div><p class="fineprint">分母が0の項目は「—」。ライブの待機・人物存在チェックや実機の処理落ちは再現しません。HomeCourtの表示本数・成功率は正解として使用していません。</p>`;
  }
  $('#offline-upload').onchange = async () => {
    const file = $('#offline-upload').files[0];
    if (!file) return;
    if (dirty && !confirm('未保存の確認を破棄しますか？')) return;
    markDirty(false);
    await task(async (signal) => {
      const probe = document.createElement('video'),
        probeURL = URL.createObjectURL(file);
      probe.preload = 'metadata';
      probe.muted = true;
      probe.playsInline = true;
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new Error(
                  '動画の情報を読み込めませんでした。写真アプリで原本のダウンロードを完了してから再試行してください。'
                )
              ),
            15000
          );
          probe.onloadedmetadata = () => {
            clearTimeout(timer);
            resolve();
          };
          probe.onerror = () => {
            clearTimeout(timer);
            reject(new Error('この動画形式を再生できません。H.264のMP4/MOVをお試しください。'));
          };
          probe.src = probeURL;
        });
        if (
          !Number.isFinite(probe.duration) ||
          probe.duration <= 0 ||
          probe.duration > 600 ||
          !probe.videoWidth ||
          !probe.videoHeight
        )
          throw new Error('10分以内の再生可能な動画を選んでください。');
        const estimate = await navigator.storage?.estimate?.().catch(() => null);
        if (estimate?.quota && estimate.quota - estimate.usage < file.size * 1.15 + 4 * 1024 * 1024)
          throw new DOMException('保存容量が不足しています。', 'QuotaExceededError');
        const saved = await importOfflineAsset(
          file,
          {
            duration: probe.duration,
            width: probe.videoWidth,
            height: probe.videoHeight,
            appVersion,
          },
          {
            signal,
            onProgress: (n, total) => progress('元動画を保存・内容確認しています', n / total),
          }
        );
        markDirty(false);
        await chooseAsset(saved.id);
        await refreshAssets();
        message(
          '元動画をローカル保存し、内容を照合しました。骨格を読み取るか、リリース位置を手動登録してください。'
        );
      } finally {
        probe.pause();
        probe.removeAttribute('src');
        probe.load();
        URL.revokeObjectURL(probeURL);
      }
    });
    $('#offline-upload').value = '';
  };
  $('#offline-assets').onchange = () => {
    const id = $('#offline-assets').value;
    if (id) void task(() => chooseAsset(id));
  };
  $('#offline-caches').onchange = () => {
    cache = caches.find((c) => c.id === $('#offline-caches').value) ?? null;
    run = runs.find((r) => r.cacheId === cache?.id) ?? null;
    benchmark = null;
    clearExport();
    overlayEpoch++;
    windowRange = null;
    renderOptions();
    renderShots();
    renderMetrics();
    updateButtons();
  };
  $('#offline-runs').onchange = () => {
    run = runs.find((r) => r.id === $('#offline-runs').value) ?? null;
    if (run?.metadata) {
      $('#offline-hand').value = run.metadata.hand;
      $('#offline-angle').value = run.metadata.cameraAngle;
      $('#offline-type').value = run.metadata.shotType;
    }
    renderOptions();
    renderShots();
  };
  $('#offline-extract').onclick = () =>
    void task(async (signal) => {
      cache = await extractOfflinePose(player, asset, {
        fps: Number($('#offline-fps').value),
        force: true,
        signal,
        onProgress: progress,
      });
      caches = (await listOfflineCaches(asset.id))
        .filter((c) => c.status === 'complete')
        .sort((a, b) => b.createdAt - a.createdAt);
      run = null;
      windowRange = null;
      overlayEpoch++;
      renderOptions();
      renderShots();
      message('骨格の読み取りを保存しました。「骨格を使って再解析」でシュート候補を探します。');
    });
  $('#offline-replay').onclick = () =>
    void task(async (signal) => {
      run = await runOfflineAnalysis(asset, cache, {
        metadata: currentMetadata(),
        reference: getReference(),
        algorithm: $('#offline-algorithm').value,
        appVersion,
        signal,
        onProgress: progress,
      });
      runs.unshift(run);
      clearExport();
      renderOptions();
      renderShots();
      message(
        `${run.shots.length}本の自動候補を保存しました。見逃しは動画の位置から追加できます。以前の修正は保持しています。`
      );
    });
  $('#offline-add').onclick = () => void apply({ type: 'add', time: player.currentTime });
  $('#offline-move').onclick = () =>
    selectedLabel && void apply({ type: 'move', id: selectedLabel, time: player.currentTime });
  $('#offline-save-label').onclick = () =>
    selectedLabel &&
    void apply({
      type: 'edit',
      id: selectedLabel,
      outcome: $('#offline-outcome').value,
      formRating: $('#offline-form-rating').value,
      formReviewSnapshot,
      note: $('#offline-note').value,
    });
  $('#offline-remove-label').onclick = () =>
    selectedLabel && void apply({ type: 'edit', id: selectedLabel, active: false });
  $('#offline-complete').onchange = () =>
    void apply({ type: 'complete', value: $('#offline-complete').checked });
  for (const id of ['#offline-outcome', '#offline-form-rating', '#offline-note'])
    $(id).addEventListener('input', () => markDirty(true));
  $('#offline-shots').onclick = (event) => {
    const b = event.target.closest('button');
    if (!b || working) return;
    if (b.dataset.offlineLabel) return void showLabel(b.dataset.offlineLabel);
    const id = b.dataset.offlineCandidate ?? b.dataset.offlineConfirm ?? b.dataset.offlineReject,
      shot = run?.shots.find((s) => s.id === id);
    if (!shot) return;
    if (b.dataset.offlineCandidate) seekTo(shot.phases.release);
    else if (b.dataset.offlineConfirm)
      void apply({
        type: 'add',
        origin: 'auto-confirmed',
        runId: run.id,
        shotId: shot.id,
        time: shot.phases.release,
      });
    else if (b.dataset.offlineReject)
      void apply({
        type: 'reject',
        runId: run.id,
        shotId: shot.id,
        value: annotations.decisions[`${run.id}:${shot.id}`]?.decision !== 'false-positive',
      });
  };
  $('#offline-compare').onclick = () =>
    void task(async (signal) => {
      const selectedCache = cache,
        reference = getReference(),
        metadata = currentMetadata(),
        compared = [];
      for (const algorithm of ['current', 'legacy']) {
        const r = await runOfflineAnalysis(asset, selectedCache, {
          metadata,
          reference,
          algorithm,
          appVersion,
          signal,
          onProgress: progress,
        });
        runs.unshift(r);
        clearExport();
        compared.push(r);
      }
      benchmark = benchmarkRuns(annotations, compared, selectedCache);
      run = compared[0];
      renderOptions();
      renderShots();
      renderMetrics();
      message(
        '同じ動画・骨格・正解で比較しました。ライブの検出設定やCalibrationは変更していません。'
      );
    });
  $('#offline-export').onclick = () =>
    void task(async (signal) => {
      clearExport();
      const blob = await exportOfflineTraining(asset, cache, runs, annotations, {
          signal,
          onProgress: (n, total) => progress('JSONを書き出しています', n / total),
        }),
        href = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = href;
      a.download = `shot-offline-${asset.id.slice(0, 20)}.json`;
      exportURL = href;
      a.className = 'button primary';
      a.id = 'offline-download-json';
      a.textContent = 'JSONを保存';
      $('#offline-export-download').replaceChildren(a);
      message(
        '準備ができました。「JSONを保存」をタップし、ファイルアプリで保存を確認してください。動画は含まれません。'
      );
    });
  $('#offline-remove-video').onclick = async () => {
    if (
      !asset?.blob ||
      !confirm(
        'この端末の元動画だけを削除しますか？骨格・解析結果・手動修正は残ります。写真・ファイルなどに原本があることを確認してください。'
      )
    )
      return;
    await task(async () => {
      await removeOfflineVideo(asset);
      await chooseAsset(asset.id);
      await refreshAssets();
      message('端末の元動画だけを削除しました。骨格・解析・修正は保持しています。');
    });
  };
  $('#offline-start').onclick = () => seekTo(0);
  container
    .querySelectorAll('[data-offline-skip]')
    .forEach((b) => (b.onclick = () => seekTo(player.currentTime + Number(b.dataset.offlineSkip))));
  $('#offline-seek').oninput = () => seekTo(Number($('#offline-seek').value));
  $('#offline-cancel').onclick = () => controller?.abort();
  player.addEventListener('loadeddata', () => {
    updateButtons();
    updatePosition();
  });
  player.addEventListener('timeupdate', updatePosition);
  player.addEventListener('seeking', updateButtons);
  player.addEventListener('seeked', () => {
    updatePosition();
    updateButtons();
  });
  player.addEventListener('canplay', updateButtons);
  player.addEventListener('play', scheduleFrame);
  player.addEventListener('pause', () => {
    if (frameCallback !== null) player.cancelVideoFrameCallback?.(frameCallback);
    frameCallback = null;
  });
  player.addEventListener('error', () => {
    if (asset?.blob) {
      message('保存した動画を再生できません。骨格・修正は保持しています。', true);
      updateButtons();
    }
  });
  const beforeUnload = (e) => {
    if (dirty || working) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnload);
  const visibility = () => {
    if (document.hidden) controller?.abort();
  };
  document.addEventListener('visibilitychange', visibility);
  void refreshAssets().catch((e) => message(msgError(e), true));
  return () => {
    disposed = true;
    controller?.abort();
    onBusy(false);
    player.pause();
    overlayEpoch++;
    window.removeEventListener('beforeunload', beforeUnload);
    document.removeEventListener('visibilitychange', visibility);
    if (exportURL) URL.revokeObjectURL(exportURL);
    if (videoURL) URL.revokeObjectURL(videoURL);
    if (frameCallback !== null) player.cancelVideoFrameCallback?.(frameCallback);
  };
}
