// المحرّك: يربط تتبّع اليد بالتعرّف. يستقبل نقاط اليد من أي كاشف (MediaPipe أو كاشف تجريبي للاختبار)
// ويُخرج أحداثاً: إشارة ثابتة (تثبيت اليد)، إشارة متحركة (DTW)، تمريرات وتلويح وأشكال جاهزة.

import { SignClassifier } from './classifier.js';
import { PairModel } from './pairmodel.js';
import { HandTracker, MotionSegmenter, MotionBank, segmentToSeq, detectBuiltinMotion, detectBuiltinShape, fingerStates, BUILTIN_SHAPES } from './motion.js';
import { POSE_LEN, FEATURE_LEN, FEATURE_LEN2, pairToFeatures, mirrorPose, bodyAnchor, wristLocation } from './features.js';

/** نموذج الإشارة المخزَّنة:
 *  { id, word, aliases?, kind:'static'|'motion'|'builtin', rule?, samples?, samples2?, hands?, takes?, ref?, anim?, source, created }
 *  - static : عيّنات [63 نقطة + موضع المعصم x,y] تُدرَّب في المتصفح
 *  - static hands:2 : عيّنات samples2 = [pose1(63), pose2(63), wi1x,wi1y,wi2x,wi2y, size1,size2]
 *  - motion : لقطات DTW (takes) + رسم متحرك للأفاتار (anim)
 *  - builtin: ربط كلمة بشكل/حركة جاهزة (rule = shape_fist | swipe_left | wave ...) بلا تدريب
 */

/** تطبيع مدخلات الكاشف: مصفوفة 21 نقطة قديمة، أو [{lm, hand}] ليدين. */
export function normalizeHands(input) {
  if (!input) return [];
  if (Array.isArray(input) && input.length === 21 && input[0] && typeof input[0].x === 'number') return [{ lm: input, hand: null }];
  if (Array.isArray(input) && input.length && input[0] && Array.isArray(input[0].lm)) return input.slice(0, 2);
  if (Array.isArray(input) && input.length && Array.isArray(input[0])) return input.slice(0, 2).map((lm) => ({ lm, hand: null }));
  return [];
}

