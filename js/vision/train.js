// الخطوة 4 (Ain-06): مسار «سجّل إشارتك» — التقاط عيّنات (يد/يدين/حركة) + معاينة حية + حفظ في IndexedDB (signbridge).
// بلا أي EMA إضافي؛ يستخدم نفس ملامح classify.js مباشرة.

import { extractFeatures } from './classify.js';

const r4 = (v) => Math.round(v * 10000) / 10000;

export function makeSignId(prefix = 'u') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** يحوّل مسار المعصم إلى متتالية ثابتة الطول (24 نقطة × [dx, dy] مطبّعة بطول الكف) لـ DTW. */
export function pathToMotionSeq(points, len = 24) {
  if (!points || points.length < 3) return null;
  const p0 = points[0];
  const sz = points.reduce((s, p) => s + p.size, 0) / points.length || 0.18;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const span = Math.max(1e-4, t1 - t0);
  const out = new Array(len * 2);
  let j = 0;
  for (let i = 0; i < len; i++) {
    const tt = t0 + (span * i) / (len - 1);
    while (j < points.length - 2 && points[j + 1].t < tt) j++;
    const a = points[j];
    const b = points[Math.min(points.length - 1, j + 1)];
    const u = Math.min(1, Math.max(0, (tt - a.t) / Math.max(1e-5, b.t - a.t)));
    const x = a.x + (b.x - a.x) * u;
    const y = a.y + (b.y - a.y) * u;
    out[i * 2] = r4((x - p0.x) / sz);
    out[i * 2 + 1] = r4((y - p0.y) / sz);
  }
  return out;
}

export class SignTrainer {
  constructor() {
    this.reset();
  }

  reset() {
    this.active = false;
    this.mode = 'one'; // 'one' | 'two' | 'motion'
    this.target = 30;
    this.durationMs = 3500;
    this.startedAt = 0;
    this.lastSampleAt = -Infinity;
    this.samples = [];
    this.samples2 = [];
    this.motionPts = [];
    this.takes = [];
  }

  start(mode = 'one', opt = {}) {
    this.reset();
    this.mode = mode;
    this.target = opt.target ?? (mode === 'two' ? 25 : 30);
    this.durationMs = opt.durationMs ?? (mode === 'motion' ? 1400 : 3500);
    this.startedAt = performance.now();
    this.active = true;
  }

  /** يُغذّى بكل إطار من VisionCapture أثناء الالتقاط؛ يعيد { done, progress, count, target, hint }. */
  pushFrame(frame) {
    if (!this.active) return { done: false, progress: 0, count: 0, target: this.target, hint: '' };
    const now = performance.now();
    const elapsed = now - this.startedAt;
    const hands = frame.hands || [];
    const ar = frame.aspect || (4 / 3);

    if (this.mode === 'motion') {
      if (hands.length >= 1) {
        const lm = hands[0].lm;
        const size = Math.hypot(lm[9].x - lm[0].x, (lm[9].y - lm[0].y) / ar) || 0.18;
        this.motionPts.push({ t: frame.t, x: lm[0].x, y: lm[0].y / ar, size });
      }
      const progress = Math.min(1, elapsed / this.durationMs);
      if (elapsed >= this.durationMs) {
        this.active = false;
        const seq = pathToMotionSeq(this.motionPts);
        if (seq) this.takes.push(seq);
        return { done: true, progress: 1, count: this.takes.length, target: 1, hint: seq ? 'تم التقاط الحركة ✓' : 'لم تظهر اليد بشكل كافٍ' };
      }
      return { done: false, progress, count: this.motionPts.length, target: 24, hint: hands.length ? 'نفّذ الحركة الآن…' : 'أظهر يدك للكاميرا' };
    }

    const needHands = this.mode === 'two' ? 2 : 1;
    let hint = '';
    if (hands.length < needHands) {
      hint = needHands === 2 ? 'أظهر اليدين معاً داخل الإطار' : 'أظهر يدك داخل الإطار';
    } else if (now - this.lastSampleAt >= 70) {
      this.lastSampleAt = now;
      if (this.mode === 'two') {
        const f1 = extractFeatures(hands[0].lm, ar);
        const f2 = extractFeatures(hands[1].lm, ar);
        if (f1 && f2) {
          const s1 = Math.hypot(hands[0].lm[9].x - hands[0].lm[0].x, (hands[0].lm[9].y - hands[0].lm[0].y) / ar) || 0.18;
          const s2 = Math.hypot(hands[1].lm[9].x - hands[1].lm[0].x, (hands[1].lm[9].y - hands[1].lm[0].y) / ar) || 0.18;
          this.samples2.push([
            ...Array.from(f1, r4),
            ...Array.from(f2, r4),
            r4(hands[0].lm[0].x), r4(hands[0].lm[0].y / ar),
            r4(hands[1].lm[0].x), r4(hands[1].lm[0].y / ar),
            r4(s1), r4(s2),
          ]);
        }
      } else {
        const f1 = extractFeatures(hands[0].lm, ar);
        if (f1) {
          this.samples.push([...Array.from(f1, r4), r4(hands[0].lm[0].x), r4(hands[0].lm[0].y)]);
        }
      }
      hint = 'ممتاز… حافظ على الإشارة مع ميل بسيط';
    }

    const count = this.mode === 'two' ? this.samples2.length : this.samples.length;
    const progress = Math.min(1, Math.max(count / this.target, elapsed / this.durationMs));
    const done = count >= this.target || elapsed >= this.durationMs;
    if (done) this.active = false;
    return { done, progress, count, target: this.target, hint };
  }

  /** يبني سجل الإشارة الصالح للحفظ في IndexedDB (signbridge) والتحميل في StaticClassifier. */
  buildSign(word) {
    const cleanWord = String(word || '').trim();
    if (!cleanWord) return null;
    if (this.mode === 'motion') {
      if (!this.takes.length) return null;
      return { id: makeSignId('m'), word: cleanWord, kind: 'motion', hands: 1, takes: this.takes.slice(), source: 'user', created: Date.now() };
    }
    if (this.mode === 'two') {
      if (this.samples2.length < 8) return null;
      return { id: makeSignId('t'), word: cleanWord, kind: 'static', hands: 2, samples2: this.samples2.slice(), samples: [], source: 'user', created: Date.now() };
    }
    if (this.samples.length < 8) return null;
    return { id: makeSignId('u'), word: cleanWord, kind: 'static', hands: 1, samples: this.samples.slice(), source: 'user', created: Date.now() };
  }
}
