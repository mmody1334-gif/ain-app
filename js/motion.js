// تتبّع اليد عبر الزمن: تنعيم، سرعة، تقسيم الحركات، مطابقة DTW للإشارات المتحركة،
// وإشارات جاهزة بلا تسجيل: تمرير اليد (4 اتجاهات)، تلويح، وأشكال أساسية (قبضة، كف مفتوحة…).

import { landmarksToPose, poseToFeatures, fingerExtension, fingerCurls, thumbGap, orientation, POSE_LEN } from './features.js';

// ---------- المتتبّع: يحوّل كل إطار إلى وضعية منعّمة وسرعة ----------
export class HandTracker {
  constructor(opt = {}) {
    this.alpha = opt.alpha ?? 0.6;
    this.prev = null;
    this.lastSeen = -1;
    this.speed = 0;
    this.hist = [];          // آخر ~0.25 ث من مواضع المعصم لقياس سرعة مستقرة
    this.extS = null;        // استقامة الأصابع بعد التنعيم الزمني
    this.tdistS = 0;
  }

  reset() { this.prev = null; this.speed = 0; this.hist = []; this.extS = null; this.tdistS = 0; }

  /**
   * سرعة عبر نافذة زمنية (~0.16 ث) لا بين إطارين: اهتزاز نقاط MediaPipe بين
   * إطارين قد يبدو حركة سريعة، لكنه يتلاشى عند قياس الإزاحة على نافذة أطول.
   */
  _windowSpeed(t, wi, size) {
    let ref = null;
    for (let i = this.hist.length - 1; i >= 0; i--) {
      if (t - this.hist[i].t <= 0.16) ref = this.hist[i]; else break;
    }
    if (!ref) return this.speed;
    const dt = t - ref.t;
    if (dt < 0.04) return this.speed;
    const v = Math.hypot(wi[0] - ref.wi[0], wi[1] - ref.wi[1]) / Math.max(1e-6, size) / dt;
    return 0.55 * this.speed + 0.45 * v;
  }

  /** @returns frame|null */
  update(t, lm, aspect) {
    const base = landmarksToPose(lm, aspect);
    if (!base) { if (this.prev && t - this.lastSeen > 0.4) this.reset(); return null; }
    const ar = aspect > 0 ? aspect : 4 / 3;
    const wi = [lm[0].x, lm[0].y / ar];               // موضع المعصم بوحدات متساوية
    let p = base.p, wiS = wi, size = base.size;
    if (this.prev) {
      const a = this.alpha;
      p = new Float32Array(POSE_LEN);
      for (let i = 0; i < POSE_LEN; i++) p[i] = a * base.p[i] + (1 - a) * this.prev.p[i];
      wiS = [0.7 * wi[0] + 0.3 * this.prev.wi[0], 0.7 * wi[1] + 0.3 * this.prev.wi[1]];
      size = 0.5 * base.size + 0.5 * this.prev.size;
    }
    this.speed = this._windowSpeed(t, wiS, size);
    this.hist.push({ t, wi: wiS, size });
    while (this.hist.length > 12) this.hist.shift();

    const extRaw = fingerExtension(p);
    this.tdistS = this.tdistS ? 0.65 * this.tdistS + 0.35 * thumbGap(p) : thumbGap(p);
    this.extS = this.extS ? this.extS.map((v, i) => 0.65 * v + 0.35 * extRaw[i]) : Float32Array.from(extRaw);
    const frame = {
      t, p, wi: wiS, w: [lm[0].x, lm[0].y], size,
      ext: this.extS, tdist: this.tdistS, speed: this.speed,
    };
    this.prev = frame;
    this.lastSeen = t;
    return frame;
  }
}

