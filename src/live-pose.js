import {createPoseEngine,POSE_MODEL} from './pose-engine.js';
import {drawPose} from './pose-coordinates.js';
import {liveMetrics} from './live-metrics.js';
import {ShotDetector} from './shot-detector.js';
const format=(v,suffix='')=>Number.isFinite(v)?`${v.toFixed(1)}${suffix}`:'—';
export function cameraErrorMessage(error){
 const messages={NotAllowedError:'カメラへのアクセスが拒否されました。Safariのサイト設定でカメラを許可し、Start Cameraを押してください。',NotFoundError:'利用できるカメラがありません。',NotReadableError:'カメラを開始できません。他のアプリでカメラを使用していないか確認してください。',OverconstrainedError:'このカメラ設定に対応していません。別のカメラで再試行してください。',SecurityError:'カメラはHTTPSで開いたページで利用してください。'};
 return messages[error?.name]??error?.message??'カメラまたは姿勢推定を開始できませんでした。';
}
export function mountLivePose(container,options={}){
 container.innerHTML=`<section class="panel live-panel"><div class="panel-heading"><div><p class="eyebrow">LIVE POSE v0.25 · EXPERIMENTAL</p><h2>Live Pose (Beta)</h2></div><span class="badge">ON DEVICE</span></div><p>Live video is processed on this device. 映像の送信・録画・保存は行いません。</p><p class="instruction">iPhoneを三脚に置き、全身が映る位置で開始してください。姿勢計測と検出デバッグ専用です。フォーム採点・助言・ボール追跡は行いません。</p><div class="sync-controls"><button id="live-start" class="primary">Start Camera</button><button id="live-stop" class="secondary" disabled>Stop Camera</button><button id="live-switch" class="secondary">前面 / 背面を切り替え</button><span id="live-camera-name">背面カメラを優先</span><label>目標Pose FPS <select id="live-target-fps"><option value="15">15</option><option value="20" selected>20</option><option value="30">30</option></select></label></div><p id="live-status" role="status" aria-live="polite">Start Cameraを押すとカメラの許可を求めます。</p><div class="live-layout"><div><div class="live-stage"><video id="live-video" autoplay muted playsinline></video><canvas id="live-overlay" aria-hidden="true"></canvas></div><p id="live-quality" role="status">Pose: 未検出</p><p id="live-shot-notice" role="status"></p></div><aside><label class="auto-setting"><input id="live-show-metrics" type="checkbox" checked> 基本計測を表示</label><div id="live-metrics"><dl><dt>Pose FPS</dt><dd id="live-pose-fps">—</dd><dt>検出確度 / 可視関節</dt><dd id="live-confidence">—</dd><dt>右肘</dt><dd id="live-right-elbow">—</dd><dt>左肘</dt><dd id="live-left-elbow">—</dd><dt>右膝</dt><dd id="live-right-knee">—</dd><dt>左膝</dt><dd id="live-left-knee">—</dd><dt>体幹傾斜（2D）</dt><dd id="live-torso">—</dd></dl><p class="fineprint">計測値はデバッグ用です。見えない関節は — と表示します。点線と橙色の点は検出確度が低い関節です。</p></div><label class="auto-setting"><input id="live-debug" type="checkbox"> ShotDetector Debug Mode</label><div id="live-detector" hidden><label class="field">シュートする手<select id="live-hand"><option value="right">右手</option><option value="left">左手</option></select></label><p>State: <strong id="live-detector-state">IDLE</strong></p><p>Shots detected: <strong id="live-shot-count">0</strong></p><p class="fineprint">Sessionと同じ姿勢のみの候補検出です。状態表示は検出条件の診断で、成功・失敗やフォーム評価ではありません。</p><dl><dt>手首高さ（体幹比）</dt><dd id="live-wrist-height">—</dd><dt>手首上昇速度（体幹比/秒）</dt><dd id="live-wrist-velocity">—</dd><dt>肘角度</dt><dd id="live-elbow-angle">—</dd><dt>肘角速度（°/秒）</dt><dd id="live-elbow-velocity">—</dd><dt>膝角度（補助・検出に非使用）</dt><dd id="live-knee-angle">—</dd><dt>肩に対する手首位置</dt><dd id="live-shoulder-wrist">—</dd></dl><canvas id="live-signal-history" height="90" aria-label="直近10秒の手首高さ"></canvas><p class="fineprint">直近10秒の手首高さ。再起動・カメラ切替・Debug切替でカウンターと履歴をリセットします。検出は遅れて確定する場合があります。</p></div><details class="live-diagnostics"><summary>Diagnostics · 端末の性能</summary><dl><dt>Camera FPS</dt><dd id="live-camera-fps">—</dd><dt>Pose inference FPS</dt><dd id="live-inference-fps">—</dd><dt>平均推論時間</dt><dd id="live-inference-ms">—</dd><dt>動画解像度</dt><dd id="live-video-resolution">—</dd><dt>推論入力解像度</dt><dd id="live-input-resolution">—</dd><dt>モデル</dt><dd>${POSE_MODEL}</dd></dl><p class="fineprint">目標15〜30FPS。実測値は端末・発熱・省電力設定で変わります。低速の場合は推論解像度を自動で下げます。画面を離れるとカメラは停止します。</p></details></aside></div></section>`;
 const el=id=>container.querySelector(`#${id}`),video=el('live-video'),overlay=el('live-overlay');
 const input=document.createElement('canvas'),context=input.getContext('2d');
 let stream=null,engine=null,sendPromise=null,running=false,disposed=false,token=0,raf=null,videoCallback=null,facing='environment',mirror=false,landmarks=null,lastPoseAt=-Infinity,lastInference=-Infinity,lastVideoTime=-1,lastCameraTime=-1,lastUI=0,edge=480;
 let cameraSamples=[],cameraCounter=0,poseTimes=[],durations=[],detector=null,metrics=liveMetrics(null);
 const text=(id,value)=>{const node=el(id);if(node&&node.textContent!==String(value))node.textContent=value;};
 function resetDetector(){detector=new ShotDetector({hand:el('live-hand').value,aspect:video.videoWidth/video.videoHeight||1,live:true});text('live-shot-count','0');text('live-detector-state','IDLE');text('live-shot-notice','');}
 function updateButtons(pending=false){if(disposed)return;el('live-start').disabled=running||pending;el('live-stop').disabled=!running&&!pending;el('live-switch').disabled=pending;}
 function countCamera(now,frames=++cameraCounter){cameraSamples.push({time:now,frames});while(cameraSamples.length>2&&cameraSamples[1].time<now-1000)cameraSamples.shift();}
 function watchCamera(id){if(!video.requestVideoFrameCallback)return;videoCallback=video.requestVideoFrameCallback((now,metadata)=>{if(id!==token||!running)return;countCamera(now,metadata.presentedFrames);watchCamera(id);});}
 function chart(){const c=el('live-signal-history'),ctx=c.getContext('2d'),w=Math.max(1,c.clientWidth);if(c.width!==w)c.width=w;ctx.clearRect(0,0,w,c.height);const rows=detector?.history??[];if(!rows.length)return;const end=rows.at(-1).time;ctx.strokeStyle='#5b7e3f';ctx.lineWidth=2;ctx.beginPath();let pen=false;for(const r of rows){if(!Number.isFinite(r.wristHeight)){pen=false;continue;}const x=w*(1-(end-r.time)/10),y=c.height*(.5-Math.max(-2,Math.min(2,r.wristHeight))/4);if(pen)ctx.lineTo(x,y);else ctx.moveTo(x,y);pen=true;}ctx.stroke();}
 function paint(now){
  const first=cameraSamples[0],last=cameraSamples.at(-1),cameraFPS=first&&last&&last.time-first.time>150&&now-last.time<2000?(last.frames-first.frames)*1000/(last.time-first.time):null;
  poseTimes=poseTimes.filter(t=>now-t<1000);
  text('live-pose-fps',running?poseTimes.length:'—');text('live-inference-fps',running?poseTimes.length:'—');text('live-camera-fps',running?format(cameraFPS):'—');text('live-confidence',`${Math.round(metrics.confidence*100)}% / ${metrics.visibleCount}/12`);
  for(const [id,key]of[['live-right-elbow','rightElbow'],['live-left-elbow','leftElbow'],['live-right-knee','rightKnee'],['live-left-knee','leftKnee'],['live-torso','torsoLean']])text(id,format(metrics[key],'°'));
  const average=durations.length?durations.reduce((s,t)=>s+t,0)/durations.length:null;text('live-inference-ms',format(average,' ms'));text('live-video-resolution',video.videoWidth?`${video.videoWidth} × ${video.videoHeight}`:'—');text('live-input-resolution',running?`${input.width} × ${input.height}`:'—');
  text('live-quality',!running?'Pose: 未検出':metrics.visibleCount===12?'Full body detected · 全身を検出':metrics.visibleCount?'Full body not detected · 全身が映るよう距離を調整してください':'Pose not detected · 体がカメラに映る位置へ移動してください');
  if(el('live-debug').checked&&detector){const snapshot=detector.snapshot(),s=snapshot.signals;text('live-detector-state',snapshot.state);text('live-shot-count',snapshot.count);for(const [id,key]of[['live-wrist-height','wristHeight'],['live-wrist-velocity','wristVelocity'],['live-elbow-angle','elbowAngle'],['live-elbow-velocity','elbowVelocity'],['live-knee-angle','kneeAngle']])text(id,format(s[key]));text('live-shoulder-wrist',s.shoulderToWrist==='above'?'肩より上':s.shoulderToWrist==='below'?'肩より下':'—');text('live-shot-notice',snapshot.event&&now/1000-snapshot.event.at<1.5?`SHOT DETECTED #${snapshot.count}`:'');chart();}
 }
 async function stop(show=true){
  const wasRunning=running;++token;running=false;if(wasRunning)options.onStop?.();cancelAnimationFrame(raf);if(videoCallback!==null&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(videoCallback);videoCallback=null;
  stream?.getTracks().forEach(track=>track.stop());stream=null;video.pause();video.srcObject=null;landmarks=null;metrics=liveMetrics(null);drawPose(overlay,video,null);updateButtons();if(show&&!disposed)text('live-status','カメラを停止しました。映像は保存していません。');if(!disposed)paint(performance.now());
  const old=engine,pending=sendPromise;engine=null;
  if(old){await pending?.catch(()=>{});await old.close().catch(()=>{});}
 }
 function loop(now,id){
  if(!running||id!==token||disposed)return;
  const aspect=video.videoWidth/video.videoHeight;
  const ratio=`${video.videoWidth} / ${video.videoHeight}`;
  if(video.videoWidth&&video.style.aspectRatio!==ratio)video.style.aspectRatio=ratio;
  if(detector&&Math.abs(detector.aspect-aspect)>.01){detector.aspect=aspect;detector.frames=[];detector.history=[];detector.previous=null;detector.preparation=null;detector.state='IDLE';}
  if(!video.requestVideoFrameCallback&&video.currentTime!==lastCameraTime){lastCameraTime=video.currentTime;countCamera(now);}
  if(now-lastPoseAt>750){landmarks=null;metrics=liveMetrics(null);}
  drawPose(overlay,video,landmarks,mirror);
  if(now-lastUI>=250){paint(now);lastUI=now;}
  const interval=1000/Number(el('live-target-fps').value);
  if(!sendPromise&&now-lastInference>=interval&&video.readyState>=2&&video.currentTime!==lastVideoTime){
   lastInference=now;lastVideoTime=video.currentTime;const scale=Math.min(1,edge/Math.max(video.videoWidth,video.videoHeight));const iw=Math.max(1,Math.round(video.videoWidth*scale)),ih=Math.max(1,Math.round(video.videoHeight*scale));if(input.width!==iw||input.height!==ih){input.width=iw;input.height=ih;}context.drawImage(video,0,0,input.width,input.height);
   const started=performance.now();sendPromise=engine.send({image:input},now).then(()=>{
    if(id!==token)return;const elapsed=performance.now()-started;durations.push(elapsed);durations=durations.slice(-30);
    if(durations.length===30&&durations.reduce((a,b)=>a+b,0)/30>65&&edge>320){edge=edge===480?384:320;durations=[];}
   }).catch(error=>{if(id===token){text('live-status',`姿勢推定を実行できませんでした。SafariのWebGL設定・端末の空きメモリを確認してください。${error.message??''}`);void stop(false);}}).finally(()=>{sendPromise=null;});
  }
  raf=requestAnimationFrame(time=>loop(time,id));
 }
 async function start(){
  if(disposed)return;await stop(false);if(disposed)return;const id=++token;updateButtons(true);text('live-status','カメラを準備しています…');
  try{
   if(!window.isSecureContext)throw Object.assign(new Error('HTTPSでアプリを開いてください。'),{name:'SecurityError'});
   if(!navigator.mediaDevices?.getUserMedia)throw new Error('このブラウザはカメラに対応していません。iPhoneのSafariでHTTPSのページを開いてください。');
   const opened=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}}});
   if(disposed||id!==token){opened.getTracks().forEach(track=>track.stop());return;}
   stream=opened;const settings=stream.getVideoTracks()[0]?.getSettings?.()??{};mirror=(settings.facingMode??facing)==='user';video.style.transform=mirror?'scaleX(-1)':'none';text('live-camera-name',mirror?'前面カメラ（鏡像表示）':'背面カメラ（非鏡像）');video.srcObject=stream;
   await video.play();if(disposed||id!==token)return;
   if(!video.videoWidth)await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{video.removeEventListener('loadedmetadata',ready);reject(new Error('カメラ映像を読み込めませんでした。'));},10000);const ready=()=>{clearTimeout(timeout);resolve();};video.addEventListener('loadedmetadata',ready,{once:true});});
   if(disposed||id!==token)return;video.style.aspectRatio=`${video.videoWidth} / ${video.videoHeight}`;
   const localEngine=await createPoseEngine(results=>{
    if(id!==token||disposed)return;landmarks=results.poseLandmarks?.map(p=>({x:p.x,y:p.y,z:p.z,visibility:p.visibility}))??null;lastPoseAt=performance.now();poseTimes.push(lastPoseAt);poseTimes=poseTimes.filter(t=>lastPoseAt-t<1000);metrics=liveMetrics(landmarks,video.videoWidth/video.videoHeight);
    options.onFrame?.({time:lastInference/1000,landmarks,aspect:video.videoWidth/video.videoHeight});
    if(el('live-debug').checked||options.shouldDetect?.()){const snapshot=detector?.processFrame(lastInference,landmarks);for(const event of snapshot?.events??[])options.onShot?.(event);}
   });
   if(disposed||id!==token){await localEngine.close().catch(()=>{});return;}
   try{await localEngine.initialize();}catch(error){await localEngine.close().catch(()=>{});throw error;}
   if(disposed||id!==token){await localEngine.close().catch(()=>{});return;}
   engine=localEngine;
   edge=480;cameraSamples=[];cameraCounter=0;poseTimes=[];durations=[];lastInference=-Infinity;lastVideoTime=-1;lastCameraTime=-1;lastPoseAt=-Infinity;resetDetector();running=true;options.onStart?.();updateButtons();text('live-status','カメラ動作中 · Live video is processed on this device.');watchCamera(id);raf=requestAnimationFrame(time=>loop(time,id));
  }catch(error){if(id===token&&!disposed){await stop(false);text('live-status',cameraErrorMessage(error));}}
 }
 el('live-start').onclick=()=>void start();el('live-stop').onclick=()=>void stop();el('live-switch').onclick=()=>{facing=facing==='environment'?'user':'environment';if(running)void start();else text('live-camera-name',facing==='user'?'前面カメラを優先':'背面カメラを優先');};
 el('live-show-metrics').onchange=event=>el('live-metrics').hidden=!event.target.checked;
 el('live-debug').onchange=event=>{el('live-detector').hidden=!event.target.checked;if(!options.shouldDetect?.())resetDetector();};el('live-hand').onchange=()=>resetDetector();
 const hidden=()=>{if(document.hidden)void stop();};const leaving=()=>void stop(false);document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leaving);
 const dispose=()=>{disposed=true;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leaving);void stop(false);};
 dispose.isRunning=()=>running;dispose.resetDetector=resetDetector;dispose.setHand=hand=>{el('live-hand').value=hand;el('live-hand').disabled=!!options.shouldDetect?.();resetDetector();};return dispose;
}
