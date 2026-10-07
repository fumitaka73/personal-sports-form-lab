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
 await page.goto(process.env.LIVE_TEST_URL||'http://127.0.0.1:5173/');await page.getByRole('button',{name:'Live Pose (Beta)',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__cameraRequests.length),0);await page.locator('#live-debug').check();await page.locator('#live-start').click();await page.waitForFunction(()=>document.querySelector('#live-status').textContent.includes('動作中'));
 await page.waitForFunction(()=>Number(document.querySelector('#live-shot-count').textContent)>=1,{timeout:10000});await page.evaluate(()=>window.__mode='freeze');assert.equal(await page.locator('#live-shot-count').textContent(),'1');
 assert.equal(await page.evaluate(()=>window.__cameraRequests[0].video.facingMode.ideal),'environment');assert.equal(await page.evaluate(()=>window.__cameraRequests[0].audio),false);assert.equal(await page.locator('#live-video').evaluate(v=>v.muted&&v.playsInline),true);assert.equal(await page.locator('#live-video').evaluate(v=>v.style.transform),'none');
 await page.waitForFunction(()=>Number(document.querySelector('#live-inference-fps').textContent)>0);assert.ok((await page.locator('#live-inference-ms').textContent()).includes('ms'));assert.equal(await page.evaluate(()=>window.__maxInference),1);
 async function aligned(){return page.evaluate(async()=>{const {videoTransform}=await import('/src/pose-coordinates.js');const v=document.querySelector('#live-video'),c=document.querySelector('#live-overlay'),rect=v.getBoundingClientRect(),dpr=Math.min(devicePixelRatio,2),t=videoTransform(v.videoWidth,v.videoHeight,rect.width,rect.height,v.style.transform.includes('-1')),p=window.__lastLandmarks[16];const data=c.getContext('2d').getImageData(Math.round(t.x(p)*dpr)-2,Math.round(t.y(p)*dpr)-2,5,5).data;return data.some((x,i)=>i%4===3&&x>0);});}
 assert.ok(await aligned());await page.setViewportSize({width:844,height:390});await page.evaluate(()=>{window.__cameraCanvas.width=640;window.__cameraCanvas.height=360;});await page.waitForFunction(()=>document.querySelector('#live-video').videoWidth===640);await page.waitForTimeout(350);assert.ok(await aligned());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.evaluate(()=>window.__mode='none');await page.waitForFunction(()=>document.querySelector('#live-right-elbow').textContent==='—');assert.ok((await page.locator('#live-quality').textContent()).includes('not detected'));assert.equal(await page.locator('#live-overlay').evaluate(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)),false);
 await page.evaluate(()=>window.__mode='freeze');await page.waitForFunction(()=>document.querySelector('#live-right-elbow').textContent!=='—');assert.equal(await page.locator('#live-shot-count').textContent(),'1');
 await page.locator('#live-show-metrics').uncheck();assert.equal(await page.locator('#live-metrics').isVisible(),false);
 await page.locator('#live-switch').click();await page.waitForFunction(()=>document.querySelector('#live-status').textContent.includes('動作中')&&document.querySelector('#live-video').style.transform.includes('-1'));assert.equal(await page.evaluate(()=>window.__cameraRequests.at(-1).video.facingMode.ideal),'user');await page.waitForTimeout(300);assert.ok(await aligned());
 await page.locator('#live-stop').click();await page.waitForFunction(()=>window.__tracks.every(t=>t.readyState==='ended'));const sends=await page.evaluate(()=>window.__sends);await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.__sends),sends);assert.equal(await page.locator('#live-video').evaluate(v=>v.srcObject),null);
 await page.evaluate(()=>window.__permissionError=true);await page.locator('#live-start').click();await page.waitForFunction(()=>document.querySelector('#live-status').textContent.includes('拒否'));assert.equal(await page.locator('#live-start').isEnabled(),true);
 await page.evaluate(()=>{window.__permissionError=false;window.__delayCamera=true;});await page.locator('#live-start').click();await page.locator('#live-stop').click();await page.waitForTimeout(500);assert.ok(await page.evaluate(()=>window.__tracks.every(t=>t.readyState==='ended')));
 await page.evaluate(()=>window.__delayCamera=false);await page.locator('#live-start').click();await page.waitForFunction(()=>document.querySelector('#live-status').textContent.includes('動作中'));await page.getByRole('button',{name:'Single Shot',exact:true}).click();await page.waitForFunction(()=>window.__tracks.every(t=>t.readyState==='ended'));
 assert.deepEqual(errors,[]);console.log('PASS: rear/front start-stop, permission denial, canceled start, navigation cleanup, portrait/landscape + DPR overlay alignment, pose loss/recovery, metrics/diagnostics, one in-flight inference, shared detector count without duplicates. Synthetic camera/pose, not physical iPhone.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
