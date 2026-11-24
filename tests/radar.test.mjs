import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const imp = (rel) => import(pathToFileURL(path.resolve(rel)).href);
const { RayEngine, quantizeDistanceBand } = await imp('js/depth.js');
const { RadarSpeechGate, MIN_WARNING_INTERVAL_MS } = await imp('js/vision/radar.js');
const { toFusha } = await imp('js/speech.js');

test('RadarSpeechGate: speaks warning ONCE, never repeats when distance and direction stay constant (even after 60s)', () => {
  const spoken = [];
  const gate = new RadarSpeechGate({
    clockFn: null,
    speakFn: (text) => spoken.push(text),
    cancelFn: () => {},
    isSpeakingFn: () => false,
  });

  assert.equal(MIN_WARNING_INTERVAL_MS, 8000);

  // بدء على مسار سالك لا يثرثر تلقائياً قبل ظهور أي عائق
  assert.equal(gate.update({ dist: 4.3, dir: 'center', dirAr: 'أمامك', label: 'مسار سالك' }, 0).spoke, false);
  assert.equal(spoken.length, 0);

  // ظهور عائق على بعد 1.4م أمامك: ينطق فوراً مرة واحدة
  const first = gate.update({ dist: 1.4, dir: 'center', dirAr: 'أمامك', label: 'كرسي' }, 1000);
  assert.equal(first.spoke, true);
  assert.equal(spoken.length, 1);
  assert.match(spoken[0], /كرسي أمامك/);

  // ثبات العائق مع تذبذب طفيف (±0.2م داخل هيستيريسيس فئة near) وتبدّل التسمية على مدار 65 ثانية: لا يعيد النطق أبداً
  for (let t = 1500; t <= 66000; t += 500) {
    const jitterDist = 1.4 + Math.sin(t / 1000) * 0.22; // 1.18م .. 1.62م
    const flickerLabel = t % 1000 === 0 ? 'جدار أو حاجز' : 'كرسي';
    const r = gate.update({ dist: jitterDist, dir: 'center', dirAr: 'أمامك', label: flickerLabel }, t);
    assert.equal(r.spoke, false, `Must NOT repeat unchanged warning at t=${t}ms`);
  }
  assert.equal(spoken.length, 1);
});

test('RadarSpeechGate: enforces >= 8s minimum interval even when distance or direction changes, then speaks on real change', () => {
  const events = [];
  const gate = new RadarSpeechGate({
    speakFn: (text) => events.push({ text }),
    cancelFn: () => {},
    isSpeakingFn: () => false,
  });

  // t=0: أول تحذير (متر ونصف أمامك)
  assert.equal(gate.update({ dist: 1.4, dir: 'center', dirAr: 'أمامك', label: 'عائق' }, 0).spoke, true);
  assert.equal(events.length, 1);

  // t=2000..7900ms: تغيّر حقيقي في المسافة (خطر 0.6م) والاتجاه (يسار) لكن قبل مرور 8 ثوانٍ -> محجوب بفاصل 8 ثوانٍ
  for (const t of [1500, 3000, 5500, 7999]) {
    const r = gate.update({ dist: 0.6, dir: 'left', dirAr: 'على يسارك', label: 'عائق' }, t);
    assert.equal(r.spoke, false, `Must block before 8000ms at t=${t}`);
    assert.equal(r.reason, 'cooldown');
  }
  assert.equal(events.length, 1);

  // t=8000ms: اكتمل فاصل 8 ثوانٍ والمسافة تغيّرت فعلاً -> ينطق مرة واحدة
  const second = gate.update({ dist: 0.6, dir: 'left', dirAr: 'على يسارك', label: 'عائق' }, 8000);
  assert.equal(second.spoke, true);
  assert.equal(events.length, 2);

  // t=16500ms: نفس المسافة (0.65م) لكن تغيّر الاتجاه فعلاً من يسار إلى يمين بعد >8 ثوانٍ -> ينطق مرة واحدة
  const third = gate.update({ dist: 0.65, dir: 'right', dirAr: 'على يمينك', label: 'عائق' }, 16500);
  assert.equal(third.spoke, true);
  assert.equal(events.length, 3);
  assert.match(events[2].text, /على يمينك/);
});

test('RadarSpeechGate: mute immediately cancels speech and blocks both auto and manual speech until unmuted', () => {
  let cancelCalls = 0;
  const spoken = [];
  const gate = new RadarSpeechGate({
    speakFn: (text) => spoken.push(text),
    cancelFn: () => { cancelCalls++; },
    isSpeakingFn: () => false,
  });

  gate.setMuted(true);
  assert.equal(cancelCalls, 1);
  assert.equal(gate.update({ dist: 0.7, dir: 'center', dirAr: 'أمامك', label: 'شخص' }, 1000).spoke, false);
  assert.equal(gate.speakNow({ dist: 0.7, dir: 'center', dirAr: 'أمامك', label: 'شخص' }, 2000).spoke, false);
  assert.equal(spoken.length, 0);

  gate.setMuted(false);
  assert.equal(gate.update({ dist: 0.7, dir: 'center', dirAr: 'أمامك', label: 'شخص' }, 3000).spoke, true);
  assert.equal(spoken.length, 1);
});

test('RayEngine + RadarSpeechGate: pocket/dark mode returns dark:true, clears fake obstacles, and suspends speech', () => {
  const ray = new RayEngine();
  const darkImg = { width: 120, height: 160, data: new Uint8ClampedArray(120 * 160 * 4) };
  const darkRes = ray._analyzeThreeZones(darkImg);
  assert.equal(darkRes.dark, true);
  assert.equal(darkRes.zones.center, 4.5);

  // فحص استقرار الفئات بهيستيريسيس ±0.3م
  let band = quantizeDistanceBand(1.75, null).id;
  for (const d of [1.85, 1.95, 2.05, 1.75]) {
    band = quantizeDistanceBand(d, band).id;
    assert.equal(band, 'near');
  }
  assert.equal(quantizeDistanceBand(2.2, band).id, 'mid');

  // تشكيل الفصحى لمفردات الرادار
  const vocalized = toFusha('عائق أمامك على بعد متر ونصف');
  assert.ok(vocalized.includes('عَائِق') && vocalized.includes('أَمَامَكَ'));

  // فحص التقاط قاعدة العائق السفلية دون أن تخدعها الحافة العلوية لنفس العائق
  const cw = 120, ch = 160;
  const data = new Uint8ClampedArray(cw * ch * 4).fill(215);
  for (let y = 38; y <= 148; y++) {
    for (let x = 10; x <= 40; x++) {
      const i = (y * cw + x) * 4;
      data[i] = 20; data[i + 1] = 22; data[i + 2] = 28; data[i + 3] = 255;
    }
  }
  const leftRes = ray._analyzeThreeZones({ width: cw, height: ch, data });
  assert.ok(leftRes.zones.left < 1.85, `Expected close left obstacle <1.85m, got ${leftRes.zones.left}`);
  assert.ok(leftRes.zones.center > 3.0, `Expected clear center >3.0m, got ${leftRes.zones.center}`);
  assert.ok(leftRes.zones.right > 3.0, `Expected clear right >3.0m, got ${leftRes.zones.right}`);
});
