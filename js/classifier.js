// مصنّف الإشارات الثابتة: شبكة عصبية صغيرة (MLP) تُدرَّب داخل المتصفح على نقاط يدك.
// ما يحلّ التباس الإشارات هنا:
//  1) خصائص أغنى (اتجاه، انثناء، مسافات) بدل إحداثيات خام فقط.
//  2) تدريب على نسخ مُشوَّشة ومُدارة قليلاً، فيتحمّل اختلاف الزاوية والجلسة.
//  3) رفض الأوضاع الغريبة: إن لم تشبه أي عيّنة مسجّلة لا تُنطق كلمة.
//  4) تقرير تشابه يخبرك أيّ إشارتين يخلط بينهما النموذج.

import { FEATURE_LEN, poseToFeatures, perturbPose, mirrorPose, makeRng } from './features.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function softmaxInPlace(z) {
  let m = -Infinity;
  for (let i = 0; i < z.length; i++) if (z[i] > m) m = z[i];
  let s = 0;
  for (let i = 0; i < z.length; i++) { z[i] = Math.exp(z[i] - m); s += z[i]; }
  for (let i = 0; i < z.length; i++) z[i] /= s;
}

export class SignClassifier {
  constructor() {
    this.classes = [];
    this.D = FEATURE_LEN;
    this.H = 0;
    this.mean = null; this.std = null;
    this.W1 = null; this.b1 = null; this.W2 = null; this.b2 = null;
    this.ref = null;          // عيّنات مرجعية مُعيَّرة لحساب أقرب جار
    this.refLabel = null;
    this.nnThr = 1;           // أقصى مسافة مقبولة إلى أقرب عيّنة (مُعيَّرة)
    this.pMin = 0.6;          // أقل احتمال مقبول
    this.margin = 0.15;       // أقل فارق بين الأول والثاني
    this._h = null; this._z = null; this._x = null;
  }

