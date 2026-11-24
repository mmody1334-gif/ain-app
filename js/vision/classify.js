// الخطوة 3 (Ain-06): مصنّف الوضعيات الثابتة — ملامح مُطبّعة + kNN (k=5) + تصويت أغلبية على آخر 5 إطارات (عتبة 0.7).
// لا holdSec ولا تجميد ولا أي EMA إضافي.

export const FEAT_LEN = 63;

/** يستخرج 63 ميزة مُطبَّعة: النقاط نسبة للمعصم ومقسومة على حجم الكف (مع تصحيح نسبة العرض/الارتفاع). */
export function extractFeatures(lm, aspect = 4 / 3) {
  if (!lm || lm.length < 21) return null;
  const ar = aspect > 0 ? aspect : 4 / 3;
  const wx = lm[0].x;
  const wy = lm[0].y / ar;
  const wz = lm[0].z || 0;
  const palm = Math.hypot(lm[9].x - wx, lm[9].y / ar - wy, (lm[9].z || 0) - wz);
  if (palm < 1e-4) return null;
  const inv = 1 / palm;
  const out = new Float32Array(FEAT_LEN);
  for (let i = 0; i < 21; i++) {
    out[i * 3] = (lm[i].x - wx) * inv;
    out[i * 3 + 1] = (lm[i].y / ar - wy) * inv;
    out[i * 3 + 2] = ((lm[i].z || 0) - wz) * inv;
  }
  return out;
}

/** يعكس الملامح أفقياً (x -> -x) حتى تعمل الإشارات المبدئية باليد اليمنى واليسرى معاً. */
export function mirrorFeatures(f) {
  const out = new Float32Array(f.length);
  for (let i = 0; i < f.length; i += 3) {
    out[i] = -f[i];
    out[i + 1] = f[i + 1];
    out[i + 2] = f[i + 2];
  }
  return out;
}

/** ملامح ليدين معاً (63 + 63 + موضع نسبي = 128 قيمة). */
export function extractPairFeatures(lm1, lm2, aspect = 4 / 3) {
  const f1 = extractFeatures(lm1, aspect);
  const f2 = extractFeatures(lm2, aspect);
  if (!f1 || !f2) return null;
  const ar = aspect > 0 ? aspect : 4 / 3;
  const s1 = Math.hypot(lm1[9].x - lm1[0].x, (lm1[9].y - lm1[0].y) / ar) || 0.18;
  const s2 = Math.hypot(lm2[9].x - lm2[0].x, (lm2[9].y - lm2[0].y) / ar) || 0.18;
  const avg = (s1 + s2) * 0.5;
  const out = new Float32Array(128);
  out.set(f1, 0);
  out.set(f2, 63);
  out[126] = (lm2[0].x - lm1[0].x) / avg;
  out[127] = ((lm2[0].y - lm1[0].y) / ar) / avg;
  return out;
}

function l2Dist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s / a.length);
}

// ---------- كاشف الأشكال الهندسية الجاهزة مباشرة من الملامح المطبّعة (بلا أي EMA) ----------
function ptDist(f, a, b) {
  return Math.hypot(f[a * 3] - f[b * 3], f[a * 3 + 1] - f[b * 3 + 1], f[a * 3 + 2] - f[b * 3 + 2]);
}

function jointAngleDeg(f, a, b, c) {
  const ux = f[a * 3] - f[b * 3], uy = f[a * 3 + 1] - f[b * 3 + 1], uz = f[a * 3 + 2] - f[b * 3 + 2];
  const vx = f[c * 3] - f[b * 3], vy = f[c * 3 + 1] - f[b * 3 + 1], vz = f[c * 3 + 2] - f[b * 3 + 2];
  const nu = Math.hypot(ux, uy, uz), nv = Math.hypot(vx, vy, vz);
  if (nu < 1e-5 || nv < 1e-5) return 180;
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (nu * nv)));
  return Math.acos(cos) * (180 / Math.PI);
}

/**
 * حالة الأصابع الخمسة ثلاثية الحالات: 'E' مفرود بوضوح، 'C' مطوي بوضوح، 'H' انتقالي/غامض.
 * المنطقة الانتقالية 'H' تمنع اللخبطة والومضات الكاذبة بين الأشكال المتقاربة.
 */
