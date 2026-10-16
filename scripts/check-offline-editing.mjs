// Long artificial video, actual media decoder + IndexedDB. No personal footage or inference required.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const fixture=process.env.OFFLINE_LONG_VIDEO_FIXTURE;
if(!fixture)throw Error('OFFLINE_LONG_VIDEO_FIXTUREに145秒の人工動画を指定してください。');
const base=process.env.LIVE_TEST_URL ?? 'http://127.0.0.1:5173';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,permissions:['clipboard-read','clipboard-write']});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(20000);
 await page.goto(base);await page.locator('.other-menu>summary').click();await page.locator('[data-page=offline]').click();
 await page.locator('#offline-upload').setInputFiles(fixture);await page.waitForFunction(()=>document.querySelector('#offline-status').textContent.includes('内容を照合'));
 await page.waitForFunction(()=>!document.querySelector('#offline-add').disabled);
 const assetId=await page.locator('#offline-assets').inputValue();
 const labels=()=>page.evaluate(async id=>(await import('/src/offline-storage.js')).getOfflineAnnotations(id),assetId);
 async function ready(){await page.waitForFunction(()=>!document.querySelector('#offline-add').disabled);}
 async function seek(t){await page.locator('#offline-seek').evaluate((e,t)=>{e.value=t;e.dispatchEvent(new Event('input',{bubbles:true}));},t);await ready();await page.waitForFunction(t=>Math.abs(document.querySelector('#offline-player').currentTime-t)<.03,t);}
 async function add(){
  const time=await page.evaluate(()=>{const v=document.querySelector('#offline-player'),t=v.currentTime;document.querySelector('#offline-add').click();return t;});
  await page.waitForFunction(()=>document.querySelector('#offline-save').textContent.includes('読み戻し確認済み'));
  const a=await labels(),item=a.items.at(-1),audit=a.history.at(-1).action.positionAudit;
  assert.ok(Math.abs(item.time-time)<.03);assert.equal(audit.mediaTime,item.time);assert.ok(Math.abs(audit.uiTime-item.time)<.03);
  return item;
 }
 async function marker(id){
  await page.locator(`#offline-truth-markers [data-marker-ids*="${id}"]`).tap();
  const choice=page.locator(`[data-choice-kind=truth][data-choice-id="${id}"]`);if(await choice.isVisible())await choice.tap();await ready();
  assert.ok((await page.locator('#offline-selection').textContent()).includes('選択中：正解'));
  assert.equal(await page.locator('#offline-truth-markers [aria-pressed=true]').count(),1);
 }
 // Exact regression for the previously reproduced 145s/390px timeline snap: 30s became 20s.
 await seek(20);const old=await add();
 const point=await page.locator('#offline-truth-markers').evaluate(track=>{
   const r=track.getBoundingClientRect();
   track.addEventListener('pointerdown',event=>{window.rawTimelinePointer={x:event.clientX,y:event.clientY,type:event.pointerType};},{once:true,capture:true});
   track.addEventListener('click',event=>{window.timelineTap={time:(event.clientX-r.left)/r.width*145,marker:!!event.target.closest('button')};},{once:true,capture:true});
   return {x:r.left+r.width*31/145,y:r.top+22,width:r.width,left:r.left};
 });
 await page.touchscreen.tap(point.x,point.y);await ready();
 const tapped=await page.evaluate(()=>({...window.timelineTap,raw:window.rawTimelinePointer}));
 const rawTime=(tapped.raw.x-point.left)/point.width*145;
 assert.ok(Math.abs(rawTime-31)<.03);
 assert.ok(Math.abs(await page.locator('#offline-player').evaluate(v=>v.currentTime)-rawTime)<.03);
 const at30=await add();assert.ok(Math.abs(at30.time-rawTime)<.03);
 for(const item of [old,at30]){await marker(item.id);await page.locator('#offline-remove-label').click();await ready();}
 assert.equal((await labels()).items.filter(i=>i.active!==false).length,0);
 const registered=[];
 for(const [i,t]of [4,18,32,46,60,74,88,102,116,130].entries()){
  await seek(t);
  if(i%3===1){await page.locator('#offline-play').click();await page.waitForFunction(t=>document.querySelector('#offline-player').currentTime>t+.15,t);}
  if(i%3===2){await page.locator('#offline-play').click();await page.waitForFunction(t=>document.querySelector('#offline-player').currentTime>t+.1,t);await page.locator('#offline-play').click();}
  registered.push(await add());
 }
 assert.equal((await labels()).items.filter(i=>i.active!==false).length,10);
 assert.match(await page.locator('#offline-counts').textContent(),/手動追加 10本.*確認済み正解 10本/);
 // Exact same-time duplicate: both IDs/positions visible in local diagnostic, no changes saved.
 await seek(registered[6].time);await page.locator('#offline-add').click();
 await page.waitForFunction(()=>document.querySelector('#offline-diagnostic-text').textContent.includes('登録せず'));
 const diagnostic=JSON.parse(await page.locator('#offline-diagnostic-text').textContent());
 assert.equal(diagnostic.conflict.id,registered[6].id);assert.equal(diagnostic.usedTime,diagnostic.conflict.time);
 assert.equal(diagnostic.usedTime,diagnostic.mediaTime);assert.equal(diagnostic.usedTime,diagnostic.uiTime);
 await page.locator('#offline-copy-diagnostic').click();
 const copied=JSON.parse(await page.evaluate(()=>navigator.clipboard.readText()));
 assert.equal(copied.conflict.id,registered[6].id);
 assert.equal('landmarks' in copied,false);assert.equal('blob' in copied,false);
 assert.equal((await labels()).items.filter(i=>i.active!==false).length,10);
 await seek(50);
 for(const delta of [-1,1,-3,3]){const before=await page.locator('#offline-player').evaluate(v=>v.currentTime);await page.locator(`[data-offline-skip="${delta}"]`).click();await ready();assert.ok(Math.abs(await page.locator('#offline-player').evaluate(v=>v.currentTime)-(before+delta))<.03);}
 await marker(registered[3].id);await seek(48);await page.locator('#offline-move').click();await ready();
 assert.equal((await labels()).items.find(i=>i.id===registered[3].id).time,48);
 await marker(registered[3].id);assert.ok(Math.abs(await page.locator('#offline-player').evaluate(v=>v.currentTime)-48)<.03);
 await page.locator('#offline-remove-label').click();await ready();
 assert.equal(await page.locator(`#offline-truth-markers [data-marker-id="${registered[3].id}"]`).count(),0);
 assert.equal((await labels()).items.find(i=>i.id===registered[3].id).active,false);
 await seek(48);registered[3]=await add();
 // Details can be scrolled/edited while all primary video controls remain in the viewport.
 for(const size of [{width:320,height:568},{width:390,height:664},{width:390,height:844},{width:430,height:932},{width:844,height:390}]){
  await page.setViewportSize(size);await page.waitForTimeout(80);
  await page.locator('#offline-workspace').evaluate(e=>e.scrollIntoView({block:'start'}));
  await page.locator('#offline-detail-scroll').evaluate(e=>e.scrollTop=e.scrollHeight);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const geometry=await page.evaluate(()=>{
    const get=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};};
    return {header:get('.app-header'),nav:get('.app-nav'),video:get('.offline-stage'),details:get('#offline-detail-scroll'),controls:['#offline-play','[data-offline-skip="-1"]','[data-offline-skip="1"]','[data-offline-skip="-3"]','[data-offline-skip="3"]','#offline-timeline','#offline-add','#offline-move','#offline-remove-label'].map(get)};
  });
  assert.ok(geometry.video.top>=geometry.header.bottom-2,JSON.stringify({size,geometry}));
  for(const r of geometry.controls)assert.ok(r.top>=geometry.header.bottom-2&&r.bottom<=geometry.nav.top+2,JSON.stringify({size,geometry}));
  assert.ok(geometry.details.height>=45);assert.ok(geometry.details.bottom<=geometry.nav.top+2,JSON.stringify({size,geometry}));
  const firstTop=geometry.video.top;
  await page.locator('#offline-detail-scroll').evaluate(e=>e.scrollTop=0);
  assert.ok(Math.abs((await page.locator('.offline-stage').boundingBox()).y-firstTop)<1);
  await page.screenshot({path:`/workspace/work/pr41-v2-${size.width}x${size.height}.png`});
 }
 const saved=await labels();
 await page.reload();await page.locator('.other-menu>summary').click();await page.locator('[data-page=offline]').click();await page.locator('#offline-assets').selectOption(assetId);await ready();
 assert.deepEqual(await labels(),saved);
 assert.deepEqual((await page.locator('#offline-truth-markers [data-marker-time][data-marker-kind=truth]').evaluateAll(es=>es.map(e=>Number(e.dataset.markerTime)))).sort((a,b)=>a-b),saved.items.filter(i=>i.active!==false).map(i=>i.time).sort((a,b)=>a-b));
 assert.equal(saved.items.filter(i=>i.active===false).length,3);assert.ok(saved.history.some(h=>h.action.active===false));
 assert.deepEqual(errors,[]);
 console.log('PASS long artificial video: former 30s→20s snap regression; ten separated releases after seek/pause/playing with UI/check/save audit equality; duplicate diagnostic IDs; marker selection/move/cancel/re-add; ±1/3; fixed portrait/landscape preview with independently scrolling details; reload/history retained. Physical iPhone Safari remains unverified.');
}finally{await browser.close();}
