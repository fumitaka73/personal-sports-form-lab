import test from 'node:test';
import assert from 'node:assert/strict';
import { angle, validatePhases, calculateMetrics, compareAnalyses } from '../src/metrics.js';
import { generateFeedback } from '../src/feedback.js';
import { METRICS } from '../src/scoring-config.js';
const phases = { start: 0, release: 1, end: 2 };
const metadata = { cameraAngle: 'side', shotType: 'jump' };
function frames() {
  return Array.from({ length: 25 }, (_, index) => {
    const time = index / 12;
    const extension = Math.min(1, time);
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
    for (const [s,e,w,h,k,a] of [[11,13,15,23,25,27],[12,14,16,24,26,28]]) {
      landmarks[s] = { x: 0.5, y: 0.35, visibility: 0.99 };
      landmarks[e] = { x: 0.58, y: 0.35 - 0.12 * extension, visibility: 0.99 };
      landmarks[w] = { x: 0.62 - 0.03 * extension, y: 0.44 - 0.38 * extension, visibility: 0.99 };
      landmarks[h] = { x: 0.5, y: 0.6 - 0.04 * extension, visibility: 0.99 };
      landmarks[k] = { x: 0.63 - 0.12 * extension, y: 0.75, visibility: 0.99 };
      landmarks[a] = { x: 0.5, y: 0.95, visibility: 0.99 };
    }
    return { time, landmarks };
  });
}
const sample = () => calculateMetrics(frames(), phases, 'right');
test('joint angles use correct geometry and reject zero length', () => {
  assert.equal(angle({x:1,y:0},{x:0,y:0},{x:0,y:1}),90);
  assert.equal(angle({x:1,y:0},{x:0,y:0},{x:-1,y:0}),180);
  assert.equal(angle({x:0,y:0},{x:0,y:0},{x:1,y:0}),null);
});
test('invalid phase order, duration and non-finite inputs fail', () => {
  assert.doesNotThrow(() => validatePhases(phases,2));
  for (const bad of [{start:0,release:NaN,end:2},{start:1,release:0,end:2},{start:0,release:1,end:31},{start:0,release:2,end:2}]) assert.throws(() => validatePhases(bad,2));
});
test('deterministic metrics and self-comparison return 100', () => {
  const a = sample(), b = sample();
  assert.deepEqual(a.metrics,b.metrics);
  const comparison = compareAnalyses(a,b,metadata,metadata);
  assert.equal(comparison.overall,100);
  assert.ok(comparison.metrics.filter(m => m.score !== null).length >= 10);
  assert.ok(Object.values(a.metrics).every(v => v === null || Number.isFinite(v)));
});
test('normalization is invariant under translation and uniform camera scale', () => {
  const transformed = frames().map(f => ({...f,landmarks:f.landmarks.map(p => ({...p,x:p.x*0.7+0.1,y:p.y*0.7+0.1}))}));
  const a = sample(), b = calculateMetrics(transformed,phases,'right');
  for (const key of Object.keys(METRICS)) {
    if (a.metrics[key] !== null) assert.ok(Math.abs(a.metrics[key]-b.metrics[key]) < 1e-6, key);
  }
});
test('score changes follow explicit tolerances and weighted formula', () => {
  const a = sample(), b = sample(); b.metrics.elbowAngle += METRICS.elbowAngle.tolerance;
  const comparison = compareAnalyses(a,b,metadata,metadata);
  assert.equal(comparison.metrics.find(m => m.key === 'elbowAngle').score,0);
  assert.ok(comparison.overall < 100 && comparison.overall >= 0);
  assert.ok(generateFeedback(comparison).focus[0].includes('肘'));
});
test('angle mismatch excludes every non-temporal metric and lowers confidence', () => {
  const comparison = compareAnalyses(sample(),sample(),metadata,{...metadata,cameraAngle:'front'});
  assert.equal(comparison.confidence,'Low');
  assert.ok(comparison.metrics.filter(m => !m.temporal).every(m => m.score === null));
  assert.ok(comparison.warnings.length > 0);
});
test('different shot types exclude lower body and jump-dependent metrics', () => {
  const comparison = compareAnalyses(sample(),sample(),metadata,{...metadata,shotType:'set'});
  assert.ok(comparison.metrics.filter(m => m.group === 'lower' || m.shotDependent).every(m => m.score === null));
  assert.ok(comparison.metrics.find(m => m.key === 'elbowAngle').score !== null);
});
test('one available metric yields a clearly low-confidence provisional score', () => {
  const a = sample(), b = sample(); b.metrics = Object.fromEntries(Object.keys(METRICS).map(k => [k,null]));
  b.metrics.elbowAngle = a.metrics.elbowAngle;
  const comparison = compareAnalyses(a,b,metadata,metadata);
  assert.equal(comparison.overall,100);
  assert.equal(comparison.groups.find(g => g.key === 'balance').score,null);
  assert.equal(comparison.confidence,'Low');
  assert.ok(comparison.warnings.some(w => w.includes('暫定')));
});
test('no detected person returns an accepted unscored analysis, never a fabricated number', () => {
  const missing = calculateMetrics(frames().map(f => ({...f,landmarks:null})),phases,'right');
  assert.equal(missing.coverage,0);
  assert.ok(Object.values(missing.metrics).every(v => v === null));
  const comparison = compareAnalyses(sample(),missing,metadata,metadata);
  assert.equal(comparison.overall,null);
  assert.equal(comparison.confidence,'Low');
  assert.ok(comparison.warnings.some(w => w.includes('受付')));
  assert.ok(generateFeedback(comparison).difference.includes('比較'));
});
test('cropped ankles do not discard the visible shooting arm', () => {
  const cropped = calculateMetrics(frames().map(f => ({...f,landmarks:f.landmarks.map((p,i) => [27,28].includes(i) ? {...p,visibility:0} : p)})),phases,'right');
  assert.ok(Number.isFinite(cropped.metrics.elbowAngle));
  assert.equal(cropped.metrics.kneeAngle,null);
  assert.equal(cropped.metrics.bodyOffset,null);
  assert.equal(cropped.lowQuality,true);
  assert.ok(compareAnalyses(sample(),cropped,metadata,metadata).overall !== null);
});
test('upper-body-only footage is accepted without invented torso or leg metrics', () => {
  const cropped = calculateMetrics(frames().map(f => ({...f,landmarks:f.landmarks.map((p,i) => i >= 23 ? {...p,visibility:0} : p)})),phases,'right');
  assert.ok(Number.isFinite(cropped.metrics.elbowAngle));
  assert.equal(cropped.metrics.wristHeight,null);
  assert.equal(cropped.metrics.verticalRise,null);
  assert.equal(cropped.lowQuality,true);
});
test('low detection confidence and sparse tracking are warnings rather than rejection', () => {
  const low = calculateMetrics(frames().map(f => ({...f,landmarks:f.landmarks.map(p => ({...p,visibility:0.3}))})),phases,'right');
  assert.ok(Number.isFinite(low.metrics.elbowAngle));
  assert.equal(compareAnalyses(sample(),low,metadata,metadata).confidence,'Low');
  const sparse = calculateMetrics(frames().map((f,i) => [0,2,12,20,24].includes(i) ? f : {...f,landmarks:null}),phases,'right');
  assert.ok(Number.isFinite(sparse.metrics.elbowAngle));
  assert.equal(sparse.lowQuality,true);
  assert.ok(sparse.warnings.some(w => w.includes('途切れ')));
});
test('release detection gaps use nearest measured values with a confidence warning', () => {
  const gap = calculateMetrics(frames().map(f => Math.abs(f.time-1)<0.3 ? {...f,landmarks:null} : f),phases,'right');
  assert.ok(Number.isFinite(gap.metrics.elbowAngle));
  assert.equal(gap.lowQuality,true);
  assert.ok(gap.warnings.some(w => w.includes('最も近い')));
});
test('automatic midpoint release and very short phase windows are accepted as approximate', () => {
  assert.doesNotThrow(() => validatePhases({start:0,release:0.05,end:0.1},0.1));
  assert.equal(calculateMetrics(frames(),phases,'right',1,true).lowQuality,true);
});
test('coaching prioritizes at most two improvements', () => {
  const a = sample(),b = sample();
  for (const key of Object.keys(METRICS)) if (b.metrics[key] !== null) b.metrics[key] += METRICS[key].tolerance;
  const feedback = generateFeedback(compareAnalyses(a,b,metadata,metadata));
  assert.equal(feedback.focus.length,2);
});

test('small or stationary movements still yield reference metrics with low confidence', () => {
  const still = frames().map(f => ({...f, landmarks: frames()[0].landmarks}));
  const analysis = calculateMetrics(still,phases,'right');
  assert.ok(Number.isFinite(analysis.metrics.elbowAngle));
  assert.equal(analysis.metrics.armLead,null);
  assert.equal(analysis.metrics.wristPeakTiming,null);
  assert.equal(analysis.lowQuality,true);
});
