// رسم يد ثلاثية الأبعاد على canvas من 21 نقطة: يُدار بالسحب، ويشغّل حركات مسجّلة، ويلوّن الأصابع للتغذية الراجعة.
// المدخل هو نفس نقاط الإشارة المخزَّنة، فالبيانات نفسها تخدم الاتجاهين (من الإشارة إلى الكلام ومن الكلام إلى الإشارة).

import { HAND_CONNECTIONS } from './features.js';
import { builtinAnim } from './anims.js';

const FINGER_RANGES = { thumb: [1, 4], index: [5, 8], middle: [9, 12], ring: [13, 16], pinky: [17, 20] };
const FINGER_ORDER = ['thumb', 'index', 'middle', 'ring', 'pinky'];

const DEFAULT_COLORS = {
  skin: '#e9b99a', skinDark: '#c98f6e', line: '#6d4331', ok: '#2fae77', bad: '#e0563d', trail: '#8a8fff',
  glow: 'rgba(120,120,255,0.18)', grid: 'rgba(128,128,128,0.18)',
};

function rotate(x, y, z, yaw, pitch) {
  let c = Math.cos(yaw), s = Math.sin(yaw);
  let x1 = x * c + z * s, z1 = -x * s + z * c;
  c = Math.cos(pitch); s = Math.sin(pitch);
  const y1 = y * c - z1 * s, z2 = y * s + z1 * c;
  return [x1, y1, z2];
}

export class HandView {
  constructor(canvas, opt = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.mirror = opt.mirror ?? true;
    this.yaw = opt.yaw ?? -0.25; this.pitch = opt.pitch ?? 0.05;
    this.colors = { ...DEFAULT_COLORS, ...(opt.colors || {}) };
    this.pose = null; this.off = [0, 0];
    this.anim = null; this.animT0 = 0; this.loop = true; this.speed = 1; this.pauseEnd = 0.7;
    this.feedback = null;               // {thumb:'ok'|'bad', ...}
    this.trail = null;
    this.zoom = opt.zoom ?? 1;
    this.interactive = opt.interactive ?? true;
    this.raf = 0; this.running = false;
    this._dpr = 1; this._w = 0; this._h = 0;
    this._bindPointer();
    this._observe();
  }

  setColors(c) { this.colors = { ...this.colors, ...c }; this.draw(); }

  setPose(p, off = [0, 0]) { this.anim = null; this.trail = null; this.pose = p; this.off = off; this.draw(); }

  setFeedback(fb) { this.feedback = fb; this.draw(); }

  /** anim: {frames:[{p,off}], dur} — يُكرَّر مع توقف قصير في النهاية. */
  play(anim, opt = {}) {
    if (!anim || !anim.frames || !anim.frames.length) return;
    this.anim = anim; this.loop = opt.loop ?? true; this.speed = opt.speed ?? 1;
    this.animT0 = performance.now();
    this.trail = anim.frames.length > 2 ? anim.frames.map((f) => f.off) : null;
    this._start();
  }

  stop() { this.anim = null; this.trail = null; this._stopLoop(); this.draw(); }

  _start() { if (this.running) return; this.running = true; const tick = () => { if (!this.running) return; this.draw(); this.raf = requestAnimationFrame(tick); }; this.raf = requestAnimationFrame(tick); }
  _stopLoop() { this.running = false; cancelAnimationFrame(this.raf); }
  destroy() { this._stopLoop(); this._ro?.disconnect(); }

  _observe() {
    const fit = () => {
      const r = this.cv.getBoundingClientRect();
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const w = Math.max(40, Math.round(r.width)), h = Math.max(40, Math.round(r.height));
      if (w === this._w && h === this._h && dpr === this._dpr) return;
      this._w = w; this._h = h; this._dpr = dpr;
      this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
      this.draw();
    };
    this._fit = fit;
    if (typeof ResizeObserver !== 'undefined') { this._ro = new ResizeObserver(fit); this._ro.observe(this.cv); }
    fit();
  }

