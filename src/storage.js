import {iterateChunks,POSE_STRIDE} from './pose-archive.js';
import {ratingEntry} from './session-feedback.js';
const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('sports-form-lab', 5);
  request.onupgradeneeded = () => {
    for (const name of ['videos', 'results', 'settings', 'temporaryVideos', 'poseSessions', 'poseChunks', 'calibrations', 'offlineAssets', 'offlineCaches', 'offlineChunks', 'offlineRuns', 'offlineAnnotations']) {
      if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('別のタブを閉じてから再読み込みしてください。'));
});
async function transact(storeName, mode, action) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = action(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('保存が中断されました'));
  });
}
export const listVideos = () => transact('videos', 'readonly', store => store.getAll());
export const saveVideo = video => transact('videos', 'readwrite', store => store.put(video));
export const deleteVideo = id => transact('videos', 'readwrite', store => store.delete(id));
export const listResults = () => transact('results', 'readonly', store => store.getAll());
export const getSetting = id => transact('settings', 'readonly', store => store.get(id));
export const setSetting = (id, value) => transact('settings', 'readwrite', store => store.put({ id, value }));
export const deleteResult = id => transact('results', 'readwrite', store => store.delete(id));
// Store video, reference pointer, and result atomically: quota errors leave no partial records.
export async function commitAnalysis(video, referenceId, result = null, reviewData = null) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['videos', 'results', 'settings'], 'readwrite');
    tx.objectStore('videos').put(video);
    if(reviewData)tx.objectStore('settings').put({id:'review-v04',value:reviewData});
    if (result) tx.objectStore('results').put(result);
    else tx.objectStore('settings').put({ id: 'referenceId', value: referenceId });
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
// Persist the original session video and its per-shot results together.
export async function commitSession(video, sessions) {
  const db=await database;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['videos','settings'],'readwrite');
    tx.objectStore('videos').put(video);
    tx.objectStore('settings').put({id:'sessions',value:sessions});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}

export const saveCoachSession = session => transact('results', 'readwrite', store => store.put(session));

export const listTemporaryVideos = () => transact('temporaryVideos','readonly',s=>s.getAll());
export const saveTemporaryVideo = row => transact('temporaryVideos','readwrite',s=>s.put(row));
export const deleteTemporaryVideo = id => transact('temporaryVideos','readwrite',s=>s.delete(id));

