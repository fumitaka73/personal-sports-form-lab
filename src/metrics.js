import { ANALYSIS_VERSION, METRICS, GROUPS } from './scoring-config.js';
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const sd = a => a.length ? Math.sqrt(mean(a.map(v => (v - mean(a)) ** 2))) : null;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const visible = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 0) >= 0.55;
export function angle(a, b, c) {
  const u = { x: a.x - b.x, y: a.y - b.y }, v = { x: c.x - b.x, y: c.y - b.y };
  const denominator = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
  return denominator > 1e-8 ? Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / denominator))) * 180 / Math.PI : null;
}
export function validatePhases(phases, duration) {
  const { start, release, end } = phases;
  if (![start, release, end, duration].every(Number.isFinite) || start < 0 || end > duration + 0.01 || release - start < 0.3 || end - release < 0.3 || end - start > 10) {
    throw new Error('開始 → リリース → 終了を順に指定してください。リリースの前後は各0.3秒以上、区間全体は10秒以内にします。');
  }
}
function frameMetrics(frame, hand, aspect) {
  const p = frame.landmarks?.map(point => ({ ...point, x: point.x * aspect }));
  if (!p) return null;
  const [s, e, w, h, k, a] = hand === 'right' ? [12, 14, 16, 24, 26, 28] : [11, 13, 15, 23, 25, 27];
  if (![s, e, w, h, k, a].every(i => visible(p[i]))) return null;
  const torso = dist(p[s], p[h]); if (torso < 0.035) return null;
  const both = [11, 12, 23, 24, 27, 28].every(i => visible(p[i]));
  const shoulders = both ? mid(p[11], p[12]) : p[s];
  const hips = both ? mid(p[23], p[24]) : p[h];
  const ankles = both ? mid(p[27], p[28]) : p[a];
  return { time: frame.time, elbow: angle(p[s], p[e], p[w]), shoulder: angle(p[h], p[s], p[e]), knee: angle(p[h], p[k], p[a]), hip: angle(p[s], p[h], p[k]), torsoLean: Math.atan2(shoulders.x - hips.x, hips.y - shoulders.y) * 180 / Math.PI, bodyOffset: (shoulders.x - ankles.x) / torso, hipY: hips.y / torso, wristHeight: (p[s].y - p[w].y) / torso, wristX: (p[w].x - p[s].x) / torso, wristY: (p[w].y - p[s].y) / torso, torso, rawHipY: hips.y, visibility: mean([s, e, w, h, k, a].map(i => p[i].visibility)), both };
}
function smooth(rows) {
  return rows.map((row, index) => {
    const neighbors = rows.slice(Math.max(0, index - 1), index + 2);
    const result = { ...row };
    for (const key of ['elbow', 'shoulder', 'knee', 'hip', 'torsoLean', 'bodyOffset', 'wristHeight', 'wristX', 'wristY', 'rawHipY']) {
      const values = neighbors.map(r => r[key]).filter(Number.isFinite);
      result[key] = values.length ? mean(values) : null;
    }
    return result;
  });
}
function onset(rows, key) {
  const valid = rows.filter(r => Number.isFinite(r[key]));
  if (valid.length < 4) return null;
  const minimum = Math.min(...valid.map(r => r[key]));
  const maximum = Math.max(...valid.map(r => r[key]));
  if (maximum - minimum < 12) return null;
  const minIndex = valid.findIndex(r => r[key] === minimum);
  return valid.slice(minIndex).find(r => r[key] >= minimum + 0.3 * (maximum - minimum))?.time ?? null;
}
export function calculateMetrics(frames, phases, hand, aspect = 1) {
  const rows = smooth(frames.map(f => frameMetrics(f, hand, aspect)).filter(Boolean));
  const coverage = rows.length / frames.length;
  const pre = rows.filter(r => r.time <= phases.release);
  const post = rows.filter(r => r.time >= phases.release);
  const releaseRows = rows.filter(r => Math.abs(r.time - phases.release) <= 0.15);
  const gaps = rows.slice(1).map((r, i) => r.time - rows[i].time);
  if (rows.length < 10 || coverage < 0.65 || pre.length < 4 || post.length < 3 || !releaseRows.length || Math.max(0, ...gaps) > 0.35) {
    throw new Error('姿勢を十分に検出できませんでした。全身とシュート側の腕が映る明るい動画で、開始・リリース・終了を指定し直してください。点数は作成していません。');
  }
  const elbowValues = pre.map(r => r.elbow).filter(Number.isFinite);
  const wristValues = pre.map(r => r.wristHeight).filter(Number.isFinite);
  if (!elbowValues.length || Math.max(...elbowValues) - Math.min(...elbowValues) < 15 || Math.max(...wristValues) - Math.min(...wristValues) < 0.25) {
    throw new Error('指定した区間で腕を伸ばして手首を上げる動きを十分に検出できませんでした。構えからリリース後までのシュート区間を指定してください。点数は作成していません。');
  }
  const average = (source, key) => mean(source.map(r => r[key]).filter(Number.isFinite));
  const legOnset = onset(pre, 'knee'), armOnset = onset(pre, 'elbow');
  const duration = phases.release - phases.start;
  const peak = rows.reduce((best, r) => r.wristHeight > best.wristHeight ? r : best, rows[0]);
  const torso = average(rows, 'torso');
  const metrics = {
    kneeArmTiming: legOnset !== null && armOnset !== null ? (legOnset - armOnset) / duration : null,
    torsoLean: average(releaseRows, 'torsoLean'),
    bodyOffset: rows.every(r => r.both) ? average(releaseRows, 'bodyOffset') : null,
    verticalRise: (average(pre.slice(0, 3), 'rawHipY') - average(releaseRows, 'rawHipY')) / torso,
    elbowAngle: average(releaseRows, 'elbow'), shoulderAngle: average(releaseRows, 'shoulder'),
    kneeAngle: average(pre.slice(0, 3), 'knee'), hipAngle: average(releaseRows, 'hip'),
    armLead: armOnset === null ? null : (phases.release - armOnset) / duration,
    wristPeakTiming: (peak.time - phases.release) / duration,
    wristHeight: average(releaseRows, 'wristHeight'),
    followWrist: Math.hypot(sd(post.map(r => r.wristX)), sd(post.map(r => r.wristY))),
    followElbow: sd(post.map(r => r.elbow).filter(Number.isFinite)),
  };
  return { version: ANALYSIS_VERSION, metrics, phases, hand, aspect, coverage, visibility: average(rows, 'visibility'), frameCount: frames.length, validFrames: rows.length, frames, analyzedAt: Date.now() };
}
export function compareAnalyses(reference, current, refMeta, newMeta) {
  const angleMismatch = refMeta.cameraAngle !== newMeta.cameraAngle;
  const shotMismatch = refMeta.shotType !== newMeta.shotType;
  const warnings = [];
  if (angleMismatch) warnings.push('撮影角度が異なるため、関節角度・位置・揺れを除外し、時間に関する指標だけで比較しています。');
  if (shotMismatch) warnings.push('シュート種別が異なるため、下半身と跳躍に依存する指標は点数に含めていません。');
  if (reference.hand !== current.hand) warnings.push('シュートする手が異なります。同じ手の映像での比較を推奨します。');
  const metrics = Object.entries(METRICS).map(([key, config]) => {
    const refValue = reference.metrics[key], value = current.metrics[key];
    let excluded = null;
    if (angleMismatch && !config.temporal) excluded = '撮影角度が異なるため除外';
    else if (shotMismatch && (config.group === 'lower' || config.shotDependent)) excluded = 'シュート種別が異なるため除外';
    else if (!Number.isFinite(refValue) || !Number.isFinite(value)) excluded = '必要な動きを検出できないため除外';
    const delta = excluded ? null : value - refValue;
    const score = excluded ? null : Math.max(0, 100 * (1 - Math.abs(delta) / config.tolerance));
    return { key, ...config, refValue, value, delta, score, excluded };
  });
  const groups = Object.entries(GROUPS).map(([key, config]) => {
    const used = metrics.filter(m => m.group === key && m.score !== null);
    const total = used.reduce((s, m) => s + m.weight, 0);
    return { key, ...config, score: total ? used.reduce((s, m) => s + m.score * m.weight, 0) / total : null };
  });
  const used = metrics.filter(m => m.score !== null);
  const validGroups = groups.filter(g => g.score !== null);
  const totalWeight = validGroups.reduce((s, g) => s + g.weight, 0);
  const overall = used.length >= 2 && totalWeight ? Math.round(validGroups.reduce((s, g) => s + g.score * g.weight, 0) / totalWeight) : null;
  if (overall === null) warnings.push('比較できる指標が足りないため、総合点を表示できません。同じ撮影角度・種別で撮り直してください。');
  const quality = Math.min(reference.coverage, current.coverage, reference.visibility, current.visibility);
  let confidence = quality >= 0.9 && used.length >= 10 ? 'High' : quality >= 0.75 && used.length >= 6 ? 'Medium' : 'Low';
  if (angleMismatch || reference.hand !== current.hand) confidence = 'Low';
  if (shotMismatch && confidence === 'High') confidence = 'Medium';
  if (confidence === 'Low') warnings.push('分析の信頼度は低めです。計測値は参考として扱い、同じ位置から全身を撮影すると比較しやすくなります。');
  return { version: ANALYSIS_VERSION, overall, confidence, metrics, groups, warnings, angleMismatch, shotMismatch };
}