export function fingerStates3(f) {
  if (!f) return ['H', 'H', 'H', 'H', 'H'];
  const rThumb = ptDist(f, 4, 17) / Math.max(1e-5, ptDist(f, 2, 17));
  const dThumbIdx = ptDist(f, 4, 5);
  const th = (rThumb > 1.22 && dThumbIdx > 0.44) ? 'E'
    : (rThumb < 1.06 || dThumbIdx < 0.34) ? 'C' : 'H';

  const st = [th];
  const chains = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]];
  for (const [mcp, pip, tip] of chains) {
    const ang = jointAngleDeg(f, mcp, pip, tip);
    const ratio = ptDist(f, tip, 0) / Math.max(1e-5, ptDist(f, pip, 0));
    if (ang >= 145 && ratio >= 1.15) st.push('E');
    else if (ang <= 118 || ratio <= 1.02) st.push('C');
    else st.push('H');
  }
  return st; // [thumb, index, middle, ring, pinky]
}

export function fingerExtended(f) {
  return fingerStates3(f).map((s) => s === 'E');
}

export function detectBuiltinShapeFast(f) {
  if (!f) return null;
  const st = fingerStates3(f);
  const [th, idx, mid, rng, pnk] = st;

  // دائرة O: طرف الإبهام يلامس طرف السبابة والثلاثة الباقية مفرودة بوضوح
  if (ptDist(f, 4, 8) < 0.32 && mid === 'E' && rng === 'E' && pnk === 'E') {
    return { id: 'shape_ok', conf: 0.92 };
  }

  // الأصابع الأربعة مطوية بوضوح: إبهام للأعلى/للأسفل أو قبضة
  if (idx === 'C' && mid === 'C' && rng === 'C' && pnk === 'C') {
    if (th === 'E') {
      const dy = f[4 * 3 + 1] - f[2 * 3 + 1];
      if (dy < -0.32) return { id: 'shape_thumb', conf: 0.92 };
      if (dy > 0.32) return { id: 'shape_thumb_down', conf: 0.92 };
    }
    if (th !== 'E' || Math.abs(f[4 * 3 + 1] - f[2 * 3 + 1]) < 0.25) {
      return { id: 'shape_fist', conf: 0.94 };
    }
    return null;
  }

  // أي إصبع في المنطقة الانتقالية 'H' يُرفض بدل التخمين الخاطئ
  if (idx === 'H' || mid === 'H' || rng === 'H' || pnk === 'H') return null;

  if (th === 'E' && idx === 'E' && mid === 'E' && rng === 'E' && pnk === 'E') return { id: 'shape_open', conf: 0.94 };
  if (th === 'C' && idx === 'E' && mid === 'C' && rng === 'C' && pnk === 'C') return { id: 'shape_point', conf: 0.90 };
  if (th === 'C' && idx === 'E' && mid === 'E' && rng === 'C' && pnk === 'C') return { id: 'shape_victory', conf: 0.90 };
  if (th === 'E' && idx === 'E' && mid === 'C' && rng === 'C' && pnk === 'C') return { id: 'shape_l', conf: 0.88 };
  if (th === 'C' && idx === 'E' && mid === 'E' && rng === 'E' && pnk === 'C') return { id: 'shape_three', conf: 0.90 };
  if (th === 'C' && idx === 'E' && mid === 'E' && rng === 'E' && pnk === 'E') return { id: 'shape_four', conf: 0.90 };
  if (th === 'E' && idx === 'C' && mid === 'C' && rng === 'C' && pnk === 'E') return { id: 'shape_call', conf: 0.90 };
  if (th === 'E' && idx === 'E' && mid === 'C' && rng === 'C' && pnk === 'E') return { id: 'shape_love', conf: 0.90 };
  if (th === 'C' && idx === 'C' && mid === 'C' && rng === 'C' && pnk === 'E') return { id: 'shape_pinky', conf: 0.88 };

  return null;
}