  // ---------- تدريب ----------
  /**
   * @param {Array<{label:string, samples:Array<{p:Float32Array,w:number[]}>}>} data
   * @param {{epochs?:number, hidden?:number, perClass?:number, mirror?:boolean, seed?:number, onProgress?:Function}} opt
   */
  static async train(data, opt = {}) {
    const clf = new SignClassifier();
    const { epochs = 40, hidden = 48, perClass = 110, mirror = false, seed = 7, onProgress } = opt;
    const rng = makeRng(seed);
    const groups = data.filter((g) => g.samples.length > 0);
    clf.classes = groups.map((g) => g.label);
    const C = clf.classes.length, D = clf.D, H = hidden;
    clf.H = H;
    if (C === 0) return clf;

    const makeAug = (opts, always) => (g) => {
      const s = g.samples[Math.floor(rng() * g.samples.length)];
      let p = s.p;
      if (mirror && rng() < 0.5) p = mirrorPose(p);
      if (always || rng() < 0.85) p = perturbPose(p, rng, opts);
      return poseToFeatures(p, s.w);
    };
    const aug = makeAug({}, false);
    // تشويش أوسع لمعايرة حدّ الرفض: نقبل اختلافاً أكبر من اختلاف التدريب، فلا يُرفض أسلوبك لمجرد تغيّر الجلسة
    const augWide = makeAug({ rz: 26, rx: 15, ry: 15, noise: 0.055, scale: 0.13 }, true);

    // إحصاءات المعايرة من مجموعة مُشوَّشة
    const pool = [];
    for (let k = 0; k < 4; k++) for (const g of groups) for (let i = 0; i < 40; i++) pool.push(aug(g));
    clf.mean = new Float32Array(D); clf.std = new Float32Array(D);
    for (const f of pool) for (let d = 0; d < D; d++) clf.mean[d] += f[d] / pool.length;
    for (const f of pool) for (let d = 0; d < D; d++) clf.std[d] += (f[d] - clf.mean[d]) ** 2 / pool.length;
    for (let d = 0; d < D; d++) clf.std[d] = Math.max(0.05, Math.sqrt(clf.std[d]));

    // مرجع أقرب الجيران (من العيّنات الأصلية غير المُشوَّشة)
    const refF = [], refL = [];
    groups.forEach((g, c) => {
      const n = g.samples.length, take = Math.min(n, 120);
      for (let k = 0; k < take; k++) {
        const s = g.samples[Math.round((k * (n - 1)) / Math.max(1, take - 1))];
        refF.push(clf._standardize(poseToFeatures(s.p, s.w))); refL.push(c);
      }
    });
    clf.ref = refF; clf.refLabel = refL;

    if (C === 1) {
      clf._calibrate(groups, augWide);
      return clf;
    }

    // أوزان
    const he = Math.sqrt(2 / D);
    const gaussR = () => { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    clf.W1 = new Float32Array(H * D).map(() => gaussR() * he);
    clf.b1 = new Float32Array(H);
    clf.W2 = new Float32Array(C * H).map(() => gaussR() * Math.sqrt(1 / H));
    clf.b2 = new Float32Array(C);

    // Adam
    const params = [clf.W1, clf.b1, clf.W2, clf.b2];
    const mom = params.map((t) => new Float32Array(t.length));
    const vel = params.map((t) => new Float32Array(t.length));
    const grads = params.map((t) => new Float32Array(t.length));
    let step = 0;
    const B = 32;
    const h = new Float32Array(H), z = new Float32Array(C), dz = new Float32Array(C), dh = new Float32Array(H);
    const x = new Float32Array(D);

    const N = C * perClass;
    const X = new Float32Array(N * D), Y = new Int32Array(N);
    const order = new Int32Array(N).map((_, i) => i);

    for (let ep = 0; ep < epochs; ep++) {
      // مجموعة جديدة مُشوَّشة في كل جولة
      let n = 0;
      for (let c = 0; c < C; c++) {
        for (let i = 0; i < perClass; i++, n++) {
          const f = aug(groups[c]);
          for (let d = 0; d < D; d++) X[n * D + d] = (f[d] - clf.mean[d]) / clf.std[d];
          Y[n] = c;
        }
      }
      for (let i = N - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
      const lr = 0.004 * (1 - 0.8 * ep / epochs);

      for (let s0 = 0; s0 < N; s0 += B) {
        const e = Math.min(N, s0 + B);
        grads.forEach((g) => g.fill(0));
        for (let bi = s0; bi < e; bi++) {
          const id = order[bi], y = Y[id], off = id * D;
          for (let d = 0; d < D; d++) x[d] = X[off + d];
          // أمامي
          for (let k = 0; k < H; k++) {
            let a = clf.b1[k]; const r = k * D;
            for (let d = 0; d < D; d++) a += clf.W1[r + d] * x[d];
            h[k] = a > 0 ? a : 0;
          }
          for (let c = 0; c < C; c++) {
            let a = clf.b2[c]; const r = c * H;
            for (let k = 0; k < H; k++) a += clf.W2[r + k] * h[k];
            z[c] = a;
          }
          softmaxInPlace(z);
          // خلفي
          for (let c = 0; c < C; c++) dz[c] = z[c] - (c === y ? 1 : 0);
          dh.fill(0);
          for (let c = 0; c < C; c++) {
            const r = c * H, g = dz[c];
            grads[3][c] += g;
            for (let k = 0; k < H; k++) { grads[2][r + k] += g * h[k]; dh[k] += g * clf.W2[r + k]; }
          }
          for (let k = 0; k < H; k++) {
            if (h[k] <= 0) continue;
            const g = dh[k], r = k * D;
            grads[1][k] += g;
            for (let d = 0; d < D; d++) grads[0][r + d] += g * x[d];
          }
        }
        step++;
        const bsz = e - s0, c1 = 1 - Math.pow(0.9, step), c2 = 1 - Math.pow(0.999, step);
        for (let t = 0; t < params.length; t++) {
          const P = params[t], G = grads[t], M = mom[t], V = vel[t];
          const decay = t % 2 === 0 ? 1e-4 : 0;
          for (let i = 0; i < P.length; i++) {
            const g = G[i] / bsz + decay * P[i];
            M[i] = 0.9 * M[i] + 0.1 * g;
            V[i] = 0.999 * V[i] + 0.001 * g * g;
            P[i] -= lr * (M[i] / c1) / (Math.sqrt(V[i] / c2) + 1e-8);
          }
        }
      }
      if (onProgress) onProgress((ep + 1) / epochs);
      await tick();
    }
    clf._calibrate(groups, augWide);
    return clf;
  }

  _calibrate(groups, aug) {
    // أقصى مسافة مقبولة = ما يصل إليه تشويش واسع (المئين 95) × 1.15
    const dists = [];
    for (const g of groups) for (let i = 0; i < 40; i++) {
      const f = this._standardize(aug(g));
      dists.push(this._nn(f).dist);
    }
    dists.sort((a, b) => a - b);
    this.nnThr = Math.max(0.35, dists[Math.floor(dists.length * 0.95)] * 1.15);
  }

  _standardize(f) {
    const o = new Float32Array(this.D);
    for (let d = 0; d < this.D; d++) o[d] = (f[d] - this.mean[d]) / this.std[d];
    return o;
  }

  /** أقرب عيّنة مرجعية (مسافة مُقسَّمة على √D لتبقى قابلة للمقارنة). */
  _nn(xs) {
    let best = Infinity, bi = -1;
    const D = this.D, R = this.ref;
    for (let i = 0; i < R.length; i++) {
      const r = R[i]; let s = 0;
      for (let d = 0; d < D; d++) { const v = xs[d] - r[d]; s += v * v; if (s >= best) break; }
      if (s < best) { best = s; bi = i; }
    }
    return { dist: Math.sqrt(best / D), index: bi, label: bi >= 0 ? this.classes[this.refLabel[bi]] : null };
  }

  // ---------- تنبؤ ----------
  predictFeatures(f) {
    const C = this.classes.length;
    if (!C || !this.ref) return { label: null, prob: 0, probs: [], accepted: false, dist: Infinity };
    const xs = this._standardize(f);
    const nn = this._nn(xs);
    let probs;
    if (C === 1) probs = [1];
    else {
      const H = this.H, D = this.D;
      if (!this._h || this._h.length !== H) { this._h = new Float32Array(H); }
      const h = this._h; const z = new Float32Array(C);
      for (let k = 0; k < H; k++) {
        let a = this.b1[k]; const r = k * D;
        for (let d = 0; d < D; d++) a += this.W1[r + d] * xs[d];
        h[k] = a > 0 ? a : 0;
      }
      for (let c = 0; c < C; c++) {
        let a = this.b2[c]; const r = c * H;
        for (let k = 0; k < H; k++) a += this.W2[r + k] * h[k];
        z[c] = a;
      }
      softmaxInPlace(z);
      probs = Array.from(z);
    }
    let b = 0, s = -1;
    probs.forEach((p, i) => { if (p > b) { s = b; b = p; } else if (p > s) s = p; });
    const bi = probs.indexOf(b);
    const label = this.classes[bi];
    const accepted = b >= this.pMin && (b - Math.max(0, s)) >= this.margin && nn.dist <= this.nnThr && label !== 'none';
    return { label, prob: b, probs, accepted, dist: nn.dist, nearest: nn.label };
  }

  predict(p, w) { return this.predictFeatures(poseToFeatures(p, w)); }

  // ---------- حفظ واسترجاع ----------
  toJSON() {
    const r = (a, k = 4) => Array.from(a, (v) => +v.toFixed(k));
    return {
      v: 1, classes: this.classes, H: this.H, D: this.D,
      mean: r(this.mean), std: r(this.std),
      W1: this.W1 ? r(this.W1) : null, b1: this.b1 ? r(this.b1) : null,
      W2: this.W2 ? r(this.W2) : null, b2: this.b2 ? r(this.b2) : null,
      nnThr: this.nnThr, pMin: this.pMin, margin: this.margin,
    };
  }

  static fromJSON(j) {
    const c = new SignClassifier();
    c.classes = j.classes; c.H = j.H; c.D = j.D;
    c.mean = Float32Array.from(j.mean); c.std = Float32Array.from(j.std);
    if (j.W1) { c.W1 = Float32Array.from(j.W1); c.b1 = Float32Array.from(j.b1); c.W2 = Float32Array.from(j.W2); c.b2 = Float32Array.from(j.b2); }
    c.nnThr = j.nnThr; c.pMin = j.pMin; c.margin = j.margin;
    return c;
  }

  /** يعيد بناء المرجع من العيّنات (يُستدعى بعد fromJSON). */
  attachReference(data) {
    const ref = [], lab = [];
    data.forEach((g) => {
      const c = this.classes.indexOf(g.label);
      if (c < 0 || !g.samples.length) return;
      const n = g.samples.length, take = Math.min(n, 120);
      for (let k = 0; k < take; k++) {
        const s = g.samples[Math.round((k * (n - 1)) / Math.max(1, take - 1))];
        ref.push(this._standardize(poseToFeatures(s.p, s.w))); lab.push(c);
      }
    });
    this.ref = ref; this.refLabel = lab;
  }
}

// ---------- تقييم التشابه بين الإشارات ----------
/**
 * يدرّب نموذجاً على أول 80% من تسجيل كل إشارة ويختبره على آخر 20% (لم يرها)،
 * ثم يبني مصفوفة الالتباس وقائمة الأزواج المتشابهة.
 */
export async function evaluateSeparability(data, opt = {}) {
  const train = [], test = [];
  for (const g of data) {
    if (g.label === 'none') { train.push(g); continue; }
    const n = g.samples.length;
    if (n < 10) continue;
    const cut = Math.floor(n * 0.8);
    train.push({ label: g.label, samples: g.samples.slice(0, cut) });
    test.push({ label: g.label, samples: g.samples.slice(cut) });
  }
  const labels = test.map((g) => g.label);
  if (labels.length < 2) return { labels, matrix: [], accuracy: null, perClass: {}, pairs: [], rejected: 0 };
  const model = await SignClassifier.train(train, { epochs: opt.epochs ?? 25, perClass: opt.perClass ?? 90, seed: 11, mirror: opt.mirror });
  const idx = Object.fromEntries(labels.map((l, i) => [l, i]));
  const L = labels.length;
  const matrix = Array.from({ length: L }, () => new Array(L + 1).fill(0)); // آخر عمود = مرفوض/ليست إشارة
  let ok = 0, total = 0;
  for (const g of test) {
    for (const s of g.samples) {
      const r = model.predict(s.p, s.w);
      total++;
      const row = idx[g.label];
      if (r.label && r.label !== 'none' && idx[r.label] !== undefined && r.accepted) { matrix[row][idx[r.label]]++; if (r.label === g.label) ok++; }
      else if (r.label && r.label !== 'none' && idx[r.label] !== undefined && !r.accepted) { matrix[row][L]++; }
      else matrix[row][L]++;
    }
  }
  const perClass = {};
  labels.forEach((l, i) => {
    const n = matrix[i].reduce((a, b) => a + b, 0);
    perClass[l] = { n, acc: n ? matrix[i][i] / n : 0, rejected: n ? matrix[i][L] / n : 0 };
  });
  const pairs = [];
  for (let a = 0; a < L; a++) for (let b = a + 1; b < L; b++) {
    const na = matrix[a].reduce((x, y) => x + y, 0), nb = matrix[b].reduce((x, y) => x + y, 0);
    const rate = (matrix[a][b] + matrix[b][a]) / Math.max(1, na + nb);
    pairs.push({ a: labels[a], b: labels[b], rate });
  }
  pairs.sort((x, y) => y.rate - x.rate);
  return { labels, matrix, accuracy: total ? ok / total : null, perClass, pairs, rejected: matrix.reduce((s, r) => s + r[L], 0) };
}

/** مسافة المراكز بين إشارتين مقسومة على انتشار كل منهما: أقل من ~1.5 = متشابهتان جداً. */
export function pairSeparation(model, data) {
  const stats = {};
  for (const g of data) {
    if (!g.samples.length) continue;
    const fs = g.samples.map((s) => model._standardize(poseToFeatures(s.p, s.w)));
    const D = model.D, mu = new Float32Array(D);
    fs.forEach((f) => { for (let d = 0; d < D; d++) mu[d] += f[d] / fs.length; });
    let spread = 0;
    fs.forEach((f) => { let s = 0; for (let d = 0; d < D; d++) s += (f[d] - mu[d]) ** 2; spread += s / fs.length; });
    stats[g.label] = { mu, rms: Math.sqrt(spread / D) };
  }
  const out = [], ls = Object.keys(stats);
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
    const a = stats[ls[i]], b = stats[ls[j]]; let s = 0;
    for (let d = 0; d < model.D; d++) s += (a.mu[d] - b.mu[d]) ** 2;
    const dc = Math.sqrt(s / model.D);
    out.push({ a: ls[i], b: ls[j], separation: dc / Math.max(1e-6, a.rms + b.rms) });
  }
  return out.sort((x, y) => x.separation - y.separation);
}
