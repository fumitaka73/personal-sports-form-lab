import { shotMotionRows } from './auto-phases.js';
import { replayOfflineRows } from './offline-rules.js';
import { benchmarkRuns, activeLabels } from './offline-data.js';
// Independent of DOM/IndexedDB. The same public export can be checked on a Mac or CI.
export function validateOfflineExport(data) {
  if (
    data?.format !== 'psfl.offline-training' ||
    data.schemaVersion !== 1 ||
    !data.asset?.id ||
    !/^[a-f0-9]{64}$/.test(data.asset.sha256 ?? '')
  )
    throw new Error('対応する動画再解析JSONではありません。');
  const { asset, cache, annotations } = data;
  if (
    !Number.isFinite(asset.duration) ||
    asset.duration <= 0 ||
    asset.duration > 600 ||
    !(asset.width > 0 && asset.height > 0) ||
    cache?.assetId !== asset.id ||
    cache.status !== 'complete' ||
    annotations?.assetId !== asset.id ||
    !Array.isArray(annotations.items) ||
    !Array.isArray(data.poseChunks) ||
    data.poseChunks.length !== cache.chunkCount
  )
    throw new Error('動画・骨格・正解データの対応または完了状態が不正です。');
  if (
    !Number.isInteger(annotations.revision) ||
    annotations.revision < 0 ||
    new Set(annotations.items.map((i) => i.id)).size !== annotations.items.length ||
    annotations.items.some(
      (i) => !i.id || !Number.isFinite(i.time) || i.time < 0 || i.time > asset.duration
    )
  )
    throw new Error('正解ラベルの位置またはIDが不正です。');
  let previous = -1,
    count = 0;
  for (let index = 0; index < data.poseChunks.length; index++) {
    const chunk = data.poseChunks[index];
    if (chunk.index !== index || !Array.isArray(chunk.frames) || chunk.frames.length > 120)
      throw new Error('骨格チャンクの形式が不正です。');
    for (const f of chunk.frames) {
      if (
        !Number.isFinite(f.time) ||
        f.time <= previous ||
        f.time < 0 ||
        f.time > asset.duration + 0.05
      )
        throw new Error('骨格の動画内位置が連続していません。');
      previous = f.time;
      count++;
      if (
        f.landmarks !== null &&
        (!Array.isArray(f.landmarks) ||
          f.landmarks.length !== 33 ||
          f.landmarks.some(
            (p) =>
              p !== null &&
              (!Number.isFinite(p.x) ||
                !Number.isFinite(p.y) ||
                !Number.isFinite(p.z) ||
                !Number.isFinite(p.visibility))
          ))
      )
        throw new Error('骨格の座標形式が不正です。');
    }
  }
  if (count !== cache.frameCount || Math.abs(previous - cache.lastTime) > 0.001)
    throw new Error('骨格の本数が保存情報と一致しません。');
  return data;
}
export function benchmarkOfflineExport(input) {
  const data = validateOfflineExport(input),
    hand = data.runs?.find((r) => r.cacheId === data.cache.id)?.metadata.hand ?? 'right',
    rows = [];
  for (const c of data.poseChunks)
    rows.push(...shotMotionRows(c.frames, hand, data.asset.width / data.asset.height));
  const runs = [
    ['current', 'session-pose-1.2'],
    ['legacy', 'session-pose-1.1@92cfe6b'],
  ].map(([id, algorithm]) => ({
    id,
    assetId: data.asset.id,
    cacheId: data.cache.id,
    algorithm,
    shots: replayOfflineRows(rows, data.asset.duration, id),
  }));
  return {
    ...benchmarkRuns(data.annotations, runs, data.cache),
    sourceSha256: data.asset.sha256,
    hand,
    finalLabels: activeLabels(data.annotations).map((i) => ({
      id: i.id,
      time: i.time,
      outcome: i.outcome,
    })),
    note: '同じ保存済みの骨格・最終有効ラベルを使用。ライブの人物存在チェック・処理落ちは再現しません。単一動画は一般化性能の証明ではありません。',
  };
}