// ---------- تقسيم الحركات ----------
export class MotionSegmenter {
  constructor(opt = {}) {
    this.vOn = opt.vOn ?? 3.0;        // سرعة بدء الحركة (طول كف في الثانية)
    this.vOff = opt.vOff ?? 1.2;      // سرعة اعتبار الحركة انتهت
    this.minDur = opt.minDur ?? 0.25;
    this.maxDur = opt.maxDur ?? 2.5;
    this.still = opt.still ?? 0.3;    // مدة الهدوء لإنهاء الحركة
    this.pre = opt.pre ?? 0.15;
    this.reset();
  }

  reset() { this.buf = []; this.active = false; this.frames = []; this.stillSince = null; this.fastCount = 0; }

  get isActive() { return this.active; }

  /** يستدعى لكل إطار؛ يعيد مقطعاً عند انتهاء الحركة. frame=null عند فقدان اليد. */
  push(frame, t) {
    if (!frame) {
      if (this.active) return this._finish(t);
      this.buf = [];
      return null;
    }
    const slim = { t: frame.t, p: frame.p, wi: frame.wi, size: frame.size, ext: frame.ext, speed: frame.speed };
    if (!this.active) {
      this.buf.push(slim);
      while (this.buf.length && frame.t - this.buf[0].t > this.pre) this.buf.shift();
      if (frame.speed > this.vOn) this.fastCount++; else this.fastCount = 0;
      if (this.fastCount >= 2) { this.active = true; this.frames = this.buf.slice(); this.stillSince = null; }
      return null;
    }
    this.frames.push(slim);
    if (frame.speed < this.vOff) { if (this.stillSince == null) this.stillSince = frame.t; }
    else this.stillSince = null;
    const dur = frame.t - this.frames[0].t;
    if ((this.stillSince != null && frame.t - this.stillSince >= this.still) || dur > this.maxDur) return this._finish(frame.t);
    return null;
  }

  _finish(t) {
    let frames = this.frames;
    if (this.stillSince != null) frames = frames.filter((f) => f.t <= this.stillSince + 0.06);
    this.active = false; this.fastCount = 0; this.stillSince = null; this.frames = []; this.buf = [];
    if (frames.length < 5) return null;
    const dur = frames[frames.length - 1].t - frames[0].t;
    if (dur < this.minDur) return null;
    return { frames, dur };
  }
}

// ---------- مطابقة DTW ----------
const T_LEN = 24;
const PTS = [4, 8, 12, 16, 20, 5, 9, 17];
export const SEQ_F = PTS.length * 3 + 2 + 3;

function frameVec(f, start, out, o) {
  let k = o;
  for (const i of PTS) { out[k++] = f.p[i * 3]; out[k++] = f.p[i * 3 + 1]; out[k++] = f.p[i * 3 + 2]; }
  out[k++] = (f.wi[0] - start.wi[0]) / start.size;
  out[k++] = (f.wi[1] - start.wi[1]) / start.size;
  const n = orientation(f.p);
  out[k++] = n[6]; out[k++] = n[7]; out[k++] = n[8];
}

/** يحوّل مقطعاً إلى متتالية ثابتة الطول T×F. */
export function segmentToSeq(frames) {
  const n = frames.length, out = new Float32Array(T_LEN * SEQ_F);
  const start = frames[0], t0 = frames[0].t, t1 = frames[n - 1].t;
  const tmp = new Float32Array(SEQ_F), tmp2 = new Float32Array(SEQ_F);
  let j = 0;
  for (let i = 0; i < T_LEN; i++) {
    const tt = t0 + ((t1 - t0) * i) / (T_LEN - 1);
    while (j < n - 2 && frames[j + 1].t < tt) j++;
    const a = frames[j], b = frames[Math.min(n - 1, j + 1)];
    const span = b.t - a.t || 1, u = Math.min(1, Math.max(0, (tt - a.t) / span));
    frameVec(a, start, tmp, 0); frameVec(b, start, tmp2, 0);
    for (let d = 0; d < SEQ_F; d++) out[i * SEQ_F + d] = tmp[d] + (tmp2[d] - tmp[d]) * u;
  }
  return out;
}

