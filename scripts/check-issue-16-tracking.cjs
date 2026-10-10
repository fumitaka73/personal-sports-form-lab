// Optional browser integration check: install Playwright separately and supply
// NODE_PATH to its node_modules. Start npm run dev first. No physical camera is used.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.LIVE_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__cameraRequests=[];window.__tracks=[];window.__closed=0;window.__sends=0;window.__activeInference=0;window.__maxInference=0;window.__mode='freeze';
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

 await page.locator('#coach-start').click();await page.waitForFunction(()=>document.querySelector('#coach-status').textContent.includes('コーチング中'));const count=()=>page.evaluate(()=>window.__spoken.filter(s=>s.text==='トラッキングを再開しました').length);await page.waitForTimeout(1600);assert.equal(await count(),0);
 await page.evaluate(()=>window.__mode='none');await page.waitForTimeout(300);await page.evaluate(()=>window.__mode='freeze');await page.waitForTimeout(1500);assert.equal(await count(),0);
 await page.evaluate(()=>window.__mode='none');await page.waitForTimeout(1400);await page.evaluate(()=>window.__mode='freeze');await page.waitForFunction(()=>window.__spoken.filter(s=>s.text==='トラッキングを再開しました').length===1);assert.match(await page.locator('#coach-tracking-notice').textContent(),/トラッキングを再開しました/);await page.waitForTimeout(1300);assert.equal(await count(),1);assert.equal(await page.locator('#coach-count').textContent(),'0');
 await page.locator('.coach-setup').evaluate(e=>e.open=true);await page.locator('#coach-voice').uncheck();await page.evaluate(()=>window.__mode='none');await page.waitForTimeout(1400);await page.evaluate(()=>window.__mode='freeze');await page.waitForTimeout(1500);assert.equal(await count(),1);assert.match(await page.locator('#coach-tracking-notice').textContent(),/トラッキングを再開しました/);
 await page.locator('.coach-setup').evaluate(e=>e.open=true);await page.locator('#coach-voice').check();await page.evaluate(()=>window.__mode='none');await page.waitForTimeout(1400);await page.evaluate(()=>window.__mode='freeze');await page.waitForFunction(()=>window.__spoken.filter(s=>s.text==='トラッキングを再開しました').length===2);
 await page.locator('#coach-stop').click();const before=await count();await page.locator('#coach-start').click();await page.waitForTimeout(1600);assert.equal(await count(),before);await page.locator('#live-switch').click();await page.waitForFunction(()=>window.__cameraRequests.length>=2);await page.waitForTimeout(1500);assert.equal(await count(),before);assert.deepEqual(errors,[]);await page.locator('.app-nav').getByRole('button',{name:'シュートの確認',exact:true}).click();await page.waitForTimeout(400);assert.equal(await count(),before);console.log('PASS issue16 tracking: first/brief loss silent; sustained loss + stable recovery one voice; repeated loss re-notifies; voice OFF visual only; no ghost shots; session stop/start, camera switch and navigation reset. Synthetic camera/speech, physical Safari untested.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
