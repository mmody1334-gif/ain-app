import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const imp = (rel) => import(pathToFileURL(path.resolve(rel)).href);
const { RayEngine } = await imp('js/depth.js');
const { RadarSpeechGate } = await imp('js/vision/radar.js');

const CW = 120, CH = 160;

/** إطار بلون جلد شبه موحّد مع تشويش خفيف (كفّ ملاصق للعدسة) */
function palmFrame(seed = 1) {
  const data = new Uint8ClampedArray(CW * CH * 4);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < data.length; i += 4) {
    const n = (rnd() - 0.5) * 6;
    data[i] = 205 + n; data[i + 1] = 150 + n; data[i + 2] = 125 + n; data[i + 3] = 255;
  }
  return { width: CW, height: CH, data };
}

/** مشهد عادي: أرضية فاتحة وعائق داكن في المنتصف */
function sceneFrame() {
  const data = new Uint8ClampedArray(CW * CH * 4);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const i = (y * CW + x) * 4;
    const v = y < 60 ? 170 : 120 + ((x * 7 + y * 3) % 40);
    data[i] = v; data[i + 1] = v; data[i + 2] = v + 5; data[i + 3] = 255;
  }
  for (let y = 70; y <= 125; y++) for (let x = 45; x <= 75; x++) {
    const i = (y * CW + x) * 4;
    data[i] = 30; data[i + 1] = 30; data[i + 2] = 35;
  }
  return { width: CW, height: CH, data };
}

function engineWith(frameFn, detections) {
  const ray = new RayEngine();
  ray.canvas = { width: CW, height: CH };
  ray.ctx = { drawImage() {}, getImageData: () => frameFn() };
  ray._detector = { detectForVideo: () => ({ detections }) };
  ray._lastDetPerf = -1e9; // يضمن تشغيل الكاشف في أول إطار
  return ray;
}
const video = { videoWidth: 640, videoHeight: 480 };
const det = (x, y, w, h, name, score) => ({
  boundingBox: { originX: x, originY: y, width: w, height: h },
  categories: [{ categoryName: name, score }],
});

test('regression: palm covering the camera must NOT be reported as "person at 1.5m"', () => {
  // هذا هو البلاغ الحقيقي: الكف ملأ الصورة فقال الرادار «شخص على متر ونص»
  const ray = engineWith(() => palmFrame(), [det(0, 0, 640, 480, 'person', 0.55)]);
  const spoken = [];
  const gate = new RadarSpeechGate({ speakFn: (t) => spoken.push(t), cancelFn() {}, isSpeakingFn: () => false });

  let res;
  for (let i = 0; i < 5; i++) { res = ray.process(video); gate.update(res, i * 200); }

  assert.equal(res.occluded, true, 'frame must be flagged as occluded');
  assert.ok(res.dist < 0.6, `distance must be "very close", got ${res.dist}`);
  assert.doesNotMatch(res.label, /شخص/);
  assert.equal(spoken.length, 1);
  assert.match(spoken[0], /قريب جداً/);
  assert.doesNotMatch(spoken[0], /متر|شخص|توقف/, `must not speak a fake number/label: "${spoken[0]}"`);
});

test('gate: after the palm is removed, a real obstacle is announced (after the 8s gap) with its distance', () => {
  const spoken = [];
  const gate = new RadarSpeechGate({ speakFn: (t) => spoken.push(t), cancelFn() {}, isSpeakingFn: () => false });
  gate.update({ occluded: true, dist: 0.3, dir: 'center', dirAr: 'أمامك', label: 'x' }, 0);
  gate.update({ occluded: true, dist: 0.3, dir: 'center', dirAr: 'أمامك', label: 'x' }, 3000);
  assert.equal(spoken.length, 1, 'occlusion spoken once only');
  assert.equal(gate.update({ occluded: false, dist: 1.4, dir: 'center', dirAr: 'أمامك', label: 'كرسي' }, 4000).reason, 'cooldown');
  const r = gate.update({ occluded: false, dist: 1.4, dir: 'center', dirAr: 'أمامك', label: 'كرسي' }, 9000);
  assert.equal(r.spoke, true);
  assert.match(spoken[1], /كرسي أمامك، متر ونصف/);
});

test('palm covering the camera with NO detector result is still "very close", not a fake wall', () => {
  const ray = engineWith(() => palmFrame(7), []);
  const res = ray.process(video);
  assert.equal(res.occluded, true);
  assert.ok(res.dist < 0.6);
  assert.equal(res.isWall, false);
});

test('a detection box covering most of the frame means very close (no ground-plane guess)', () => {
  const ray = engineWith(() => sceneFrame(), [det(40, 10, 580, 470, 'person', 0.8)]);
  const res = ray.process(video);
  assert.equal(res.occluded, true);
  assert.ok(res.dist < 0.6, `got ${res.dist}`);
});

test('low-confidence detections are not named (say "عائق", not "شخص")', () => {
  const ray = engineWith(() => sceneFrame(), [det(260, 180, 120, 200, 'person', 0.4)]);
  ray.process(video);
  assert.equal(ray.lastDetections[0].label, 'عائق');
  assert.equal(ray.lastDetections[0].uncertain, true);
});

test('no regression: a normal confident mid-frame obstacle keeps its name and a real distance', () => {
  const ray = engineWith(() => sceneFrame(), [det(260, 180, 120, 200, 'chair', 0.8)]);
  const res = ray.process(video);
  assert.equal(res.occluded, false);
  assert.equal(ray.lastDetections[0].label, 'كرسي');
  assert.ok(ray.lastDetections[0].dist > 0.9, `got ${ray.lastDetections[0].dist}`);
});

test('no false alarm: a textured wood/beige floor (skin-like color) is NOT treated as occlusion', () => {
  const data = new Uint8ClampedArray(CW * CH * 4);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const i = (y * CW + x) * 4;
    const grain = ((x * 13 + y * 5) % 17) * 2.2 + (y % 9 < 1 ? -30 : 0); // عروق خشب وفواصل بلاط
    data[i] = 170 + grain; data[i + 1] = 120 + grain * 0.8; data[i + 2] = 80 + grain * 0.6; data[i + 3] = 255;
  }
  const ray = engineWith(() => ({ width: CW, height: CH, data }), []);
  assert.equal(ray.process(video).occluded, false);
});
