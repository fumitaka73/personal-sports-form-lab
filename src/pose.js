import { calculateMetrics, validatePhases } from './metrics.js';
const assetRoot = new URL(`${import.meta.env.BASE_URL}pose/`, document.baseURI).href;
let scriptPromise;
function loadPoseScript() {
  if (window.Pose) return Promise.resolve();
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = `${assetRoot}pose.js`;
    script.onload = resolve;
    script.onerror = () => { scriptPromise = null; script.remove(); reject(new Error('姿勢推定モデルを読み込めませんでした。通信状態を確認して再試行してください。')); };
    document.head.append(script);
  });
  return scriptPromise;
}
export function seekVideo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('動画の読み込みに時間がかかっています。別の形式の動画をお試しください。')), 10000);
    function finish(error) { clearTimeout(timeout); video.removeEventListener('seeked', done); video.removeEventListener('error', failed); error ? reject(error) : resolve(); }
    const done = () => finish(); const failed = () => finish(new Error('動画を読み込めませんでした。MP4（H.264）またはWebM形式をお試しください。'));
    video.addEventListener('seeked', done, { once: true }); video.addEventListener('error', failed, { once: true });
    video.currentTime = time;
  });
}
export async function analyzeVideo(video, phases, hand, onProgress, signal, phaseEstimated = false) {
  validatePhases(phases, video.duration);
  const checkCancel = () => { if (signal.aborted) throw new DOMException('分析をキャンセルしました。', 'AbortError'); };
  checkCancel(); onProgress('姿勢推定モデルを準備しています', 0);
  await loadPoseScript(); checkCancel();
  const pose = new window.Pose({ locateFile: file => `${assetRoot}${file}` });
  pose.setOptions({ modelComplexity: 0, smoothLandmarks: false, enableSegmentation: false, selfieMode: false, minDetectionConfidence: 0.25, minTrackingConfidence: 0.25 });
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d'); const frames = [];
  let currentLandmarks = null;
  pose.onResults(results => { currentLandmarks = results.poseLandmarks?.map(p => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })) ?? null; });
  const originalTime = video.currentTime; video.pause();
  try {
    await pose.initialize(); checkCancel();
    const count = Math.ceil((phases.end - phases.start) * 12);
    for (let i = 0; i <= count; i++) {
      checkCancel();
      const time = phases.start + (phases.end - phases.start) * i / count;
      await seekVideo(video, Math.min(time, video.duration - 0.001)); checkCancel();
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      currentLandmarks = null;
      await pose.send({ image: canvas }, (time - phases.start) * 1000);
      frames.push({ time, landmarks: currentLandmarks });
      onProgress(`フレーム抽出・姿勢検出 ${i + 1}/${count + 1}`, Math.round(85 * (i + 1) / (count + 1)));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    checkCancel(); onProgress('指定したシュート区間の計測値を計算しています', 90);
    return calculateMetrics(frames, phases, hand, video.videoWidth / video.videoHeight, phaseEstimated);
  } catch (error) {
    if (error.name === 'AbortError' || error.message.includes('姿勢を十分') || error.message.includes('動きを十分') || error.message.includes('動画')) throw error;
    throw new Error('姿勢推定を実行できませんでした。WebGLが有効なChromeまたはEdgeで再試行してください。');
  } finally {
    await pose.close().catch(() => {});
    await seekVideo(video, originalTime).catch(() => {});
  }
}
