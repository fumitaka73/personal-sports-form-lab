const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('sports-form-lab', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('videos', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function transact(mode, action) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('videos', mode);
    const request = action(tx.objectStore('videos'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('保存が中断されました'));
  });
}
export const listVideos = () => transact('readonly', store => store.getAll());
export const saveVideo = video => transact('readwrite', store => store.put(video));
export const deleteVideo = id => transact('readwrite', store => store.delete(id));
