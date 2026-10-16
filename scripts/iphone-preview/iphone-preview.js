// Test-only helper. No network, video access, storage reset, or application algorithm changes.
const measurements='psfl-pr41-test-measurements';
const elapsed=ms=>`${Math.floor(ms/60000)}分${Math.floor(ms/1000)%60}秒`;
let started=null;
const bar=document.createElement('section');bar.className='iphone-test-bar';bar.setAttribute('aria-label','PR41テスト環境');
bar.innerHTML='<div><strong>PR41 テスト版 · 登録位置修正版</strong><button type="button" id="iphone-open-video">動画を試す</button><a href="./iphone-test.html" target="_blank" rel="noopener">確認手順</a></div><small>本番とは別の保存先 · 動画の外部送信なし</small><p id="iphone-elapsed" role="status" hidden></p><button id="iphone-copy-result" type="button" hidden>所要時間をコピー</button>';
const attach=()=>{const header=document.querySelector('.app-header');if(!header)return false;header.after(bar);document.querySelector('.app-name').textContent='SPORTS FORM LAB · テスト版';return true;};
if(!attach()){const timer=setInterval(()=>{if(attach())clearInterval(timer);},100);}
const output=bar.querySelector('#iphone-elapsed'),copy=bar.querySelector('#iphone-copy-result');
let record=null;
try{record=JSON.parse(localStorage.getItem(measurements)??'null');}catch{}
if(record){output.hidden=false;output.textContent=`前回の骨格抽出：${elapsed(record.elapsedMs)} · ${record.result}`;copy.hidden=false;}
bar.querySelector('#iphone-open-video').onclick=()=>{const button=document.querySelector('[data-page="offline"]');if(button&&!button.disabled)button.click();};
document.addEventListener('click',event=>{if(event.target.closest('#offline-extract')&&!event.target.closest('button').disabled){started={at:Date.now(),clock:performance.now()};output.hidden=false;copy.hidden=true;output.textContent='骨格抽出を計測中：0分0秒';}},true);
setInterval(()=>{
 if(!started)return;const progress=document.querySelector('#offline-progress-area'),busy=progress&&!progress.hidden;
 if(busy){output.textContent=`骨格抽出を計測中：${elapsed(performance.now()-started.clock)}`;return;}
 const status=document.querySelector('#offline-status')?.textContent??'',complete=status.includes('骨格の読み取りを保存');
 record={startedAt:started.at,elapsedMs:Date.now()-started.at,result:complete?'完了':'中断・未完了'};started=null;
 output.textContent=`骨格抽出：${elapsed(record.elapsedMs)} · ${record.result}`;copy.hidden=false;
 try{localStorage.setItem(measurements,JSON.stringify(record));}catch{}
},1000);
copy.onclick=async()=>{if(!record)return;const text=`PR41 iPhoneテスト\n骨格抽出 ${elapsed(record.elapsedMs)} / ${record.result}\nフリーズ：\n発熱（体感）：\n中断後の保存：\n手動修正・再解析：\nLive Coach：`;
 try{await navigator.clipboard.writeText(text);copy.textContent='コピーしました';}catch{output.textContent=text;output.style.whiteSpace='pre-wrap';}};