export const listPoseSessions=()=>transact('poseSessions','readonly',s=>s.getAll());
export const savePoseSession=row=>transact('poseSessions','readwrite',s=>s.put(row));
export const listCalibrations=()=>transact('calibrations','readonly',s=>s.getAll());
export const getCalibration=id=>transact('calibrations','readonly',s=>s.get(id));
export async function savePoseChunk(chunk,session){
 const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction(['poseChunks','poseSessions'],'readwrite');let error;try{tx.objectStore('poseChunks').put(chunk);tx.objectStore('poseSessions').put(session);}catch(e){error=e;tx.abort();}tx.oncomplete=resolve;tx.onerror=()=>reject(error??tx.error);tx.onabort=()=>reject(error??tx.error);});
}
export async function loadPoseChunks(id){const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction('poseChunks','readonly'),r=tx.objectStore('poseChunks').getAll(IDBKeyRange.bound(id+':',id+':\uffff'));tx.oncomplete=()=>resolve(r.result.sort((a,b)=>a.index-b.index));tx.onerror=()=>reject(tx.error);});}
export async function deletePoseSession(id){const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction(['poseChunks','poseSessions'],'readwrite');tx.objectStore('poseChunks').delete(IDBKeyRange.bound(id+':',id+':\uffff'));tx.objectStore('poseSessions').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
// Approval and pointer update are atomic. Imported versions are never activated.
export async function commitCalibration(version,expectedActiveId=undefined){
 const db=await database;return new Promise((resolve,reject)=>{
  const tx=db.transaction(['calibrations','settings'],'readwrite'),settings=tx.objectStore('settings');let conflict=null;
  const write=()=>{tx.objectStore('calibrations').add(version);settings.put({id:'active-calibration:'+version.scope,value:version.id});};
  if(expectedActiveId===undefined)write();else{const request=settings.get('active-calibration:'+version.scope);request.onsuccess=()=>{if((request.result?.value??null)!==expectedActiveId){conflict=new Error('別の画面で適用設定が変わりました。改善案を作り直してください。');tx.abort();}else write();};}
  tx.oncomplete=resolve;tx.onerror=()=>reject(conflict??tx.error);tx.onabort=()=>reject(conflict??tx.error);
 });
}
export async function activeCalibration(scope){const pointer=await getSetting('active-calibration:'+scope);return pointer?.value?getCalibration(pointer.value):null;}
export async function importCalibrations(records){const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction('calibrations','readwrite'),store=tx.objectStore('calibrations');for(const row of records){const r=store.get(row.id);r.onsuccess=()=>{if(!r.result)store.add(row);};}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}

// Merge one weak session rating atomically, preserving the latest comments and shot labels.
export async function saveSessionRating(session,ratings,note,condition,basis){
 const db=await database;return new Promise((resolve,reject)=>{
  const tx=db.transaction('settings','readwrite'),store=tx.objectStore('settings'),request=store.get('review-v04');let saved,error;
  request.onsuccess=()=>{try{const data=structuredClone(request.result?.value??{version:1,cases:{},references:{},sessionFeedback:{},verification:{}}),key=`live:${session.id}`;data.sessionFeedback[key]=ratingEntry(session,data.sessionFeedback[key],ratings,note,condition,basis);saved=data;store.put({id:'review-v04',value:data});}catch(e){error=e;tx.abort();}};
  tx.oncomplete=()=>resolve(saved);tx.onerror=()=>reject(error??tx.error);tx.onabort=()=>reject(error??tx.error);
 });
}
// Save a generated shot clip without changing source segments or other shots.
export async function saveShotClip(row,limit=128*1024*1024){
 const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction('temporaryVideos','readwrite'),store=tx.objectStore('temporaryVideos'),request=store.getAll();let error;
 request.onsuccess=()=>{const existing=request.result.find(r=>r.id===row.id),total=request.result.filter(r=>r.id!==row.id).reduce((n,r)=>n+r.bytes,0);if(total+row.bytes>limit){error=new Error('クリップ保存の容量上限です。元動画は保持しました。不要な動画を保存・整理してください。');tx.abort();return;}store.put({...row,keep:existing?.keep??row.keep});};
 tx.oncomplete=resolve;tx.onerror=()=>reject(error??tx.error);tx.onabort=()=>reject(error??tx.error);
 });
}
// Stream only the requested pose window; do not expand a whole session on iPhone.
export async function loadPoseWindow(id,start,end,maxFrames=600){
 const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction(['poseSessions','poseChunks'],'readonly'),request=tx.objectStore('poseSessions').get(id),frames=[];
 request.onsuccess=()=>{const session=request.result;if(!session)return;const cursor=tx.objectStore('poseChunks').openCursor(IDBKeyRange.bound(id+':',id+':\uffff'));cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;const packed=new Float32Array(row.value.buffer);if(session.origin+packed[packed.length-POSE_STRIDE]<start){row.continue();return;}if(session.origin+packed[0]>end)return;for(const frame of iterateChunks([row.value],session.origin)){if(frame.time>end||frames.length>=maxFrames)return;if(frame.time>=start)frames.push(frame);}row.continue();};};
 tx.oncomplete=()=>resolve(frames);tx.onerror=()=>reject(tx.error);
 });
}

// Detection checks live in a separate settings record, with optimistic concurrency.
export async function commitDetectionCheck(next,expectedRevision){
 const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction('settings','readwrite'),store=tx.objectStore('settings'),id='detection-check:'+next.sessionId,r=store.get(id);let error;
 r.onsuccess=()=>{try{if((r.result?.value?.revision??0)!==expectedRevision){error=new Error('別の画面で確認結果が更新されました。再読み込みしてください。');tx.abort();return;}store.put({id,value:next});}catch(e){error=e;tx.abort();}};tx.oncomplete=resolve;tx.onerror=()=>reject(error??tx.error);tx.onabort=()=>reject(error??tx.error);
 });
}
export async function retainDetectionVideos(ids){
 const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction('temporaryVideos','readwrite'),store=tx.objectStore('temporaryVideos');for(const id of ids){const r=store.get(id);r.onsuccess=()=>{if(r.result)store.put({...r.result,keep:true});};}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
export async function saveTemporaryVideoBounded(row,limit=128*1024*1024){
 const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction('temporaryVideos','readwrite'),store=tx.objectStore('temporaryVideos'),r=store.getAll();let error;r.onsuccess=()=>{try{const total=r.result.filter(v=>v.id!==row.id).reduce((n,v)=>n+(v.bytes??v.blob?.size??0),0);if(total+row.bytes>limit){error=new Error('動画の容量上限です。既存動画は削除しません。必要な動画を書き出してから整理してください。');tx.abort();return;}store.put(row);}catch(e){error=e;tx.abort();}};tx.oncomplete=resolve;tx.onerror=()=>reject(error??tx.error);tx.onabort=()=>reject(error??tx.error);});
}

