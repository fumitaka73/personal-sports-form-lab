import {
  compactAsset,
  OFFLINE_SCHEMA,
  unpackOfflineFrames,
  benchmarkRuns,
} from './offline-data.js';
import { readOfflineChunk } from './offline-storage.js';
import { checkAbort } from './backup-hash.js';
// A JSON Blob built chunk by chunk, without a base64 video or one giant landmark array.
export async function exportOfflineTraining(
  asset,
  cache,
  runs,
  annotations,
  { signal, onProgress = () => {} } = {}
) {
  if (!cache || cache.status !== 'complete')
    throw new Error('骨格を最後まで読み取ってから書き出してください。');
  const selected = runs.filter((r) => r.cacheId === cache.id),
    hand = selected[0]?.metadata.hand,
    comparable = selected.filter((r) => r.metadata.hand === hand),
    benchmark =
      annotations.complete && comparable.length
        ? benchmarkRuns(annotations, comparable, cache)
        : null;
  const header = {
    format: 'psfl.offline-training',
    schemaVersion: OFFLINE_SCHEMA,
    exportedAt: new Date().toISOString(),
    asset: compactAsset(asset),
    cache,
    runs: selected,
    annotations,
    benchmark,
    note: '動画は含みません。asset.sha256で元動画と照合します。時刻は動画開始からの秒。自動判定と手動正解は別々です。HomeCourtの表示は正解ラベルではありません。',
  };
  const parts = [JSON.stringify(header).slice(0, -1), ',"poseChunks":['];
  for (let i = 0; i < cache.chunkCount; i++) {
    checkAbort(signal);
    const chunk = await readOfflineChunk(cache.id, i);
    if (!chunk) throw new Error('骨格の一部がありません。書き出しを中止しました。');
    parts.push(
      i ? ',' : '',
      JSON.stringify({
        index: i,
        frames: unpackOfflineFrames(chunk.buffer).map((f) => ({
          ...f,
          landmarks:
            f.landmarks?.map((p) =>
              Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) ? p : null
            ) ?? null,
        })),
      })
    );
    onProgress(i + 1, cache.chunkCount);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  parts.push(']}');
  return new Blob(parts, { type: 'application/json' });
}
