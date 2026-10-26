// مؤثرات صوتية مولَّدة بالمتصفح (WebAudio) — بلا ملفات صوت، فتعمل بلا إنترنت.
let ctx = null;
let muted = false;

function ac() {
  if (muted) return null;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch (_) { return null; }
}

/** نغمة واحدة: تردد، بداية (ث)، مدة، شكل الموجة، مستوى الصوت */
function tone(f, at = 0, dur = 0.15, type = 'sine', vol = 0.25, slideTo = null) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  setMuted(m) { muted = !!m; },
  get muted() { return muted; },
  /** مهمة أُنجزت: «دينغ» مزدوج */
  task() { tone(880, 0, 0.12, 'triangle', 0.22); tone(1318.5, 0.09, 0.22, 'triangle', 0.22); },
  /** يوم كامل: فانفار صاعد */
  day() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.11, 0.22, 'square', 0.12));
    tone(1046.5, 0.48, 0.55, 'triangle', 0.22); tone(1318.5, 0.48, 0.55, 'triangle', 0.16); tone(1568, 0.48, 0.55, 'triangle', 0.12);
  },
  /** يوم مقفول: «تك» منخفض */
  locked() { tone(196, 0, 0.09, 'square', 0.14); tone(146.8, 0.08, 0.14, 'square', 0.14); },
  /** فتح يوم جديد: لمعة */
  unlock() { [1318.5, 1760, 2093, 2637].forEach((f, i) => tone(f, i * 0.06, 0.16, 'sine', 0.14)); },
  /** شارة جديدة */
  badge() { tone(784, 0, 0.12, 'triangle', 0.2); tone(988, 0.1, 0.12, 'triangle', 0.2); tone(1175, 0.2, 0.12, 'triangle', 0.2); tone(1568, 0.3, 0.4, 'triangle', 0.22); },
  /** نقرة خفيفة */
  tap() { tone(1200, 0, 0.04, 'sine', 0.08); },
  /** الهدف الكبير: 50% */
  goal() { this.day(); setTimeout(() => this.badge(), 900); },
};
export default sfx;