// Drive export reads only this session. No schema change or record migration.
export const getCoachSession=id=>transact('results','readonly',s=>s.get(id));
export const getPoseSession=id=>transact('poseSessions','readonly',s=>s.get(id));
export const getPoseChunk=id=>transact('poseChunks','readonly',s=>s.get(id));
export async function poseChunkInventory(sessionId){
 const db=await database;return new Promise((resolve,reject)=>{
  const tx=db.transaction('poseChunks','readonly'),request=tx.objectStore('poseChunks').openCursor(IDBKeyRange.bound(sessionId+':',sessionId+':\uffff')),rows=[];
  request.onsuccess=()=>{try{const c=request.result;if(!c)return;const row=c.value;if(row.sessionId!==sessionId)throw new Error('姿勢のセッションIDが一致しません');const a=new Float32Array(row.buffer);rows.push({id:row.id,index:row.index,bytes:row.buffer.byteLength,count:a.length/POSE_STRIDE,first:a[0],last:a[a.length-POSE_STRIDE]});c.continue();}catch(error){tx.abort();reject(error);}};
  tx.oncomplete=()=>resolve(rows);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });
}
// Allocate one stable Drive ID atomically across tabs, before sending any content.
export async function reserveDriveId(key,proposedId){
 const db=await database;return new Promise((resolve,reject)=>{
  const tx=db.transaction('settings','readwrite'),store=tx.objectStore('settings'),r=store.get(key);let id,error;
  r.onsuccess=()=>{try{id=r.result?.value?.id??proposedId;if(!r.result)store.add({id:key,value:{id}});}catch(e){error=e;tx.abort();}};
  tx.oncomplete=()=>resolve(id);tx.onerror=()=>reject(error??tx.error);tx.onabort=()=>reject(error??tx.error);
 });
}

// Additive v5 stores: imported videos never share the legacy live Pose encoding.
export const offlineRecord=(store,id)=>transact(store,'readonly',s=>s.get(id));
export async function offlineRecords(store,assetId){
 const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),request=tx.objectStore(store).openCursor(),rows=[];
 request.onsuccess=()=>{const c=request.result;if(!c)return;if(!assetId||c.value.assetId===assetId){const {blob,...metadata}=c.value;rows.push(store==='offlineAssets'?{...metadata,hasVideo:!!blob}:c.value);}c.continue();};tx.oncomplete=()=>resolve(rows);tx.onerror=()=>reject(tx.error);});
}
export async function offlineWrite(writes,{expectedRevision,immutable=false}={}){
 const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction([...new Set(writes.map(w=>w.store))],'readwrite');let error;
 const write=()=>{try{for(const {store,row}of writes)tx.objectStore(store)[immutable?'add':'put'](row);}catch(e){error=e;tx.abort();}};
 if(expectedRevision!==undefined){const row=writes[0].row,r=tx.objectStore('offlineAnnotations').get(row.id);r.onsuccess=()=>{if((r.result?.revision??0)!==expectedRevision){error=new Error('別の画面で修正が保存されています。再読み込みしてください。');tx.abort();}else write();};}else write();
 tx.oncomplete=resolve;tx.onerror=event=>{error??=event.target?.error;};tx.onabort=()=>reject(error??tx.error??new Error('保存が中断されました。'));
 });
}
export async function offlineReadChunks(cacheId,start,end){
 const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction('offlineChunks','readonly'),request=tx.objectStore('offlineChunks').openCursor(IDBKeyRange.bound(cacheId+':',cacheId+':\uffff')),rows=[];
 request.onsuccess=()=>{const c=request.result;if(!c)return;const row=c.value;if(row.first>end)return;if(row.last>=start)rows.push(row);c.continue();};tx.oncomplete=()=>resolve(rows);tx.onerror=()=>reject(tx.error);});
}
