import { ANALYSIS_VERSION, METRICS, GROUPS } from './scoring-config.js';
const finite = Number.isFinite;
const mean = values => { const a = values.filter(finite); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; };
const sd = values => { const a = values.filter(finite); return a.length >= 2 ? Math.sqrt(mean(a.map(v => (v - mean(a)) ** 2))) : null; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const visible = p => p && finite(p.x) && finite(p.y) && (p.visibility ?? 0) >= 0.2;
const difference = (a, b) => finite(a) && finite(b) ? a - b : null;
const ratio = (a, b) => finite(a) && finite(b) && b > 1e-8 ? a / b : null;
export function angle(a, b, c) {
  const u = { x: a.x - b.x, y: a.y - b.y }, v = { x: c.x - b.x, y: c.y - b.y };
  const denominator = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
  return denominator > 1e-8 ? Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / denominator))) * 180 / Math.PI : null;
}
export function validatePhases(phases, duration) {
  const { start, release, end } = phases;
  if (![start, release, end, duration].every(finite) || start < 0 || end > duration + 0.01 || !(start < release && release < end) || end - start > 30) {
    throw new Error('開始 → リリース → 終了の順に、動画内の時刻を指定してください。区間全体は30秒以内にします。');
  }
}
function frameMetrics(frame, hand, aspect) {
  const p = frame.landmarks?.map(point => ({ ...point, x: point.x * aspect }));
  if (!p) return null;
  const [s, e, w, h, k, a] = hand === 'right' ? [12, 14, 16, 24, 26, 28] : [11, 13, 15, 23, 25, 27];
  const has = (...indices) => indices.every(i => visible(p[i]));
  const joint = (...indices) => has(...indices) ? angle(...indices.map(i => p[i])) : null;
  const bothUpper = has(11, 12, 23, 24);
  const shoulders = bothUpper ? mid(p[11], p[12]) : has(s, h) ? p[s] : null;
  const hips = bothUpper ? mid(p[23], p[24]) : has(s, h) ? p[h] : null;
  const bothFeet = has(27, 28);
  const ankles = bothFeet ? mid(p[27], p[28]) : has(a) ? p[a] : null;
  const torsoLength = shoulders && hips ? dist(shoulders, hips) : null;
  const torso = torsoLength > 0.01 ? torsoLength : null;
  const values = {
    elbow: joint(s, e, w), shoulder: joint(h, s, e), knee: joint(h, k, a), hip: joint(s, h, k),
    torsoLean: shoulders && hips && torso ? Math.atan2(shoulders.x - hips.x, hips.y - shoulders.y) * 180 / Math.PI : null,
    bodyOffset: bothUpper && bothFeet && torso ? (shoulders.x - ankles.x) / torso : null,
    wristHeight: has(s, w) && torso ? (p[s].y - p[w].y) / torso : null,
    wristX: has(s, w) && torso ? (p[w].x - p[s].x) / torso : null,
    wristY: has(s, w) && torso ? (p[w].y - p[s].y) / torso : null,
    rawHipY: hips && torso ? hips.y : null,
    torso,
  };
  if (!Object.values(values).some(finite)) return null;
  // Each joint is independent. A hidden ankle must not discard a visible elbow.
  return { time: frame.time, ...values, complete: has(s, e, w, h, k, a), visibility: mean([s, e, w, h, k, a].filter(i => visible(p[i])).map(i => p[i].visibility)) };
}
function smooth(rows) {
  return rows.map((row, index) => {
    // Do not bridge tracking gaps or fill missing joints with neighboring guesses.
    const neighbors = rows.slice(Math.max(0, index - 1), index + 2).filter(r => Math.abs(r.time - row.time) <= 0.18);
    const result = { ...row };
    for (const key of ['elbow', 'shoulder', 'knee', 'hip', 'torsoLean', 'bodyOffset', 'wristHeight', 'wristX', 'wristY', 'rawHipY']) result[key] = finite(row[key]) ? mean(neighbors.map(r => r[key])) : null;
    return result;
  });
}
function onset(rows, key) {
  const valid = rows.filter(r => finite(r[key]));
  if (valid.length < 2) return null;
  const minimum = Math.min(...valid.map(r => r[key])), maximum = Math.max(...valid.map(r => r[key]));
  if (maximum - minimum < 3) return null;
  const minIndex = valid.findIndex(r => r[key] === minimum);
  return valid.slice(minIndex).find(r => r[key] >= minimum + 0.3 * (maximum - minimum))?.time ?? null;
}
export function calculateMetrics(frames, phases, hand, aspect = 1, phaseEstimated = false) {
  const rows = smooth(frames.map(f => frameMetrics(f, hand, aspect)).filter(Boolean));
  const coverage = frames.length ? rows.length / frames.length : 0;
  const completeCoverage = frames.length ? rows.filter(r => r.complete).length / frames.length : 0;
  const pre = rows.filter(r => r.time <= phases.release), post = rows.filter(r => r.time >= phases.release);
  const warnings = [];
  if (phaseEstimated) warnings.push('リリース時刻は区間の中央を仮に使用しています。実際のリリース位置に合わせると比較精度が上がります。');
  if (!rows.length) warnings.push('姿勢を検出できませんでした。動画は受け付けましたが、自動計測値と点数は表示できません。動画の比較再生とメモは利用できます。');
  else if (coverage < 0.65 || rows.length < 10) warnings.push('姿勢を検出できた場面が少ないため、精度低の参考分析です。見えている関節だけを計測しています。');
  if (rows.length && completeCoverage < 0.8) warnings.push('全身の関節がそろわない場面があるため、見える部分だけを使った精度低の分析です。');
  const gaps = rows.slice(1).map((r, i) => r.time - rows[i].time);
  if (Math.max(0, ...gaps) > 0.35) warnings.push('姿勢の追跡が途中で途切れています。検出できた場面を使った参考値です。');
  let releaseFallback = false;
  const atRelease = key => {
    const valid = rows.filter(r => finite(r[key]));
    const nearby = valid.filter(r => Math.abs(r.time - phases.release) <= 0.15);
    if (nearby.length) return mean(nearby.map(r => r[key]));
    if (!valid.length) return null;
    releaseFallback = true;
    return valid.reduce((best, r) => Math.abs(r.time - phases.release) < Math.abs(best.time - phases.release) ? r : best)[key];
  };
  const average = (source, key) => mean(source.map(r => r[key]));
  const legOnset = onset(pre, 'knee'), armOnset = onset(pre, 'elbow');
  const duration = phases.release - phases.start;
  const wristRows = rows.filter(r => finite(r.wristHeight));
  const elbowValues = pre.map(r => r.elbow).filter(finite);
  const wristRange = wristRows.length ? Math.max(...wristRows.map(r => r.wristHeight)) - Math.min(...wristRows.map(r => r.wristHeight)) : 0;
  const weakMotion = !elbowValues.length || Math.max(...elbowValues) - Math.min(...elbowValues) < 12 || wristRange < 0.2;
  if (rows.length && weakMotion) warnings.push('腕の動きが小さいか、映像から十分に読み取れていません。動作の適合判定は行わず、計測可能な項目で分析を続けています。');
  const peak = wristRange >= 0.05 ? wristRows.reduce((best, r) => r.wristHeight > best.wristHeight ? r : best) : null;
  const torso = average(rows, 'torso');
  const wristXDeviation = sd(post.map(r => r.wristX)), wristYDeviation = sd(post.map(r => r.wristY));
  const metrics = {
    kneeArmTiming: legOnset !== null && armOnset !== null ? (legOnset - armOnset) / duration : null,
    torsoLean: atRelease('torsoLean'), bodyOffset: atRelease('bodyOffset'),
    verticalRise: ratio(difference(average(pre.slice(0, 3), 'rawHipY'), atRelease('rawHipY')), torso),
    elbowAngle: atRelease('elbow'), shoulderAngle: atRelease('shoulder'),
    kneeAngle: average(pre.slice(0, 3), 'knee'), hipAngle: atRelease('hip'),
    armLead: armOnset === null ? null : (phases.release - armOnset) / duration,
    wristPeakTiming: peak ? (peak.time - phases.release) / duration : null,
    wristHeight: atRelease('wristHeight'),
    followWrist: finite(wristXDeviation) && finite(wristYDeviation) ? Math.hypot(wristXDeviation, wristYDeviation) : null,
    followElbow: sd(post.map(r => r.elbow)),
  };
  if (releaseFallback) warnings.push('リリース付近に検出できない関節があるため、最も近い検出場面の値を代わりに使っています。');
  const visibility = average(rows, 'visibility') ?? 0;
  const missingMetrics = Object.values(metrics).filter(v => !finite(v)).length;
  const lowQuality = completeCoverage < 0.8 || coverage < 0.65 || rows.length < 10 || visibility < 0.55 || weakMotion || releaseFallback || phaseEstimated || missingMetrics > 3 || Math.max(0, ...gaps) > 0.35;
  if (visibility < 0.55 && rows.length) warnings.push('関節の検出確度が低いため、精度低の参考値として表示します。');
  return { version: ANALYSIS_VERSION, metrics, phases, hand, aspect, coverage, completeCoverage, visibility, lowQuality, warnings, phaseEstimated, frameCount: frames.length, validFrames: rows.length, frames, analyzedAt: Date.now() };
}
export function compareAnalyses(reference, current, refMeta, newMeta) {
  const angleMismatch = refMeta.cameraAngle !== newMeta.cameraAngle, shotMismatch = refMeta.shotType !== newMeta.shotType;
  const warnings = [...(reference.warnings ?? []).map(w => `Good Form：${w}`), ...(current.warnings ?? []).map(w => `今回：${w}`)];
  if (angleMismatch) warnings.push('撮影角度が異なりますが、分析は続けています。角度・位置・揺れは点数から除外し、時間指標だけで比較するため、精度低と表示します。');
  if (shotMismatch) warnings.push('シュート種別が異なるため、下半身と跳躍に依存する指標は点数に含めていません。');
  if (reference.hand !== current.hand) warnings.push('シュートする手が異なります。同じ手の映像での比較を推奨します。');
  const metrics = Object.entries(METRICS).map(([key, config]) => {
    const refValue = reference.metrics[key], value = current.metrics[key];
    let excluded = null;
    if (angleMismatch && !config.temporal) excluded = '撮影角度が異なるため除外';
    else if (shotMismatch && (config.group === 'lower' || config.shotDependent)) excluded = 'シュート種別が異なるため除外';
    else if (!finite(refValue) || !finite(value)) excluded = '必要な関節・動きを計測できないため対象外';
    const delta = excluded ? null : value - refValue;
    const score = excluded ? null : Math.max(0, 100 * (1 - Math.abs(delta) / config.tolerance));
    return { key, ...config, refValue, value, delta, score, excluded };
  });
  const groups = Object.entries(GROUPS).map(([key, config]) => {
    const used = metrics.filter(m => m.group === key && m.score !== null), total = used.reduce((s, m) => s + m.weight, 0);
    return { key, ...config, score: total ? used.reduce((s, m) => s + m.score * m.weight, 0) / total : null };
  });
  const used = metrics.filter(m => m.score !== null), validGroups = groups.filter(g => g.score !== null);
  const totalWeight = validGroups.reduce((s, g) => s + g.weight, 0);
  const overall = used.length && totalWeight ? Math.round(validGroups.reduce((s, g) => s + g.score * g.weight, 0) / totalWeight) : null;
  if (overall === null) warnings.push('動画の受付と分析処理は完了しました。比較できる計測値がないため点数は未算出ですが、動画の比較再生・メモ・履歴は利用できます。');
  else if (used.length < 6) warnings.push(`比較できた${used.length}項目だけから求めた暫定スコアです。全身のフォーム一致度を表すものではありません。`);
  const quality = Math.min(reference.coverage, current.coverage, reference.visibility, current.visibility);
  let confidence = quality >= 0.9 && used.length >= 10 ? 'High' : quality >= 0.75 && used.length >= 6 ? 'Medium' : 'Low';
  if (angleMismatch || reference.hand !== current.hand || reference.lowQuality || current.lowQuality) confidence = 'Low';
  if (shotMismatch && confidence === 'High') confidence = 'Medium';
  if (confidence === 'Low') warnings.push('精度低：検出できた範囲での参考分析です。動画をはじかずに処理していますが、数値は映像と見比べて確認してください。');
  return { version: ANALYSIS_VERSION, overall, confidence, metrics, groups, warnings, angleMismatch, shotMismatch, usedMetricCount: used.length };
}
