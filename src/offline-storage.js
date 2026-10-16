import { offlineRecord, offlineRecords, offlineWrite, offlineReadChunks } from './storage.js';
import { compactAsset, unpackOfflineFrames, emptyAnnotations } from './offline-data.js';
import { hashBlob, checkAbort } from './backup-hash.js';
export const getOfflineAsset = (id) => offlineRecord('offlineAssets', id);
export const getOfflineCache = (id) => offlineRecord('offlineCaches', id);
export const listOfflineAssets = () => offlineRecords('offlineAssets');
export const listOfflineCaches = (assetId) => offlineRecords('offlineCaches', assetId);
export const listOfflineRuns = (assetId) => offlineRecords('offlineRuns', assetId);
export const getOfflineAnnotations = async (id) =>
  (await offlineRecord('offlineAnnotations', id)) ?? emptyAnnotations(id);
export const readOfflineChunk = (id, index) =>
  offlineRecord('offlineChunks', `${id}:${String(index).padStart(6, '0')}`);
export const writeOfflineCache = (row) => offlineWrite([{ store: 'offlineCaches', row }]);
export async function importOfflineAsset(file, metadata, { signal, onProgress = () => {} } = {}) {
  const hash = await hashBlob(file, { signal, onProgress });
  checkAbort(signal);
  const id = `video-${hash.sha256}`,
    old = await getOfflineAsset(id);
  if (old?.blob) return old;
  const asset = {
    ...old,
    id,
    schemaVersion: 1,
    sha256: hash.sha256,
    bytes: file.size,
    title: old?.title ?? file.name,
    mimeType: file.type || 'video/mp4',
    sourceLastModified: file.lastModified ?? null,
    createdAt: old?.createdAt ?? Date.now(),
    ...metadata,
    blob: file,
  };
  await offlineWrite([{ store: 'offlineAssets', row: asset }]);
  const saved = await getOfflineAsset(id);
  if (!saved?.blob || saved.blob.size !== file.size || saved.sha256 !== hash.sha256)
    throw new Error(
      '元動画の保存を確認できませんでした。写真・ファイルの原本はそのまま残してください。'
    );
  // Hash the stored bytes rather than treating a successful transaction as content proof.
  const verified = await hashBlob(saved.blob, { signal });
  if (verified.sha256 !== hash.sha256) throw new Error('保存した元動画の内容が一致しません。');
  return saved;
}
export async function saveOfflineChunk(cache, index, frames, buffer) {
  await offlineWrite([
    {
      store: 'offlineChunks',
      row: {
        id: `${cache.id}:${String(index).padStart(6, '0')}`,
        cacheId: cache.id,
        assetId: cache.assetId,
        index,
        first: frames[0].time,
        last: frames.at(-1).time,
        buffer,
      },
    },
    { store: 'offlineCaches', row: cache },
  ]);
}
export async function saveOfflineRun(run) {
  await offlineWrite([{ store: 'offlineRuns', row: run }], { immutable: true });
  const saved = await offlineRecord('offlineRuns', run.id);
  if (JSON.stringify(saved) !== JSON.stringify(run))
    throw new Error('解析結果の保存内容を確認できません。');
  return saved;
}
export async function saveOfflineAnnotations(next, expectedRevision) {
  await offlineWrite([{ store: 'offlineAnnotations', row: next }], { expectedRevision });
  const saved = await getOfflineAnnotations(next.assetId);
  if (JSON.stringify(saved) !== JSON.stringify(next))
    throw new Error('保存後の確認に失敗しました。別の画面での変更がないか再読み込みしてください。');
  return saved;
}
export async function loadOfflineWindow(cache, start, end) {
  const chunks = await offlineReadChunks(cache.id, start, end);
  return chunks
    .flatMap((c) => unpackOfflineFrames(c.buffer))
    .filter((f) => f.time >= start && f.time <= end);
}
// Explicit user action only. Preserve every annotation, cache, run, hash and old app record.
export async function removeOfflineVideo(asset) {
  const current = await getOfflineAsset(asset.id);
  if (!current) return;
  const row = { ...compactAsset(current), videoRemovedAt: Date.now() };
  await offlineWrite([{ store: 'offlineAssets', row }]);
  const saved = await getOfflineAsset(asset.id);
  if (saved.blob) throw new Error('動画の削除を確認できませんでした。');
  return saved;
}
