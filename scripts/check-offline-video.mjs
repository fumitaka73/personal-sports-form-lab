import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { benchmarkOfflineExport } from '../src/offline-benchmark.js';
const { chromium } = createRequire(import.meta.url)('playwright');
const fixture = process.env.OFFLINE_VIDEO_FIXTURE;
if (!fixture)
  throw new Error(
    'OFFLINE_VIDEO_FIXTUREに14秒以上の人工テスト動画を指定してください（docs/issue-40-offline-video.md参照）。'
  );
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true }),
    errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error('PAGEERROR', e.message);
  });
  page.on('dialog', (d) => d.accept());
  page.setDefaultTimeout(20000);
  const base = process.env.LIVE_TEST_URL || 'http://127.0.0.1:5173';
  await page.route('**/offline-test-blank', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>migration fixture</title>' })
  );
  await page.goto(base + '/offline-test-blank');
  // Seed the exact previous v4 stores, including Blob, Pose bytes, Calibration and review sentinels.
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('sports-form-lab', 4);
      r.onupgradeneeded = () => {
        for (const n of [
          'videos',
          'results',
          'settings',
          'temporaryVideos',
          'poseSessions',
          'poseChunks',
          'calibrations',
        ])
          r.result.createObjectStore(n, { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(
        [
          'videos',
          'results',
          'settings',
          'temporaryVideos',
          'poseSessions',
          'poseChunks',
          'calibrations',
        ],
        'readwrite'
      );
      tx.objectStore('videos').put({
        id: 'old-good',
        title: '旧Good Form',
        isGoodForm: true,
        createdAt: 1,
        blob: new Blob(['keep-good']),
      });
      tx.objectStore('results').put({
        id: 'old-session',
        kind: 'live-coach',
        goodFormReference: { id: 'old-good', title: '旧Good Form' },
        metadata: {},
        shots: [],
        createdAt: 1,
      });
      tx.objectStore('settings').put({
        id: 'review-v04',
        value: {
          version: 1,
          cases: {},
          references: {},
          sessionFeedback: {},
          verification: {},
          sentinel: 'old-review',
        },
      });
      tx.objectStore('settings').put({
        id: 'keep-user-setting',
        value: { calibration: 'approved', notes: '保存済みメモ' },
      });
      tx.objectStore('temporaryVideos').put({
        id: 'old-video',
        keep: true,
        blob: new Blob(['keep-video']),
        bytes: 10,
      });
      tx.objectStore('poseSessions').put({ id: 'old-pose', origin: 10, count: 1 });
      tx.objectStore('poseChunks').put({
        id: 'old-pose:0',
        sessionId: 'old-pose',
        index: 0,
        buffer: new Uint8Array([1, 2, 3, 4]).buffer,
      });
      tx.objectStore('calibrations').put({ id: 'old-calibration', value: 'keep-calibration' });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.goto(base);
  await page.locator('.other-menu>summary').click();
  await page.locator('[data-page=offline]').click();
  assert.equal(await page.locator('#offline-add').isVisible(), false);
  // Real native H.264 decoder and IndexedDB, synthetic inference only (not an accuracy test).
  await page.evaluate(async () => {
    const { frames } = await import('/test-support/shot-frames.js'),
      samples = frames();
    window.poseSendCount = 0;
    window.Pose = class {
      setOptions() {}
      onResults(cb) {
        this.cb = cb;
      }
      async initialize() {}
      async send(input, time) {
        window.poseSendCount++;
        if (window.failPose) throw new Error('人工のモデル失敗');
        const sample = samples[Math.min(24, Math.round(((time / 1000) % 4) * 12))];
        this.cb({ poseLandmarks: sample.landmarks });
      }
      async close() {}
    };
  });
  await page.locator('#offline-upload').setInputFiles(fixture);
  await page.waitForFunction(() =>
    document.querySelector('#offline-status').textContent.includes('内容を照合')
  );
  await page.waitForFunction(() => !document.querySelector('#offline-add').disabled);
  assert.match(await page.locator('#offline-video-state').textContent(), /保存・内容照合済み/);
  const assetId = await page.locator('#offline-assets').inputValue();
  await page.locator('#offline-start').click();
  assert.ok((await page.locator('#offline-player').evaluate((v) => v.currentTime)) < 0.05);
  await page.locator('[data-offline-skip="3"]').click();
  await page.waitForFunction(
    () => Math.abs(document.querySelector('#offline-player').currentTime - 3) < 0.02
  );
  await page.locator('[data-offline-skip="-3"]').click();
  await page.waitForFunction(() => document.querySelector('#offline-player').currentTime < 0.05);
  async function seek(time) {
    await page.locator('#offline-seek').evaluate((e, t) => {
      e.value = String(t);
      e.dispatchEvent(new Event('input', { bubbles: true }));
    }, time);
    await page.waitForFunction(
      (t) => Math.abs(document.querySelector('#offline-player').currentTime - t) < 0.025,
      time
    );
  }
  for (let i = 0; i < 10; i++) {
    await seek(0.5 + i);
    await page.locator('#offline-add').click();
    await page.waitForFunction(
      (n) =>
        document
          .querySelector('#offline-counts')
          .textContent.includes('確認した正解 ' + n + '本') &&
        document.querySelector('#offline-save').textContent.includes('読み戻し確認済み'),
      i + 1
    );
  }
  await page.locator('#offline-outcome').selectOption('missed');
  await page.locator('#offline-form-rating').selectOption('bad');
  await page.locator('#offline-note').fill('手動の確認メモ');
  await page.locator('#offline-save-label').click();
  await page.waitForFunction(() =>
    document.querySelector('#offline-save').textContent.includes('読み戻し確認済み')
  );
  await seek(10.5);
  await page.locator('#offline-move').click();
  await page.waitForFunction(() =>
    document.querySelector('[data-offline-label].active')?.textContent.includes('10.50')
  );
  await page.locator('#offline-remove-label').click();
  await page.waitForFunction(() =>
    document.querySelector('#offline-counts').textContent.includes('確認した正解 9本')
  );
  await seek(10.5);
  await page.locator('#offline-add').click();
  await page.waitForFunction(() =>
    document.querySelector('#offline-counts').textContent.includes('確認した正解 10本')
  );
  await page.locator('#offline-extract').click();
  await page.waitForFunction(
    () => document.querySelector('#offline-status').textContent.includes('骨格の読み取りを保存'),
    null,
    { timeout: 120000 }
  );
  const sent = await page.evaluate(() => window.poseSendCount);
  console.log('extraction', sent, await page.locator('#offline-cache-info').textContent());
  assert.ok(sent >= 200);
  await page.locator('#offline-replay').click();
  await page.waitForFunction(() =>
    document.querySelector('#offline-status').textContent.includes('自動候補を保存')
  );
  assert.match(await page.locator('#offline-counts').textContent(), /確認した正解 10本/);
  assert.equal(
    await page.evaluate(() => window.poseSendCount),
    sent,
    'rule replay does not reinfer video'
  );
  const before = await page.evaluate(async (id) => {
    const st = await import('/src/offline-storage.js');
    return {
      labels: JSON.stringify(await st.getOfflineAnnotations(id)),
      runs: await st.listOfflineRuns(id),
      caches: await st.listOfflineCaches(id),
    };
  }, assetId);
  assert.equal(before.runs.length, 1);
  assert.equal(before.caches.length, 1);
  assert.ok(before.caches[0].frameCount > 190);
  assert.equal(before.caches[0].status, 'complete');
  assert.equal(before.runs[0].referenceId, null);
  assert.ok(before.runs[0].shots.length > 0);
  assert.equal(before.runs[0].shots[0].evaluation, null);
  await page.locator('#offline-complete').check();
  await page.waitForFunction(() => document.querySelector('#offline-compare').disabled === false);
  await page.locator('#offline-compare').click();
  await page.waitForSelector('.offline-metric-cards article');
  assert.equal(await page.locator('.offline-metric-cards article').count(), 2);
  assert.match(await page.locator('#offline-metrics').textContent(), /正解 10本/);
  const download = page.waitForEvent('download');
  await page.locator('#offline-export').click();
  await page.locator('#offline-download-json').click();
  const file = await download,
    downloadPath = await file.path(),
    json = JSON.parse(await readFile(downloadPath, 'utf8')),
    report = benchmarkOfflineExport(json);
  if (process.env.OFFLINE_EXPORT_TEST_PATH) await file.saveAs(process.env.OFFLINE_EXPORT_TEST_PATH);
  assert.equal(report.results.length, 2);
  assert.equal(report.results[0].truthCount, 10);
  assert.equal(json.annotations.items.length, 11);
  assert.equal(json.annotations.items.filter((i) => i.active !== false).length, 10);
  assert.equal(json.annotations.items.find((i) => i.note === '手動の確認メモ').formRating, 'bad');
  assert.equal(json.poseChunks.length, before.caches[0].chunkCount);
  assert.equal('blob' in json.asset, false);
  // Re-import is content-deduplicated and does not discard labels/cache/runs.
  await page.locator('#offline-upload').setInputFiles(fixture);
  await page.waitForFunction(() =>
    document.querySelector('#offline-status').textContent.includes('内容を照合')
  );
  assert.equal(await page.locator('#offline-assets option').count(), 2);
  const after = await page.evaluate(async (id) => {
    const st = await import('/src/offline-storage.js');
    return {
      labels: await st.getOfflineAnnotations(id),
      runs: await st.listOfflineRuns(id),
      assets: await st.listOfflineAssets(),
    };
  }, assetId);
  assert.equal(after.labels.items.length, 11);
  assert.equal(after.runs.length, 3);
  assert.equal(after.assets.length, 1);
  for (const size of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await page.locator('.offline-stage').scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false
    );
    assert.ok(
      (await page.locator('.offline-stage').boundingBox()).height <=
        Math.max(270, size.height * 0.43) + 1
    );
    assert.ok((await page.locator('#offline-add').boundingBox()).height >= 44);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('.other-menu>summary').click();
  await page.locator('[data-page=offline]').click();
  await page.locator('#offline-assets').selectOption(assetId);
  await page.waitForFunction(() =>
    document.querySelector('#offline-counts').textContent.includes('確認した正解 10本')
  );
  assert.equal(await page.locator('#offline-complete').isChecked(), true);
  assert.match(await page.locator('#offline-save').textContent(), /読み戻し確認済み/);
  // Stale revision must fail without overwriting saved labels.
  const concurrency = await page.evaluate(async (id) => {
    const st = await import('/src/offline-storage.js'),
      { changeAnnotations } = await import('/src/offline-data.js'),
      a = await st.getOfflineAnnotations(id),
      next = changeAnnotations(
        a,
        { type: 'edit', id: a.items[0].id, note: '別画面の保存' },
        { duration: 14 }
      );
    await st.saveOfflineAnnotations(next, a.revision);
    try {
      await st.saveOfflineAnnotations({ ...a, revision: a.revision + 1 }, a.revision);
      return false;
    } catch {
      return (await st.getOfflineAnnotations(id)).items[0].note === '別画面の保存';
    }
  }, assetId);
  assert.equal(concurrency, true);
  // Save quota and duplicate immutable runs cannot damage existing records.
  const storageGuards = await page.evaluate(async (id) => {
    const st = await import('/src/offline-storage.js'),
      runs = await st.listOfflineRuns(id),
      original = JSON.stringify(runs[0]);
    let duplicate = false,
      quota = false;
    try {
      await st.saveOfflineRun({ ...runs[0], shots: [] });
    } catch (e) {
      duplicate = e.name === 'ConstraintError';
    }
    const put = IDBObjectStore.prototype.put;
    try {
      IDBObjectStore.prototype.put = function (row, ...rest) {
        if (this.name === 'offlineAssets')
          throw new DOMException('synthetic quota', 'QuotaExceededError');
        return put.call(this, row, ...rest);
      };
      try {
        await st.importOfflineAsset(
          new File(['synthetic new bytes'], 'quota.mp4', { type: 'video/mp4' }),
          { duration: 1, width: 10, height: 10 }
        );
      } catch (e) {
        quota = e.name === 'QuotaExceededError';
      }
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    return {
      duplicate,
      quota,
      unchanged:
        JSON.stringify((await st.listOfflineRuns(id)).find((r) => r.id === runs[0].id)) ===
        original,
      originalBlob: !!(await st.getOfflineAsset(id)).blob,
    };
  }, assetId);
  assert.deepEqual(storageGuards, {
    duplicate: true,
    quota: true,
    unchanged: true,
    originalBlob: true,
  });
  // Abort, failed inference, immutable results; original data survives every path.
  await page.evaluate(async (id) => {
    const st = await import('/src/offline-storage.js'),
      { extractOfflinePose } = await import('/src/offline-analysis.js'),
      asset = await st.getOfflineAsset(id),
      video = document.querySelector('#offline-player'),
      aborted = new AbortController();
    aborted.abort();
    try {
      await extractOfflinePose(video, asset, { signal: aborted.signal, force: true });
      throw new Error('abort was ignored');
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
    }
    const engineFactory = async () => ({
      initialize: async () => {},
      send: async () => {
        throw new Error('synthetic failure');
      },
      close: async () => {},
    });
    try {
      await extractOfflinePose(video, asset, {
        signal: new AbortController().signal,
        force: true,
        engineFactory,
      });
      throw new Error('failure was ignored');
    } catch (e) {
      if (!e.message.includes('synthetic failure')) throw e;
    }
  }, assetId);
  const midAbort = await page.evaluate(async (id) => {
    const st = await import('/src/offline-storage.js'),
      { extractOfflinePose } = await import('/src/offline-analysis.js'),
      { frames } = await import('/test-support/shot-frames.js'),
      asset = await st.getOfflineAsset(id),
      abort = new AbortController();
    let done = false;
    const engineFactory = async (cb) => ({
      initialize: async () => {},
      send: async () => cb({ poseLandmarks: frames()[0].landmarks }),
      close: async () => {
        done = true;
      },
    });
    try {
      await extractOfflinePose(document.querySelector('#offline-player'), asset, {
        force: true,
        signal: abort.signal,
        engineFactory,
        readFrame: async (v, time) => ({ time, timing: 'seek-time-estimate' }),
        onProgress: (text, p) => {
          if (p > 0.05) abort.abort();
        },
      });
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
    }
    const caches = await st.listOfflineCaches(id),
      partial = caches.find((c) => c.status === 'cancelled' && c.frameCount > 0);
    return { closed: done, partial: !!partial, hasVideo: !!(await st.getOfflineAsset(id)).blob };
  }, assetId);
  assert.deepEqual(midAbort, { closed: true, partial: true, hasVideo: true });
  // A later Good Form can evaluate manual positions without rewriting original runs.
  await page.evaluate(async () => {
    const st = await import('/src/storage.js'),
      { frames } = await import('/test-support/shot-frames.js'),
      { calculateMetrics } = await import('/src/metrics.js');
    await st.saveVideo({
      id: 'offline-test-reference',
      title: '追加した検証用基準',
      isGoodForm: true,
      createdAt: 2,
      blob: new Blob(['synthetic-reference']),
      hand: 'right',
      shotType: 'jump',
      cameraAngle: 'side',
      analysis: calculateMetrics(
        frames(),
        { start: 0, release: 1, end: 2 },
        'right',
        320 / 568,
        false
      ),
    });
    await st.setSetting('referenceId', 'offline-test-reference');
  });
  await page.reload();
  await page.locator('.other-menu>summary').click();
  await page.locator('[data-page=offline]').click();
  await page.locator('#offline-assets').selectOption(assetId);
  await page.waitForFunction(() => document.querySelector('[data-offline-label]'));
  await page.locator('[data-offline-label]').first().click();
  await page.waitForFunction(() =>
    document.querySelector('#offline-label-analysis').textContent.includes('参考計算')
  );
  await page.locator('#offline-form-rating').selectOption('bad');
  await page.locator('#offline-save-label').click();
  await page.waitForFunction(() =>
    document.querySelector('#offline-save').textContent.includes('読み戻し確認済み')
  );
  const formContext = await page.evaluate(async (id) => {
    const st = await import('/src/offline-storage.js'),
      a = await st.getOfflineAnnotations(id),
      item = a.items.find((i) => i.formReviewSnapshot?.referenceId === 'offline-test-reference'),
      runs = await st.listOfflineRuns(id);
    return {
      snapshot: !!item?.formReviewSnapshot?.comparison,
      rating: item?.formRating,
      originalNoReference: runs.every((r) => r.referenceId === null),
    };
  }, assetId);
  assert.deepEqual(formContext, { snapshot: true, rating: 'bad', originalNoReference: true });
  await page.locator('#offline-remove-video').evaluate((e) => (e.closest('details').open = true));
  await page.locator('#offline-remove-video').click();
  await page.waitForFunction(() =>
    document.querySelector('#offline-video-state').textContent.includes('端末にはありません')
  );
  assert.equal(await page.locator('#offline-add').isDisabled(), true);
  assert.equal(await page.locator('#offline-replay').isDisabled(), false);
  await page.locator('#offline-replay').click();
  await page.waitForFunction(() =>
    document.querySelector('#offline-status').textContent.includes('自動候補を保存')
  );
  const preserved = await page.evaluate(async (id) => {
    const st = await import('/src/storage.js'),
      offline = await import('/src/offline-storage.js');
    return {
      good: await (await st.listVideos()).find((v) => v.id === 'old-good').blob.text(),
      video: await (await st.listTemporaryVideos())[0].blob.text(),
      pose: [...new Uint8Array((await st.getPoseChunk('old-pose:0')).buffer)],
      cal: (await st.getCalibration('old-calibration')).value,
      review: (await st.getSetting('review-v04')).value.sentinel,
      setting: (await st.getSetting('keep-user-setting')).value,
      shotCount: (await offline.getOfflineAnnotations(id)).items.filter((i) => i.active !== false)
        .length,
      hasVideo: !!(await offline.getOfflineAsset(id)).blob,
      cacheStates: (await offline.listOfflineCaches(id)).map((c) => c.status).sort(),
      runs: (await offline.listOfflineRuns(id)).length,
    };
  }, assetId);
  assert.deepEqual(preserved, {
    good: 'keep-good',
    video: 'keep-video',
    pose: [1, 2, 3, 4],
    cal: 'keep-calibration',
    review: 'old-review',
    setting: { calibration: 'approved', notes: '保存済みメモ' },
    shotCount: 10,
    hasVideo: false,
    cacheStates: ['cancelled', 'cancelled', 'complete', 'failed'],
    runs: 4,
  });
  assert.deepEqual(errors, []);
  console.log(
    'PASS offline import/v4→v5 preservation, real native video preview/zero/3s/portrait-landscape, 10 registrations, move/exclude/edit/readback/reload, dedup, chunked synthetic Pose, replay without inference, pre39/current metrics, portable JSON+Node replay, cancel/failure/concurrency, remove-only-video and retained replay. Physical iPhone/real Pose accuracy untested.'
  );
} finally {
  await browser.close();
}
