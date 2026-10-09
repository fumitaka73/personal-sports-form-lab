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
