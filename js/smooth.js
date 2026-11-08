// مرشح التنعيم التكيفي One-Euro Filter لمعالم اليد والأصابع
// يزيل التشتت والاهتزاز عند ثبات اليد، مع استجابة لحظية بلا تأخير عند الحركة السريعة.

class OneEuroValue {
  constructor(minCutoff = 1.2, beta = 2.0, dCutoff = 1.0) {
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

  filter(x, t) {
    if (this.tPrev === null || this.xPrev === null) {
      this.tPrev = t;
      this.xPrev = x;
      this.dxPrev = 0;
      return x;
    }

    const dt = Math.max(1e-4, t - this.tPrev);
    this.tPrev = t;

    // 1. حساب المشتقة وتنعيمها
    const dx = (x - this.xPrev) / dt;
    const aD = this._alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = dxHat;

    // 2. ضبط تردد القطع تكيفياً حسب السرعة
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this._alpha(cutoff, dt);

    // 3. تنعيم الإشارة
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    return xHat;
  }

  _alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }
}

export class HandSmoothFilter {
  constructor(minCutoff = 1.2, beta = 2.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.slots = [this._createSlot(), this._createSlot()];
    this.lastT = [0, 0];
  }

  _createSlot() {
    const pts = [];
    for (let i = 0; i < 21; i++) {
      pts.push({
        x: new OneEuroValue(this.minCutoff, this.beta),
        y: new OneEuroValue(this.minCutoff, this.beta),
        z: new OneEuroValue(this.minCutoff, this.beta),
      });
    }
    return pts;
  }

  reset() {
    for (const slot of this.slots) {
      for (const pt of slot) {
        pt.x.reset();
        pt.y.reset();
        pt.z.reset();
      }
    }
    this.lastT = [0, 0];
  }

  smooth(hands, t) {
    if (!hands || !hands.length) {
      this.reset();
      return hands;
    }

    const isList = hands[0]?.lm;
    const rawHands = isList ? hands : (Array.isArray(hands) && hands.length === 21 ? [{ lm: hands }] : []);

    const outHands = [];

    for (let hIdx = 0; hIdx < rawHands.length && hIdx < 2; hIdx++) {
      const h = rawHands[hIdx];
      const lm = h.lm;
      if (!lm || lm.length < 21) continue;

      if (t - this.lastT[hIdx] > 0.25) {
        for (const pt of this.slots[hIdx]) {
          pt.x.reset(); pt.y.reset(); pt.z.reset();
        }
      }
      this.lastT[hIdx] = t;

      const slot = this.slots[hIdx];
      const smoothedLm = new Array(21);

      for (let i = 0; i < 21; i++) {
        const rawPt = lm[i];
        smoothedLm[i] = {
          x: slot[i].x.filter(rawPt.x, t),
          y: slot[i].y.filter(rawPt.y, t),
          z: slot[i].z.filter(rawPt.z || 0, t),
        };
      }

      outHands.push({
        ...h,
        lm: smoothedLm,
      });
    }

    return isList ? outHands : (outHands[0]?.lm || hands);
  }
}
