// الخطوة 2 (Ain-06): طبقة تنعيم واحدة فقط — One Euro Filter على نقاط اليد الـ 21.
// minCutoff = 1.2, beta = 8.0. ممنوع أي EMA إضافي فوق هذه الطبقة.

class OneEuroScalar {
  constructor(minCutoff = 1.2, beta = 8.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  _alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(x, t) {
    if (this.tPrev === null || this.xPrev === null) {
      this.tPrev = t;
      this.xPrev = x;
      this.dxPrev = 0;
      return x;
    }
    const dt = Math.max(1e-4, t - this.tPrev);
    this.tPrev = t;

    const dx = (x - this.xPrev) / dt;
    const aD = this._alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = dxHat;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this._alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    return xHat;
  }
}

export class VisionSmoother {
  constructor(minCutoff = 1.2, beta = 8.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.slots = [this._createSlot(), this._createSlot()];
  }

  _createSlot() {
    return {
      pts: Array.from({ length: 21 }, () => ({
        x: new OneEuroScalar(this.minCutoff, this.beta, this.dCutoff),
        y: new OneEuroScalar(this.minCutoff, this.beta, this.dCutoff),
        z: new OneEuroScalar(this.minCutoff, this.beta, this.dCutoff),
      })),
      wrist: null,
      t: -1,
    };
  }

  _resetSlot(slot) {
    for (const p of slot.pts) {
      p.x.reset();
      p.y.reset();
      p.z.reset();
    }
    slot.wrist = null;
    slot.t = -1;
  }

  reset() {
    for (const s of this.slots) this._resetSlot(s);
  }

  /** ينعّم مصفوفة أيدي [{ lm, hand, score }] بطبقة One Euro واحدة مع مطابقة مكانية للخانتين. */
  smooth(hands, t) {
    if (!hands || !hands.length) {
      this.reset();
      return [];
    }
    const n = Math.min(2, hands.length);
    const STALE = 0.25;
    const JUMP = 0.40;
    const isLive = (sl) => sl.wrist !== null && t >= sl.t && (t - sl.t) <= STALE;
    const dist = (hIdx, sIdx) => {
      const sl = this.slots[sIdx];
      const w = hands[hIdx]?.lm?.[0];
      if (!isLive(sl) || !w) return 0.5;
      return Math.hypot(w.x - sl.wrist.x, w.y - sl.wrist.y);
    };

    const assign = new Array(n).fill(0);
    if (n === 1) {
      let best = -1, bestD = JUMP;
      for (let k = 0; k < 2; k++) {
        if (!isLive(this.slots[k])) continue;
        const d = dist(0, k);
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best < 0) best = !isLive(this.slots[0]) ? 0 : !isLive(this.slots[1]) ? 1 : 0;
      assign[0] = best;
    } else {
      const cost = (hi, si) => (isLive(this.slots[si]) ? Math.min(0.45, dist(hi, si)) : 0.25);
      const straight = cost(0, 0) + cost(1, 1);
      const crossed = cost(0, 1) + cost(1, 0);
      if (crossed < straight) { assign[0] = 1; assign[1] = 0; }
      else { assign[0] = 0; assign[1] = 1; }
    }

    const out = [];
    for (let i = 0; i < n; i++) {
      const h = hands[i];
      if (!h?.lm || h.lm.length < 21) continue;
      const sl = this.slots[assign[i]];
      if (!isLive(sl) || dist(i, assign[i]) >= JUMP) this._resetSlot(sl);

      const lm = new Array(21);
      for (let j = 0; j < 21; j++) {
        const pt = h.lm[j];
        lm[j] = {
          x: sl.pts[j].x.filter(pt.x, t),
          y: sl.pts[j].y.filter(pt.y, t),
          z: sl.pts[j].z.filter(pt.z || 0, t),
        };
      }
      sl.wrist = { x: h.lm[0].x, y: h.lm[0].y };
      sl.t = t;
      out.push({ ...h, lm });
    }
    return out;
  }
}
