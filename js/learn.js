// وضع التعلّم: مقارنة يد المتعلّم بوضعية النموذج، إصبعاً إصبعاً، وتوليد وصف عربي تلقائي للإشارة.

import { fingerExtension, mirrorPose } from './features.js';
import { fingerStates } from './motion.js';
import { FINGER_WORDS } from './arabic.js';

const NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const START = [1, 5, 9, 13, 17];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const pt = (p, i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];

/** إطار الكف: محور الأصابع، المحور الجانبي، وعمود الكف. */
export function palmFrame(p) {
  const y = norm(pt(p, 9));
  let lat = sub(pt(p, 17), pt(p, 5));
  const k = dot(lat, y);
  lat = norm([lat[0] - y[0] * k, lat[1] - y[1] * k, lat[2] - y[2] * k]);
  const n = norm(cross(lat, y));
  return { x: lat, y, z: n };
}

function toFrame(p) {
  const F = palmFrame(p), q = new Float32Array(63);
  for (let i = 0; i < 21; i++) {
    const v = pt(p, i);
    q[i * 3] = dot(v, F.x); q[i * 3 + 1] = dot(v, F.y); q[i * 3 + 2] = dot(v, F.z);
  }
  return q;
}

const angleDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) * 180 / Math.PI;

function fingerErr(q, t, f) {
  const a = START[f];
  let e = 0, w = 0;
  const lo = f === 0 ? 1 : 1;                  // نتجاهل قاعدة الإصبع الثابتة تقريباً
  for (let k = lo; k <= 3; k++) {
    const i = a + k, wt = k === 3 ? 1.4 : 1;
    e += wt * Math.hypot(q[i * 3] - t[i * 3], q[i * 3 + 1] - t[i * 3 + 1], q[i * 3 + 2] - t[i * 3 + 2]);
    w += wt;
  }
  return e / w;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * يقارن وضعية المتعلّم بوضعية النموذج.
 * @returns {{score:number, fingers:Object, errs:number[], orient:number, flipped:boolean, hints:string[], mirrored:boolean, ok:boolean}}
 */
export function compareToTarget(pose, target, opt = {}) {
  const okThr = opt.okThr ?? 0.30;
  const tries = opt.allowMirror === false ? [target] : [target, mirrorPose(target)];
  let best = null;
  tries.forEach((tg, idx) => {
    const q = toFrame(pose), t = toFrame(tg);
    const errs = NAMES.map((_, f) => fingerErr(q, t, f));
    const ext = fingerExtension(pose), extT = fingerExtension(tg);
    const sc = errs.map((e) => clamp01(1 - e / 0.62));
    const mean = sc.reduce((a, b) => a + b, 0) / 5;
    const mn = Math.min(...sc);
    const score = Math.round(100 * (0.55 * mean + 0.45 * mn));
    const Fa = palmFrame(pose), Ft = palmFrame(tg);
    const orient = angleDeg(Fa.y, Ft.y);
    const flipped = dot(Fa.z, Ft.z) < -0.3;
    if (!best || score > best.score) best = { score, errs, orient, flipped, ext, extT, mirrored: idx === 1 };
  });
  const { errs, ext, extT } = best;
  const fingers = {}, hints = [];
  NAMES.forEach((n, f) => {
    const good = errs[f] <= okThr;
    fingers[n] = good ? 'ok' : 'bad';
    if (!good) {
      const d = extT[f] - ext[f];
      if (d > 0.12) hints.push(`افرد ${FINGER_WORDS[n]}`);
      else if (d < -0.12) hints.push(`اثنِ ${FINGER_WORDS[n]}`);
      else hints.push(`عدّل وضع ${FINGER_WORDS[n]}`);
    }
  });
  let orientNote = null;
  // اتجاه اليد في الصورة لا يغيّر «شكل الأصابع»؛ المهم هو وجه الكف (flipped).
  // كان فحص الزاوية هنا يرفض وضعيات صحيحة تماماً لمجرد أن اليد مُدارة قليلاً.
  if (best.flipped) orientNote = 'اقلب كفّك لتواجه الاتجاه الآخر';
  if (orientNote) hints.unshift(orientNote);
  const ok = best.score >= (opt.passScore ?? 72) && !best.flipped;
  return { score: best.score, fingers, errs, orient: best.orient, flipped: best.flipped, hints, mirrored: best.mirrored, ok };
}

// ---------- وصف عربي تلقائي ----------
const STATE_WORD = { E: 'مفرود', C: 'مطوي', H: 'نصف مثني' };
const STATE_FEM = { E: 'مفرودة', C: 'مطوية', H: 'نصف مثنية' };
const FEM = { thumb: false, index: true, middle: true, ring: true, pinky: true };

function dirWord(v) {
  // منظور المتعلّم أمام المرآة: اليمين على الشاشة = يمين المستخدم (x الخام معكوس)
  const x = -v[0], y = -v[1], z = -v[2];
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (az > ax && az > ay && az > 0.55) return z > 0 ? 'نحو الكاميرا' : 'بعيداً عن الكاميرا';
  if (ay >= ax) return y > 0 ? 'للأعلى' : 'للأسفل';
  return x > 0 ? 'لليمين' : 'لليسار';
}

export function describePose(pose) {
  const st = fingerStates(pose);
  const parts = [];
  const allE = st.every((s) => s === 'E'), allC = st.every((s) => s === 'C');
  if (allE) parts.push('كل الأصابع مفرودة');
  else if (allC) parts.push('اليد مقبوضة (كل الأصابع مطوية)');
  else {
    const ext = NAMES.filter((_, i) => st[i] === 'E').map((n) => FINGER_WORDS[n]);
    const cur = NAMES.filter((_, i) => st[i] === 'C').map((n) => FINGER_WORDS[n]);
    const mid = NAMES.filter((_, i) => st[i] === 'H').map((n) => FINGER_WORDS[n]);
    if (ext.length) parts.push(`مفرود: ${ext.join('، ')}`);
    if (cur.length) parts.push(`مطوي: ${cur.join('، ')}`);
    if (mid.length) parts.push(`نصف مثني: ${mid.join('، ')}`);
  }
  const d = dirWord(palmFrame(pose).y);
  parts.push(`الأصابع تتجه ${d}`);
  return parts.join(' · ') + '.';
}

export function describeMotion(sign) {
  const anim = sign.anim;
  if (!anim || !anim.offs || anim.offs.length < 3) return '';
  const o = anim.offs, n = o.length;
  const dx = -(o[n - 1][0] - o[0][0]), dy = o[n - 1][1] - o[0][1];       // dx بمنظور المستخدم
  let path = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let i = 1; i < n; i++) path += Math.hypot(o[i][0] - o[i - 1][0], o[i][1] - o[i - 1][1]);
  for (const q of o) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
  const net = Math.hypot(dx, dy), w = maxX - minX, h = maxY - minY;
  if (path < 0.6) return 'حركة صغيرة جداً أو ثبات.';
  if (net < 0.35 * path) {
    if (w > 1.6 * h) return 'حركة ذهاب وإياب أفقية (تلويح).';
    if (h > 1.6 * w) return 'حركة ذهاب وإياب عمودية.';
    return 'حركة دائرية أو ملتفّة.';
  }
  if (Math.abs(dx) > 1.5 * Math.abs(dy)) return dx > 0 ? 'تحرّك اليد لليمين.' : 'تحرّك اليد لليسار.';
  if (Math.abs(dy) > 1.5 * Math.abs(dx)) return dy < 0 ? 'ارفع اليد للأعلى.' : 'اخفض اليد للأسفل.';
  return 'حركة مائلة.';
}

export function starsFor(score) { return score >= 90 ? 3 : score >= 78 ? 2 : score >= 66 ? 1 : 0; }
