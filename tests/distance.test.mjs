// فحص هندسة المسافة في js/depth.js: كل اختبار هنا كان يفشل على الكود القديم.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const imp = (rel) => import(pathToFileURL(path.resolve(rel)).href);
const { RayEngine } = await imp('js/depth.js');
const { RadarSpeechGate } = await imp('js/vision/radar.js');

const CW = 120, CH = 160;
const video = { videoWidth: 480, videoHeight: 640 };
function engine(frame, detections = []) {
  const r = new RayEngine();
  r.canvas = { width: CW, height: CH };
  r.ctx = { drawImage() {}, getImageData: () => frame };
  r._detector = { detectForVideo: () => ({ detections }) };
  r._lastDetPerf = -1e9;
  return r;
}
const det = (x, y, w, h, name, score = 0.8) => ({
  boundingBox: { originX: x * 480, originY: y * 640, width: w * 480, height: h * 640 },
  categories: [{ categoryName: name, score }],
});
/** مشهد ممر فارغ: تدرّج إضاءة ناعم بلا حواف */
function emptyCorridor() {
  const data = new Uint8ClampedArray(CW * CH * 4);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const i = (y * CW + x) * 4, v = 110 + y * 0.4 + ((x * 3 + y) % 5);
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
  }
  return { width: CW, height: CH, data };
}

test('gyro: phone held exactly upright (beta=90) means camera pitch 0, not -5 deg', () => {
  const r = new RayEngine();
  r._handleOrientation({ beta: 90, gamma: 0, alpha: 0 });
  assert.ok(Math.abs(r.pitch) < 1e-9, `pitch=${r.pitch}`);
  // صف أسفل الصورة = زاوية vfov/2 تحت الأفق، والمسافة الحقيقية = 1.32 / tan(31°) ≈ 2.20م
  assert.ok(Math.abs(r._calcDistFromRow(1.0) - 2.2) < 0.05, `got ${r._calcDistFromRow(1.0)}`);
});

test('empty corridor (no edges at all) is reported as a clear path, not a phantom "wall at 3.6m"', () => {
  const r = engine(emptyCorridor());
  r._handleOrientation({ beta: 90, gamma: 0, alpha: 0 });
  const spoken = [];
  const gate = new RadarSpeechGate({ speakFn: (t) => spoken.push(t), cancelFn() {}, isSpeakingFn: () => false });
  let res;
  for (let i = 0; i < 12; i++) { res = r.process(video); gate.update(res, i * 100); }
  assert.doesNotMatch(res.label, /جدار/);
  assert.ok(res.zones.center >= 4.0, `center=${res.zones.center}`);
  assert.equal(spoken.length, 0, `must stay silent, said: ${spoken}`);
});

test('person close in front with feet cut off by the frame (phone upright) is NOT reported as 2.7m', () => {
  // شخص على ~1.3م: يملأ أغلب ارتفاع الصورة وقدماه خارجها
  const r = engine(emptyCorridor(), [det(0.35, 0.02, 0.3, 0.98, 'person')]);
  r._handleOrientation({ beta: 90, gamma: 0, alpha: 0 });
  r.process(video);
  const d = r.lastDetections[0].dist;
  assert.ok(d < 1.8, `person with clipped feet must be estimated close, got ${d.toFixed(2)}m`);
  assert.ok(d > 0.8, `but not absurdly close, got ${d.toFixed(2)}m`);
});

test('a fully visible chair far away keeps its ground-plane distance', () => {
  const r = engine(emptyCorridor(), [det(0.42, 0.62, 0.16, 0.18, 'chair')]);
  r._handleOrientation({ beta: 90, gamma: 0, alpha: 0 });
  r.process(video);
  const d = r.lastDetections[0].dist;
  // قاع الكرسي عند الصف 0.8 → 1.32/tan(0.3*62°) ≈ 3.9م
  assert.ok(d > 3.3 && d < 4.5, `got ${d.toFixed(2)}`);
});

test('an obstacle seen only by edges (no detector name) is called "obstacle", never asserted as a wall', () => {
  const f = emptyCorridor();
  for (let y = 120; y < CH; y++) for (let x = 0; x < CW; x++) { const i = (y * CW + x) * 4; f.data[i] = f.data[i + 1] = f.data[i + 2] = 25; }
  const r = engine(f);
  r._handleOrientation({ beta: 60, gamma: 0, alpha: 0 }); // مائل للأسفل 30°
  const res = r.process(video);
  assert.doesNotMatch(res.label, /جدار/);
  assert.ok(res.zones.center < 3.5, `center=${res.zones.center}`);
});
