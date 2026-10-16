import { replayOfflineRows } from './offline-rules.js';
self.onmessage = (event) => {
  try {
    const { rows, duration, algorithm } = event.data;
    self.postMessage({ shots: replayOfflineRows(rows, duration, algorithm) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
