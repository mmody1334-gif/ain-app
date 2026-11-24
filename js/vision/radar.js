// وحدة الرادار الصوتي وبوابة منع تكرار النطق لصفحة المعاينة (Ain Spatial Radar & Audio Gate)
import { quantizeDistanceBand } from '../depth.js';
import { tts } from '../speech.js';

export const MIN_WARNING_INTERVAL_MS = 8000;
export const POCKET_DARK_MS = 2000;

export function colorForDist(d) {
  if (d < 0.95) return '#ff453a';
  if (d < 2.0) return '#f5a623';
  return '#30d158';
}

/** خطر قريب يقطع أي جملة فوراً؛ غيره ينتظر دوره ويُسقط لو تأخر أكثر من 3ث (لم يعد صحيحاً) */
export function radarSpeakOpt(band) {
  return band.id === 'danger' || band.id === 'occluded' ? { urgent: true } : { maxAgeMs: 3000 };
}

export const OCCLUDED_TEXT = 'انتبه، شيء قريب جداً من الكاميرا، المسافة غير مؤكدة';

/** فئة النطق: «مغطاة» فئة مستقلة حتى لا تُخلط مع خطر حقيقي ولا تُقال لها أرقام. */
function bandFor(target, prevId, hyst) {
  if (target.occluded) return { id: 'occluded', text: 'قريب جداً' };
  return quantizeDistanceBand(target.dist, prevId === 'occluded' ? null : prevId, hyst);
}

export function buildRadarWarningText(target, band) {
  if (target?.occluded || band?.id === 'occluded') return OCCLUDED_TEXT;
  if (!target || band.id === 'clear') {
    return 'المسار أمامك سالك';
  }
  let cleanLabel = String(target.label || 'عائق').replace(/\s+(يسار|يمين)$/, '');
  if (cleanLabel === 'مسار سالك') cleanLabel = 'عائق';
  const dirAr = target.dirAr || (target.dir === 'left' ? 'على يسارك' : target.dir === 'right' ? 'على يمينك' : 'أمامك');
  if (band.id === 'danger') {
    const z = target.zones || {};
    const alt = (z.left > (z.right ?? 0) + 0.4 && z.left > 1.6)
      ? '، اتجه يساراً'
      : ((z.right > (z.left ?? 0) + 0.4 && z.right > 1.6) ? '، اتجه يميناً' : '');
    return `توقف، ${cleanLabel} قريب جداً ${dirAr}${alt}`;
  }
  return `${cleanLabel} ${dirAr}، ${band.text}`;
}

/**
 * بوابة النطق الذكية للرادار:
 * 1) تنطق التحذير مرة واحدة فور رصد أول عائق.
 * 2) تفرض فاصلاً زمنياً لا يقل عن 8 ثوانٍ بين أي تحذيرين تلقائيين.
 * 3) لا تعيد النطق أبداً إلا إذا تغيّرت فئة المسافة (بهيستيريسيس ±0.3م) أو تغيّر الاتجاه فعلياً.
 * 4) تدعم كتم الصوت الفوري وتعليق النطق في وضع الجيب (الظلام).
 */
export class RadarSpeechGate {
  constructor(opt = {}) {
    this.minIntervalMs = opt.minIntervalMs ?? MIN_WARNING_INTERVAL_MS;
    this.pocketDarkMs = opt.pocketDarkMs ?? POCKET_DARK_MS;
    this.hysteresisM = opt.hysteresisM ?? 0.3;
    this.speakFn = opt.speakFn || ((text, speakOpt) => tts.speak(text, speakOpt));
    this.cancelFn = opt.cancelFn || (() => tts.cancel());
    this.isSpeakingFn = opt.isSpeakingFn || (() => tts.speaking);

    this.muted = false;
    this.reset();
  }

  reset() {
    this.hasSpoken = false;
    this.lastSpokenAt = -Infinity;
    this.lastBandId = null;
    this.lastDir = null;
    this.lastText = '';
    this.darkSince = null;
    this.isPocketMode = false;
    this.spokenCount = 0;
  }

