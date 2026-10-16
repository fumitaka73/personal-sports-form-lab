import appPackage from '../package.json';
import { createPoseEngine, POSE_OPTIONS, POSE_MODEL } from './pose-engine.js';
import { seekVideo } from './pose.js';
import { calculateMetrics } from './metrics.js';
import { reviewShot } from './shot-engine.js';
import { shotMotionRows } from './auto-phases.js';
import { SESSION_POSE_THRESHOLDS } from './session.js';
import { hashText, jsonText, checkAbort } from './backup-hash.js';
import {
  OFFLINE_CACHE_VERSION,
  OFFLINE_ALGORITHMS,
  OFFLINE_FEATURE_VERSION,
  packOfflineFrames,
  unpackOfflineFrames,
} from './offline-data.js';
import {
  writeOfflineCache,
  saveOfflineChunk,
  readOfflineChunk,
  listOfflineCaches,
  saveOfflineRun,
  loadOfflineWindow,
} from './offline-storage.js';
const yieldUI = () => new Promise((resolve) => setTimeout(resolve, 0));
const bounded = (promise, ms, label, signal) =>
  new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        error ? reject(error) : resolve(value);
      },
      abort = () => finish(new DOMException('中断', 'AbortError')),
      timer = setTimeout(() => finish(new Error(label)), ms);
    Promise.resolve(promise).then(
      (value) => finish(null, value),
      (error) => finish(error)
    );
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
export function extractionConfig(asset, fps) {
  if (![15, 30].includes(fps)) throw new Error('骨格の読み取り間隔を選んでください。');
  return {
    schema: OFFLINE_CACHE_VERSION,
    model: POSE_MODEL,
    modelPackageVersion: appPackage.dependencies['@mediapipe/pose'],
    options: POSE_OPTIONS,
    inputLongEdge: 640,
    fps,
    videoSha256: asset.sha256,
    width: asset.width,
    height: asset.height,
    timing: 'video-media-seconds',
    ballTracking: false,
  };
}
// Request a presented frame when supported. Explicitly label seek-time fallback;
// never call this a verified extraction of every source frame.
export async function readVideoSample(video, time, signal) {
  checkAbort(signal);
  let frameId = null,
    timer,
    resolveFrame;
  const presented =
    video.requestVideoFrameCallback && Math.abs(video.currentTime - time) > 0.001
      ? new Promise((resolve) => {
          resolveFrame = resolve;
          frameId = video.requestVideoFrameCallback((now, metadata) =>
            resolve({ time: metadata.mediaTime, timing: 'presented-media-time' })
          );
          timer = setTimeout(() => resolve(null), 1500);
        })
      : Promise.resolve(null);
  try {
    await bounded(seekVideo(video, time), 11000, '動画の読み込みが進みません。', signal);
    checkAbort(signal);
    const frame = await bounded(presented, 2000, '映像の表示を確認できませんでした。', signal);
    // A pending callback can describe the frame BEFORE the seek, especially when paused.
    // Keep every requested sample; do not silently discard it as a duplicate old frame.
    await bounded(
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      2000,
      '画面の更新が止まったため中断しました。',
      signal
    );
    checkAbort(signal);
    return frame && Number.isFinite(frame.time) && Math.abs(frame.time - video.currentTime) < 0.025
      ? frame
      : { time: video.currentTime, timing: 'seek-time-estimate' };
  } finally {
    clearTimeout(timer);
    if (frameId !== null) video.cancelVideoFrameCallback?.(frameId);
    resolveFrame?.(null);
  }
}
export async function extractOfflinePose(
  video,
  asset,
  {
    fps = 15,
    force = false,
    signal,
    onProgress = () => {},
    engineFactory = createPoseEngine,
    readFrame = readVideoSample,
  } = {}
) {
  const config = extractionConfig(asset, fps),
    key = hashText(jsonText(config)),
    old = (await listOfflineCaches(asset.id)).find((c) => c.key === key && c.status === 'complete');
  if (old && !force) {
    onProgress('保存済みの骨格を使用します', 1);
    return old;
  }
  const cache = {
    id: crypto.randomUUID(),
    assetId: asset.id,
    schemaVersion: 1,
    key,
    config,
    status: 'extracting',
    createdAt: Date.now(),
    duration: asset.duration,
    chunkCount: 0,
    frameCount: 0,
    poseFrameCount: 0,
    requestedCount: 0,
    duplicates: 0,
    maxGap: 0,
    timing: { presented: 0, estimated: 0 },
    coverage: 'sampled-whole-duration',
    firstTime: null,
    lastTime: null,
  };
  await writeOfflineCache(cache);
  let pose,
    landmarks = null,
    pending = [],
    index = 0;
  const originalTime = video.currentTime;
  const flush = async () => {
    if (!pending.length) return;
    const chunk = pending;
    pending = [];
    cache.chunkCount = index + 1;
    await saveOfflineChunk(cache, index++, chunk, packOfflineFrames(chunk));
  };
  try {
    checkAbort(signal);
    onProgress('姿勢推定モデルを準備しています', 0);
    pose = await bounded(
      engineFactory((r) => {
        landmarks =
          r.poseLandmarks?.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })) ??
          null;
      }),
      45000,
      '姿勢推定モデルを読み込めませんでした。通信状態を確認してください。',
      signal
    );
    await bounded(
      pose.initialize(),
      45000,
      '姿勢推定の準備が完了しませんでした。元動画は保存済みです。',
      signal
    );
    checkAbort(signal);
    const canvas = document.createElement('canvas'),
      scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    video.pause();
    const count = Math.ceil(asset.duration * fps);
    for (let i = 0; i <= count; i++) {
      checkAbort(signal);
      if (document.hidden)
        throw new DOMException('画面が非表示になったため安全に中断しました。', 'AbortError');
      const requested = Math.min(i / fps, asset.duration - 0.001),
        sample = await readFrame(video, requested, signal);
      checkAbort(signal);
      cache.requestedCount++;
      if (!Number.isFinite(sample.time) || sample.time < 0 || sample.time > asset.duration + 0.05)
        throw new Error('動画内の位置を読み取れませんでした。');
      if (cache.lastTime !== null && sample.time <= cache.lastTime + 0.00001) {
        cache.duplicates++;
        continue;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      landmarks = null;
      await bounded(
        pose.send({ image: canvas }, sample.time * 1000),
        45000,
        '骨格の読み取りが進まないため中断しました。元動画と以前の修正は保持しています。',
        signal
      );
      checkAbort(signal);
      cache.frameCount++;
      if (landmarks) cache.poseFrameCount++;
      cache.timing[sample.timing === 'presented-media-time' ? 'presented' : 'estimated']++;
      if (cache.lastTime !== null)
        cache.maxGap = Math.max(cache.maxGap, sample.time - cache.lastTime);
      cache.firstTime ??= sample.time;
      cache.lastTime = sample.time;
      pending.push({ time: sample.time, landmarks });
      if (pending.length >= 120) await flush();
      onProgress(
        `骨格を読み取り中 ${i + 1}/${count + 1}（画面を開いたままにしてください）`,
        (i + 1) / (count + 1)
      );
      await yieldUI();
    }
    await flush();
    if (!cache.frameCount || cache.firstTime > 0.2 || asset.duration - cache.lastTime > 0.2)
      throw new Error(
        '動画の先頭から最後まで読み取れませんでした。未完了の記録として保持しています。'
      );
    cache.status = 'complete';
    cache.finishedAt = Date.now();
    await writeOfflineCache(cache);
    return cache;
  } catch (error) {
    await flush().catch(() => {});
    cache.status = error.name === 'AbortError' ? 'cancelled' : 'failed';
    cache.error = error.message;
    await writeOfflineCache(cache).catch(() => {});
    throw error;
  } finally {
    if (pose) await bounded(Promise.resolve(pose.close()), 3000, '終了待ち').catch(() => {});
    if (!document.hidden)
      await bounded(seekVideo(video, originalTime), 2000, '再生位置の復元待ち').catch(() => {});
  }
}
export async function rowsFromCache(cache, { signal, onProgress = () => {} } = {}) {
  if (cache.status !== 'complete') throw new Error('骨格の読み取りが未完了です。');
  const rows = [];
  for (let i = 0; i < cache.chunkCount; i++) {
    checkAbort(signal);
    const c = await readOfflineChunk(cache.id, i);
    if (!c) throw new Error('骨格データの一部が見つかりません。読み取り直してください。');
    const frames = unpackOfflineFrames(c.buffer);
    rows.push(
      ...shotMotionRows(frames, cache.hand ?? 'right', cache.config.width / cache.config.height)
    );
    onProgress(i + 1, cache.chunkCount);
    await yieldUI();
  }
  return rows;
}
async function replayInWorker(rows, duration, algorithm, signal) {
  checkAbort(signal);
  if (typeof Worker === 'undefined')
    throw new Error(
      'このブラウザは別スレッドでの再解析に対応していません。Safariを更新してください。元動画と修正は保持しています。'
    );
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./offline-replay-worker.js', import.meta.url), {
        type: 'module',
      }),
      timer = setTimeout(
        () => finish(new Error('検出ルールの処理に時間がかかりすぎています。')),
        60000
      );
    const abort = () => finish(new DOMException('中断', 'AbortError'));
    function finish(error, value) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      error ? reject(error) : resolve(value);
    }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) =>
      event.data.error ? finish(new Error(event.data.error)) : finish(null, event.data.shots);
    worker.onerror = () =>
      finish(new Error('再解析の処理を開始できませんでした。ページを開き直してください。'));
    worker.postMessage({ rows, duration, algorithm });
  });
}
export async function runOfflineAnalysis(
  asset,
  cache,
  { metadata, reference = null, algorithm = 'current', appVersion, signal, onProgress = () => {} }
) {
  const rows = await rowsFromCache(
    { ...cache, hand: metadata.hand },
    {
      signal,
      onProgress: (n, total) =>
        onProgress('保存した骨格からシュート候補を検出しています', (n / total) * 0.5),
    }
  );
  checkAbort(signal);
  const detections = await replayInWorker(rows, asset.duration, algorithm, signal),
    shots = [];
  for (let i = 0; i < detections.length; i++) {
    checkAbort(signal);
    const candidate = detections[i],
      frames = await loadOfflineWindow(cache, candidate.phases.start, candidate.phases.end);
    const analysis = calculateMetrics(
      frames,
      candidate.phases,
      metadata.hand,
      asset.width / asset.height,
      true
    );
    const { frames: unused, ...summary } = analysis;
    const evaluation = reference?.analysis
      ? reviewShot(reference.analysis, analysis, reference, metadata)
      : null;
    shots.push({ id: `shot-${i + 1}`, number: i + 1, ...candidate, analysis: summary, evaluation });
    onProgress(
      `フォームを分析中 ${i + 1}/${detections.length}`,
      0.5 + (0.5 * (i + 1)) / detections.length
    );
    await yieldUI();
  }
  checkAbort(signal);
  const run = {
    id: crypto.randomUUID(),
    assetId: asset.id,
    cacheId: cache.id,
    schemaVersion: 1,
    algorithm: OFFLINE_ALGORITHMS[algorithm],
    algorithmKey: algorithm,
    featureVersion: OFFLINE_FEATURE_VERSION,
    parameters: { ...SESSION_POSE_THRESHOLDS },
    mode: 'offline-pose-only-session',
    livePresenceGates: false,
    metadata,
    referenceId: reference?.id ?? null,
    referenceSnapshot: reference?.analysis
      ? {
          id: reference.id,
          title: reference.title,
          metadata: {
            hand: reference.hand,
            cameraAngle: reference.cameraAngle,
            shotType: reference.shotType,
          },
          analysis: (({ frames, ...rest }) => rest)(reference.analysis),
        }
      : null,
    shots,
    createdAt: Date.now(),
    appVersion,
  };
  return saveOfflineRun(run);
}
