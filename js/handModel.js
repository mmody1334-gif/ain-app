// نموذج يد اصطناعي (حركة أمامية للمفاصل): يولّد نقاط 21 نقطة لأشكال يد أساسية.
// يُستخدم لـ: مكتبة «أشكال اليد الأساسية» للتدريب، ولاختبار التطبيق، ولرسم اليد قبل أن تسجّل إشاراتك.
// ملاحظة: هذه أشكال هندسية عامة، وليست إشارات عربية موثّقة. معاني الإشارات تأتي من قاموس مختص.

import { POSE_LEN, renormalizePose } from './features.js';

// قواعد الأصابع (x جانبي، y للأعلى) في وحدة طول الكف = 1
const MCP = { index: [0.30, 0.95], middle: [0.03, 1.0], ring: [-0.22, 0.93], pinky: [-0.43, 0.78] };
const BONES = { index: [0.52, 0.30, 0.24], middle: [0.58, 0.34, 0.26], ring: [0.52, 0.31, 0.24], pinky: [0.40, 0.22, 0.20] };
const SPREAD = { index: 5, middle: 0, ring: -4, pinky: -11 };   // درجات
const BASE_IDX = { index: 5, middle: 9, ring: 13, pinky: 17 };
const d2r = Math.PI / 180;

function rot(v, rx, ry, rz) {
  let [x, y, z] = v;
  // حول x
  let c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

/**
 * @param {object} o
 * @param {number[]} o.curl  انثناء [إبهام، سبابة، وسطى، بنصر، خنصر] من 0 (مفرود) إلى 1 (مطوي)
 * @param {number} [o.spread] زيادة تباعد الأصابع (درجات)
 * @param {number} [o.thumbOut] مدى ابتعاد الإبهام عن الكف 0..1 (يُستعمل مع الإبهام المفرود)
 * @param {number[]} [o.angles] [ميل أمامي/خلفي x، التفاف y، دوران z] بالدرجات لتوجيه اليد
 * @param {boolean} [o.pinchIndexThumb] يضم رأس الإبهام إلى رأس السبابة (شكل O)
 */
export function buildPose(o = {}) {
  const curl = o.curl || [0, 0, 0, 0, 0];
  const spread = o.spread || 0;
  const pts = new Array(21).fill(0).map(() => [0, 0, 0]);
  const fingers = ['index', 'middle', 'ring', 'pinky'];
  fingers.forEach((f, k) => {
    const c = curl[k + 1];
    const base = BASE_IDX[f];
    const th = [c * 80 * d2r, c * 95 * d2r, c * 62 * d2r];       // زوايا المفاصل الثلاثة
    const sp = (SPREAD[f] + (spread * (f === 'index' ? 1 : f === 'pinky' ? -1 : 0))) * d2r;
    let pos = [MCP[f][0], MCP[f][1], 0];
    pts[base] = pos.slice();
    let ang = 0;
    for (let j = 0; j < 3; j++) {
      ang += th[j];
      // اتجاه الإصبع في مستوى الانثناء ثم تباعد جانبي
      const d = [Math.sin(sp) * Math.cos(ang), Math.cos(ang) * Math.cos(sp), -Math.sin(ang)];
      pos = [pos[0] + d[0] * BONES[f][j], pos[1] + d[1] * BONES[f][j], pos[2] + d[2] * BONES[f][j]];
      pts[base + 1 + j] = pos.slice();
    }
  });
  // الإبهام: بين وضع «مفرود للخارج» و«مطوي على الكف»
  const ct = curl[0];
  const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const outDirs = [[0.62, 0.74, -0.15], [0.80, 0.55, -0.10], [0.88, 0.45, -0.05]];
  const inDirs = [[0.10, 0.75, -0.35], [-0.70, 0.40, -0.30], [-0.90, 0.30, -0.10]];
  const tl = [0.45, 0.38, 0.30];
  let tp = [0.28, 0.20, 0];
  pts[1] = tp.slice();
  for (let j = 0; j < 3; j++) {
    let d = lerp(outDirs[j], inDirs[j], ct);
    const l = Math.hypot(...d); d = d.map((v) => v / l);
    tp = [tp[0] + d[0] * tl[j], tp[1] + d[1] * tl[j], tp[2] + d[2] * tl[j]];
    pts[2 + j] = tp.slice();
  }
  if (o.pinchIndexThumb) {
    // اجعل رأس الإبهام عند رأس السبابة وقرّب المفاصل
    const tip = pts[8].slice();
    const th1 = pts[1], th2 = [(th1[0] + tip[0]) * 0.5 + 0.12, (th1[1] + tip[1]) * 0.5 - 0.05, -0.28], th3 = [(th2[0] + tip[0]) * 0.5, (th2[1] + tip[1]) * 0.5, -0.30];
    pts[2] = th2; pts[3] = th3; pts[4] = tip.map((v, i) => v + (i === 2 ? -0.02 : 0));
  }
  // y للأسفل (إحداثيات الصورة)
  const [ax, ay, az] = (o.angles || [0, 0, 0]).map((v) => v * d2r);
  const out = new Float32Array(POSE_LEN);
  pts.forEach((p, i) => {
    const q = rot([p[0], -p[1], p[2]], ax, ay, az);
    out[i * 3] = q[0]; out[i * 3 + 1] = q[1]; out[i * 3 + 2] = q[2];
  });
  return renormalizePose(out);
}

// مكتبة الأشكال الأساسية (اسم عربي + وصف قصير). لا تُنسب لها معانٍ لغوية.
export const SHAPES = [
  { id: 'shape_open',    name: 'كف مفتوحة',      emoji: '✋', curl: [0, 0, 0, 0, 0], spread: 8 },
  { id: 'shape_fist',    name: 'قبضة',           emoji: '✊', curl: [0.75, 1, 1, 1, 1] },
  { id: 'shape_point',   name: 'سبّابة للأعلى',  emoji: '☝️', curl: [0.8, 0, 1, 1, 1] },
  { id: 'shape_victory', name: 'حرف V',          emoji: '✌️', curl: [0.8, 0, 0, 1, 1], spread: 14 },
  { id: 'shape_thumb',   name: 'إبهام مرفوع',    emoji: '👍', curl: [0, 1, 1, 1, 1], angles: [0, 0, -75] },
  { id: 'shape_three',   name: 'ثلاثة أصابع',    emoji: '🤟', curl: [0.8, 0, 0, 0, 1], spread: 6 },
  { id: 'shape_four',    name: 'أربعة أصابع',    emoji: '🖐', curl: [0.9, 0, 0, 0, 0] },
  { id: 'shape_call',    name: 'اتصل بي',        emoji: '🤙', curl: [0, 1, 1, 1, 0], angles: [0, 0, -20] },
  { id: 'shape_love',    name: 'أحبّك (ILY)',    emoji: '🤟', curl: [0, 0, 1, 1, 0], spread: 10 },
  { id: 'shape_ok',      name: 'دائرة O',        emoji: '👌', curl: [0, 0.55, 0, 0, 0], pinchIndexThumb: true },
  { id: 'shape_pinky',   name: 'خنصر فقط',       emoji: '', curl: [0.8, 1, 1, 1, 0] },
];

export function shapePose(id, jitter) {
  const s = SHAPES.find((x) => x.id === id);
  return buildPose({ ...s, ...(jitter || {}) });
}
