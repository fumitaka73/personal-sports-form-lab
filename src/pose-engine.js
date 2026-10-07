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
export const POSE_MODEL='MediaPipe Pose Lite (modelComplexity 0)';
export const POSE_OPTIONS=Object.freeze({modelComplexity:0,smoothLandmarks:false,enableSegmentation:false,selfieMode:false,minDetectionConfidence:0.25,minTrackingConfidence:0.25});
export async function createPoseEngine(onResults){
 await loadPoseScript();
 const pose=new window.Pose({locateFile:file=>`${assetRoot}${file}`});
 pose.setOptions({...POSE_OPTIONS});pose.onResults(onResults);
 return pose;
}
