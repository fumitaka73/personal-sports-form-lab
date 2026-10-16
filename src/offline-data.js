// Platform-neutral, media-time-based records. No live sessions or Calibration are modified.
export const OFFLINE_SCHEMA = 1;
export const OFFLINE_FEATURE_VERSION = 'shot-motion-rows-1';
export const OFFLINE_STRIDE = 133; // seconds + 33 MediaPipe points × x,y,z,visibility
export const OFFLINE_CACHE_VERSION = 'pose33-f32-1';
export const OFFLINE_ALGORITHMS = Object.freeze({
  current: 'session-pose-1.2',
  legacy: 'session-pose-1.1@92cfe6b',
});
export const emptyAnnotations = (assetId) => ({
  id: assetId,
  assetId,
  schemaVersion: OFFLINE_SCHEMA,
  revision: 0,
  items: [],
  decisions: {},
  history: [],
  complete: false,
});
export const activeLabels = (annotations) => annotations.items.filter((i) => i.active !== false);
export const compactAsset = (asset) => {
  const { blob, ...metadata } = asset;
  return metadata;
};
export function packOfflineFrames(frames) {
  const data = new Float32Array(frames.length * OFFLINE_STRIDE);
  data.fill(NaN);
  frames.forEach((f, i) => {
    const start = i * OFFLINE_STRIDE;
    data[start] = f.time;
    for (let j = 0; j < 33; j++) {
      const p = f.landmarks?.[j];
      if (!p) continue;
      data.set([p.x, p.y, p.z ?? 0, p.visibility ?? 0], start + 1 + j * 4);
    }
  });
  return data.buffer;
}
export function unpackOfflineFrames(buffer) {
  const data = new Float32Array(buffer);
  if (data.length % OFFLINE_STRIDE) throw new Error('骨格データの形式が一致しません。');
  const frames = [];
  for (let i = 0; i < data.length; i += OFFLINE_STRIDE) {
    const p = [];
    for (let j = 0; j < 33; j++) {
      const k = i + 1 + j * 4;
      p.push({
        x: data[k],
        y: data[k + 1],
        z: data[k + 2],
        visibility: Number.isFinite(data[k + 3]) ? data[k + 3] : 0,
      });
    }
    frames.push({
      time: data[i],
      landmarks: p.some((point) => Number.isFinite(point.x)) ? p : null,
    });
  }
  return frames;
}
export function changeAnnotations(
  previous,
  action,
  { id = crypto.randomUUID(), now = Date.now(), duration } = {}
) {
  const next = structuredClone(previous);
  next.revision++;
  next.updatedAt = now;
  next.complete = false;
  if (action.type === 'complete') next.complete = !!action.value;
  else if (['add', 'move'].includes(action.type)) {
    const time = Number(action.time);
    if (!Number.isFinite(time) || time < 0 || time > duration)
      throw new Error('動画の範囲内でリリースの瞬間を指定してください。');
    if (activeLabels(next).some((i) => i.id !== action.id && Math.abs(i.time - time) < 0.5))
      throw new Error(
        '近くに確認済みのシュートがあります。同じシュートなら「位置を修正」を使ってください。'
      );
    if (action.type === 'add')
      next.items.push({
        id,
        time,
        active: true,
        origin: action.origin ?? 'manual',
        sourceRunId: action.runId ?? null,
        sourceShotId: action.shotId ?? null,
        outcome: 'unknown',
        formRating: 'unreviewed',
        note: '',
        createdAt: now,
      });
    else {
      const item = next.items.find((i) => i.id === action.id && i.active !== false);
      if (!item) throw new Error('修正対象が見つかりません。');
      item.time = time;
      item.timeCorrected = true;
    }
  } else if (action.type === 'edit') {
    const item = next.items.find((i) => i.id === action.id);
    if (!item) throw new Error('確認対象が見つかりません。');
    if (action.active !== undefined) item.active = !!action.active;
    if (action.outcome !== undefined) {
      if (!['made', 'missed', 'unknown'].includes(action.outcome))
        throw new Error('成否の形式が違います。');
      item.outcome = action.outcome;
    }
    if (action.formRating !== undefined) {
      if (!['good', 'bad', 'unsure', 'unreviewed'].includes(action.formRating))
        throw new Error('フォーム評価の形式が違います。');
      item.formRating = action.formRating;
    }
    if (action.formReviewSnapshot !== undefined)
      item.formReviewSnapshot = structuredClone(action.formReviewSnapshot);
    if (action.note !== undefined) item.note = String(action.note).slice(0, 4000);
  } else if (action.type === 'reject') {
    if (!action.runId || !action.shotId) throw new Error('候補が見つかりません。');
    if (action.value !== false)
      for (const item of next.items)
        if (item.sourceRunId === action.runId && item.sourceShotId === action.shotId)
          item.active = false;
    next.decisions[`${action.runId}:${action.shotId}`] = {
      decision: action.value === false ? 'unreviewed' : 'false-positive',
      runId: action.runId,
      shotId: action.shotId,
      updatedAt: now,
    };
  } else throw new Error('対応しない修正です。');
  next.history.push({
    revision: next.revision,
    at: now,
    action: structuredClone(action),
    annotationId: action.type === 'add' ? id : (action.id ?? null),
  });
  return next;
}
export function annotationCounts(annotations, run) {
  return {
    automatic: run?.shots.length ?? 0,
    manual: activeLabels(annotations).filter((i) => i.origin === 'manual').length,
    confirmed: activeLabels(annotations).length,
    excluded: Object.values(annotations.decisions).filter(
      (d) => d.runId === run?.id && d.decision === 'false-positive'
    ).length,
  };
}
// Sorted interval matching maximizes one-to-one matches for a fixed tolerance on a line.
// An extra detection of the same shot remains a false positive.
export function matchShotTimes(truth, detected, tolerance = 0.5) {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('照合の幅が不正です。');
  const a = [...truth].sort((a, b) => a - b),
    b = [...detected].sort((a, b) => a - b);
  if ([...a, ...b].some((x) => !Number.isFinite(x)))
    throw new Error('シュート位置に数値以外が含まれます。');
  let i = 0,
    j = 0,
    tp = 0;
  const pairs = [];
  while (i < a.length && j < b.length) {
    if (b[j] < a[i] - tolerance) j++;
    else if (b[j] > a[i] + tolerance) i++;
    else {
      pairs.push({ truth: a[i++], detected: b[j++] });
      tp++;
    }
  }
  const fp = b.length - tp,
    fn = a.length - tp,
    precision = b.length ? tp / b.length : null,
    recall = a.length ? tp / a.length : null,
    f1 = a.length + b.length ? (2 * tp) / (a.length + b.length) : null;
  return {
    truthCount: a.length,
    detectedCount: b.length,
    tp,
    fp,
    fn,
    precision,
    recall,
    f1,
    tolerance,
    pairs,
  };
}
export function benchmarkRuns(annotations, runs, cache) {
  if (!annotations.complete)
    throw new Error('動画の最後まで確認して「全編を確認した」を保存してください。');
  if (cache.status !== 'complete') throw new Error('骨格の抽出を最後まで完了してください。');
  if (new Set(runs.map((r) => r.metadata?.hand ?? 'right')).size > 1)
    throw new Error('同じシュートする手の設定で比較してください。');
  if (!runs.length || runs.some((r) => r.cacheId !== cache.id || r.assetId !== annotations.assetId))
    throw new Error('同じ動画・骨格データの解析結果を選んでください。');
  return {
    schemaVersion: 1,
    assetId: annotations.assetId,
    cacheId: cache.id,
    labelRevision: annotations.revision,
    coverage: 'human-reviewed-whole-video; sampled-pose',
    results: runs.map((r) => ({
      runId: r.id,
      algorithm: r.algorithm,
      ...matchShotTimes(
        activeLabels(annotations).map((i) => i.time),
        r.shots.map((s) => s.phases.release)
      ),
    })),
  };
}
