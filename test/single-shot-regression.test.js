import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateMetrics, compareAnalyses } from '../src/metrics.js';
import { generateFeedback } from '../src/feedback.js';
import { reviewShot } from '../src/shot-engine.js';
import { evaluateCheckpoints } from '../src/checkpoints.js';
import { frames } from '../test-support/shot-frames.js';
export function baseline(){ const phases={start:0,release:1,end:2}, meta={cameraAngle:'side',shotType:'jump',hand:'right'}; const good=calculateMetrics(frames(),phases,'right'); const shot=calculateMetrics(frames().map(f=>({...f,landmarks:f.landmarks.map((p,i)=>i===16?{...p,x:p.x+0.04}:p)})),phases,'right'); const comparison=compareAnalyses(good,shot,meta,meta); return {metrics:shot.metrics,comparison,feedback:generateFeedback(comparison),checkpoints:evaluateCheckpoints(shot,meta,good,meta)}; }
test('preserved Single Shot metrics, Form Match, sub-scores and feedback match pre-session baseline',()=>{assert.deepEqual(baseline(),JSON.parse(readFileSync(new URL('./fixtures/single-shot-baseline.json',import.meta.url))));});

test('the shared review engine preserves the pre-session Single Shot scoring pipeline',()=>{const phases={start:0,release:1,end:2},meta={cameraAngle:'side',shotType:'jump',hand:'right'};const good=calculateMetrics(frames(),phases,'right');const shot=calculateMetrics(frames().map(f=>({...f,landmarks:f.landmarks.map((p,i)=>i===16?{...p,x:p.x+0.04}:p)})),phases,'right');const {metrics,checkpoints,...expected}=baseline();const {trunkEstimate,...core}=reviewShot(good,shot,meta,meta);assert.ok(trunkEstimate);assert.deepEqual(core,{...expected,checkpointReview:checkpoints});});
