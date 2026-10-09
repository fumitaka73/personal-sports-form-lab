import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=process.env.APP_URL??'http://127.0.0.1:5173';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
await page.route('**/legacy-seed',route=>route.fulfill({contentType:'text/html',body:'<html>Legacy database fixture</html>'}));await page.goto(base+'/legacy-seed');
await page.waitForTimeout(50);const seed=await page.evaluate(async()=>{
 const {frames}=await import('/test-support/shot-frames.js'),{calculateMetrics}=await import('/src/metrics.js'),{selectLegacyCoachFeedback:selectCoachFeedback}=await import('/src/coach-feedback.js'),{collectCases,emptyReviewData}=await import('/src/review-data.js');
 const metadata={shotType:'jump',cameraAngle:'side',hand:'right'},analysis=calculateMetrics(frames(),{start:0,release:1,end:2},'right',1,false),reference={id:'good',title:'Calibration fixture Good',...metadata,analysis,isGoodForm:true};const sessions=[];
 for(const [i,id] of ['train-a','train-b','val-a','val-b'].entries()) {const shots=[];for(let j=0;j<10;j++){const timestamp=100000+i*100000+Math.floor(j/3)*10000+j%3*1000,comparison={version:'test',overall:70,confidence:'Medium',metrics:[{key:'wristHeight',group:'release',label:'Release',unit:'ratio',tolerance:.6,delta:-.4,weight:.5,value:.3,refValue:.7,score:70}],groups:[],warnings:[]};shots.push({number:j+1,timestamp,analysis,comparison,coachFeedback:selectCoachFeedback(comparison)});}sessions.push({id,createdAt:100000+i*100000,endedAt:500000,kind:'live-coach',version:'live-coach-0.4',metadata,goodFormReference:reference,focus:'automatic',shots});}
 const reviews=emptyReviewData();for(const c of collectCases([],[],sessions)){c.labels={...c.labels,detection:'correct',feedbackRating:(c.source.shotNumber-1)%3===0?'useful':'repetitive',submetrics:{release:'too-low'}};reviews.cases[c.id]=c;}
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('sports-form-lab',3);r.onupgradeneeded=()=>{for(const name of ['videos','results','settings','temporaryVideos'])r.result.createObjectStore(name,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const tx=db.transaction(['videos','results','settings'],'readwrite');tx.objectStore('videos').put(reference);for(const s of sessions)tx.objectStore('results').put(s);tx.objectStore('settings').put({id:'referenceId',value:'good'});tx.objectStore('settings').put({id:'review-v04',value:reviews});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();return {reviews:JSON.stringify(reviews),sessions:JSON.stringify(sessions.sort((a,b)=>a.id.localeCompare(b.id)))};
});

// Add independently verified detector truth to the fixture; no inferred times are treated as human truth.
await page.evaluate(async()=>{
 const storage=await import('/src/storage.js'),{frames}=await import('/test-support/shot-frames.js'),{packFrame}=await import('/src/pose-archive.js'),{replayDetection,defaultParameters,reviewFingerprint}=await import('/src/personal-calibration.js');
 const reviews=(await storage.getSetting('review-v04')).value,datasets={};
 for(const [i,id] of ['train-a','train-b','val-a','val-b'].entries()){
  const origin=100+i*100,metadata={shotType:'jump',cameraAngle:'side',hand:'right'},series=Array.from({length:10},(_,j)=>frames().map(f=>{const landmarks=structuredClone(f.landmarks),x=Math.min(1,f.time);landmarks[16].y=.26-.18*x;landmarks[14].y=.35-.06*x;return {time:origin+j*3.2+f.time,landmarks,aspect:1};})).flat();
  const times=replayDetection({metadata,frames:series},{...defaultParameters().detector,minExtension:5,minExtendedElbow:90});
  const buffer=new Float32Array(series.flatMap(f=>packFrame(f,origin))).buffer;
  await storage.savePoseChunk({id:id+':000000',sessionId:id,index:0,buffer},{id,origin,end:series.at(-1).time,createdAt:100000+i*100000,metadata,goodFormId:'good',schema:'pose-trace-1',status:'complete',complete:true,count:series.length,bytes:buffer.byteLength,chunks:1,aspect:1});
  datasets[id]={split:'excluded',truth:{confirmed:true,actualShots:10,events:times.map((e,j)=>({caseId:`live:${id}:${j+1}`,time:e.time})),reviewFingerprint:reviewFingerprint(Object.values(reviews.cases).filter(c=>c.source.recordId===id)),confirmedAt:1}};
 }
 await storage.setSetting('calibration-datasets-v05',datasets);
});
await page.goto(base+'/');await page.locator('[data-page=calibration]').click();await page.waitForSelector('#ai-generate');
assert.equal(await page.locator('.tabs>button').count(),4);
assert.equal(await page.locator('#ai-advanced').evaluate(e=>e.open),false);
await page.locator('#ai-generate').click();await page.waitForSelector('[data-approve="1"]:not([disabled])',{timeout:30000});
assert.equal(await page.locator('[data-approve]').count(),2);
const before=await page.evaluate(async()=>{const s=await import('/src/storage.js');return {active:(await s.getSetting('active-calibration:'+JSON.stringify(['jump','side','right','good'])))?.value??null,datasets:(await s.getSetting('calibration-datasets-v05')).value};});
assert.equal(before.active,null);assert.deepEqual(['train-a','train-b','val-a','val-b'].map(id=>before.datasets[id].split),['training','training','validation','validation']);assert.ok(Object.values(before.datasets).every(v=>v.lockedAt));
await page.locator('[data-approve="0"]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-approve]').length===1);const firstDetector=await page.evaluate(async()=>{const s=await import('/src/storage.js');return (await s.activeCalibration(JSON.stringify(['jump','side','right','good']))).parameters.detector;});
await page.locator('[data-approve="0"]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-approve]').length===0);
const after=await page.evaluate(async()=>{const s=await import('/src/storage.js');return {versions:await s.listCalibrations(),active:await s.activeCalibration(JSON.stringify(['jump','side','right','good'])),reviews:JSON.stringify((await s.getSetting('review-v04')).value)};});
assert.equal(after.versions.length,2);assert.equal(after.active.kind,'feedback');assert.deepEqual(after.active.parameters.detector,firstDetector);assert.equal(after.active.parameters.feedback.suppressCorrections,true);assert.equal(after.reviews,seed.reviews);
await page.locator('#ai-history').evaluate(e=>e.closest('details').open=true);await page.locator('#ai-history').click();assert.equal(await page.locator('#ai-advanced').evaluate(e=>e.open),true);
await page.locator('#calibration-reset').click();await page.waitForFunction(()=>document.querySelector('#ai-basic .applied-setting').textContent.includes('標準ルール'));
// Add two unreviewed shots; basic confirmation takes a choice and save, with independent cue corrections.
await page.evaluate(async()=>{const st=await import('/src/storage.js'),sessions=await st.listResults(),s=sessions.find(s=>s.id==='train-a'),shots=s.shots.slice(0,2).map((shot,i)=>({...shot,number:i+1,coachFeedback:{version:'live-coach-0.6',speak:true,triggers:[{key:'kneeAngle',delta:20},{key:'trunkExtension',delta:10}],text:{ja:'ディップ浅い、腰反りすぎ'},reason:'Synthetic fixture'}}));await st.saveCoachSession({...s,id:'quick-session',shots});});
await page.reload();await page.locator('[data-page=review]').click();await page.locator('[data-review-case="live:quick-session:1"]').click();assert.equal(await page.locator('#review-advanced').evaluate(e=>e.open),false);assert.equal(await page.locator('[data-cue]').count(),2);
await page.locator('[data-quick=correct]').click();await page.locator('#quick-next').click();await page.waitForFunction(()=>document.querySelector('.quick-review').textContent.includes('シュート 2'));
await page.locator('[data-cue="kneeAngle:1"]').selectOption('correct');await page.locator('[data-cue="trunkExtension:1"]').selectOption('incorrect');await page.locator('#quick-next').click();await page.waitForSelector('#review-filter');
const quick=await page.evaluate(async()=>{const s=await import('/src/storage.js');return (await s.getSetting('review-v04')).value.cases;});
assert.equal(quick['live:quick-session:1'].labels.detection,'correct');assert.equal(quick['live:quick-session:1'].labels.evaluation,'unsure');assert.equal(quick['live:quick-session:2'].labels.cueLabels['trunkExtension:1'],'incorrect');assert.equal(quick['live:quick-session:1'].annotationHistory.length,1);
await page.locator('#review-filter').selectOption('all');await page.locator('[data-review-case="live:quick-session:2"]').click();await page.locator('#quick-false').click();await page.waitForSelector('#review-filter');
assert.equal(await page.evaluate(async()=>{const s=await import('/src/storage.js');return (await s.getSetting('review-v04')).value.cases['live:quick-session:2'].labels.detection;}),'false-positive');
// Manual missed-shot correction stays available without video when pose timestamps exist.
await page.locator('#review-data-tools').evaluate(e=>e.open=true);await page.locator('#manual-session').selectOption('train-a');await page.locator('#manual-start').fill('0.1');await page.locator('#manual-end').fill('0.5');await page.locator('#manual-shot-form button').click();await page.waitForFunction(()=>document.querySelector('.quick-review')?.textContent.includes('シュート 11'));
const manual=await page.evaluate(async()=>{const st=await import('/src/storage.js');return (await st.getSetting('review-v04')).value.cases['live:train-a:11'];});assert.equal(manual.manualAdded,true);assert.equal(manual.comparison.overall,null);
await page.locator('#quick-detection').click();await page.waitForSelector('#review-filter');
// Compare-and-set approval cannot overwrite another tab's active version.
const conflict=await page.evaluate(async()=>{const st=await import('/src/storage.js'),version=(await st.listCalibrations())[0];try{await st.commitCalibration({...version,id:'stale-proposal'},'different-active-id');return false;}catch{return !(await st.listCalibrations()).some(v=>v.id==='stale-proposal');}});assert.equal(conflict,true);
for(const width of [320,390,430]){await page.setViewportSize({width,height:844});for(const destination of ['review','calibration','good']){await page.locator(`[data-page=${destination}]`).click();await page.waitForTimeout(80);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${destination} at ${width}`);}}
assert.deepEqual(errors,[]);console.log(JSON.stringify({twoTapReview:true,individualCueLabels:true,falsePositive:true,manualMissedShot:true,atomicApprovalConflict:true,autoAllocation:true,twoSeparatelyApprovedProposals:true,originalsPreserved:true,rollback:true,portraitWidths:[320,390,430],pageErrors:errors}));await browser.close();