export class StaticClassifier {
  constructor(opt = {}) {
    this.k = opt.k ?? 5;
    this.voteWindow = opt.voteWindow ?? 5;
    this.confThreshold = opt.confThreshold ?? 0.7;
    this.maxDist1 = opt.maxDist1 ?? 0.20;
    this.maxDist2 = opt.maxDist2 ?? 0.30;
    this.refs1User = []; // إشارات المستخدم الثابتة (أولوية قصوى)
    this.refs1Starter = []; // إشارات starter الثابتة (أنا/أنت/هو)
    this.refs2 = []; // [{ id, word, feat }]
    this.sig1 = new Map(); // id -> ['E'|'C'|null x5] بوابة أصابع تمنع خلط الإشارات المسجّلة
    this.byRule = new Map(); // rule -> { id, word }
    this.history = []; // آخر 5 إطارات: [{ id, word, conf }]
  }

  reset() {
    this.history = [];
  }

  /** يحمّل إشارات starter أو إشارات المستخدم في المصنّف (kNN للثابتة + خريطة الأشكال الجاهزة). */
  loadSigns(signs = []) {
    this.refs1User = [];
    this.refs1Starter = [];
    this.refs2 = [];
    this.sig1.clear();
    this.byRule.clear();
    this.history = [];

    for (const s of signs) {
      if (!s || !s.id || !s.word) continue;
      if (s.kind === 'builtin' && s.rule) {
        this.byRule.set(s.rule, { id: s.id, word: s.word, rule: s.rule });
        continue;
      }
      if ((s.kind || 'static') === 'static') {
        if (s.hands === 2 && Array.isArray(s.samples2) && s.samples2.length) {
          const step = Math.max(1, Math.floor(s.samples2.length / 30));
          for (let i = 0; i < s.samples2.length; i += step) {
            const raw = s.samples2[i];
            if (!Array.isArray(raw) || raw.length < 126) continue;
            const feat = new Float32Array(128);
            for (let j = 0; j < 126; j++) feat[j] = raw[j];
            const sz = ((raw[130] || 0.18) + (raw[131] || 0.18)) * 0.5;
            feat[126] = ((raw[128] ?? 0.6) - (raw[126] ?? 0.4)) / sz;
            feat[127] = ((raw[129] ?? 0.5) - (raw[127] ?? 0.5)) / sz;
            this.refs2.push({ id: s.id, word: s.word, feat });
          }
        } else if (Array.isArray(s.samples) && s.samples.length) {
          const step = Math.max(1, Math.floor(s.samples.length / 25));
          const cnt = Array.from({ length: 5 }, () => ({ E: 0, C: 0 }));
          let totalN = 0;
          for (let i = 0; i < s.samples.length; i += step) {
            const raw = s.samples[i];
            if (!Array.isArray(raw) || raw.length < FEAT_LEN) continue;
            const feat = Float32Array.from(raw.slice(0, FEAT_LEN));
            const st = fingerStates3(feat);
            for (let k = 0; k < 5; k++) {
              if (st[k] === 'E') cnt[k].E++;
              else if (st[k] === 'C') cnt[k].C++;
            }
            totalN++;
            const target = s.source === 'starter' ? this.refs1Starter : this.refs1User;
            target.push({ id: s.id, word: s.word, feat });
            if (s.source === 'starter') {
              target.push({ id: s.id, word: s.word, feat: mirrorFeatures(feat) });
            }
          }
          if (totalN > 0) {
            this.sig1.set(s.id, cnt.map((c) => (c.E / totalN >= 0.85 ? 'E' : c.C / totalN >= 0.85 ? 'C' : null)));
          }
        }
      }
    }
  }

  _passesGate(id, feat) {
    const sig = this.sig1.get(id);
    if (!sig) return true;
    const st = fingerStates3(feat);
    for (let i = 0; i < 5; i++) {
      if (!sig[i] || st[i] === 'H') continue;
      if (st[i] !== sig[i]) return false;
    }
    return true;
  }