  setMuted(flag) {
    this.muted = !!flag;
    if (this.muted) {
      this.cancelFn();
    }
    return this.muted;
  }

  update(target, explicitNowMs) {
    if (!target) return { spoke: false, reason: 'empty' };
    const nowMs = explicitNowMs !== undefined ? explicitNowMs : performance.now();
    const stampAfter = () => (explicitNowMs !== undefined ? explicitNowMs : performance.now());

    const isDark = !!target.dark || (target.light != null && target.light < 14);
    if (isDark) {
      if (this.darkSince === null) this.darkSince = nowMs;
      if (!this.isPocketMode && nowMs - this.darkSince >= this.pocketDarkMs) {
        this.isPocketMode = true;
      }
      return { spoke: false, reason: this.isPocketMode ? 'pocket' : 'dark', pocket: this.isPocketMode };
    }
    if (target.light == null || target.light >= 22) {
      this.darkSince = null;
      this.isPocketMode = false;
    }

    if (this.muted) {
      return { spoke: false, reason: 'muted', pocket: false };
    }

    const band = bandFor(target, this.lastBandId, this.hysteresisM);
    const dir = band.id === 'clear' ? 'center' : (target.dir || 'center');
    const text = buildRadarWarningText(target, band);

    if (!this.hasSpoken) {
      if (band.id === 'clear') {
        return { spoke: false, reason: 'initial-clear', bandId: band.id, dir };
      }
      this.hasSpoken = true;
      this.lastBandId = band.id;
      this.lastDir = dir;
      this.lastText = text;
      this.spokenCount++;
      this.speakFn(text, { cancel: band.id === 'danger' || band.id === 'occluded' });
      this.lastSpokenAt = stampAfter();
      return { spoke: true, text, bandId: band.id, dir };
    }

    const distChanged = band.id !== this.lastBandId;
    const dirChanged = band.id !== 'clear' && dir !== this.lastDir;
    if (!distChanged && !dirChanged) {
      return { spoke: false, reason: 'unchanged', bandId: band.id, dir };
    }

    if (nowMs - this.lastSpokenAt < this.minIntervalMs) {
      return { spoke: false, reason: 'cooldown', bandId: band.id, dir };
    }

    // بعد انقضاء 8 ثوانٍ كاملة تكون أي جملة سابقة قد انتهت؛ تمرير cancel: true يمنع تعلّق طابور النطق في كروم أندرويد
    this.lastBandId = band.id;
    this.lastDir = dir;
    this.lastText = text;
    this.spokenCount++;
    this.speakFn(text, radarSpeakOpt(band));
    this.lastSpokenAt = stampAfter();
    return { spoke: true, text, bandId: band.id, dir };
  }

  speakNow(target, explicitNowMs) {
    if (this.muted || !target) return { spoke: false, reason: 'muted' };
    const band = bandFor(target, this.lastBandId, this.hysteresisM);
    const dir = band.id === 'clear' ? 'center' : (target.dir || 'center');
    const text = buildRadarWarningText(target, band);
    this.hasSpoken = true;
    this.lastBandId = band.id;
    this.lastDir = dir;
    this.lastText = text;
    this.spokenCount++;
    this.speakFn(text, radarSpeakOpt(band));
    this.lastSpokenAt = explicitNowMs !== undefined ? explicitNowMs : performance.now();
    return { spoke: true, text, bandId: band.id, dir };
  }
}

/** مولّد نبضات السونار الاستريو بالمتصفح (WebAudio) مع اهتزاز لمسي اختياري */
export class SonarAudio {
  constructor() {
    this.audioCtx = null;
    this.pannerNode = null;
    this.timer = null;
    this.running = false;
    this.enabled = true;
    this.muted = false;
    this.enableVib = true;
    this.pocket = false;
    this.currentTarget = { dist: 2.5, hitX: 0.5, dir: 'center' };
    this.stableKey = '';
    this.stableSince = 0;
    this.pingCount = 0;
    this.lastFreq = 0;
    this.lastPan = 0;
  }

