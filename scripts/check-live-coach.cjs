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
   const c=document.createElement('canvas');c.width=320;c.height=480;window.__cameraCanvas=c;const ctx=c.getContext('2d');let frame=0;
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

 await page.addInitScript(()=>{window.__spoken=[];Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},getVoices(){return []},speak(u){window.__spoken.push({text:u.text,lang:u.lang,volume:u.volume,rate:u.rate});}}});});
 await page.goto(process.env.LIVE_TEST_URL||'http://127.0.0.1:5173/');
 await page.evaluate(async()=>{const {calculateMetrics}=await import('/src/metrics.js');const {frames}=await import('/test-support/shot-frames.js');const analysis=calculateMetrics(frames(),{start:0,release:1,end:2},'right',320/480,false);const {saveVideo,setSetting}=await import('/src/storage.js');await saveVideo({id:'coach-good',title:'Coach baseline',createdAt:Date.now(),shotType:'jump',cameraAngle:'side',hand:'right',analysis,blob:new Blob(),notes:''});await setSetting('referenceId','coach-good');});
 await page.reload();await page.locator('.app-nav').getByRole('button',{name:'練習する',exact:true}).click();assert.equal(await page.locator('#coach-start').isEnabled(),false);await page.locator('#live-start').click();await page.waitForFunction(()=>!document.querySelector('#coach-start').disabled);
 await page.locator('#coach-start').click();await page.waitForFunction(()=>document.querySelector('#coach-status').textContent.includes('コーチング中'));await page.locator('.coach-setup').evaluate(e=>e.open=true);await page.locator('.camera-settings').evaluate(e=>e.open=true);await page.locator('.coach-reasons').evaluate(e=>e.open=true);await page.locator('#coach-debug').check();await page.locator('#live-debug').check();await page.waitForFunction(()=>Number(document.querySelector('#coach-count').textContent)>=1,null,{timeout:15000});assert.ok((await page.locator('#coach-details').textContent()).includes('COMPLETE'));assert.ok((await page.locator('#coach-score').textContent()).includes('%'));assert.equal(await page.locator('#coach-reference').isEnabled(),false);
 await page.waitForFunction(()=>Number(document.querySelector('#coach-count').textContent)>=2,null,{timeout:15000});const delays=await page.evaluate(async()=>{const {listResults}=await import('/src/storage.js');return (await listResults()).find(r=>r.kind==='live-coach').shots.map(s=>s.feedbackDelayMs)});assert.ok(delays.every(ms=>ms>=450&&ms<2000));
 await page.locator('.coach-setup').evaluate(e=>e.open=true);await page.locator('#coach-voice').uncheck();const before=await page.evaluate(()=>window.__spoken.length);await page.waitForFunction(()=>Number(document.querySelector('#coach-count').textContent)>=3,null,{timeout:15000});assert.equal(await page.evaluate(()=>window.__spoken.length),before);
 await page.locator('#coach-stop').click();await page.waitForSelector('#coach-summary .session-report');assert.ok((await page.locator('#coach-summary').textContent()).includes('次の練習の参考'));assert.equal(await page.locator('#coach-start').isEnabled(),true);
 const records=await page.evaluate(async()=>{await new Promise(r=>setTimeout(r,150));const {listResults}=await import('/src/storage.js');return await listResults();});const saved=records.find(r=>r.kind==='live-coach');assert.ok(saved.endedAt);assert.equal(saved.shots.length,3);assert.equal(saved.shots[0].analysis.frames,undefined);assert.equal(saved.coachInput.shots.length,3);assert.ok(saved.shots.every(s=>s.comparison.confidence!=='High'));assert.equal(saved.shots[0].coachFeedback.text.ja.length>0,true);assert.ok(await page.evaluate(()=>window.__spoken.some(s=>s.lang==='ja-JP')));
 await page.locator('.coach-setup').evaluate(e=>e.open=true);await page.locator('#coach-language').selectOption('en');await page.locator('.coach-setup').evaluate(e=>e.open=true);await page.locator('#coach-voice').check();await page.locator('#coach-voice-test').click();assert.equal(await page.evaluate(()=>window.__spoken.at(-1).lang),'en-US');
 await page.locator('.other-menu').evaluate(e=>e.open=true);await page.getByRole('button',{name:'履歴',exact:true}).click();await page.waitForFunction(()=>window.__tracks.every(t=>t.readyState==='ended'));await page.getByRole('button',{name:'まとめを見る',exact:true}).click();assert.ok((await page.locator('#screen').textContent()).includes('安定した計測'));
 await page.reload();await page.locator('.other-menu').evaluate(e=>e.open=true);await page.getByRole('button',{name:'履歴',exact:true}).click();assert.ok((await page.locator('#screen').textContent()).includes('3本'));
 await page.locator('.app-nav').getByRole('button',{name:'練習する',exact:true}).click();await page.locator('.coach-setup').evaluate(e=>e.open=true);await page.locator('#coach-language').selectOption('ja');await page.evaluate(()=>window.__mode='none');await page.locator('#live-start').click();await page.waitForFunction(()=>!document.querySelector('#coach-start').disabled);await page.locator('#coach-start').click();
 await page.waitForFunction(()=>document.querySelector('#coach-status').textContent.includes('全身を映して'),null,{timeout:16000});assert.ok(await page.evaluate(()=>window.__spoken.some(s=>s.text==='全身を映して')));assert.ok(await page.evaluate(()=>window.__spoken.every(s=>s.rate===1.25)));
 await page.locator('#coach-stop').click();const afterStop=await page.evaluate(()=>window.__spoken.length);await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>window.__spoken.length),afterStop);await page.locator('#live-stop').click();
 assert.deepEqual(errors,[]);console.log('PASS: Live Coach completed shots, shared scores, 0.5–2s feedback delivery, Japanese/English voice, voice off, diagnostics, summaries, local persistence without camera video/frames, history reload and camera cleanup. Synthetic camera; physical iPhone not tested.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