  _knn(feat, refs, maxDist, checkGate = false) {
    if (!feat || !refs.length) return null;
    const scored = refs.map((r) => ({ id: r.id, word: r.word, d: l2Dist(feat, r.feat) }));
    scored.sort((a, b) => a.d - b.d);
    const top = scored.slice(0, Math.min(this.k, scored.length));
    if (!top.length || top[0].d > maxDist) return null;

    const weights = new Map();
    const words = new Map();
    let totalW = 0;
    for (const item of top) {
      if (item.d > maxDist * 1.2) continue;
      const w = 1 / (item.d + 0.04);
      weights.set(item.id, (weights.get(item.id) || 0) + w);
      words.set(item.id, item.word);
      totalW += w;
    }
    if (!totalW) return null;

    let bestId = null, bestW = 0;
    for (const [id, w] of weights) {
      if (w > bestW) { bestW = w; bestId = id; }
    }
    if (checkGate && !this._passesGate(bestId, feat)) return null;

    const voteRatio = bestW / totalW;
    // الثقة الحقيقية تعتمد على القرب الفعلي لا على كون الفئة وحيدة
    const distConf = Math.max(0, Math.min(1, 1 - (top[0].d / maxDist) * 0.45));
    const conf = +(Math.min(voteRatio, distConf)).toFixed(3);
    if (conf < this.confThreshold) return null;
    return { id: bestId, word: words.get(bestId), conf, dist: top[0].d };
  }

  /** يصنّف إطاراً واحداً (يد واحدة أو يدان) ثم يطبّق تصويت الأغلبية على آخر 5 إطارات. */
  predict(hands, aspect = 4 / 3) {
    if (!hands || !hands.length) {
      this.history = [];
      return { id: null, word: null, conf: 0, raw: null };
    }

    let raw = null;

    // 1) يدان معاً (kNN بالترتيبين)
    if (hands.length >= 2 && this.refs2.length) {
      const pA = extractPairFeatures(hands[0].lm, hands[1].lm, aspect);
      const pB = extractPairFeatures(hands[1].lm, hands[0].lm, aspect);
      const rA = this._knn(pA, this.refs2, this.maxDist2);
      const rB = this._knn(pB, this.refs2, this.maxDist2);
      raw = (rA && (!rB || rA.conf >= rB.conf)) ? rA : rB;
    }

    // 2) يد واحدة: إشارات المستخدم أولاً (مع بوابة الأصابع) ← ثم الأشكال الهندسية الجاهزة ← ثم إشارات starter
    if (!raw && this.refs1User.length) {
      for (const h of hands) {
        const feat = extractFeatures(h.lm, aspect);
        if (!feat) continue;
        const knnHit = this._knn(feat, this.refs1User, this.maxDist1, true);
        if (knnHit && (!raw || knnHit.conf > raw.conf)) raw = knnHit;
      }
    }

    if (!raw) {
      for (const h of hands) {
        const feat = extractFeatures(h.lm, aspect);
        const shape = detectBuiltinShapeFast(feat);
        if (shape) {
          const sign = this.byRule.get(shape.id);
          if (sign) {
            raw = { id: sign.id, word: sign.word, conf: shape.conf, rule: shape.id };
            break;
          }
        }
      }
    }

    if (!raw && this.refs1Starter.length) {
      for (const h of hands) {
        const feat = extractFeatures(h.lm, aspect);
        if (!feat) continue;
        const knnHit = this._knn(feat, this.refs1Starter, this.maxDist1, true);
        if (knnHit && (!raw || knnHit.conf > raw.conf)) raw = knnHit;
      }
    }

    // تصويت الأغلبية على آخر 5 إطارات (بلا holdSec ولا تجميد)
    this.history.push(raw);
    if (this.history.length > this.voteWindow) this.history.shift();

    const counts = new Map();
    const confSum = new Map();
    const wordMap = new Map();
    for (const item of this.history) {
      if (!item || !item.id) continue;
      counts.set(item.id, (counts.get(item.id) || 0) + 1);
      confSum.set(item.id, (confSum.get(item.id) || 0) + item.conf);
      wordMap.set(item.id, item.word);
    }

    const needed = Math.ceil(this.voteWindow / 2); // 3 من آخر 5 إطارات
    let winId = null, winCount = 0;
    for (const [id, c] of counts) {
      if (c > winCount) { winCount = c; winId = id; }
    }

    if (winId && winCount >= needed) {
      const avgConf = +(confSum.get(winId) / winCount).toFixed(2);
      if (avgConf >= this.confThreshold) {
        return { id: winId, word: wordMap.get(winId), conf: avgConf, raw };
      }
    }
    return { id: null, word: null, conf: 0, raw };
  }
}
