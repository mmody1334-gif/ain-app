// مصنّف إشارات اليدين: أقرب الجيران على خصائص اليدين (99+99+6).
// kNN مناسب هنا لأن إشارات اليدين جديدة وقليلة، ولا يحتاج تدريباً طويلاً،
// ويحتفظ بأمثلة المستخدم نفسه بدل أن يفرط في التخصيص على جلسة واحدة.

import { FEATURE_LEN2 } from './features.js';

const MAX_REFS_PER_CLASS = 80;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class PairModel {
  constructor() {
    this.classes = [];
    this.mean = null; this.std = null;
    this.refs = []; this.refLabels = [];
    this.thr = [];
    this.D = FEATURE_LEN2;
  }

  static train(data) {
    const m = new PairModel();
    const groups = data.filter((g) => g.samples && g.samples.length >= 5);
    m.classes = groups.map((g) => g.label);
    const all = [];
    groups.forEach((g, c) => g.samples.forEach((s) => all.push({ f: s, label: c })));
    if (!all.length) return m;
    const D = FEATURE_LEN2;
    m.mean = new Float32Array(D); m.std = new Float32Array(D);
    for (const x of all) for (let d = 0; d < D; d++) m.mean[d] += x.f[d] / all.length;
    for (const x of all) for (let d = 0; d < D; d++) m.std[d] += (x.f[d] - m.mean[d]) ** 2 / all.length;
    for (let d = 0; d < D; d++) m.std[d] = Math.max(0.05, Math.sqrt(m.std[d]));

    const byClass = new Map();
    for (const x of all) {
      const xs = m._std(x.f);
      const arr = byClass.get(x.label) || [];
      arr.push(xs);
      byClass.set(x.label, arr);
    }
    for (const [c, arr] of byClass) {
      const step = Math.max(1, Math.ceil(arr.length / MAX_REFS_PER_CLASS));
      const picked = arr.filter((_, i) => i % step === 0);
      m.refs.push(...picked);
      for (let i = 0; i < picked.length; i++) m.refLabels.push(c);
      const ds = [];
      for (let i = 0; i < picked.length; i++) for (let j = i + 1; j < picked.length; j++) {
        let s = 0; for (let d = 0; d < D; d++) s += (picked[i][d] - picked[j][d]) ** 2;
        ds.push(Math.sqrt(s / D));
      }
      ds.sort((a, b) => a - b);
      const p95 = ds.length ? ds[Math.floor(ds.length * 0.95)] : 0.8;
      m.thr[c] = clamp(p95 * 1.35, 0.45, 2.8);
    }
    return m;
  }

  _std(f) {
    const o = new Float32Array(this.D);
    for (let d = 0; d < this.D; d++) o[d] = (f[d] - this.mean[d]) / this.std[d];
    return o;
  }

  predict(f) {
    if (!this.refs.length) return { label: null, accepted: false, prob: 0, dist: Infinity };
    const xs = this._std(f);
    const best = new Map();
    for (let i = 0; i < this.refs.length; i++) {
      const r = this.refs[i]; let s = 0;
      for (let d = 0; d < this.D; d++) { const v = xs[d] - r[d]; s += v * v; }
      const dist = Math.sqrt(s / this.D);
      const c = this.refLabels[i];
      const prev = best.get(c);
      if (!prev || dist < prev) best.set(c, dist);
    }
    const ranked = [...best.entries()].sort((a, b) => a[1] - b[1]);
    const [c, d] = ranked[0];
    const second = ranked[1]?.[1] ?? Infinity;
    const thr = this.thr[c] ?? 0.9;
    const label = this.classes[c];
    const accepted = !!label && label !== 'none' && d <= thr && second / Math.max(1e-6, d) >= 1.04;
    return { label, accepted, prob: clamp(1 - d / (thr * 1.15), 0, 1), dist: d, thr, nearest: label };
  }

  toJSON() {
    const r = (a) => Array.from(a, (v) => +v.toFixed(4));
    return {
      v: 1, classes: this.classes, D: this.D,
      mean: r(this.mean), std: r(this.std),
      thr: this.thr,
      refs: this.refs.map((x) => r(x)),
      refLabels: this.refLabels,
    };
  }

  static fromJSON(j) {
    const m = new PairModel();
    m.classes = j.classes; m.D = j.D || FEATURE_LEN2;
    m.mean = Float32Array.from(j.mean); m.std = Float32Array.from(j.std);
    m.thr = j.thr || [];
    m.refs = (j.refs || []).map((x) => Float32Array.from(x));
    m.refLabels = j.refLabels || [];
    return m;
  }
}
