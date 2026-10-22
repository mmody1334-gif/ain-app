// خصائص نقاط اليد: تحويل نقاط MediaPipe الـ21 إلى وضعية مُطبَّعة ثم إلى متجه خصائص.
// الفكرة: الوضعية (pose) لا تعتمد على بعد اليد ولا على مكانها في الصورة،
// ومتجه الخصائص يضيف ما كان ينقص النموذج القديم: اتجاه الكف والأصابع صراحةً،
// وانثناء كل إصبع، ومسافات أطراف الأصابع، وزوايا التباعد بينها.

export const N_LM = 21;
export const POSE_LEN = 63;          // 21 نقطة × (x,y,z)
export const FEATURE_LEN = 99;

export const FINGERS = [
  { id: 'thumb',  name: 'الإبهام',  idx: [1, 2, 3, 4] },
  { id: 'index',  name: 'السبّابة', idx: [5, 6, 7, 8] },
  { id: 'middle', name: 'الوسطى',   idx: [9, 10, 11, 12] },
  { id: 'ring',   name: 'البنصر',   idx: [13, 14, 15, 16] },
  { id: 'pinky',  name: 'الخنصر',   idx: [17, 18, 19, 20] },
];
export const TIPS = [4, 8, 12, 16, 20];

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

// ---------- أدوات المتجهات ----------
const len3 = (x, y, z) => Math.hypot(x, y, z);

function unit(out, o, x, y, z) {
  const l = len3(x, y, z) || 1e-9;
  out[o] = x / l; out[o + 1] = y / l; out[o + 2] = z / l;
}

