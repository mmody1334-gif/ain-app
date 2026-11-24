import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const imp = (rel) => import(pathToFileURL(path.resolve(rel)).href);
const { VisionSmoother } = await imp('js/vision/smooth.js');
const { isMobileDevice, shouldAutoFallbackToCpu } = await imp('js/vision/capture.js');
const { StaticClassifier, extractFeatures, fingerStates3 } = await imp('js/vision/classify.js');
const { SignTrainer } = await imp('js/vision/train.js');
const { Store } = await imp('js/store.js');
const { shapePose, buildPose } = await imp('js/handModel.js');
const { mirrorPose } = await imp('js/features.js');

const rawStarter = JSON.parse(fs.readFileSync('data/starter.json', 'utf8'));
const starterSigns = Array.isArray(rawStarter) ? rawStarter : rawStarter.signs;

function toLm(pose, wx = 0.5, wy = 0.5, sz = 0.18, ar = 4 / 3) {
  return Array.from({ length: 21 }, (_, i) => ({
    x: wx + pose[i * 3] * sz,
    y: wy + pose[i * 3 + 1] * sz * ar,
    z: pose[i * 3 + 2] * sz,
  }));
}

test('Step 1-2 architecture guard: single One Euro layer, no holdSec or extra EMA in js/vision/*', () => {
  const files = ['capture.js', 'smooth.js', 'classify.js', 'train.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join('js', 'vision', f), 'utf8');
    // تجاهل التعليقات وفحص الكود الفعلي فقط
    const codeOnly = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/\bholdSec\b/.test(codeOnly), `${f} must not contain holdSec`);
    assert.ok(!/\b(extS|anglesS|tdistS)\b/.test(codeOnly), `${f} must not contain extra EMA fields`);
  }
});

test('Step 2: VisionSmoother (One Euro minCutoff=1.2, beta=8.0) damps resting jitter and resets on empty hand', () => {
  const sm = new VisionSmoother(1.2, 8.0);
  const base = toLm(shapePose('shape_open'), 0.5, 0.5, 0.18);
  let rawErr = 0;
  let smErr = 0;
  for (let i = 0; i < 20; i++) {
    const jit = (i % 2 === 0 ? 1 : -1) * 0.01;
    const noisy = base.map((p) => ({ x: p.x + jit, y: p.y - jit, z: p.z }));
    const out = sm.smooth([{ lm: noisy, hand: 'Right' }], i * 0.05);
    if (i > 5) {
      rawErr += Math.abs(noisy[8].x - base[8].x);
      smErr += Math.abs(out[0].lm[8].x - base[8].x);
    }
  }
  assert.ok(smErr < rawErr * 0.5, `Expected jitter reduction >50%, got smErr=${smErr} vs rawErr=${rawErr}`);
  assert.deepEqual(sm.smooth([], 2.0), []);
  assert.equal(sm.slots[0].wrist, null);
  assert.equal(sm.slots[1].wrist, null);
});

test('Step 3: extractFeatures normalization is translation- and scale-invariant', () => {
  const p = shapePose('shape_open');
  const fA = extractFeatures(toLm(p, 0.2, 0.3, 0.12), 4 / 3);
  const fB = extractFeatures(toLm(p, 0.72, 0.78, 0.29), 4 / 3);
  assert.equal(fA.length, 63);
  assert.ok(Math.abs(fA[0]) < 1e-6 && Math.abs(fA[1]) < 1e-6 && Math.abs(fA[2]) < 1e-6);
  let maxDiff = 0;
  for (let i = 0; i < 63; i++) maxDiff = Math.max(maxDiff, Math.abs(fA[i] - fB[i]));
  assert.ok(maxDiff < 1e-4, `Expected invariant features, got maxDiff=${maxDiff}`);
});

test('Step 3: StaticClassifier 5-frame majority vote (2 frames=null, 3 frames=hit) and instant reset on hand loss', () => {
  const clf = new StaticClassifier({ k: 5, voteWindow: 5, confThreshold: 0.7 });
  clf.loadSigns(starterSigns);
  const openH = [{ lm: toLm(shapePose('shape_open')) }];
  assert.equal(clf.predict(openH, 4 / 3).word, null);
  assert.equal(clf.predict(openH, 4 / 3).word, null);
  const hit = clf.predict(openH, 4 / 3);
  assert.equal(hit.word, 'بخير');
  assert.ok(hit.conf >= 0.7);

  // فقد اليد يصفّر سجل التصويت فوراً
  const lost = clf.predict([], 4 / 3);
  assert.equal(lost.word, null);
  assert.equal(clf.history.length, 0);
});

test('Step 3: ambiguous half-curled pose and low-confidence (<0.7) kNN return unknown (null)', () => {
  const clf = new StaticClassifier({ k: 5, voteWindow: 5, confThreshold: 0.7 });
  clf.loadSigns(starterSigns);
  const halfCurled = buildPose({ curl: [0.4, 0.45, 0.45, 0.45, 0.45] });
  const states = fingerStates3(extractFeatures(toLm(halfCurled), 4 / 3));
  assert.ok(states.includes('H'), `Expected ambiguous H states, got ${states.join('')}`);

  let res = null;
  for (let i = 0; i < 5; i++) res = clf.predict([{ lm: toLm(halfCurled) }], 4 / 3);
  assert.equal(res.word, null);
  assert.equal(res.conf, 0);
});

