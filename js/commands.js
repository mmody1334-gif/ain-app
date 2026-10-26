// أوامر: جمل المواقف، طوارئ، وإعدادات التحكم بالحاسوب (يُصدَّر إلى برنامج بايثون).
import { BUILTIN_NAMES } from './names.js';

// كلمات الطوارئ العاجلة: أي منها ينطقها التطبيق بأعلى صوت ويهتز فورًا
export const URGENT_WORDS = new Set(['مساعد', 'طبيب', 'طبيباً', 'دكتور', 'ماء', 'ماءً', 'إسعاف', 'نجدة', 'مساعدة']);

export const ACTIONS = [
  { id: 'right', label: 'السهم → التالي (الشريحة التالية)' },
  { id: 'left', label: 'السهم ← السابق (الشريحة السابقة)' },
  { id: 'up', label: 'السهم للأعلى' },
  { id: 'down', label: 'السهم للأسفل' },
  { id: 'pagedown', label: 'Page Down' },
  { id: 'pageup', label: 'Page Up' },
  { id: 'space', label: 'مسافة (تشغيل/إيقاف مؤقت)' },
  { id: 'enter', label: 'Enter' },
  { id: 'esc', label: 'Esc (خروج)' },
  { id: 'f5', label: 'F5 — بدء عرض الشرائح' },
  { id: 'shift_f5', label: 'Shift+F5 — العرض من الشريحة الحالية' },
  { id: 'home', label: 'Home — أول شريحة' },
  { id: 'end', label: 'End — آخر شريحة' },
  { id: 'b', label: 'B — شاشة سوداء' },
  { id: 'w', label: 'W — شاشة بيضاء' },
  { id: 'volume_up', label: 'رفع الصوت' },
  { id: 'volume_down', label: 'خفض الصوت' },
  { id: 'mute', label: 'كتم الصوت' },
  { id: 'play_pause', label: 'تشغيل/إيقاف الوسائط' },
  { id: 'next_track', label: 'المقطع التالي' },
  { id: 'prev_track', label: 'المقطع السابق' },
  { id: 'disarm', label: 'قفل التحكم (إلغاء التسليح)' },
];

export const PHRASE_PRESETS = [
  'أحتاج مساعدة', 'أين دورة المياه؟', 'شكراً لك', 'أنا لا أسمع، تحدّث ببطء وأنت تنظر إليّ', 'من فضلك اكتب لي', 'أريد ماءً', 'أحتاج طبيباً',
];

export const DEFAULT_COMMANDS = {
  phrases: [],
  sos: { enabled: false, key: null, phone: '', message: 'أحتاج مساعدة عاجلة. أنا أصمّ ولا أستطيع الكلام.', location: true, countdown: 5, bubble: true },
  pc: {
    armKey: 'builtin:shape_victory', armSeconds: 25, cooldown: 0.8, alwaysArm: false,
    bindings: [
      // حرّك يدك لليسار = الشريحة التالية، ولليمين = السابقة
      { key: 'builtin:swipe_left', action: 'right' },
      { key: 'builtin:swipe_right', action: 'left' },
      { key: 'builtin:shape_fist', action: 'b' },
    ],
  },
};

export function mergeCommands(saved) {
  const d = JSON.parse(JSON.stringify(DEFAULT_COMMANDS));
  if (!saved) return d;
  return { phrases: saved.phrases || d.phrases, sos: { ...d.sos, ...(saved.sos || {}) }, pc: { ...d.pc, ...(saved.pc || {}), bindings: saved.pc?.bindings || d.pc.bindings } };
}

export function gestureLabel(app, key) {
  if (!key) return '—';
  if (key.startsWith('sign:')) { const s = app.signs.find((x) => x.id === key.slice(5)); return s ? `${s.word} (${s.kind === 'motion' ? 'حركة' : 'وضعية'})` : 'إشارة محذوفة'; }
  if (key.startsWith('builtin:')) return BUILTIN_NAMES[key.slice(8)] || key;
  return key;
}

