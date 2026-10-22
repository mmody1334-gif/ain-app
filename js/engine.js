// المحرّك: يربط تتبّع اليد بالتعرّف. يستقبل نقاط اليد من أي كاشف (MediaPipe أو كاشف تجريبي للاختبار)
// ويُخرج أحداثاً: إشارة ثابتة (تثبيت اليد)، إشارة متحركة (DTW)، تمريرات وتلويح وأشكال جاهزة.

import { SignClassifier } from './classifier.js';
import { HandTracker, MotionSegmenter, MotionBank, segmentToSeq, detectBuiltinMotion, detectBuiltinShape, fingerStates } from './motion.js';
import { POSE_LEN, mirrorPose } from './features.js';

/** نموذج الإشارة المخزَّنة:
 *  { id, word, aliases?, kind:'static'|'motion'|'builtin', rule?, samples?, takes?, ref?, anim?, source, created }
 *  - static : عيّنات [63 نقطة + موضع المعصم x,y] تُدرَّب في المتصفح
 *  - motion : لقطات DTW (takes) + رسم متحرك للأفاتار (anim)
 *  - builtin: ربط كلمة بشكل/حركة جاهزة (rule = shape_fist | swipe_left | wave ...) بلا تدريب
 */

export class Engine {
  constructor(opt = {}) {
    this.tracker = new HandTracker();
    this.segmenter = new MotionSegmenter();
    this.clf = null;
    this.bank = new MotionBank();
    this.signs = [];
    this.byRule = new Map();       // rule → sign
    this.byId = new Map();
    this.holdSec = opt.holdSec ?? 0.6;
    this.graceSec = 0.35;
    this.staticSpeedMax = opt.staticSpeedMax ?? 1.9;
    this.relockSec = opt.relockSec ?? 0.5;
    this.enableStatic = true;
    this.enableMotion = true;
    this.enableShapes = true;
    this._resetHold();
    this.lock = null; this.lockSince = 0; this.lastSeen = -1;
    this.motionUntil = 0;      // بعد أي حركة: مهلة قصيرة قبل قبول الوضعيات الثابتة
    this.staticUntil = 0;      // بعد نطق إشارة: مهلة قصيرة تمنع تكرارها من اهتزاز بسيط
    this.lockOther = null;     // إشارة مختلفة ظهرت للتو: لا نلغي القفل إلا إذا ثبتت
    this.lockLostSince = 0;
    this.lastPred = null;
    this.ready = false;
    this.trainInfo = null;
  }

  _resetHold() { this.hold = { key: null, since: 0, lastGood: 0, sign: null, kind: null, id: null, conf: 0 }; }

  /** تحديث الجداول فقط (كلمة ↔ إشارة جاهزة) بلا إعادة تدريب. */
  refreshMaps(signs) {
    this.signs = signs.slice();
    this.byRule.clear(); this.byId.clear();
    for (const s of this.signs) { this.byId.set(s.id, s); if (s.kind === 'builtin' && s.rule) this.byRule.set(s.rule, s); }
  }

  /** يحدّث قائمة الإشارات ويُعيد بناء النموذج. */
  async setSigns(signs, onProgress) {
    this.refreshMaps(signs);

    const statics = this.signs.filter((s) => s.kind === 'static' && s.samples && s.samples.length >= 8);
    const data = statics.map((s) => {
      const samples = s.samples.map((a) => ({ p: Float32Array.from(a.slice(0, POSE_LEN)), w: [a[POSE_LEN] ?? 0.5, a[POSE_LEN + 1] ?? 0.5] }));
      // إشارات المشروع الأصلية مسجّلة بيد واحدة؛ نضيف نسخها المعكوسة حتى تعمل
      // باليد اليمنى أو اليسرى. إشارات المستخدم تبقى كما سجّلها هو.
      if (s.source === 'starter') samples.push(...samples.map((x) => ({ p: mirrorPose(x.p), w: x.w })));
      return { label: s.id, samples };
    });
    this.clf = null; this.trainData = data;
    // «بوابة الأصابع»: أي إصبع كان مفروداً دائماً (أو مطوياً دائماً) في تسجيلاتك، فظهوره بالعكس يرفض الإشارة.
    // تحلّ الخلط بين إشارتين تختلفان في إصبع واحد، فالمصنِّف وحده قد يتساهل فيها.
    this.sig = new Map();
    for (const g of data) {
      const cnt = Array.from({ length: 5 }, () => ({ E: 0, C: 0, H: 0 }));
      for (const sm of g.samples) fingerStates(sm.p).forEach((st, i) => cnt[i][st]++);
      const n = g.samples.length;
      this.sig.set(g.label, cnt.map((c) => (c.C / n <= 0.03 && c.E / n >= 0.8 ? 'E' : c.E / n <= 0.03 && c.C / n >= 0.8 ? 'C' : null)));
    }
    if (data.length >= 1) {
      // «none» غير مطلوبة: يُرفض أي شيء بعيد عن العيّنات بحدّ أقرب جار
      this.clf = await SignClassifier.train(data, { epochs: data.length > 6 ? 50 : 40, onProgress });
    }
    this.bank = new MotionBank();
    for (const s of this.signs) if (s.kind === 'motion' && s.takes && s.takes.length >= 2) this.bank.setSign(s.id, s.takes);
    this.ready = true;
    this.reset();
    return this.clf;
  }

  reset() {
    this.tracker.reset(); this.segmenter.reset(); this._resetHold();
    this.lock = null; this.motionUntil = 0; this.staticUntil = 0; this.lockOther = null; this.lockLostSince = 0;
  }

