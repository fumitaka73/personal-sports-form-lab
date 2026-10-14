import test from 'node:test';import assert from 'node:assert/strict';
import {FakeDrive} from '../test-support/fake-drive.js';
import {DriveAPI} from '../src/drive-api.js';
import {DriveBackup} from '../src/drive-backup.js';
import {hashBlob,hashText,jsonBlob} from '../src/backup-hash.js';
async function file(blob,path='videos/test.mp4'){return {path,mimeType:blob.type||'video/mp4',makeBlob:async()=>blob,...await hashBlob(blob)};}
function harness(server=new FakeDrive(),ids=new Map(),receipts=new Map()){
 const api=new DriveAPI({token:()=> 'synthetic-token',fetcher:server.fetch.bind(server),sleep:async()=>{}}),saver=new DriveBackup({api,scope:'synthetic-account',readId:async k=>ids.get(k),reserveId:async(k,id)=>{if(!ids.has(k))ids.set(k,id);return ids.get(k);},saveReceipt:async(k,v)=>receipts.set(k,v)});
 return {server,api,saver,ids,receipts};
}
async function plan(){const f=await file(new Blob([new Uint8Array(2300000)],{type:'video/mp4'}));return {sessionId:'synthetic-session',snapshotId:hashText('snapshot'),base:{schema:'personal-sports-form-lab-session',schemaVersion:1,sessionId:'synthetic-session',selection:{videoIds:['test']}},files:[f]};}
test('resumable upload confirms checksums, commits manifest last, identical resend creates no extra files or transfers',async()=>{
 const h=harness(),p=await plan(),progress=[];const first=await h.saver.save(p,{onProgress:s=>progress.push(s)});assert.equal(first.complete,true);assert.equal(h.receipts.size,1);const count=h.server.files.size,putCount=h.server.history.filter(r=>r.method==='PUT').length;
 const manifest=JSON.parse(await h.server.files.get(first.manifestId).blob.text());assert.equal(manifest.uploadState,'complete');assert.equal(manifest.files[0].verified,true);assert.equal(manifest.files[0].sha256,p.files[0].sha256);assert.equal(manifest.files[0].bytes,2300000);
 const again=await h.saver.save(p);assert.equal(again.folderId,first.folderId);assert.equal(h.server.files.size,count);assert.equal(h.server.history.filter(r=>r.method==='PUT').length,putCount);assert.equal(progress.at(-1).phase,'complete');
 assert.ok(h.server.history.filter(r=>r.range?.startsWith('bytes ')&&!r.range.includes('*')).every(r=>{const [,a,b,total]=/bytes (\d+)-(\d+)\/(\d+)/.exec(r.range);return b-a+1<=1048576&&(Number(b)+1===Number(total)||(b-a+1)%262144===0);}));
 const serialized=JSON.stringify({ids:[...h.ids],receipts:[...h.receipts]});assert.ok(!serialized.includes('synthetic-token'));assert.ok(!serialized.includes('upload_id'));
});
test('response lost after bytes arrived resumes from server Range rather than resending blindly',async()=>{
 const h=harness();h.server.dropResponseOnce=true;const p=await plan(),result=await h.saver.save(p);assert.equal(result.complete,true);
 const videoPuts=h.server.history.filter(r=>r.method==='PUT'&&r.range?.startsWith('bytes 0-1048575'));assert.equal(videoPuts.length,1);
});
test('abort and new-page retry keep stable file IDs, preserve local source and previously completed backup',async()=>{
 const h=harness(),p=await plan(),controller=new AbortController();h.server.onChunk=()=>{h.server.onChunk=null;controller.abort();};await assert.rejects(h.saver.save(p,{signal:controller.signal}),{name:'AbortError'});assert.equal(h.receipts.size,0);const files=h.server.files.size;
 const retry=harness(h.server,h.ids,h.receipts),result=await retry.saver.save(p);assert.equal(result.complete,true);assert.equal(h.server.files.size,files+1); // only final manifest was not yet created
 const old=new Map([...h.server.files].map(([id,f])=>[id,f.blob]));const p2={...p,snapshotId:hashText('edited'),files:[await file(jsonBlob({labels:'edited'}),'reviews.json')]};await retry.saver.save(p2);for(const [id,blob]of old)assert.equal(h.server.files.get(id).blob,blob);assert.equal(p.files[0].bytes,2300000);
});
test('quota and auth expiry never confirm completion; reconnect and retry reuse reserved IDs',async()=>{
 const h=harness(),p=await plan();h.server.quota=true;await assert.rejects(h.saver.save(p),e=>e.code==='quota');assert.equal(h.receipts.size,0);h.server.quota=false;
 h.server.onChunk=()=>{h.server.onChunk=null;h.server.authExpired=true;};await assert.rejects(h.saver.save(p),e=>e.code==='auth');assert.equal(h.receipts.size,0);h.server.authExpired=false;assert.equal((await h.saver.save(p)).complete,true);
});
test('expired resumable sessions restart only the incomplete file; rate limit is bounded and recoverable',async()=>{
 const h=harness(),p=await plan();h.server.expireOnce=true;assert.equal((await h.saver.save(p)).complete,true);assert.equal([...h.server.files.values()].filter(f=>f.name==='test.mp4').length,1);
 const rate=harness();const row=await rate.saver.ensure(['test'],'test.mp4',null,'video/mp4');rate.server.rateOnce=true;await assert.rejects(rate.api.upload(row.id,p.files[0]),e=>e.code==='rate');assert.equal(rate.receipts.size,0);assert.ok(await rate.api.upload(row.id,p.files[0]));
});
test('remote tampering, missing checksums and untrusted resumable endpoints cannot yield saved status',async()=>{
 const h=harness(),p=await plan(),result=await h.saver.save(p),video=h.server.files.get(result.files[0].driveFileId);video.sha256Checksum='changed';video.md5Checksum='changed';await assert.rejects(h.saver.save(p),e=>e.code==='conflict');
 const bad=new DriveAPI({token:()=> 'synthetic-token',fetcher:async()=>new Response('',{headers:{Location:'https://attacker.invalid/upload'}}),sleep:async()=>{}});await assert.rejects(bad.request('https://attacker.invalid/upload'),e=>e.code==='endpoint');
 const noHashes=harness();const f=await file(new Blob(['x']));noHashes.server.metadata=function(row){const data=FakeDrive.prototype.metadata.call(this,row);delete data.sha256Checksum;delete data.md5Checksum;return data;};const row=await noHashes.saver.ensure(['test'],'test.mp4',null,'video/mp4');await assert.rejects(noHashes.api.upload(row.id,f),e=>e.code==='verification');assert.equal(noHashes.receipts.size,0);
});
test('ID journal failure stops before content upload; receipt write failure does not falsify verified Drive completion',async()=>{
 const h=harness(),p=await plan();h.saver.reserveId=async()=>{throw new Error('local quota');};await assert.rejects(h.saver.save(p),e=>e.code==='local-state');assert.equal(h.server.files.size,0);
 const ok=harness();ok.saver.saveReceipt=async()=>{throw new Error('local quota');};const result=await ok.saver.save(p);assert.equal(result.complete,true);assert.equal(result.localReceiptSaved,false);
});

