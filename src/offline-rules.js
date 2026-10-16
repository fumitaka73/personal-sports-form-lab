import { detectSessionRows } from './session.js';
import { detectLegacyRows } from './offline-legacy-detector.js';
import { OFFLINE_ALGORITHMS } from './offline-data.js';
export function replayOfflineRows(rows, duration, algorithm = 'current') {
  if (!OFFLINE_ALGORITHMS[algorithm]) throw new Error('未対応の検出ルールです。');
  return (algorithm === 'current' ? detectSessionRows : detectLegacyRows)(rows, {
    start: 0,
    end: duration,
  });
}
