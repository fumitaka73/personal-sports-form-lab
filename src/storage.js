import {iterateChunks,POSE_STRIDE} from './pose-archive.js';
import {ratingEntry} from './session-feedback.js';
const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('sports-form-lab', 4);
  request.onupgradeneeded = () => {
    for (const name of ['videos', 'results', 'settings', 'temporaryVideos', 'poseSessions', 'poseChunks', 'calibrations']) {
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
 const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction(['poseChunks','poseSessions'],'readwrite');tx.objectStore('poseChunks').put(chunk);tx.objectStore('poseSessions').put(session);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
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