export function dtw(a, b, band = 7) {
  const T = T_LEN, F = SEQ_F;
  const INF = 1e9;
  let prev = new Float32Array(T).fill(INF), cur = new Float32Array(T).fill(INF);
  for (let i = 0; i < T; i++) {
    cur.fill(INF);
    for (let j = Math.max(0, i - band); j <= Math.min(T - 1, i + band); j++) {
      // الكلفة = انحراف شكل اليد + 3.5 × انحراف مسار المعصم، فلا يضيع المسار وسط أرقام الشكل الثابتة
      let sp = 0, st = 0;
      const ia = i * F, jb = j * F;
      for (let d = 0; d < 24; d++) { const v = a[ia + d] - b[jb + d]; sp += v * v; }
      for (let d = 26; d < F; d++) { const v = a[ia + d] - b[jb + d]; sp += v * v; }
      for (let d = 24; d < 26; d++) { const v = a[ia + d] - b[jb + d]; st += v * v; }
      const c = Math.sqrt(sp / 27) + 3.5 * Math.sqrt(st / 2);
      let best;
      if (i === 0 && j === 0) best = 0;
      else best = Math.min(i > 0 ? prev[j] : INF, j > 0 ? cur[j - 1] : INF, i > 0 && j > 0 ? prev[j - 1] : INF);
      cur[j] = best + c;
    }
    [prev, cur] = [cur, prev];
  }
  return prev[T - 1] / (2 * T);
}

export class MotionBank {
  constructor() { this.signs = new Map(); }

  setSign(id, seqs) {
    const seqArr = seqs.map((s) => (s instanceof Float32Array ? s : Float32Array.from(s)));
    let thr = 0.5;
    if (seqArr.length >= 3) {
      const ds = [];
      for (let i = 0; i < seqArr.length; i++) for (let j = i + 1; j < seqArr.length; j++) ds.push(dtw(seqArr[i], seqArr[j]));
      const m = ds.reduce((a, b) => a + b, 0) / ds.length;
      const sd = Math.sqrt(ds.reduce((a, b) => a + (b - m) ** 2, 0) / ds.length);
      thr = Math.min(1.2, Math.max(0.2, m + 2.2 * sd, m * 1.6));
    }
    this.signs.set(id, { seqs: seqArr, thr });
  }

  removeSign(id) { this.signs.delete(id); }

  classify(seq) {
    const scores = [];
    for (const [id, s] of this.signs) {
      let best = Infinity;
      for (const q of s.seqs) best = Math.min(best, dtw(seq, q));
      scores.push({ id, d: best, thr: s.thr });
    }
    scores.sort((a, b) => a.d - b.d);
    if (!scores.length) return { label: null, accepted: false, scores };
    const a = scores[0], b = scores[1];
    const ratio = b ? b.d / Math.max(1e-6, a.d) : Infinity;
    const accepted = a.d <= a.thr && ratio >= 1.15;
    return { label: a.id, dist: a.d, thr: a.thr, ratio, accepted, scores };
  }

  toJSON() { const o = {}; for (const [id, s] of this.signs) o[id] = { thr: s.thr, seqs: s.seqs.map((q) => Array.from(q, (v) => +v.toFixed(3))) }; return o; }
  static fromJSON(j) {
    const b = new MotionBank();
    for (const id of Object.keys(j || {})) b.signs.set(id, { thr: j[id].thr, seqs: j[id].seqs.map((q) => Float32Array.from(q)) });
    return b;
  }
}