  _bindPointer() {
    if (!this.interactive) return;
    let down = false, lx = 0, ly = 0;
    this.cv.style.touchAction = 'none';
    this.cv.addEventListener('pointerdown', (e) => { down = true; lx = e.clientX; ly = e.clientY; try { this.cv.setPointerCapture(e.pointerId); } catch (_) { /* لا شيء */ } });
    this.cv.addEventListener('pointermove', (e) => {
      if (!down) return;
      this.yaw += (e.clientX - lx) * 0.012 * (this.mirror ? -1 : 1);
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + (e.clientY - ly) * 0.012));
      lx = e.clientX; ly = e.clientY; if (!this.running) this.draw();
    });
    const up = () => { down = false; };
    this.cv.addEventListener('pointerup', up); this.cv.addEventListener('pointercancel', up);
    this.cv.addEventListener('dblclick', () => { this.yaw = -0.25; this.pitch = 0.05; if (!this.running) this.draw(); });
  }

  /** مركز اليد ونصف قطرها (مع مدى الحركة) لتبقى داخل الإطار مهما كان اتجاهها. */
  _layoutFor() {
    const key = this.anim || this.pose;
    if (this._layKey === key && this._lay) return this._lay;
    const frames = this.anim ? this.anim.frames : [{ p: this.pose, off: this.off || [0, 0] }];
    let sx = 0, sy = 0, n = 0, maxOff = 0;
    const p0 = frames[0].p;
    for (let i = 0; i < 21; i++) { sx += p0[i * 3]; sy += p0[i * 3 + 1]; n++; }
    const c = [sx / n, sy / n];
    let R = 0.9;
    for (const f of frames) {
      for (let i = 0; i < 21; i++) R = Math.max(R, Math.hypot(f.p[i * 3] - c[0], f.p[i * 3 + 1] - c[1], f.p[i * 3 + 2]) * 1.0 + 0.2);
      const o = f.off || [0, 0]; maxOff = Math.max(maxOff, Math.hypot(o[0], o[1]));
    }
    this._layKey = key; this._lay = { c, R: Math.max(1.1, R + maxOff * 0.9) };
    return this._lay;
  }

  _currentPose() {
    if (!this.anim) return { p: this.pose, off: this.off };
    const fr = this.anim.frames, n = fr.length;
    if (n === 1) return { p: fr[0].p, off: fr[0].off || [0, 0] };
    const dur = Math.max(0.3, this.anim.dur || n / 12) / this.speed;
    const total = dur + this.pauseEnd;
    let t = (performance.now() - this.animT0) / 1000;
    if (!this.loop && t > dur) t = dur; else t = t % total;
    const u = Math.min(1, t / dur) * (n - 1);
    const i = Math.min(n - 2, Math.floor(u)), f = u - i;
    const a = fr[i], b = fr[i + 1];
    const p = new Float32Array(63);
    for (let k = 0; k < 63; k++) p[k] = a.p[k] + (b.p[k] - a.p[k]) * f;
    const oa = a.off || [0, 0], ob = b.off || [0, 0];
    return { p, off: [oa[0] + (ob[0] - oa[0]) * f, oa[1] + (ob[1] - oa[1]) * f] };
  }

  draw() {
    const ctx = this.ctx; if (!ctx) return;
    const dpr = this._dpr, W = this._w, H = this._h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const C = this.colors;
    // شبكة خفيفة تمنح إحساس العمق
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    const gy = H * 0.9;
    for (let i = -3; i <= 3; i++) { ctx.moveTo(W / 2 + i * W * 0.12, gy - H * 0.04); ctx.lineTo(W / 2 + i * W * 0.2, gy + H * 0.08); }
    ctx.stroke();

    const cur = this._currentPose();
    if (!cur.p) return;
    const p = cur.p;
    const lay = this._layoutFor();
    const unit = Math.min(W, H) * 0.40 * this.zoom / lay.R;   // طول الكف بالبكسل
    const cx = W / 2 - lay.c[0] * unit * (this.mirror ? -1 : 1), cy = H * 0.54 - lay.c[1] * unit;
    const mx = this.mirror ? -1 : 1;
    const proj = (x, y, z, ox = 0, oy = 0) => {
      const [X, Y, Z] = rotate(mx * x, y, z, this.yaw, this.pitch);
      const persp = 1 / (1 - Z * 0.12);
      return [cx + (mx * ox + X) * unit * persp, cy + (oy + Y) * unit * persp, Z, persp];
    };

    // أثر مسار الحركة
    if (this.trail) {
      ctx.fillStyle = C.trail;
      this.trail.forEach((o, i) => {
        const q = proj(0, 0, 0, o?.[0] || 0, o?.[1] || 0);
        ctx.globalAlpha = 0.15 + 0.25 * (i / this.trail.length);
        ctx.beginPath(); ctx.arc(q[0], q[1], unit * 0.045, 0, 7); ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    const P = [];
    for (let i = 0; i < 21; i++) P.push(proj(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], cur.off[0], cur.off[1]));

    // ظل
    ctx.fillStyle = C.glow;
    ctx.beginPath(); ctx.ellipse(cx, gy + H * 0.02, unit * 0.9, unit * 0.12, 0, 0, 7); ctx.fill();

    // الكف
    const palm = [0, 1, 5, 9, 13, 17];
    ctx.beginPath();
    palm.forEach((i, k) => { if (k === 0) ctx.moveTo(P[i][0], P[i][1]); else ctx.lineTo(P[i][0], P[i][1]); });
    ctx.closePath();
    ctx.fillStyle = C.skin; ctx.fill();
    ctx.lineJoin = 'round'; ctx.lineWidth = unit * 0.16; ctx.strokeStyle = C.skin; ctx.stroke();

    // عظام الأصابع مرتبة من الأبعد للأقرب
    const bones = [];
    FINGER_ORDER.forEach((f) => {
      const a = FINGER_RANGES[f][0];
      for (let k = 0; k < 3; k++) bones.push({ f, i: a + k, j: a + k + 1, k, z: (P[a + k][2] + P[a + k + 1][2]) / 2 });
    });
    bones.sort((u, v) => v.z - u.z);          // z الأكبر = أبعد
    for (const b of bones) {
      const A = P[b.i], B = P[b.j];
      const fb = this.feedback?.[b.f];
      const col = fb === 'ok' ? C.ok : fb === 'bad' ? C.bad : C.skin;
      const w = unit * (0.16 - b.k * 0.025) * ((A[3] + B[3]) / 2);
      ctx.lineCap = 'round';
      ctx.strokeStyle = fb ? col : C.skinDark; ctx.lineWidth = w + 2.5;
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
    }
    // مفاصل
    ctx.fillStyle = C.line; ctx.globalAlpha = 0.5;
    for (let i = 1; i < 21; i++) { if (i === 5 || i === 9 || i === 13 || i === 17) continue; ctx.beginPath(); ctx.arc(P[i][0], P[i][1], unit * 0.018, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
}

/** يحوّل إشارة مخزَّنة إلى رسم متحرك للأفاتار. */
export function animOf(sign) {
  if (!sign) return null;
  if (sign.kind === 'builtin') return builtinAnim(sign.rule);
  if (sign.anim && sign.anim.frames && sign.anim.frames.length) {
    return { frames: sign.anim.frames.map((f, i) => ({ p: Float32Array.from(f), off: sign.anim.offs?.[i] || [0, 0] })), dur: sign.anim.dur || 1 };
  }
  if (sign.ref) return { frames: [{ p: Float32Array.from(sign.ref), off: [0, 0] }], dur: 1 };
  return null;
}

export { HAND_CONNECTIONS };