function dist(p, a, b) {
  return len3(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
}

/**
 * يحوّل نقاط MediaPipe (x,y مقيسة على عرض/ارتفاع الصورة، و z نسبية) إلى وضعية مُطبَّعة.
 * @param {Array<{x:number,y:number,z:number}>} lm  21 نقطة
 * @param {number} aspect  عرض الصورة ÷ ارتفاعها
 * @returns {{p:Float32Array, w:[number,number], size:number}|null}
 */
export function landmarksToPose(lm, aspect) {
  if (!lm || lm.length < N_LM) return null;
  const ar = aspect > 0 ? aspect : 4 / 3;
  // وحدات متساوية في الاتجاهين (بوحدة عرض الصورة)
  const X = new Float32Array(N_LM), Y = new Float32Array(N_LM), Z = new Float32Array(N_LM);
  for (let i = 0; i < N_LM; i++) { X[i] = lm[i].x; Y[i] = lm[i].y / ar; Z[i] = lm[i].z || 0; }
  const d = (i) => len3(X[i] - X[0], Y[i] - Y[0], Z[i] - Z[0]);
  const size = (d(5) + d(9) + d(13) + d(17)) / 4;
  if (!(size > 1e-4)) return null;
  const p = new Float32Array(POSE_LEN);
  for (let i = 0; i < N_LM; i++) {
    p[i * 3] = (X[i] - X[0]) / size;
    p[i * 3 + 1] = (Y[i] - Y[0]) / size;
    p[i * 3 + 2] = (Z[i] - Z[0]) / size;
  }
  return { p, w: [lm[0].x, lm[0].y], size };
}

/** يعيد تطبيع وضعية موجودة (مثلاً بعد التدوير أو التحويل من صيغة قديمة). */
export function renormalizePose(p) {
  const d = (i) => len3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  const size = (d(5) + d(9) + d(13) + d(17)) / 4 || 1;
  const out = new Float32Array(POSE_LEN);
  for (let i = 0; i < POSE_LEN; i++) out[i] = p[i] / size;
  return out;
}

/** الاتجاهات الأساسية للكف والأصابع (متجهات وحدة). */
export function orientation(p) {
  const o = new Float32Array(15);
  // محور الكف: من المعصم إلى قاعدة الوسطى
  unit(o, 0, p[27], p[28], p[29]);
  // العرض: من الخنصر إلى السبابة
  const lx = p[15] - p[51], ly = p[16] - p[52], lz = p[17] - p[53];
  unit(o, 3, lx, ly, lz);
  // الناظم: عمودي على الكف (يعطي وجه الكف واليد معاً)
  const ax = o[0], ay = o[1], az = o[2];
  const lux = o[3], luy = o[4], luz = o[5];
  unit(o, 6, luy * az - luz * ay, luz * ax - lux * az, lux * ay - luy * ax);
  // اتجاه السبابة، واتجاه الإبهام
  unit(o, 9, p[24] - p[15], p[25] - p[16], p[26] - p[17]);
  unit(o, 12, p[12] - p[6], p[13] - p[7], p[14] - p[8]);
  return o;
}

/** درجة استقامة كل إصبع: 1 = مفرود تماماً، وتقل كلما انثنى. */
export function fingerExtension(p) {
  const out = new Float32Array(5);
  FINGERS.forEach((f, k) => {
    const [a, b, c, d] = f.idx;
    const chain = dist(p, a, b) + dist(p, b, c) + dist(p, c, d);
    out[k] = Math.min(1, dist(p, a, d) / (chain || 1));
  });
  return out;
}

/** زاوية الانثناء عند مفصل (بالدرجات): 180 = مفصل مستقيم. */
function jointAngle(p, a, b, c) {
  const ux = p[a * 3] - p[b * 3], uy = p[a * 3 + 1] - p[b * 3 + 1], uz = p[a * 3 + 2] - p[b * 3 + 2];
  const vx = p[c * 3] - p[b * 3], vy = p[c * 3 + 1] - p[b * 3 + 1], vz = p[c * 3 + 2] - p[b * 3 + 2];
  const lu = len3(ux, uy, uz) || 1e-9, lv = len3(vx, vy, vz) || 1e-9;
  let c0 = (ux * vx + uy * vy + uz * vz) / (lu * lv);
  c0 = c0 > 1 ? 1 : c0 < -1 ? -1 : c0;
  return Math.acos(c0) * 180 / Math.PI;
}

/**
 * انثناء كل إصبع من 0 (مستقيم تماماً) إلى 1 (مطوي تماماً)، محسوباً من زوايا
 * المفصلين، لا من المسافات وحدها؛ لذلك لا يتأثر بحجم اليد ولا ببعدها عن الكاميرا.
 */
export function fingerCurls(p) {
  const out = new Float32Array(5);
  FINGERS.forEach((f, k) => {
    const [a, b, c, d] = f.idx;
    const bend = (180 - jointAngle(p, a, b, c)) + (180 - jointAngle(p, b, c, d));
    out[k] = Math.max(0, Math.min(1, bend / 180));
  });
  return out;
}

/** بُعد طرف الإبهام عن قاعدة السبابة بوحدات طول الكف (مقياس ثبات «الإبهام خارجاً»). */
export function thumbGap(p) {
  return Math.hypot(p[12] - p[15], p[13] - p[16], p[14] - p[17]);
}

/**
 * متجه الخصائص (99 رقماً):
 *  60 إحداثيات الوضعية (من دون المعصم) | 15 اتجاهات | 5 استقامة الأصابع | 5 بُعد الأطراف عن المعصم
 *  | 10 مسافات بين الأطراف | 4 زوايا التباعد
 * مكان اليد في الصورة لا يدخل الخصائص عمداً: النموذج القديم كان يعتمد عليه فيخلط بين الإشارات
 * عندما تتغير جلستك أو جلوسك أمام الكاميرا (مثلاً «أنا» كانت تُعرف بأن اليد عند حافة الصورة).
 */
export function poseToFeatures(p, w, out) {
  const f = out || new Float32Array(FEATURE_LEN);
  let o = 0;
  for (let i = 3; i < POSE_LEN; i++) f[o++] = p[i];
  const ori = orientation(p);
  for (let i = 0; i < 15; i++) f[o++] = ori[i];
  const ext = fingerExtension(p);
  for (let i = 0; i < 5; i++) f[o++] = ext[i];
  for (let k = 0; k < 5; k++) f[o++] = dist(p, TIPS[k], 0);
  for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) f[o++] = dist(p, TIPS[a], TIPS[b]);
  const dir = (i, j) => {
    const x = p[j * 3] - p[i * 3], y = p[j * 3 + 1] - p[i * 3 + 1], z = p[j * 3 + 2] - p[i * 3 + 2];
    const l = len3(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };
  const dI = dir(5, 8), dM = dir(9, 12), dR = dir(13, 16), dP = dir(17, 20), dT = dir(2, 4);
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  f[o++] = dot(dI, dM); f[o++] = dot(dM, dR); f[o++] = dot(dR, dP); f[o++] = dot(dT, dI);
  return f;
}

// ---------- تغييرات عشوائية للتدريب (تحاكي اختلاف الجلسات والزوايا) ----------
function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function makeRng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** يدوّر الوضعية حول المعصم بزوايا صغيرة (بالدرجات) ويضيف ضجيجاً. */
export function perturbPose(p, rng, opt = {}) {
  const { rz = 12, rx = 7, ry = 7, noise = 0.025, scale = 0.06 } = opt;
  const d2r = Math.PI / 180;
  const az = gauss(rng) * rz * 0.5 * d2r, ax = gauss(rng) * rx * 0.5 * d2r, ay = gauss(rng) * ry * 0.5 * d2r;
  const cz = Math.cos(az), sz = Math.sin(az), cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay);
  // R = Rz * Ry * Rx
  const r00 = cz * cy, r01 = cz * sy * sx - sz * cx, r02 = cz * sy * cx + sz * sx;
  const r10 = sz * cy, r11 = sz * sy * sx + cz * cx, r12 = sz * sy * cx - cz * sx;
  const r20 = -sy, r21 = cy * sx, r22 = cy * cx;
  const out = new Float32Array(POSE_LEN);
  const k = 1 + gauss(rng) * scale;
  for (let i = 0; i < N_LM; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    const nx = (r00 * x + r01 * y + r02 * z) * k + (i ? gauss(rng) * noise : 0);
    const ny = (r10 * x + r11 * y + r12 * z) * k + (i ? gauss(rng) * noise : 0);
    const nz = (r20 * x + r21 * y + r22 * z) * k + (i ? gauss(rng) * noise : 0);
    out[i * 3] = nx; out[i * 3 + 1] = ny; out[i * 3 + 2] = nz;
  }
  return renormalizePose(out);
}

export function mirrorPose(p) {
  const out = new Float32Array(p);
  for (let i = 0; i < N_LM; i++) out[i * 3] = -out[i * 3];
  return out;
}
