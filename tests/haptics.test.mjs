// اهتزاز الرادار: نمط مختلف لكل مسافة، بإيقاع هادئ، ولا اهتزاز في الجيب/الظلام.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { RadarHaptics, HAPTIC_PATTERNS } = await import(pathToFileURL(path.resolve('js/vision/radar.js')).href);

const run = (targets, stepMs = 100) => {
  const fired = [];
  const h = new RadarHaptics({ vibrateFn: (p) => fired.push(p) });
  targets.forEach((t, i) => h.update(t, i * stepMs));
  return fired;
};
const rep = (t, n) => Array.from({ length: n }, () => t);

test('each distance band has its own distinct pattern', () => {
  const ps = ['danger', 'near', 'mid', 'occluded'].map((k) => JSON.stringify(HAPTIC_PATTERNS[k].pattern));
  assert.equal(new Set(ps).size, 4);
});

test('danger buzzes about once per second, not on every frame', () => {
  const fired = run(rep({ dist: 0.6 }, 50)); // 5 ثوانٍ بمعدل 10 إطارات/ث
  assert.ok(fired.length >= 4 && fired.length <= 6, `fired ${fired.length}`);
  assert.deepEqual(fired[0], HAPTIC_PATTERNS.danger.pattern);
});

test('near and mid are calmer; far / clear never vibrate', () => {
  assert.ok(run(rep({ dist: 1.4 }, 50)).length <= 4);
  assert.ok(run(rep({ dist: 2.4 }, 50)).length <= 2);
  assert.equal(run(rep({ dist: 3.5 }, 50)).length, 0);
  assert.equal(run(rep({ dist: 4.5 }, 50)).length, 0);
});

test('an obstacle getting closer vibrates immediately with the new pattern', () => {
  const fired = run([...rep({ dist: 2.4 }, 5), { dist: 0.6 }]);
  assert.deepEqual(fired.at(-1), HAPTIC_PATTERNS.danger.pattern);
});

test('covered camera has its own pattern; pocket / dark is silent', () => {
  assert.deepEqual(run([{ dist: 0.3, occluded: true }])[0], HAPTIC_PATTERNS.occluded.pattern);
  assert.equal(run(rep({ dist: 0.6, dark: true }, 30)).length, 0);
  assert.equal(run(rep({ dist: 0.6, pocket: true }, 30)).length, 0);
});

test('disabled = no vibration at all', () => {
  const fired = [];
  const h = new RadarHaptics({ vibrateFn: (p) => fired.push(p) });
  h.enabled = false;
  for (let i = 0; i < 30; i++) h.update({ dist: 0.5 }, i * 100);
  assert.equal(fired.length, 0);
});

test('moving away through several bands quickly does not cause a burst of vibrations', () => {
  const fired = run([{ dist: 0.3, occluded: true }, { dist: 0.6 }, { dist: 1.4 }, { dist: 2.3 }, { dist: 2.4 }], 200);
  assert.equal(fired.length, 1, JSON.stringify(fired));
});