// ---------- إشارات جاهزة بلا تسجيل ----------
export const BUILTIN_MOTIONS = [
  { id: 'swipe_left',  name: 'تمرير اليد لليسار',  hint: 'حرّك كفاً مفتوحة بسرعة نحو يسارك' },
  { id: 'swipe_right', name: 'تمرير اليد لليمين',  hint: 'حرّك كفاً مفتوحة بسرعة نحو يمينك' },
  { id: 'swipe_up',    name: 'تمرير اليد للأعلى',  hint: 'ارفع كفاً مفتوحة بسرعة' },
  { id: 'swipe_down',  name: 'تمرير اليد للأسفل',  hint: 'اخفض كفاً مفتوحة بسرعة' },
  { id: 'wave',        name: 'تلويح',               hint: 'لوّح بكفك يميناً ويساراً ثلاث مرات' },
  { id: 'no',          name: 'هزّ السبابة (لا)',    hint: 'ارفع سبابتك فقط وحرّكها يميناً ويساراً مرتين' },
  { id: 'yes',         name: 'تحريك القبضة (نعم)',  hint: 'اقبض يدك وحرّكها للأعلى والأسفل مرتين' },
  { id: 'circle',      name: 'رسم دائرة',           hint: 'ارسم دائرة كاملة بكفّ مفتوح' },
];

function openFingers(frames) {
  let c = 0;
  for (const f of frames) { let k = 0; for (let i = 1; i < 5; i++) if (f.ext[i] > 0.8) k++; c += k; }
  return c / frames.length;
}

function reversals(vals, amp) {
  let rev = 0, dir = 0, ext = vals[0];
  for (let i = 1; i < vals.length; i++) {
    const d = Math.sign(vals[i] - vals[i - 1]);
    if (!d) continue;
    if (dir && d !== dir) { if (Math.abs(vals[i - 1] - ext) > amp) rev++; ext = vals[i - 1]; }
    dir = d;
  }
  return rev;
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; }
  return Math.abs(a) / 2;
}

/** يتعرّف على تمرير/تلويح/إشارات حركة جاهزة من مقطع حركة. الاتجاهات بمنظور صاحب اليد. */
export function detectBuiltinMotion(seg) {
  const fr = seg.frames, n = fr.length;
  if (n < 6) return null;
  const sz = fr.reduce((s, f) => s + f.size, 0) / n;
  const pts = fr.map((f) => [f.wi[0] / sz, f.wi[1] / sz]);
  const dx = pts[n - 1][0] - pts[0][0], dy = pts[n - 1][1] - pts[0][1];
  let L = 0;
  for (let i = 1; i < n; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const net = Math.hypot(dx, dy);
  const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]));
  const w = maxX - minX, h = maxY - minY;

  const m = [0, 1, 2, 3, 4].map((k) => fr.reduce((s, f) => s + f.ext[k], 0) / n);
  const open = openFingers(fr);
  const indexOnly = m[1] > 0.74 && m[2] < 0.62 && m[3] < 0.62 && m[4] < 0.62;
  const fist = m[1] < 0.62 && m[2] < 0.62 && m[3] < 0.62 && m[4] < 0.62;

  // 1) هزّ السبابة: لا
  if (indexOnly && seg.dur >= 0.45 && seg.dur <= 2.2 && reversals(pts.map((p) => p[0]), 0.3) >= 2 && net < 0.9 * L) {
    return { id: 'no', strength: net };
  }
  // 2) تحريك القبضة: نعم
  if (fist && seg.dur >= 0.45 && seg.dur <= 2.2 && reversals(pts.map((p) => p[1]), 0.25) >= 2 && net < 0.9 * L) {
    return { id: 'yes', strength: net };
  }
  if (open < 2.8) return null;

  // 3) تلويح: انعكاسات متعددة في المحور الأفقي
  if (reversals(pts.map((p) => p[0]), 0.8) >= 3 && net < 0.5 * L && seg.dur >= 0.8) {
    return { id: 'wave', strength: net };
  }
  // 4) دائرة: مسار منحنٍ يغطي محورين ويعود قريباً من بدايته
  if (w > 0.6 && h > 0.6 && net < 0.45 * L && seg.dur >= 0.6 && polygonArea(pts) / Math.max(1e-6, L * L) > 0.035) {
    return { id: 'circle', strength: polygonArea(pts) / (L * L) };
  }
  const straight = net / Math.max(1e-6, L);
  if (straight < 0.65 || seg.dur > 1.3) return null;
  // الحركة الأفقية أطول عادةً من العمودية في الصورة، فحدّها أكبر
  if (Math.abs(dx) >= 1.8 * Math.abs(dy) && Math.abs(dx) >= 2.0) return { id: dx < 0 ? 'swipe_right' : 'swipe_left', strength: net };
  if (Math.abs(dy) >= 1.8 * Math.abs(dx) && Math.abs(dy) >= 1.5) return { id: dy < 0 ? 'swipe_up' : 'swipe_down', strength: net };
  return null;
}

