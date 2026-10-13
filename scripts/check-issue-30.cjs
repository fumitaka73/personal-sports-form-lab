// Optional browser integration check: install Playwright separately and supply
// NODE_PATH to its node_modules. Start npm run dev first. No physical camera is used.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.LIVE_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__cameraRequests=[];window.__tracks=[];window.__closed=0;window.__sends=0;window.__activeInference=0;window.__maxInference=0;window.__mode='auto';
  navigator.mediaDevices.getUserMedia=async constraints=>{
   window.__cameraRequests.push(constraints);
   if(window.__permissionError)throw new DOMException('denied','NotAllowedError');
   const c=document.createElement('canvas');c.width=window.__shape==='landscape'?640:320;c.height=window.__shape==='portrait'?576:window.__shape==='landscape'?360:480;window.__cameraCanvas=c;const ctx=c.getContext('2d');let frame=0;
   const timer=setInterval(()=>{ctx.fillStyle=frame++%2?'#254638':'#284b3d';ctx.fillRect(0,0,c.width,c.height);},33);
   const stream=c.captureStream(30),track=stream.getVideoTracks()[0],stop=track.stop.bind(track),settings=track.getSettings.bind(track);
   track.stop=()=>{clearInterval(timer);stop();};track.getSettings=()=>({...settings(),facingMode:constraints.video.facingMode.ideal});window.__tracks.push(track);
   if(window.__delayCamera)await new Promise(r=>setTimeout(r,200));return stream;
  };
  window.Pose=class{
   setOptions(options){window.__poseOptions=options;}async initialize(){this.start=performance.now();}async close(){window.__closed++;}onResults(cb){this.cb=cb;}
   async send(){window.__sends++;window.__activeInference++;window.__maxInference=Math.max(window.__maxInference,window.__activeInference);await new Promise(r=>setTimeout(r,12));const time=(performance.now()-this.start)/1000,v=window.__mode==='freeze'?1:Math.min(1,time%4);
    const p=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:.99}));
    for(const [s,e,w,h,k,a]of[[11,13,15,23,25,27],[12,14,16,24,26,28]]){p[s]={x:.5,y:.35,visibility:.99};p[e]={x:.58,y:.35-.12*v,visibility:.99};p[w]={x:.62-.03*v,y:.44-.38*v,visibility:.99};p[h]={x:.5,y:.6-.04*v,visibility:.99};p[k]={x:.63-.12*v,y:.75,visibility:.99};p[a]={x:.5,y:.95,visibility:.99};}
    window.__lastLandmarks=p;this.cb({poseLandmarks:window.__mode==='none'?null:p});window.__activeInference--;
   }
  };
 });

 await page.addInitScript(()=>{
  window.__spoken=[];window.__voiceErrors=[];window.__primed=false;window.__tap=false;
  document.addEventListener('click',()=>{window.__tap=true;setTimeout(()=>window.__tap=false,0);},true);
  Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},resume(){},getVoices(){return []},speak(u){if(!window.__primed&&!window.__tap){window.__voiceErrors.push(u.text);throw new Error('no user activation');}window.__primed=true;window.__spoken.push({text:u.text,tap:window.__tap});}}});
 });
 await page.goto(process.env.LIVE_TEST_URL||'http://127.0.0.1:5173/');
 const original=await page.evaluate(async()=>{
  const s=await import('/src/storage.js'),{frames}=await import('/test-support/shot-frames.js'),{calculateMetrics}=await import('/src/metrics.js'),{defaultParameters}=await import('/src/personal-calibration.js');
  const analysis=calculateMetrics(frames(),{start:0,release:1,end:2},'right',320/480,false);
  await s.saveVideo({id:'coach-good',title:'Good Form fixture',createdAt:1,shotType:'jump',cameraAngle:'side',hand:'right',analysis,blob:new Blob(['original-good-video']),isGoodForm:true});await s.setSetting('referenceId','coach-good');
  await s.saveTemporaryVideo({id:'old-video',sessionId:'old',bytes:103*1048576,blob:new Blob(['original-practice-video']),keep:true,start:0,end:10,expiresAt:0});
  await s.savePoseSession({id:'old-pose',bytes:27*1048576,status:'complete',complete:true,count:1});
  await s.saveCoachSession({id:'old-result',kind:'live-coach',shots:[{number:1,analysis,comparison:{overall:77,version:'test',confidence:'Medium',groups:[],metrics:[],warnings:[]},coachFeedback:{text:{ja:'グッド！',en:'Good'},code:'good',speak:false},detectorEvent:{phases:{start:1,release:2,end:3}}}],createdAt:1,endedAt:2,goodFormReference:{id:'coach-good',title:'Good Form fixture',analysis,hand:'right',shotType:'jump',cameraAngle:'side'},metadata:{hand:'right',shotType:'jump',cameraAngle:'side'}});
  const {emptyReviewData,collectCases}=await import('/src/review-data.js'),reviews=emptyReviewData(),c=collectCases([],[],await s.listResults())[0];c.labels={...c.labels,detection:'correct',notes:'untouched'};c.annotationHistory=[{at:1,labels:structuredClone(c.labels)}];reviews.cases[c.id]=c;await s.setSetting('review-v04',reviews);
  await s.importCalibrations([{id:'old-calibration',scope:'unused',engine:'personal-rules-1',parameters:defaultParameters()}]);
  return {good:JSON.stringify((await s.listVideos()).find(v=>v.id==='coach-good')),result:JSON.stringify((await s.listResults()).find(r=>r.id==='old-result')),review:JSON.stringify((await s.getSetting('review-v04')).value),calibration:JSON.stringify(await s.getCalibration('old-calibration'))};
 });
 async function enter(){await page.reload();await page.locator('.app-nav').getByRole('button',{name:'練習する',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#practice-capacity').textContent.includes('使用'));}
 async function camera(){await page.locator('#live-start').click();await page.waitForFunction(()=>!document.querySelector('#coach-start').disabled);}
 async function end(){await page.locator('#coach-stop').click();await page.waitForSelector('#coach-summary .session-report');await page.waitForFunction(()=>document.querySelector('#coach-status').textContent.includes('セッション終了'));}
 await enter();assert.match(await page.locator('#practice-capacity').innerText(),/103.0.*128.*25.0.*27.0.*32.*5.0/);assert.equal(await page.locator('#coach-voice-test').isVisible(),true);
 await camera();await page.locator('#coach-start').click();await page.waitForFunction(()=>document.querySelector('#coach-status').textContent.includes('コーチング中'));
 await page.waitForFunction(()=>Number(document.querySelector('#coach-count').textContent)>=1,null,{timeout:15000});
 const speech=await page.evaluate(()=>({spoken:window.__spoken,errors:window.__voiceErrors}));assert.equal(speech.spoken[0].text,'開始します');assert.equal(speech.spoken[0].tap,true);assert.ok(speech.spoken.some(v=>v.text!=='開始します'));assert.deepEqual(speech.errors,[]);
 // Full video visible; stage and overlays match the same uncropped rectangle.
 async function geometry(){return page.evaluate(()=>{const v=document.querySelector('#live-video'),stage=v.parentElement,c=document.querySelector('#live-overlay'),r=v.getBoundingClientRect(),a=stage.getBoundingClientRect(),b=c.getBoundingClientRect();return {ratio:r.width/r.height,source:v.videoWidth/v.videoHeight,stageW:a.width,stageH:a.height,w:r.width,h:r.height,cw:b.width,ch:b.height,overflow:document.documentElement.scrollWidth>innerWidth};});}
 for(const [width,height]of [[390,844],[844,390]]){await page.setViewportSize({width,height});await page.waitForTimeout(300);const g=await geometry();assert.ok(Math.abs(g.ratio-g.source)<.01);assert.ok(Math.abs(g.w-g.stageW)<2&&Math.abs(g.h-g.stageH)<2);assert.ok(Math.abs(g.w-g.cw)<2&&Math.abs(g.h-g.ch)<2);assert.equal(g.overflow,false);assert.ok(g.h<height*.65);}
 await end();const normal=await page.evaluate(async()=>{const s=await import('/src/storage.js');const session=(await s.listResults()).filter(r=>r.kind==='live-coach'&&r.id!=='old-result').sort((a,b)=>b.createdAt-a.createdAt)[0];return {session,video:(await s.listTemporaryVideos()).filter(r=>r.sessionId===session.id).map(r=>r.blob.size),pose:(await s.listPoseSessions()).find(r=>r.id===session.id)};});assert.equal(normal.session.recordingStatus,'stopped');assert.equal(normal.session.poseStatus,'complete');assert.ok(normal.video.some(n=>n>0));assert.ok(normal.pose.count>0);
 // Real source aspect changes, camera mirror, and tap mapping share one transform.
 for(const shape of ['portrait','landscape']){
  await page.evaluate(shape=>window.__shape=shape,shape);await page.locator('#live-switch').click();await page.waitForFunction(()=>document.querySelector('#live-status').textContent.startsWith('カメラ動作中'));await page.waitForTimeout(600);
  const g=await geometry();assert.ok(Math.abs(g.ratio-g.source)<.01);
  const mapping=await page.evaluate(async()=>{const {videoTransform}=await import('/src/pose-coordinates.js'),{previewPoint}=await import('/src/live-objects.js');const v=document.querySelector('#live-video'),r=v.getBoundingClientRect(),mirror=v.style.transform.includes('scaleX'),p={x:.3,y:.6},t=videoTransform(v.videoWidth,v.videoHeight,r.width,r.height,mirror),q=previewPoint(v,r,r.left+t.x(p),r.top+t.y(p),mirror);return {dx:Math.abs(q.x-p.x),dy:Math.abs(q.y-p.y)};});assert.ok(mapping.dx<1e-6&&mapping.dy<1e-6);
 }
 await page.locator(`[data-review-session="${normal.session.id}"]`).click();await page.locator(`[data-review-case="live:${normal.session.id}:1"]`).click();await page.waitForSelector('#clip-player:not([hidden])');await page.locator('#clip-player').evaluate(v=>{window.__reviewPlayed=false;window.__reviewFrame=false;v.addEventListener('playing',()=>window.__reviewPlayed=true,{once:true});if(v.requestVideoFrameCallback)v.requestVideoFrameCallback(()=>window.__reviewFrame=true);else v.addEventListener('timeupdate',()=>{if(v.readyState>=2)window.__reviewFrame=true;});});await page.locator('#clip-play').click();await page.waitForFunction(()=>window.__reviewPlayed&&window.__reviewFrame);

 await page.setViewportSize({width:390,height:844});
 // Full application budgets: explicit consent, then live analysis and speech survive.
 await page.evaluate(async()=>{const s=await import('/src/storage.js');await s.saveTemporaryVideo({id:'full-video',sessionId:'fixture',bytes:25*1048576,blob:new Blob(['retained']),keep:true});await s.savePoseSession({id:'full-pose',bytes:5*1048576,status:'complete',complete:true});});
 await enter();await camera();await page.locator('#coach-start').click();await page.waitForSelector('#practice-notice:not([hidden])');assert.match(await page.locator('#practice-error').innerText(),/動画.*保存枠.*姿勢記録/);assert.match(await page.locator('#practice-loss').innerText(),/共有.*再検証/);await page.locator('#practice-continue').click();await page.waitForFunction(()=>document.querySelector('#coach-status').textContent.includes('コーチング中'));await page.waitForFunction(()=>Number(document.querySelector('#coach-count').textContent)>=1,null,{timeout:15000});await end();
 const fallback=await page.evaluate(async()=>{const s=await import('/src/storage.js');return (await s.listResults()).filter(r=>r.kind==='live-coach'&&r.id!=='old-result').sort((a,b)=>b.createdAt-a.createdAt)[0];});assert.equal(fallback.videoEnabled,false);assert.equal(fallback.poseEnabled,false);assert.equal(fallback.recordingStatus,'not-recorded');assert.ok(fallback.shots.length>0);
 // Restore only test fixture byte metadata, never delete any records.
 await page.evaluate(async()=>{const s=await import('/src/storage.js');await s.saveTemporaryVideo({id:'full-video',sessionId:'fixture',bytes:1,blob:new Blob(['retained']),keep:true});await s.savePoseSession({id:'full-pose',bytes:1,status:'complete',complete:true});});
 // Unsupported MediaRecorder and permission-denied start have distinct guidance.
 for(const mode of ['unsupported','permission']){
  await enter();await camera();await page.evaluate(mode=>{window.__originalRecorder=window.MediaRecorder;if(mode==='unsupported')window.MediaRecorder=undefined;else window.MediaRecorder=class extends window.__originalRecorder{start(){throw new DOMException('record denied','NotAllowedError');}};},mode);
  await page.locator('#coach-start').click();await page.waitForSelector('#practice-notice:not([hidden])');assert.match(await page.locator('#practice-error').innerText(),mode==='unsupported'?/録画を利用できません/:/許可されていません/);await page.locator('#practice-continue').click();await page.waitForFunction(()=>document.querySelector('#coach-status').textContent.includes('コーチング中'));await end();
 }
 // Quota failures in initial Pose saving and in a recording segment stay visible.
 await enter();await camera();await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(row,...rest){if(this.name==='poseSessions'&&row.id!=='old-pose'&&row.id!=='full-pose')throw new DOMException('quota','QuotaExceededError');return put.call(this,row,...rest);};});
 await page.locator('#coach-start').click();await page.waitForSelector('#practice-notice:not([hidden])');assert.match(await page.locator('#practice-error').innerText(),/姿勢記録.*空き容量/);await page.locator('#practice-continue').click();await page.waitForFunction(()=>document.querySelector('#coach-status').textContent.includes('コーチング中'));await end();
 await enter();await camera();await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(row,...rest){if(this.name==='temporaryVideos'&&!['old-video','full-video'].includes(row.id))throw new DOMException('quota','QuotaExceededError');return put.call(this,row,...rest);};});await page.locator('#coach-start').click();await page.waitForSelector('#practice-notice:not([hidden])',{timeout:22000});assert.match(await page.locator('#practice-error').innerText(),/動画.*空き容量/);await page.locator('#practice-continue').click();await page.waitForFunction(()=>document.querySelector('#practice-mode').textContent.includes('動画なし'));await end();

 // Result-save failures and inference failures are fatal, with explicit reasons.
 await enter();await camera();await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(row,...rest){if(this.name==='results'&&row.id!=='old-result')throw new DOMException('quota','QuotaExceededError');return put.call(this,row,...rest);};});await page.locator('#coach-start').click();await page.waitForSelector('#coach-summary .session-report');assert.match(await page.locator('#practice-error').innerText(),/練習結果.*空き容量/);assert.match(await page.locator('#coach-status').innerText(),/保存できません/);
 await enter();await camera();await page.locator('#coach-start').click();await page.waitForFunction(()=>document.querySelector('#coach-status').textContent.includes('コーチング中'));await page.evaluate(()=>{window.Pose.prototype.send=async()=>{throw new Error('synthetic inference error');};});await page.waitForSelector('#coach-summary .session-report');assert.match(await page.locator('#practice-error').innerText(),/姿勢分析.*終了/);
 await enter();await page.evaluate(()=>window.__permissionError=true);await page.locator('#live-start').click();await page.waitForSelector('#practice-notice:not([hidden])');assert.match(await page.locator('#practice-error').innerText(),/カメラ.*拒否/);assert.equal(await page.locator('#coach-start').isEnabled(),false);
 await page.reload();const kept=await page.evaluate(async()=>{const s=await import('/src/storage.js');return {good:JSON.stringify((await s.listVideos()).find(v=>v.id==='coach-good')),result:JSON.stringify((await s.listResults()).find(r=>r.id==='old-result')),review:JSON.stringify((await s.getSetting('review-v04')).value),calibration:JSON.stringify(await s.getCalibration('old-calibration')),goodBlob:await (await s.listVideos()).find(v=>v.id==='coach-good').blob.text(),oldVideo:await (await s.listTemporaryVideos()).find(r=>r.id==='old-video').blob.text(),oldPose:(await s.listPoseSessions()).find(r=>r.id==='old-pose').bytes};});assert.equal(kept.good,original.good);assert.equal(kept.result,original.result);assert.equal(kept.review,original.review);assert.equal(kept.calibration,original.calibration);assert.equal(kept.oldVideo,'original-practice-video');assert.equal(kept.goodBlob,'original-good-video');assert.equal(kept.oldPose,27*1048576);assert.deepEqual(errors,[]);
 console.log('PASS Issue30: tap-synchronous voice and first advice; history budgets; recording/pose fallback; recorder support/permission/quota; portrait/landscape uncropped overlays; end/save/report/reload; all original records retained. Synthetic Chromium, not physical iPhone Safari.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