  _signFor(kind, id) {
    if (kind === 'static' || kind === 'motion') return this.byId.get(id) || null;
    return this.byRule.get(id) || null;
  }

  /**
   * @param {number} t  زمن بالثواني
   * @param {Array<{x,y,z}>|null} lm  21 نقطة أو null عند غياب اليد
   * @param {number} aspect  عرض/ارتفاع الصورة
   */
  process(t, lm, aspect) {
    const out = { t, hand: false, frame: null, speed: 0, pred: null, shape: null, hold: null, events: [], moving: false };
    const frame = this.tracker.update(t, lm, aspect);   // lm=null يُحصي غياب اليد ويعيد ضبط التتبّع
    if (!frame) {
      if (this.hold.key) this._resetHold();
      if (t - this.lastSeen > this.relockSec) this.lock = null;
      const seg = this.segmenter.push(null, t);
      if (seg) this._onSegment(seg, out);
      return out;
    }
    this.lastSeen = t;
    out.hand = true; out.frame = frame; out.speed = frame.speed;

    // ----- حركة -----
    const seg = this.enableMotion ? this.segmenter.push(frame, t) : null;
    out.moving = this.segmenter.isActive;
    if (seg) this._onSegment(seg, out);

    // ----- ثبات -----
    if (!out.moving && frame.speed < this.staticSpeedMax && t >= (this.motionUntil || 0) && t >= (this.staticUntil || 0)) this._static(t, frame, out);
    else if (this.hold.key) { this._resetHold(); }
    out.hold = this.hold.key ? { key: this.hold.key, progress: Math.min(1, (t - this.hold.since) / this.holdSec), sign: this.hold.sign, id: this.hold.id } : null;
    return out;
  }

  _static(t, frame, out) {
    let cand = null;
    if (this.enableStatic && this.clf) {
      const pr = this.clf.predict(frame.p, frame.w);
      out.pred = pr; this.lastPred = pr;
      if (pr.accepted && pr.label && pr.label !== 'none' && this._fingerGate(pr.label, frame.p, frame.ext, frame.tdist)) {
        const s = this.byId.get(pr.label);
        if (s) cand = { key: 'sign:' + s.id, kind: 'static', id: s.id, sign: s, conf: pr.prob };
      }
    }
    if (!cand && this.enableShapes) {
      const sh = detectBuiltinShape(frame.p, frame.ext, frame.tdist);
      out.shape = sh;
      if (sh) cand = { key: 'builtin:' + sh.id, kind: 'shape', id: sh.id, sign: this.byRule.get(sh.id) || null, conf: sh.conf ?? 1 };
    }
    const h = this.hold;
    if (cand) {
      if (h.key === cand.key) { h.lastGood = t; h.conf = 0.8 * h.conf + 0.2 * cand.conf; }
      else { this.hold = { key: cand.key, since: t, lastGood: t, sign: cand.sign, kind: cand.kind, id: cand.id, conf: cand.conf }; }
    } else if (h.key && t - h.lastGood > this.graceSec) {
      this._resetHold();
    }
    const hh = this.hold;
    if (hh.key && t - hh.since >= this.holdSec && this.lock !== hh.key) {
      this.lock = hh.key;
      this.staticUntil = t + 0.4;
      this.lockOther = null; this.lockLostSince = 0;
      out.events.push({ type: hh.kind === 'shape' ? 'shape' : 'static', key: hh.key, id: hh.id, sign: hh.sign, conf: hh.conf, t });
    }
    // لا نلغي قفل الإشارة إلا إذا ظهرت إشارة أخرى وثبتت، أو غابت اليد فعلاً.
    // إلغاء القفل بإطار واحد كان يسمح بتكرار الكلمة نفسها من اهتزاز بسيط.
    if (cand && this.lock && cand.key !== this.lock) {
      if (!this.lockOther || this.lockOther.key !== cand.key) this.lockOther = { key: cand.key, since: t };
      else if (t - this.lockOther.since > 0.35) this.lock = null;
    } else this.lockOther = null;
    if (!cand && this.lock) {
      if (!this.lockLostSince) this.lockLostSince = t;
      else if (t - this.lockLostSince > 0.35) this.lock = null;
    } else this.lockLostSince = 0;
  }

  _fingerGate(label, p, ext, tdist) {
    const sig = this.sig?.get(label);
    if (!sig) return true;
    const st = fingerStates(p, ext, tdist);
    for (let i = 0; i < 5; i++) if (sig[i] && st[i] !== 'H' && st[i] !== sig[i]) return false;
    return true;
  }

  _onSegment(seg, out) {
    // 1) إشارات متحركة مدرَّبة
    if (this.bank.signs.size) {
      const seq = segmentToSeq(seg.frames);
      const r = this.bank.classify(seq);
      out.motionResult = r;
      if (r.accepted) {
        const s = this.byId.get(r.label);
        out.events.push({ type: 'motion', key: 'sign:' + r.label, id: r.label, sign: s, conf: Math.max(0, 1 - r.dist / Math.max(1e-6, r.thr)), t: out.t });
        this._resetHold(); this.lock = null; this.motionUntil = out.t + 0.7;
        return;
      }
    }
    // 2) تمرير/تلويح جاهز
    const b = detectBuiltinMotion(seg);
    out.motionBuiltin = b;
    if (b) {
      out.events.push({ type: 'swipe', key: 'builtin:' + b.id, id: b.id, sign: this.byRule.get(b.id) || null, conf: 1, t: out.t });
      this._resetHold(); this.lock = null; this.motionUntil = out.t + 0.7;
    }
  }
}