// ---------- أشكال اليد الأساسية (قواعد، بلا تدريب) ----------
export const BUILTIN_SHAPES = [
  { id: 'shape_open',    name: 'كف مفتوحة',      pattern: 'EEEEE' },
  { id: 'shape_fist',    name: 'قبضة',           pattern: 'CCCCC' },
  { id: 'shape_point',   name: 'سبّابة مرفوعة',  pattern: '?ECCC' },
  { id: 'shape_victory', name: 'حرف V',          pattern: 'CEECC' },
  { id: 'shape_thumb',   name: 'إبهام مرفوع',    pattern: 'ECCCC' },
  { id: 'shape_three',   name: 'ثلاثة أصابع',    pattern: 'CEEEC' },
  { id: 'shape_four',    name: 'أربعة أصابع',    pattern: 'CEEEE' },
  { id: 'shape_call',    name: 'اتصل بي',        pattern: 'ECCCE' },
  { id: 'shape_love',    name: 'أحبّك',          pattern: 'EECCE' },
  { id: 'shape_pinky',   name: 'خنصر فقط',       pattern: 'CCCCE' },
];

/**
 * حالة كل إصبع: E مفرود، C مطوي، H بين بين.
 * تُقاس الاستقامة على مقياس المستخدم نفسه بعد «معايرة اليد»: ماذا يعني
 * «مفرود» و«مطوي» عند يده هو، لا عند يد أخرى.
 */
const DEFAULT_CAL = {
  open: [0.95, 0.99, 0.99, 0.99, 0.99],
  fist: [0.85, 0.45, 0.45, 0.45, 0.43],
  thumbOpen: 0.88,
  thumbFist: 0.50,
};
const cloneCal = (c) => ({ open: c.open.slice(), fist: c.fist.slice(), thumbOpen: c.thumbOpen, thumbFist: c.thumbFist });
let CAL = cloneCal(DEFAULT_CAL);

/** يثبّت معايرة يد المستخدم (أو يعيد الافتراضي عند تمرير null). */
export function setFingerCalibration(cal) {
  const out = cloneCal(DEFAULT_CAL);
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  if (cal) {
    for (let i = 0; i < 5; i++) {
      const o = cal.open?.[i], f = cal.fist?.[i];
      if (num(o) && num(f) && o - f > 0.08) { out.open[i] = o; out.fist[i] = f; }
    }
    if (num(cal.thumbOpen) && num(cal.thumbFist) && cal.thumbOpen - cal.thumbFist > 0.06) {
      out.thumbOpen = cal.thumbOpen; out.thumbFist = cal.thumbFist;
    }
  }
  CAL = out;
}
export function getFingerCalibration() { return cloneCal(CAL); }

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function normExt(v, i) {
  const span = CAL.open[i] - CAL.fist[i];
  return span > 0.06 ? clamp01((v - CAL.fist[i]) / span) : clamp01((v - 0.45) / 0.5);
}
function normThumb(v) {
  const span = CAL.thumbOpen - CAL.thumbFist;
  return span > 0.06 ? clamp01((v - CAL.thumbFist) / span) : clamp01((v - 0.55) / 0.33);
}

