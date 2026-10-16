// Frozen Session pose rules from 92cfe6b (before PR #39). Offline comparison only.
export const LEGACY_RULE_VERSION = 'session-pose-1.1@92cfe6b';
import { shotCandidatesFromRows } from './offline-legacy-phases.js';
export const SESSION_POSE_THRESHOLDS = Object.freeze({
  prepHeight: 0.7,
  prepElbow: 165,
  peakHeight: 0.15,
  minRise: 0.28,
  minExtendedElbow: 100,
  minExtension: 8,
  minStrength: 0.12,
});
export function detectLegacyRows(rows, range, parameters = SESSION_POSE_THRESHOLDS) {
  const thresholds = { ...SESSION_POSE_THRESHOLDS, ...parameters };
  const candidates = shotCandidatesFromRows(rows, range, true);
  const selected = [];
  // Validate a whole shooting cycle rather than counting every velocity spike.
  const evidence = (candidate) => {
    const release = candidate.phases.release;
    const motion = rows.filter((r) => r.time >= release - 1.5 && r.time <= release + 0.8);
    if (candidate.source === 'ball') return { readyTime: release - 0.3, peakTime: release };
    if (motion.length < 4) return null;
    let best = null;
    for (let i = 0; i < motion.length; i++) {
      const ready = motion[i];
      if (ready.time >= release || ready.wristHeight > thresholds.prepHeight) continue;
      const rise = motion.slice(i).filter((r) => r.time <= release + 0.8);
      const high = rise.filter(
        (r) =>
          r.time >= ready.time + 0.15 &&
          r.wristHeight >= thresholds.peakHeight &&
          r.wristHeight - ready.wristHeight >= thresholds.minRise
      );
      // At least two successive high frames: a single tracking jump is insufficient.
      // Hand rise can precede elbow extension. Inspect later high frames with
      // the same evidence thresholds instead of rejecting at the first pair.
      const supportsPose = (peak) => {
        const bent = Number.isFinite(ready.elbow) && ready.elbow <= thresholds.prepElbow;
        const extended =
          Number.isFinite(peak.elbow) &&
          peak.elbow >= thresholds.minExtendedElbow &&
          peak.elbow - ready.elbow >= thresholds.minExtension;
        if (bent && extended) return true;
        const missingElbow = !Number.isFinite(ready.elbow) || !Number.isFinite(peak.elbow);
        return missingElbow && peak.wristHeight - ready.wristHeight >= 0.5 && high.length >= 3;
      };
      const peak = high.find(
        (r, j) =>
          j && r.time - high[j - 1].time <= 0.6 && (candidate.source !== 'pose' || supportsPose(r))
      );
      if (!peak) continue;
      const ascent = rise.filter((r) => r.time <= peak.time);
      if (ascent.some((r, j) => j && r.time - ascent[j - 1].time > 0.65)) continue;
      best = { readyTime: ready.time, peakTime: peak.time };
      break;
    }
    return best;
  };
  candidates.sort(
    (a, b) => (b.source === 'ball') - (a.source === 'ball') || b.strength - a.strength
  );
  for (const candidate of candidates) {
    if (candidate.source === 'pose' && candidate.strength < thresholds.minStrength) continue;
    const cycle = evidence(candidate);
    if (!cycle) continue;
    if (
      selected.some(
        (c) =>
          Math.abs(c.phases.release - candidate.phases.release) < 1.5 ||
          Math.abs(c.cycle.readyTime - cycle.readyTime) < 0.5
      )
    )
      continue;
    selected.push({ ...candidate, cycle });
  }
  selected.sort((a, b) => a.phases.release - b.phases.release);
  // A follow-through fluctuation cannot become another shot without lowering
  // the hand for a new preparation. Keep this rule confined to Session.
  const cycles = [];
  for (const candidate of selected) {
    const previous = cycles.at(-1);
    const reset =
      !previous ||
      candidate.source === 'ball' ||
      rows.some(
        (r, j) =>
          r.time > previous.cycle.peakTime &&
          r.time < candidate.phases.release &&
          j + 1 < rows.length &&
          rows[j + 1].time < candidate.phases.release &&
          rows[j + 1].time - r.time <= 0.6 &&
          ((r.wristHeight <= thresholds.prepHeight &&
            rows[j + 1].wristHeight <= thresholds.prepHeight) ||
            (r.elbow < 150 && rows[j + 1].elbow < 150))
      );
    if (reset) cycles.push(candidate);
  }
  return cycles.map((c, i) => {
    const start = Math.max(
      c.phases.start,
      i ? (cycles[i - 1].phases.release + c.phases.release) / 2 : range.start
    );
    const end = Math.min(
      c.phases.end,
      i < cycles.length - 1 ? (c.phases.release + cycles[i + 1].phases.release) / 2 : range.end
    );
    return { ...c, phases: { start, release: c.phases.release, end } };
  });
}
