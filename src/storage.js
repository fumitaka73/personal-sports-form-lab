const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('sports-form-lab', 2);
  request.onupgradeneeded = () => {
    for (const name of ['videos', 'results', 'settings']) {
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
export async function commitAnalysis(video, referenceId, result = null) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['videos', 'results', 'settings'], 'readwrite');
    tx.objectStore('videos').put(video);
    if (result) tx.objectStore('results').put(result);
    else tx.objectStore('settings').put({ id: 'referenceId', value: referenceId });
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