export function fingerStates(p, extIn, tdistIn) {
  const ext = extIn || fingerExtension(p);
  const tdist = tdistIn == null ? thumbGap(p) : tdistIn;
  const tc = fingerCurls(p)[0];
  const nt = normThumb(tdist);
  const th = (nt >= 0.55 && tc <= 0.58) || tdist >= 0.86 ? 'E'
    : (nt <= 0.32 || tc >= 0.62) ? 'C' : 'H';
  const st = [th];
  for (let i = 1; i < 5; i++) {
    const e = normExt(ext[i], i);
    st.push(e >= 0.58 ? 'E' : e <= 0.32 ? 'C' : 'H');
  }
  return st;
}

const smooth01 = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** تقييم متصل (0..1) لمدى مطابقة شكل اليد لنمط مثل EECCE، بمقياس المستخدم. */
function matchShapeScore(pattern, extNorm, thumbNorm) {
  let sum = 0, n = 0;
  for (let i = 0; i < 5; i++) {
    const w = pattern[i];
    if (w === '?') continue;
    if (i === 0) {
      const e = smooth01(0.30, 0.72, thumbNorm);
      sum += w === 'E' ? e : 1 - e;
    } else {
      const e = smooth01(0.35, 0.78, extNorm[i]);
      sum += w === 'E' ? e : 1 - smooth01(0.20, 0.55, extNorm[i]);
    }
    n++;
  }
  return n ? sum / n : 0;
}

export function detectBuiltinShape(p, extIn, tdistIn) {
  const ext = extIn || fingerExtension(p);
  const tdist = tdistIn == null ? thumbGap(p) : tdistIn;
  const ne = [0, 1, 2, 3, 4].map((i) => (i === 0 ? normThumb(tdist) : normExt(ext[i], i)));
  // دائرة O: طرف الإبهام يلامس طرف السبابة والباقي مفرود (السبابة تكون منحنية فلا نشترط استقامتها)
  const pinch = Math.hypot(p[12] - p[24], p[13] - p[25], p[14] - p[26]);
  if (pinch < 0.34 && ne[2] > 0.55 && ne[3] > 0.55 && ne[4] > 0.55) return { id: 'shape_ok', name: 'دائرة O', conf: 0.95 };

  // الإبهام المرفوع قد تُقرأ السبابة فيه «مفرودة» خطأً بسبب انثناء المشط؛
  // نقارن بُعد طرف الإبهام عن المعصم ببُعد طرف السبابة: في الإبهام المرفوع
  // الإبهام هو البعيد، وفي السبابة المرفوعة العكس.
  const st = fingerStates(p, ext, tdist);
  const thumbD = Math.hypot(p[12], p[13], p[14]);
  const indexD = Math.hypot(p[24], p[25], p[26]);
  if (st[0] === 'E' && thumbD > indexD * 1.15 && st[2] !== 'E' && st[3] !== 'E' && st[4] !== 'E') {
    return { id: 'shape_thumb', name: 'إبهام مرفوع', conf: 0.92 };
  }

  let best = null;
  const scores = [];
  for (const s of BUILTIN_SHAPES) {
    const score = matchShapeScore(s.pattern, ne, ne[0]);
    scores.push({ s, score });
    if (!best || score > best.score) best = { id: s.id, name: s.name, score };
  }
  if (!best || best.score < 0.86) return null;
  // الأنماط التي تتجاهل الإبهام ('?') تتساوى مع غيرها؛ نُرجّح الأكثر تحديداً (ترتيب المكتبة)
  // بدل رفض الحالة كلها عند تعادل بسيط.
  const pick = scores.find((x) => x.score >= best.score - 0.02) || { s: best, score: best.score };
  return { id: pick.s.id, name: pick.s.name, conf: pick.score };
}

export { poseToFeatures };