test('Step 3-4: single user-recorded sign does NOT hijack fist, open palm, or victory', () => {
  const tr = new SignTrainer();
  tr.start('one', { target: 10, durationMs: 5000 });
  const loveLm = toLm(shapePose('shape_love'));
  for (let i = 0; i < 12; i++) {
    tr.lastSampleAt = -Infinity;
    tr.pushFrame({ t: i * 0.1, hands: [{ lm: loveLm }], aspect: 4 / 3 });
  }
  const userSign = tr.buildSign('اختباري');
  assert.ok(userSign && userSign.samples.length >= 8);

  const clf = new StaticClassifier({ k: 5, voteWindow: 5, confThreshold: 0.7 });
  clf.loadSigns([...starterSigns, userSign]);

  const expected = [
    ['اختباري', shapePose('shape_love')],
    ['قوي', shapePose('shape_fist')],
    ['بخير', shapePose('shape_open')],
    ['اتصل بي', shapePose('shape_call')],
    [null, shapePose('shape_victory')],
    ['أحسنت', shapePose('shape_thumb')],
    ['حسنًا', shapePose('shape_ok')],
  ];
  for (const [want, pose] of expected) {
    clf.reset();
    let r = null;
    for (let i = 0; i < 5; i++) r = clf.predict([{ lm: toLm(pose) }], 4 / 3);
    assert.equal(r.word, want, `Expected ${want}, got ${r.word}`);
  }
});

test('Step 3-4: two-hand kNN (k=5) recognizes all 5 starter pairs with swapped hand order', () => {
  const clf = new StaticClassifier({ k: 5, voteWindow: 5, confThreshold: 0.7 });
  clf.loadSigns(starterSigns);
  const pairs = [
    ['سلام', 'shape_open', 'shape_open', [0.34, 0.52], [0.66, 0.52]],
    ['شكرا', 'shape_open', 'shape_thumb', [0.35, 0.56], [0.65, 0.48]],
    ['ايوه', 'shape_thumb', 'shape_thumb', [0.34, 0.54], [0.66, 0.54]],
    ['لا', 'shape_point', 'shape_point', [0.36, 0.54], [0.64, 0.54]],
    ['ساعدني', 'shape_fist', 'shape_fist', [0.38, 0.55], [0.62, 0.55]],
  ];
  for (const [want, s1, s2, w1, w2] of pairs) {
    clf.reset();
    const lm1 = toLm(shapePose(s1), w1[0], w1[1] * (4 / 3));
    const lm2 = toLm(mirrorPose(shapePose(s2)), w2[0], w2[1] * (4 / 3));
    let r = null;
    for (let i = 0; i < 5; i++) {
      const hands = i % 2 === 0 ? [{ lm: lm1 }, { lm: lm2 }] : [{ lm: lm2 }, { lm: lm1 }];
      r = clf.predict(hands, 4 / 3);
    }
    assert.equal(r.word, want, `2H expected ${want}, got ${r.word}`);
  }
});

test('Step 4: SignTrainer 2-hand capture -> Store save/reload roundtrip (in-memory fallback in Node)', async () => {
  const store = new Store();
  await store.open();
  const tr = new SignTrainer();
  tr.start('two', { target: 10, durationMs: 5000 });
  const lm1 = toLm(shapePose('shape_victory'), 0.34, 0.55);
  const lm2 = toLm(shapePose('shape_open'), 0.66, 0.55);
  for (let i = 0; i < 12; i++) {
    tr.lastSampleAt = -Infinity;
    tr.pushFrame({ t: i * 0.1, hands: [{ lm: lm1 }, { lm: lm2 }], aspect: 4 / 3 });
  }
  const s2 = tr.buildSign('تجربة_يدين');
  assert.ok(s2 && s2.hands === 2 && s2.samples2.length >= 8 && s2.samples2[0].length === 132);
  await store.putSign(s2);
  const all = await store.allSigns();
  assert.equal(all.length, 1);

  const clf = new StaticClassifier({ k: 5, voteWindow: 5, confThreshold: 0.7 });
  clf.loadSigns(all);
  let r = null;
  for (let i = 0; i < 5; i++) r = clf.predict([{ lm: lm1 }, { lm: lm2 }], 4 / 3);
  assert.equal(r.word, 'تجربة_يدين');
  await store.deleteSign(s2.id);
  assert.equal((await store.allSigns()).length, 0);
});

test('Step 1: mobile detection and automatic GPU->CPU fallback on silent empty mobile frames', () => {
  assert.equal(isMobileDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile', 5), true);
  assert.equal(isMobileDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5), true);
  assert.equal(isMobileDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), true); // iPadOS
  assert.equal(isMobileDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0', 0), false);

  // موبايل على GPU بلا أي يد مكتشفة بعد 2.2ث و12 إطاراً -> سقوط تلقائي إلى CPU
  assert.equal(shouldAutoFallbackToCpu({
    backend: 'GPU', mobile: true, manualBackend: false, everSawHandOnGpu: false, elapsedMs: 2300, emptyFrames: 15, slowFrames: 0,
  }), true);
  // موبايل على GPU لكن سبق والتقط اليد -> لا يسقط لـ CPU
  assert.equal(shouldAutoFallbackToCpu({
    backend: 'GPU', mobile: true, manualBackend: false, everSawHandOnGpu: true, elapsedMs: 5000, emptyFrames: 40, slowFrames: 0,
  }), false);
  // لابتوب على GPU بلا يد -> لا يسقط تلقائياً إلا عند البطء الشديد
  assert.equal(shouldAutoFallbackToCpu({
    backend: 'GPU', mobile: false, manualBackend: false, everSawHandOnGpu: false, elapsedMs: 5000, emptyFrames: 40, slowFrames: 0,
  }), false);
  // اختيار يدوي من المستخدم -> يُحترم ولا يُغيَّر تلقائياً
  assert.equal(shouldAutoFallbackToCpu({
    backend: 'GPU', mobile: true, manualBackend: true, everSawHandOnGpu: false, elapsedMs: 5000, emptyFrames: 40, slowFrames: 10,
  }), false);
});