export class Engine {
  constructor(opt = {}) {
    this.tracker = new HandTracker();
    this.tracker2 = new HandTracker();
    // «خانتان» ثابتتان لليدين: كل يد تبقى في خانتها ما دامت قريبة من موضعها السابق،
    // لأن MediaPipe لا يضمن ترتيب اليدين بين الإطارات.
    this.slots = [{ tracker: this.tracker, w: null, t: -1, hand: null }, { tracker: this.tracker2, w: null, t: -1, hand: null }];
    this.motionSlot = 0;
    this.segmenter = new MotionSegmenter();
    this.clf = null;
    this.clf2 = null;
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

  /** يحدّث قائمة الإشارات ويُعيد بناء النموذج. cached = نموذج محفوظ صالح لنفس البيانات. */
  async setSigns(signs, onProgress, cached = null) {
    this.refreshMaps(signs);

    const statics1 = this.signs.filter((s) => s.kind === 'static' && (s.hands || 1) !== 2 && s.samples && s.samples.length >= 8);
    const data1 = statics1.map((s) => {
      const samples = s.samples.map((a) => ({ p: Float32Array.from(a.slice(0, POSE_LEN)), w: [a[POSE_LEN] ?? 0.5, a[POSE_LEN + 1] ?? 0.5] }));
      // إشارات المشروع الأصلية مسجّلة بيد واحدة؛ نضيف نسخها المعكوسة حتى تعمل
      // باليد اليمنى أو اليسرى. إشارات المستخدم تبقى كما سجّلها هو.
      if (s.source === 'starter') samples.push(...samples.map((x) => ({ p: mirrorPose(x.p), w: x.w })));
      return { label: s.id, samples };
    });
    const statics2 = this.signs.filter((s) => s.kind === 'static' && s.hands === 2 && s.samples2 && s.samples2.length >= 8);
    const data2 = statics2.map((s) => ({
      label: s.id,
      samples: s.samples2.map((a) => {
        const p1 = Float32Array.from(a.slice(0, POSE_LEN));
        const p2 = Float32Array.from(a.slice(POSE_LEN, POSE_LEN * 2));
        const f1 = { p: p1, w: [0, 0], wi: [a[126] ?? 0.5, a[127] ?? 0.5], size: a[130] || 0.18 };
        const f2 = { p: p2, w: [0, 0], wi: [a[128] ?? 0.5, a[129] ?? 0.5], size: a[131] || 0.18 };
        return pairToFeatures(f1, f2);
      }),
    }));
    this.clf = null; this.clf2 = null;
    this.trainData = data1; this.trainData2 = data2;
    // «بوابة الأصابع»: أي إصبع كان مفروداً دائماً (أو مطوياً دائماً) في تسجيلاتك، فظهوره بالعكس يرفض الإشارة.
    // تحلّ الخلط بين إشارتين تختلفان في إصبع واحد، فالمصنِّف وحده قد يتساهل فيها.
    this.sig = new Map();
    for (const g of data1) {
      const cnt = Array.from({ length: 5 }, () => ({ E: 0, C: 0, H: 0 }));
      for (const sm of g.samples) fingerStates(sm.p).forEach((st, i) => cnt[i][st]++);
      const n = g.samples.length;
      this.sig.set(g.label, cnt.map((c) => (c.C / n <= 0.03 && c.E / n >= 0.8 ? 'E' : c.E / n <= 0.03 && c.C / n >= 0.8 ? 'C' : null)));
    }
    // أي شكل جاهز يطابق بصمة إشارة مسجّلة لا يُستعمل كبديل: الإشارة المسجّلة أولى،
    // وإلا ظهر «واحد» لشخص يشير بالسبابة ضمن إشارته «أنت».
    this.shapeConflict = new Set();
    for (const sh of BUILTIN_SHAPES) {
      for (const g of data1) {
        const sig = this.sig.get(g.label);
        if (!sig) continue;
        let match = true;
        for (let i = 0; i < 5; i++) {
          if (sh.pattern[i] !== '?' && sig[i] && sig[i] !== sh.pattern[i]) { match = false; break; }
        }
        if (match) { this.shapeConflict.add(sh.id); break; }
      }
    }
    let loaded1 = false, loaded2 = false;
    if (data1.length >= 1) {
      const c1 = cached?.one || (cached?.W1 ? cached : null);
      const sameLabels = c1 && Array.isArray(c1.classes) && c1.classes.length === data1.length &&
        c1.classes.every((c, i) => c === data1[i].label);
      if (c1 && sameLabels && c1.D === FEATURE_LEN) {
        try {
          this.clf = SignClassifier.fromJSON(c1);
          this.clf.attachReference(data1);
          loaded1 = true;
          onProgress?.(1);
        } catch (e) { this.clf = null; }
      }
      if (!loaded1) {
        // «none» غير مطلوبة: يُرفض أي شيء بعيد عن العيّنات بحدّ أقرب جار
        const many = data1.length > 12;
        this.clf = await SignClassifier.train(data1, {
          epochs: many ? 32 : data1.length > 6 ? 50 : 40,
          hidden: many ? 64 : 48,
          perClass: many ? 90 : 110,
          onProgress,
        });
      }
    }
    if (data2.length >= 1) {
      const c2 = cached?.two;
      const same2 = c2 && Array.isArray(c2.classes) && c2.classes.length === data2.length &&
        c2.classes.every((c, i) => c === data2[i].label);
      if (c2 && same2 && (c2.D === FEATURE_LEN2 || !c2.D)) {
        try { this.clf2 = PairModel.fromJSON(c2); loaded2 = true; } catch (e) { this.clf2 = null; }
      }
      if (!this.clf2) this.clf2 = PairModel.train(data2);
      onProgress?.(1);
    }
    this.trainInfo = loaded1 || loaded2 ? 'cache' : data1.length || data2.length ? 'trained' : 'empty';
    this.modelParts = { one: loaded1, two: loaded2 };
    this.bank = new MotionBank();
    for (const s of this.signs) if (s.kind === 'motion' && s.takes && s.takes.length >= 2) this.bank.setSign(s.id, s.takes);
    this.ready = true;
    this.reset();
    return this.clf;
  }

  reset() {
    this.tracker.reset(); this.tracker2.reset(); this.segmenter.reset(); this._resetHold();
    if (this.slots) for (const sl of this.slots) { sl.w = null; sl.t = -1; sl.hand = null; }
    this.motionSlot = 0;
    this.lock = null; this.motionUntil = 0; this.staticUntil = 0; this.lockOther = null; this.lockLostSince = 0;
  }

  _signFor(kind, id) {
    if (kind === 'static' || kind === 'motion') return this.byId.get(id) || null;
    return this.byRule.get(id) || null;
  }

  /**
   * @param {number} t  زمن بالثواني
   * @param {Array<{x,y,z}>|Array<{lm:Array}>|null} hands  يد واحدة (صيغة قديمة) أو يدان
   * @param {number} aspect  عرض/ارتفاع الصورة
   */
  process(t, hands, aspect, pose = null) {
    const out = { t, hand: false, frame: null, frames: [], hands: 0, speed: 0, pred: null, shape: null, hold: null, events: [], moving: false, body: null };
    const list = normalizeHands(hands);
    const frames = this._trackHands(t, list, aspect);
    if (!frames.length) {
      if (this.hold.key) this._resetHold();
      if (t - this.lastSeen > this.relockSec) this.lock = null;
      const seg = this.segmenter.push(null, t);
      if (seg) this._onSegment(seg, out);
      return out;
    }
    this.lastSeen = t;
    const anchor = pose ? bodyAnchor(pose, aspect) : null;
    out.body = anchor;
    if (anchor) for (const f of frames) f.loc = wristLocation(f.wi, anchor);
    const frame = frames[0];
    out.hand = true; out.frame = frame; out.frames = frames; out.hands = frames.length; out.speed = frame.speed;

    // ----- حركة: تُقاس على اليد التي تتحرك (لا على أول يد في قائمة الكاشف) -----
    const mf = frame.slot === this.motionSlot ? frame : null;   // إن غابت اليد المتابَعة يُنهى مقطعها
    const seg = this.enableMotion ? this.segmenter.push(mf, t) : null;
    out.moving = this.segmenter.isActive;
    if (seg) this._onSegment(seg, out);

    // ----- ثبات -----
    if (!out.moving && frame.speed < this.staticSpeedMax && t >= (this.motionUntil || 0) && t >= (this.staticUntil || 0)) this._static(t, frames, out);
    else if (this.hold.key) { this._resetHold(); }
    out.hold = this.hold.key ? { key: this.hold.key, progress: Math.min(1, (t - this.hold.since) / this.holdSec), sign: this.hold.sign, id: this.hold.id } : null;
    return out;
  }

  /**
   * يربط كل يد بخانتها (الأقرب لموضعها السابق، ثم تطابق اليمين/اليسار)، ويحدّث متتبّعها،
   * ويعيد الإطارات مرتّبة: اليد المتحركة (أو المتابَعة في الحركة) أولاً.
   */
  _trackHands(t, list, aspect) {
    const STALE = 0.4;
    const live = (sl) => sl.w && t - sl.t <= STALE;
    const assign = [-1, -1];   // خانة كل يد واردة
    if (list.length === 1) {
      const w = list[0].lm[0];
      let best = -1, bestD = Infinity;
      for (let k = 0; k < 2; k++) {
        const sl = this.slots[k];
        if (!live(sl)) continue;
        const d = Math.hypot(w.x - sl.w.x, w.y - sl.w.y);
        if (d < bestD && d < 0.3) { bestD = d; best = k; }
      }
      if (best < 0) {
        // يد جديدة (أو عادت بعيداً عن موضعها): خانة غير مشغولة، ويُفضَّل تطابق اليمين/اليسار
        const free = [0, 1].filter((k) => !live(this.slots[k]));
        const byHand = free.find((k) => list[0].hand && this.slots[k].hand === list[0].hand);
        best = byHand ?? (free.includes(this.motionSlot) ? this.motionSlot : free[0] ?? this.motionSlot);
      }
      assign[0] = best;
    } else if (list.length >= 2) {
      const w0 = list[0].lm[0], w1 = list[1].lm[0];
      const d = (w, k) => (live(this.slots[k]) ? Math.hypot(w.x - this.slots[k].w.x, w.y - this.slots[k].w.y) : 0.5);
      let straight = d(w0, 0) + d(w1, 1), crossed = d(w0, 1) + d(w1, 0);
      if (!live(this.slots[0]) && !live(this.slots[1]) && list[0].hand && list[1].hand) {
        straight = list[0].hand === this.slots[0].hand ? 0 : list[1].hand === this.slots[0].hand ? 1 : 0.5;
        crossed = 1 - straight;
      }
      if (crossed < straight) { assign[0] = 1; assign[1] = 0; } else { assign[0] = 0; assign[1] = 1; }
    }
    const bySlot = [null, null];
    for (let i = 0; i < Math.min(2, list.length); i++) {
      const k = assign[i], sl = this.slots[k];
      if (sl.w && t - sl.t > STALE) sl.tracker.reset();
      const f = sl.tracker.update(t, list[i].lm, aspect);
      sl.w = { x: list[i].lm[0].x, y: list[i].lm[0].y }; sl.t = t;
      if (list[i].hand) sl.hand = list[i].hand;
      if (f) { f.slot = k; bySlot[k] = f; }
    }
    // اليد التي تتابعها الحركة: لا نبدّلها وسط مقطع حركة؛ خارج الحركة نتبع الأسرع
    if (!this.segmenter.isActive) {
      let next = this.motionSlot;
      if (!bySlot[next]) next = bySlot[0] ? 0 : bySlot[1] ? 1 : next;
      else {
        const other = bySlot[1 - next];
        if (other && other.speed > Math.max(this.segmenter.vOn * 0.6, bySlot[next].speed * 1.5)) next = 1 - next;
      }
      if (next !== this.motionSlot) { this.segmenter.reset(); this.motionSlot = next; }
    }
    const frames = [];
    if (bySlot[this.motionSlot]) frames.push(bySlot[this.motionSlot]);
    const o = bySlot[1 - this.motionSlot];
    if (o) frames.push(o);
    return frames;
  }

  _static(t, frames, out) {
    let cand = null, locBlocked = false;
    if (this.enableStatic && this.clf) {
      // نجرب اليدين معاً لإشارات اليد الواحدة، ونأخذ أوثق نتيجة
      for (const f of frames) {
        const pr = this.clf.predict(f.p, f.w);
        out.pred = pr; this.lastPred = pr;
        let frameCand = null;
        if (pr.accepted && pr.label && pr.label !== 'none' && this._fingerGate(pr.label, f.p, f.ext, f.tdist)) {
          const s = this.byId.get(pr.label);
          if (s) {
            // إشارات حسّاسة للموقع: نرفضها إذا كانت اليد بعيدة عن موضعها المسجّل بالنسبة للجسم
            if (!s.loc || !f.loc || Math.hypot(f.loc.x - s.loc.x, f.loc.y - s.loc.y) <= s.loc.r) {
              frameCand = { key: 'sign:' + s.id, kind: 'static', id: s.id, sign: s, conf: pr.prob };
            } else locBlocked = true;
          }
        }
        // قد تكون الإشارة الصحيحة في طبقة أخرى بنفس شكل اليد لكن بموقع جسم مختلف،
        // أو يرفض المصنّف التعادل بين إشارتين متطابقتين في الشكل ومختلفتين في الموقع.
        if (!frameCand && f.loc && pr.probs && pr.probs.length && pr.dist <= this.clf.nnThr) {
          for (let c = 0; c < pr.probs.length; c++) {
            const alt = this.byId.get(this.clf.classes[c]);
            if (!alt || !alt.loc || pr.probs[c] < 0.22) continue;
            if (Math.hypot(f.loc.x - alt.loc.x, f.loc.y - alt.loc.y) > alt.loc.r) continue;
            if (!this._fingerGate(alt.id, f.p, f.ext, f.tdist)) continue;
            const cc = { key: 'sign:' + alt.id, kind: 'static', id: alt.id, sign: alt, conf: pr.probs[c] };
            if (!frameCand || cc.conf > frameCand.conf) frameCand = cc;
          }
        }
        if (frameCand && (!cand || frameCand.conf > cand.conf)) cand = frameCand;
      }
    }
    // إشارات اليدين: نجرّب الترتيبين حتى لا يهم ترتيب الكاشف
    if (this.enableStatic && this.clf2 && frames.length >= 2) {
      for (const pair of [[frames[0], frames[1]], [frames[1], frames[0]]]) {
        const pr = this.clf2.predict(pairToFeatures(pair[0], pair[1]));
        out.pred2 = pr;
        if (pr.accepted && pr.label) {
          const s = this.byId.get(pr.label);
          if (s) { cand = { key: 'sign:' + s.id, kind: 'static', id: s.id, sign: s, conf: pr.prob }; break; }
        }
      }
    }
    if (!cand && this.enableShapes && !locBlocked && frames.length < 2) {
      for (const f of frames) {
        const sh = detectBuiltinShape(f.p, f.ext, f.tdist);
        out.shape = sh;
        if (sh && !this.shapeConflict.has(sh.id)) { cand = { key: 'builtin:' + sh.id, kind: 'shape', id: sh.id, sign: this.byRule.get(sh.id) || null, conf: sh.conf ?? 1 }; break; }
      }
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