/** كل الإيماءات المتاحة للربط: جاهزة + إشارات القاموس. */
export function gestureOptions(app) {
  const out = [];
  for (const [id, name] of Object.entries(BUILTIN_NAMES)) out.push({ key: 'builtin:' + id, label: name + (id.startsWith('shape_') ? ' (وضعية)' : ' (حركة)') });
  for (const s of app.signs) {
    if (s.kind !== 'static' && s.kind !== 'motion') continue;
    if (s.hands === 2) continue;   // إشارات اليدين تُعرَف في المتصفح فقط حالياً
    out.push({ key: 'sign:' + s.id, label: `${s.word} — من قاموسي` });
  }
  return out;
}

// ---------- منطق التسليح (نفسه في برنامج الحاسوب) ----------
export class ArmState {
  constructor(cfg) { this.cfg = cfg; this.armedUntil = 0; this.lastFire = -99; this.holdKey = null; this.holdSince = 0; }
  setConfig(cfg) { this.cfg = cfg; }
  isArmed(t) { return !!(this.cfg && this.cfg.alwaysArm) || t < this.armedUntil; }
  remaining(t) { return Math.max(0, this.armedUntil - t); }
  /** event: {key,type,t}. يعيد 'armed' أو action id أو null */
  feed(e) {
    const t = e.t, c = this.cfg;
    if (c.alwaysArm) this.armedUntil = Math.max(this.armedUntil, t + 1e9);   // وضع «مفعّل دائماً»: بلا إيماءة تسليح
    if (e.key === c.armKey) {
      // حدث التأكيد الثابت يأتي بعد ثبات اليد عادةً، فيكفي لتسليح البرنامج
      this.armedUntil = t + c.armSeconds; return { armed: true };
    }
    if (!this.isArmed(t)) return null;
    if (t - this.lastFire < c.cooldown) return null;
    const b = c.bindings.find((x) => x.key === e.key);
    if (!b) return null;
    this.lastFire = t;
    if (b.action === 'disarm') { this.armedUntil = 0; return { disarmed: true }; }
    this.armedUntil = t + c.armSeconds;      // نافذة منزلقة: كل أمر يمدّد التسليح
    return { action: b.action, key: e.key };
  }
}

// ---------- طوارئ ----------
export class Siren {
  constructor() { this.ctx = null; this.osc = null; this.timer = 0; }
  prime() { try { this.ctx ||= new (window.AudioContext || window.webkitAudioContext)(); this.ctx.resume?.(); } catch (e) { /* لا شيء */ } }
  start() {
    this.prime(); if (!this.ctx) return;
    this.stop();
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; g.gain.value = 0.8; o.connect(g); g.connect(this.ctx.destination); o.start();
    this.osc = o; let hi = false;
    this.timer = setInterval(() => { hi = !hi; o.frequency.value = hi ? 960 : 640; }, 380);
    o.frequency.value = 640;
  }
  maxVolume() {
    this.prime(); if (!this.ctx) return;
    this.stop();
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; g.gain.value = 1.0; o.connect(g); g.connect(this.ctx.destination); o.start();
    this.osc = o; let hi = false;
    this.timer = setInterval(() => { hi = !hi; o.frequency.value = hi ? 880 : 660; }, 380);
    o.frequency.value = 660;
  }
  pulse() {
    // short urgent beep for non-SOS urgent words
    this.prime(); if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; g.gain.value = 0.7; o.connect(g); g.connect(this.ctx.destination);
    o.frequency.value = 880; o.start(); o.stop(this.ctx.currentTime + 0.15);
  }
  stop() { clearInterval(this.timer); try { this.osc?.stop(); } catch (e) { /* لا شيء */ } this.osc = null; }
}

export function buildSosLinks(sos, pos) {
  let msg = sos.message || '';
  if (pos) msg += `\nموقعي: https://maps.google.com/?q=${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}`;
  const phone = (sos.phone || '').replace(/[^\d+]/g, '');
  return {
    msg,
    tel: phone ? `tel:${phone}` : null,
    sms: phone ? `sms:${phone}?body=${encodeURIComponent(msg)}` : `sms:?body=${encodeURIComponent(msg)}`,
    wa: `https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(msg)}`,
  };
}