test('browser fetch retains its global receiver instead of being called as an API instance method',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async function(){assert.equal(this,globalThis);return new Response(JSON.stringify({user:{permissionId:'test'}}));};
 try{const api=new DriveAPI({token:()=> 'synthetic-token'});assert.equal((await api.account()).permissionId,'test');}finally{globalThis.fetch=old;}
});

test('shared or transferred destination is rejected without creating new data or changing permissions',async()=>{
 const h=harness(),p=await plan();const result=await h.saver.save(p),root=[...h.server.files.values()].find(f=>f.name==='Personal Sports Form Lab'),count=h.server.files.size;root.shared=true;await assert.rejects(h.saver.save(p),e=>e.code==='conflict');assert.equal(h.server.files.size,count);root.shared=false;root.ownedByMe=false;await assert.rejects(h.saver.save(p),e=>e.code==='conflict');assert.equal(h.server.files.size,count);assert.ok(h.server.files.get(result.manifestId));
});

test('different Google accounts use separate ID journals and never overwrite the first account backup',async()=>{
 const h=harness(),p=await plan(),first=await h.saver.save(p),old=new Map([...h.server.files].map(([id,f])=>[id,f.blob]));h.server.userId='second-user';h.saver.scope='second-account';const second=await h.saver.save(p);assert.notEqual(second.folderId,first.folderId);assert.equal([...h.server.files.values()].filter(f=>f.name==='Personal Sports Form Lab').length,2);for(const [id,blob]of old)assert.equal(h.server.files.get(id).blob,blob);
});
