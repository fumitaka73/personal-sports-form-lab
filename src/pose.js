import { calculateMetrics, validatePhases } from './metrics.js';
import { BallTracker, detectBallCandidates } from './ball-tracking.js';
import { classifyOutcome, validHoop } from './shot-outcome.js';
import { detectShotPhases } from './auto-phases.js';
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
export async function analyzeVideo(video, phases, hand, onProgress, signal, phaseEstimated = false, options = {}) {
  const scanRange = options.session ? {start:0,release:video.duration/2,end:video.duration} : options.autoPhases ? { start: 0, release: Math.min(video.duration, 30) / 2, end: Math.min(video.duration, 30) } : phases;
  if(options.session){if(!Number.isFinite(video.duration)||video.duration<=0||video.duration>600)throw new Error('Sessionは10分以内の動画を選んでください。');}
  else validatePhases(scanRange, video.duration);
  const checkCancel = () => { if (signal.aborted) throw new DOMException('分析をキャンセルしました。', 'AbortError'); };
  checkCancel(); onProgress('姿勢推定モデルを準備しています', 0);
  await loadPoseScript(); checkCancel();
  const pose = new window.Pose({ locateFile: file => `${assetRoot}${file}` });
  pose.setOptions({ modelComplexity: 0, smoothLandmarks: false, enableSegmentation: false, selfieMode: false, minDetectionConfidence: 0.25, minTrackingConfidence: 0.25 });
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d'); const frames = [];
  const ballCanvas = document.createElement('canvas');
  const ballScale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
  ballCanvas.width = Math.max(1, Math.round(video.videoWidth * ballScale)); ballCanvas.height = Math.max(1, Math.round(video.videoHeight * ballScale));
  const ballContext = ballCanvas.getContext('2d', { willReadFrequently: true });
  const tracker = new BallTracker(video.videoWidth / video.videoHeight);
  let currentLandmarks = null;
  pose.onResults(results => { currentLandmarks = results.poseLandmarks?.map(p => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })) ?? null; });
  const originalTime = video.currentTime; video.pause();
  try {
    await pose.initialize(); checkCancel();
    const count = Math.ceil((scanRange.end - scanRange.start) * 12);
    for (let i = 0; i <= count; i++) {
      checkCancel();
      const time = scanRange.start + (scanRange.end - scanRange.start) * i / count;
      await seekVideo(video, Math.min(time, video.duration - 0.001)); checkCancel();
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      currentLandmarks = null;
      await pose.send({ image: canvas }, (time - scanRange.start) * 1000);
      ballContext.drawImage(video, 0, 0, ballCanvas.width, ballCanvas.height);
      const candidates = detectBallCandidates(ballContext.getImageData(0, 0, ballCanvas.width, ballCanvas.height));
      const ball = tracker.update(candidates, currentLandmarks, time, hand);
      frames.push({ time, landmarks: currentLandmarks, ball });
      onProgress(`姿勢検出・ボール追跡 ${i + 1}/${count + 1}`, Math.round(85 * (i + 1) / (count + 1)));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    checkCancel(); onProgress('シュート区間とリリース候補を計算しています', 90);
    if(options.session)return {frames,aspect:video.videoWidth/video.videoHeight,range:scanRange};
    const automatic = options.detection ?? (options.autoPhases ? detectShotPhases(frames, hand, video.videoWidth / video.videoHeight, scanRange) : null);
    const selected = automatic?.phases ?? phases;
    const analyzedFrames = frames.filter(f => f.time >= selected.start - 0.001 && f.time <= selected.end + 0.001);
    const analysis = calculateMetrics(analyzedFrames, selected, hand, video.videoWidth / video.videoHeight, automatic ? automatic.source !== 'ball' : phaseEstimated);
    analysis.autoDetection = automatic;
    analysis.phaseSource = automatic?.source ?? 'manual';
    analysis.ballTracking = { method: 'local-orange-color-shape', points: tracker.history, detectedFrames: tracker.history.length, scannedFrames: frames.length, coverage: tracker.history.length / frames.length };
    if (automatic) {
      analysis.warnings = analysis.warnings.filter(w => !w.startsWith('リリース時刻は'));
      analysis.warnings.unshift(automatic.reason);
      // Automatic release inference is approximate even when a colored ball is tracked.
      if (automatic.confidence !== 'High') analysis.lowQuality = true;
    }
    if (!tracker.history.length) analysis.warnings.push('ボールを追跡できませんでした。色・輪郭による検出は主にオレンジ・茶色のボール向けです。');
    analysis.hoop=validHoop(options.hoop)?options.hoop:null;
    if(analysis.hoop){
      try{
      onProgress('ゴール付近までボールの軌道を追跡しています',95);
      const flightStart=Math.max(selected.start,selected.release-0.4);
      const flightEnd=Math.min(video.duration-0.001,selected.release+4,options.outcomeEnd??Infinity);
      const flightCanvas=document.createElement('canvas'),flightScale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));
      flightCanvas.width=Math.round(video.videoWidth*flightScale);flightCanvas.height=Math.round(video.videoHeight*flightScale);
      const flightContext=flightCanvas.getContext('2d',{willReadFrequently:true});
      const flightTracker=new BallTracker(video.videoWidth/video.videoHeight);
      const seed=tracker.history.filter(p=>p.time<=flightStart).at(-1);
      if(seed&&flightStart-seed.time<.3){flightTracker.last=seed;flightTracker.trackId=seed.trackId;}
      const steps=Math.ceil((flightEnd-flightStart)*24);
      for(let i=0;i<=steps;i++){
        checkCancel();const time=flightStart+(flightEnd-flightStart)*i/Math.max(1,steps);
        await seekVideo(video,time);flightContext.drawImage(video,0,0,flightCanvas.width,flightCanvas.height);
        const nearest=frames.reduce((best,f)=>!best||Math.abs(f.time-time)<Math.abs(best.time-time)?f:best,null);
        flightTracker.update(detectBallCandidates(flightContext.getImageData(0,0,flightCanvas.width,flightCanvas.height)),nearest&&Math.abs(nearest.time-time)<.15?nearest.landmarks:null,time,hand);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      analysis.flightTracking={points:flightTracker.history,method:'orange-color-24fps',range:{start:flightStart,end:flightEnd}};
      analysis.outcome=classifyOutcome(flightTracker.history,analysis.hoop,selected.release);
      }catch(error){if(error.name==='AbortError')throw error;analysis.outcome={status:'unknown',label:'判定不能',reason:'ゴール付近の追跡を完了できませんでした。フォームの分析結果は保持しています。'};}
    }else analysis.outcome=classifyOutcome([],null,selected.release);
    return analysis;
  } catch (error) {
    if (error.name === 'AbortError' || error.message.includes('姿勢を十分') || error.message.includes('動きを十分') || error.message.includes('動画')) throw error;
    throw new Error('姿勢推定を実行できませんでした。WebGLが有効なChromeまたはEdgeで再試行してください。');
  } finally {
    await pose.close().catch(() => {});
    await seekVideo(video, originalTime).catch(() => {});
  }
}
