import test from 'node:test';
import assert from 'node:assert/strict';
import {
  packOfflineFrames,
  unpackOfflineFrames,
  changeAnnotations,
  emptyAnnotations,
  activeLabels,
  annotationCounts,
  matchShotTimes,
  benchmarkRuns,
} from '../src/offline-data.js';
import { detectSessionRows, detectSessionShots } from '../src/session.js';
import { detectLegacyRows } from '../src/offline-legacy-detector.js';
import { shotMotionRows, shotCandidates, shotCandidatesFromRows } from '../src/auto-phases.js';
import { frames } from '../test-support/shot-frames.js';
import { benchmarkOfflineExport, validateOfflineExport } from '../src/offline-benchmark.js';
const trace = [0, 4, 8].flatMap((o) => frames().map((f) => ({ ...f, time: f.time + o }))),
  range = { start: 0, end: 10 };
const assetId = 'video-' + 'a'.repeat(64);
function annotations() {
  let a = emptyAnnotations(assetId);
  for (const [index, time] of [1, 5, 9].entries())
    a = changeAnnotations(
      a,
      { type: 'add', time },
      { id: `manual${index}`, now: index, duration: 10 }
    );
  return changeAnnotations(a, { type: 'complete', value: true }, { now: 8, duration: 10 });
}
function exported() {
  const packed = unpackOfflineFrames(packOfflineFrames(trace));
  return {
    format: 'psfl.offline-training',
    schemaVersion: 1,
    asset: { id: assetId, sha256: 'a'.repeat(64), duration: 10, width: 480, height: 480 },
    cache: {
      id: 'cache',
      assetId,
      status: 'complete',
      chunkCount: 1,
      frameCount: trace.length,
      lastTime: 10,
    },
    annotations: {
      ...annotations(),
      items: annotations().items.map((i) => ({ ...i, time: i.time - 0.5 })),
    },
    runs: [{ cacheId: 'cache', metadata: { hand: 'right' } }],
    poseChunks: [{ index: 0, frames: packed }],
  };
}
test('compact offline Pose preserves all 33 landmarks, media seconds and missing frames without legacy live packing', () => {
  const input = [...trace, { time: 10.1, landmarks: null }],
    buffer = packOfflineFrames(input),
    output = unpackOfflineFrames(buffer);
  assert.equal(buffer.byteLength, input.length * 133 * 4);
  assert.equal(output.length, input.length);
  assert.equal(output.at(-1).landmarks, null);
  assert.equal(output[0].landmarks.length, 33);
  assert.ok(Math.abs(output[12].time - input[12].time) < 1e-6);
  assert.ok(Math.abs(output[12].landmarks[16].y - input[12].landmarks[16].y) < 1e-6);
  assert.throws(() => unpackOfflineFrames(new Float32Array(2).buffer));
});
test('shared row entry is identical to current Session detection for whole trace, both hands, portrait/landscape, missing and tracked-ball samples', () => {
  const variants = [
    trace,
    trace.map((f) => ({
      ...f,
      ball: {
        x: f.landmarks[16].x,
        y: f.landmarks[16].y,
        radius: 0.03,
        confidence: 0.9,
        trackId: 1,
      },
    })),
    trace.map((f, i) => (i % 9 === 0 ? { ...f, landmarks: null } : f)),
  ];
  for (const t of variants)
    for (const hand of ['left', 'right'])
      for (const aspect of [9 / 16, 1, 16 / 9]) {
        const rows = shotMotionRows(t, hand, aspect),
          balls = t.filter((f) => f.ball).length;
        assert.deepEqual(
          shotCandidatesFromRows(rows, range, true, balls),
          shotCandidates(t, hand, aspect, range, true)
        );
        assert.deepEqual(
          detectSessionRows(rows, range, undefined, balls),
          detectSessionShots(t, hand, aspect, range)
        );
      }
});
test('current and frozen pre39 Session share normal-shot counts and report no-person/stationary as zero', () => {
  const rows = shotMotionRows(trace, 'right', 1);
  assert.equal(detectLegacyRows(rows, range).length, 3);
  assert.equal(detectSessionRows(rows, range).length, 3);
  for (const input of [
    [],
    shotMotionRows(
      frames().map((f) => ({ ...f, landmarks: frames()[0].landmarks })),
      'right',
      1
    ),
  ]) {
    assert.equal(detectLegacyRows(input, range).length, 0);
    assert.equal(detectSessionRows(input, range).length, 0);
  }
});
test('reanalysis never renumbers or mutates final human labels; count actions using active state instead of history', () => {
  const a = annotations(),
    before = structuredClone(a);
  let b = changeAnnotations(
    a,
    { type: 'move', id: 'manual1', time: 5.2 },
    { duration: 10, now: 10 }
  );
  b = changeAnnotations(
    b,
    { type: 'edit', id: 'manual0', active: false },
    { duration: 10, now: 11 }
  );
  b = changeAnnotations(b, { type: 'reject', runId: 'r', shotId: 's' }, { duration: 10, now: 12 });
  assert.deepEqual(a, before);
  assert.equal(b.complete, false);
  assert.deepEqual(
    activeLabels(b).map((l) => l.time),
    [5.2, 9]
  );
  assert.equal(b.items.length, 3);
  assert.equal(b.history.length, 7);
  assert.deepEqual(annotationCounts(b, { id: 'r', shots: [{}] }), {
    automatic: 1,
    manual: 2,
    confirmed: 2,
    excluded: 1,
  });
  assert.throws(() => changeAnnotations(b, { type: 'add', time: 5.1 }, { duration: 10 }), /近く/);
  assert.throws(() => changeAnnotations(b, { type: 'add', time: 11 }, { duration: 10 }));
});
test('ten consecutive additions, time correction, exclusion/undo, form feedback, outcome and comments survive JSON roundtrip', () => {
  let a = emptyAnnotations(assetId);
  for (let i = 0; i < 10; i++)
    a = changeAnnotations(a, { type: 'add', time: i + 1 }, { duration: 20, id: `s${i}` });
  a = changeAnnotations(
    a,
    {
      type: 'edit',
      id: 's0',
      formRating: 'bad',
      outcome: 'missed',
      note: '自分の正解',
      active: false,
    },
    { duration: 20 }
  );
  a = changeAnnotations(a, { type: 'edit', id: 's0', active: true }, { duration: 20 });
  const b = JSON.parse(JSON.stringify(a));
  assert.equal(activeLabels(b).length, 10);
  assert.equal(b.items[0].formRating, 'bad');
  assert.equal(b.items[0].outcome, 'missed');
  assert.equal(b.items[0].note, '自分の正解');
  assert.equal(b.history.length, 12);
});
test('one-to-one interval matching maximizes matches, leaves duplicate FP and missing FN; zero denominators stay unknown', () => {
  const r = matchShotTimes([1, 1.6], [0.8, 1.2, 1.3, 4], 0.5);
  assert.equal(r.tp, 2);
  assert.equal(r.fp, 2);
  assert.equal(r.fn, 0);
  assert.equal(r.precision, 0.5);
  assert.equal(r.recall, 1);
  assert.ok(Math.abs(r.f1 - 2 / 3) < 1e-10);
  assert.deepEqual(matchShotTimes([], []), {
    truthCount: 0,
    detectedCount: 0,
    tp: 0,
    fp: 0,
    fn: 0,
    precision: null,
    recall: null,
    f1: null,
    tolerance: 0.5,
    pairs: [],
  });
  assert.equal(matchShotTimes([1], []).recall, 0);
  assert.equal(matchShotTimes([], [1]).recall, null);
  assert.throws(() => matchShotTimes([NaN], []));
});
test('comparison requires complete human review and same complete Pose; fixes invalidate old comparisons', () => {
  const a = annotations(),
    cache = { id: 'cache', status: 'complete' },
    runs = [
      {
        id: 'r',
        assetId,
        cacheId: 'cache',
        algorithm: 'example',
        shots: [{ phases: { release: 1 } }, { phases: { release: 5.1 } }],
      },
    ];
  const b = benchmarkRuns(a, runs, cache);
  assert.equal(b.labelRevision, a.revision);
  assert.equal(b.results[0].fn, 1);
  assert.throws(() => benchmarkRuns({ ...a, complete: false }, runs, cache), /全編/);
  assert.throws(() => benchmarkRuns(a, [{ ...runs[0], cacheId: 'other' }], cache));
  assert.throws(() => benchmarkRuns(a, runs, { ...cache, status: 'cancelled' }));
});
test('portable JSON drives repeatable same-video pre39/current comparison using final labels, not operation counts', () => {
  const d = exported(),
    a = benchmarkOfflineExport(JSON.parse(JSON.stringify(d))),
    b = benchmarkOfflineExport(d);
  assert.deepEqual(a, b);
  assert.equal(a.results.length, 2);
  assert.equal(a.results[0].truthCount, 3);
  assert.equal(a.results[0].tp, 3);
  assert.equal(a.results[0].fp, 0);
  assert.equal(a.results[0].fn, 0);
  assert.equal(a.results[0].f1, 1);
  assert.deepEqual(
    a.finalLabels.map((l) => l.time),
    [0.5, 4.5, 8.5]
  );
});
test('portable validator rejects truncated, unordered and foreign data rather than fabricating metrics', () => {
  for (const mutate of [
    (d) => (d.schemaVersion = 99),
    (d) => (d.cache.assetId = 'other'),
    (d) => (d.cache.frameCount = 4),
    (d) => (d.poseChunks[0].frames[3].time = 0),
    (d) => (d.annotations.items[0].time = Infinity),
    (d) => (d.poseChunks[0].frames[0].landmarks = [{}]),
  ]) {
    const d = exported();
    mutate(d);
    assert.throws(() => validateOfflineExport(d));
  }
});
test('rejecting a previously confirmed automatic candidate removes only its linked truth and keeps history', () => {
  let a = emptyAnnotations(assetId);
  a = changeAnnotations(
    a,
    { type: 'add', time: 1, origin: 'auto-confirmed', runId: 'r', shotId: 's' },
    { duration: 10, id: 'linked' }
  );
  a = changeAnnotations(a, { type: 'add', time: 4 }, { duration: 10, id: 'manual' });
  a = changeAnnotations(a, { type: 'reject', runId: 'r', shotId: 's' }, { duration: 10 });
  assert.deepEqual(
    activeLabels(a).map((l) => l.id),
    ['manual']
  );
  assert.equal(a.items.length, 2);
  assert.equal(a.history.length, 3);
});