  _ensureContext() {
    if (!this.audioCtx && typeof window !== 'undefined') {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
          this.audioCtx = new Ctx();
          if (this.audioCtx.createStereoPanner) {
            this.pannerNode = this.audioCtx.createStereoPanner();
            this.pannerNode.connect(this.audioCtx.destination);
          }
        }
      } catch (_) {}
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  unlock() {
    if (!this.muted) this._ensureContext();
  }

  setTarget(target, pocket = false) {
    this.pocket = !!pocket || !!target?.dark;
    if (target) {
      this.currentTarget = target;
      const bandKey = `${Math.round((target.dist || 2.5) * 2)}:${target.dir || 'center'}`;
      if (bandKey !== this.stableKey) {
        this.stableKey = bandKey;
        this.stableSince = performance.now();
      }
    }
  }

  setMuted(flag) {
    this.muted = !!flag;
    if (this.muted) {
      clearTimeout(this.timer);
      this.timer = null;
      try { navigator.vibrate?.(0); } catch (_) {}
    } else if (this.running && this.enabled) {
      this._schedule();
    }
  }

  setEnabled(flag) {
    this.enabled = !!flag;
    if (!this.enabled) {
      clearTimeout(this.timer);
      this.timer = null;
    } else if (this.running && !this.muted) {
      this._schedule();
    }
  }

  start() {
    this.running = true;
    if (this.enabled && !this.muted) {
      this._schedule();
    }
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
    try { navigator.vibrate?.(0); } catch (_) {}
  }

  playPing(dist, panX = 0.5) {
    if (this.muted || !this.enabled || this.pocket) return false;
    const ctx = this._ensureContext();
    if (!ctx) return false;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const clampedDist = Math.max(0.3, Math.min(4.5, dist));
    const factor = (4.5 - clampedDist) / 4.2;
    const freq = 290 + factor * factor * 1020;

    osc.type = factor > 0.72 ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(freq, t);

    const panVal = Math.max(-1, Math.min(1, (panX - 0.5) * 2));
    if (this.pannerNode) {
      this.pannerNode.pan.setValueAtTime(panVal, t);
      osc.connect(gain);
      gain.connect(this.pannerNode);
    } else {
      osc.connect(gain);
      gain.connect(ctx.destination);
    }

    const calmFactor = (this.stableSince && performance.now() - this.stableSince > 4000) ? 0.55 : 1;
    const dur = 0.05 + (1 - factor) * 0.04;
    const vol = (0.14 + factor * 0.24) * calmFactor;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.start(t);
    osc.stop(t + dur + 0.01);

    this.pingCount++;
    this.lastFreq = Math.round(freq);
    this.lastPan = +panVal.toFixed(2);

    if (this.enableVib && clampedDist < 1.9 && typeof navigator !== 'undefined' && navigator.vibrate) {
      const vibDur = clampedDist < 0.85 ? [55, 45, 55] : Math.round(20 + factor * 38);
      try { navigator.vibrate(vibDur); } catch (_) {}
    }
    return true;
  }

  _schedule() {
    clearTimeout(this.timer);
    if (!this.running || !this.enabled || this.muted) return;

    if (!this.pocket) {
      const d = this.currentTarget?.dist ?? 2.5;
      const panX = this.currentTarget?.hitX ?? 0.5;
      this.playPing(d, panX);
      const clamped = Math.max(0.4, Math.min(4.0, d));
      const interval = Math.round(250 + Math.pow((clamped - 0.4) / 3.6, 1.4) * 750);
      this.timer = setTimeout(() => this._schedule(), interval);
    } else {
      this.timer = setTimeout(() => this._schedule(), 1000);
    }
  }
}

