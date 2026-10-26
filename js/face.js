// تعابير الوجه: يقود FaceLandmarker على نفس فيديو الكاميرا ويستنتج سؤال/نفي/إيجاب
// من الحواجب وهزّة الرأس. يفشل بصمت: أي خطأ يعطّل الميزة فقط دون التطبيق.

const CDN_VER = '0.10.14'; // نفس نسة tasks-vision في camera.js — لا تنزيل إضافي للـ WASM
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${CDN_VER}`;
const FACE_MODEL = new URL('../vendor/face_landmarker.task', import.meta.url).href;

const BROW_WIN = 0.6;      // نافذة متوسط رفع الحاجب بالثواني
const BROW_THR = 0.35;
const SHAKE_WIN = 1.2;     // نافذة رصد هزّة الرأس بالثواني
const SHAKE_AMP = 0.02;    // أقل اتساع مقبول للحركة الأفقية/الرأسية
const KEEP_MS = 2000;      // صلاحية آخر تعبير
const EVERY_MS = 80;       // كلفة التشغيل: كشف على الأكثر كل 80 مللي ثانية

async function exists(url) {
  try { const r = await fetch(url, { method: 'HEAD', cache: 'no-store' }); return r.ok; } catch (e) { return false; }
}

let fl = null;          // كاشف الوجه
let lastTs = 0;
let lastRun = 0;
let ready = false;
let onChangeCb = null;
let currentLabel = null, currentAt = 0;

// تتبع طرف الأنف (نقطة 1) لهزّة الرأس الأفقية والإيماءة الرأسية
const noseHist = []; // {t, x, y}

export const face = {
  get current() {
    if (currentLabel && performance.now() - currentAt <= KEEP_MS) return currentLabel;
    return null;
  },
  get ready() { return ready; },
  onChange(cb) { onChangeCb = cb; },
};

function setLabel(l) {
  currentLabel = l;
  currentAt = performance.now();
  try { onChangeCb?.(l); } catch (e) { /* لا شيء */ }
}

async function loadModel() {
  // نموذج الوجه محلي إن وُجد، وإلا من الشبكة (عامل الخدمة يخزّنه)
  let url = FACE_MODEL;
  if (!(await exists('vendor/face_landmarker.task'))) {
    url = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';
  }
  const mod = await import(`${CDN_BASE}/vision_bundle.mjs`);
  const { FilesetResolver, FaceLandmarker } = mod;
  const fileset = await FilesetResolver.forVisionTasks(`${CDN_BASE}/wasm`);
  fl = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: url, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
  });
  ready = true;
}

/** يُستدعى مرة عند بدء الكاميرا في شاشة الترجمة. الفشل صامت. */
export async function initFace(video) {
  if (ready || fl) return true;
  try { await loadModel(); return true; } catch (e) { fl = null; ready = false; return false; }
}

/** ضربات هزّة الرأس: عدد انقلابات الاتجاه ضمن النافذة. */
function reversals(hist, key) {
  let n = 0, prevDir = 0, prevExt = null;
  for (const s of hist) {
    const v = s[key];
    if (prevExt == null) { prevExt = v; continue; }
    const d = v - prevExt;
    if (prevDir && Math.sign(d) === -prevDir && Math.abs(d) > 0) n++;
    if (Math.abs(d) > 0.002) prevDir = Math.sign(d);
    prevExt = v;
  }
  return n;
}

function amplitude(hist, key) {
  let mn = 1, mx = -1;
  for (const s of hist) { if (s[key] < mn) mn = s[key]; if (s[key] > mx) mx = s[key]; }
  return mx - mn;
}

/** استنتاج التعبير من عيّنات النافذة: الحواجب ثم الحركة. t بالثواني (زمن الكاميرا). */
function classify(t) {
  const now = t;
  // سؤال: متوسط رفع الحاجب أعلى العتبة في النافذة
  const brows = noseHist.filter((s) => now - s.t <= BROW_WIN && s.brow != null);
  if (brows.length >= 3) {
    const avg = brows.reduce((a, s) => a + s.brow, 0) / brows.length;
    if (avg > BROW_THR) { setLabel('question'); return; }
  }
  // نفي/إيجاب: هزّة الرأس
  const recent = noseHist.filter((s) => now - s.t <= SHAKE_WIN);
  if (recent.length >= 5) {
    const hr = reversals(recent, 'x'), ha = amplitude(recent, 'x');
    const vr = reversals(recent, 'y'), va = amplitude(recent, 'y');
    if (ha > SHAKE_AMP && hr >= 2) { setLabel('negation'); noseHist.length = 0; return; }
    if (va > SHAKE_AMP && vr >= 2) { setLabel('affirm'); noseHist.length = 0; return; }
  }
}

/** يُستدعى كل إطار من onFrame في شاشة الترجمة (بلا حلقة مستقلة). */
export function updateFace(video, t) {
  if (!ready || !fl || !video || video.readyState < 2) return;
  const now = performance.now();
  if (now - lastRun < EVERY_MS) return;
  lastRun = now;
  const ts = Math.max(lastTs + 1, Math.round(t * 1000));
  lastTs = ts;
  try {
    const r = fl.detectForVideo(video, ts);
    const n = t; // زمن الكاميرا بالثواني
    if (r?.faceLandmarks?.length) {
      const lm = r.faceLandmarks[0];
      const nose = lm[1] || { x: 0.5, y: 0.5 };
      // رفع الحاجب: متوسط درجتي blendshape
      let brow = null;
      const bs = r.faceBlendshapes?.[0]?.categories;
      if (bs) {
        const up = bs.find((c) => c.categoryName === 'browInnerUp');
        brow = up ? up.score : 0;
      }
      noseHist.push({ t: n, x: nose.x, y: nose.y, brow });
      while (noseHist.length && n - noseHist[0].t > SHAKE_WIN + 0.2) noseHist.shift();
      classify(t);
    } else {
      noseHist.length = 0; // غاب الوجه: نبدأ من جديد
    }
  } catch (e) { /* إطار فاشل لا يوقف الحلقة */ }
}