/** رسم طبقة الرادار ثلاثي المناطق على الكانفاس فوق الفيديو */
export function renderRadarOverlay(ctx, w, h, target, mirroredVideo = false) {
  ctx.clearRect(0, 0, w, h);
  if (!target) return;

  const cx = w * 0.5;
  const cy = h * 0.5;
  const rawHitX = target.hitX ?? 0.5;
  const visHitX = mirroredVideo ? (1 - rawHitX) : rawHitX;
  const hitX = visHitX * w;
  const hitY = (target.hitY ?? 0.5) * h;
  const d = target.dist ?? 2.5;
  const zones = target.zones || { left: 3.5, center: d, right: 3.5 };
  const visZones = mirroredVideo
    ? { left: zones.right, center: zones.center, right: zones.left }
    : zones;

  const topZoneY = 16;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(w * 0.35, topZoneY + 28);
  ctx.lineTo(w * 0.35, h - 24);
  ctx.moveTo(w * 0.65, topZoneY + 28);
  ctx.lineTo(w * 0.65, h - 24);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.lineWidth = 1.4;
  const rings = [
    { r: Math.min(w, h) * 0.13, col: 'rgba(255, 69, 58, 0.45)' },
    { r: Math.min(w, h) * 0.25, col: 'rgba(245, 166, 35, 0.38)' },
    { r: Math.min(w, h) * 0.36, col: 'rgba(48, 209, 88, 0.32)' },
  ];
  for (const rg of rings) {
    ctx.strokeStyle = rg.col;
    ctx.beginPath();
    ctx.arc(cx, cy + 8, rg.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  const zEntries = [
    { x: w * 0.175, name: 'يسار', val: visZones.left },
    { x: w * 0.50, name: 'أمامك', val: visZones.center },
    { x: w * 0.825, name: 'يمين', val: visZones.right },
  ];
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const z of zEntries) {
    const c = colorForDist(z.val);
    const pillW = Math.min(92, w * 0.28);
    ctx.fillStyle = 'rgba(10, 12, 24, 0.82)';
    ctx.fillRect(z.x - pillW / 2, topZoneY, pillW, 24);
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(z.x - pillW / 2, topZoneY, pillW, 24);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(target.occluded ? `${z.name}: قريب جداً` : `${z.name}: ${z.val.toFixed(1)}م`, z.x, topZoneY + 16);
  }

  if (target.dark) {
    ctx.restore();
    return;
  }

  if (target.occluded) {
    const msg = 'قريب جداً · المسافة غير مؤكدة';
    ctx.font = 'bold 15px system-ui, sans-serif';
    const tw = Math.min(w - 20, ctx.measureText(msg).width + 24);
    ctx.fillStyle = 'rgba(10, 12, 24, 0.88)';
    ctx.fillRect(cx - tw / 2, cy - 18, tw, 34);
    ctx.strokeStyle = '#ff453a';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - tw / 2, cy - 18, tw, 34);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(msg, cx, cy + 5);
    ctx.restore();
    return;
  }

  const activeColor = colorForDist(d);
  const clampedHitY = Math.max(topZoneY + 38, Math.min(h - 36, hitY));
  const grad = ctx.createLinearGradient(cx, h - 18, hitX, clampedHitY);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
  grad.addColorStop(1, activeColor);
  ctx.lineWidth = d < 1.0 ? 4 : 2.6;
  ctx.strokeStyle = grad;
  ctx.beginPath();
  ctx.moveTo(cx, h - 18);
  ctx.lineTo(hitX, clampedHitY);
  ctx.stroke();

  ctx.fillStyle = activeColor;
  ctx.beginPath();
  ctx.arc(hitX, clampedHitY, d < 1.0 ? 9 : 6.5, 0, Math.PI * 2);
  ctx.fill();

  const boxSize = 24;
  ctx.strokeStyle = activeColor;
  ctx.lineWidth = 2.2;
  ctx.strokeRect(hitX - boxSize / 2, clampedHitY - boxSize / 2, boxSize, boxSize);

  const labelText = `${target.label || 'عائق'} · ${d.toFixed(1)} م`;
  ctx.font = 'bold 13px system-ui, sans-serif';
  const textW = Math.min(w - 20, ctx.measureText(labelText).width + 18);
  const labelX = Math.max(textW / 2 + 8, Math.min(w - textW / 2 - 8, hitX));
  const labelY = Math.max(topZoneY + 52, clampedHitY - 12);

  ctx.fillStyle = 'rgba(10, 12, 24, 0.86)';
  ctx.fillRect(labelX - textW / 2, labelY - 22, textW, 24);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(labelText, labelX, labelY - 6);
  ctx.restore();
}
