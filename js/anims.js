// رسوم متحركة للإشارات الجاهزة (أشكال وتمريرات) من النموذج الاصطناعي، لتظهر في الأفاتار بلا تسجيل.
import { shapePose } from './handModel.js';

const lerp = (a, b, u) => a + (b - a) * u;

export function builtinAnim(rule) {
  if (!rule) return null;
  if (rule.startsWith('shape_')) {
    try { return { frames: [{ p: shapePose(rule), off: [0, 0] }], dur: 1 }; } catch (e) { return null; }
  }
  const open = shapePose('shape_open');
  const point = shapePose('shape_point');
  const fist = shapePose('shape_fist');
  const N = 16;
  const mk = (fn, dur, pose = open) => ({ frames: Array.from({ length: N }, (_, i) => ({ p: pose, off: fn(i / (N - 1)) })), dur });
  // إحداثيات خام (قبل عكس المرآة): swipe_left = dx موجب
  if (rule === 'swipe_left') return mk((u) => [lerp(-1.4, 1.4, u), 0], 0.8);
  if (rule === 'swipe_right') return mk((u) => [lerp(1.4, -1.4, u), 0], 0.8);
  if (rule === 'swipe_up') return mk((u) => [0, lerp(0.9, -0.9, u)], 0.8);
  if (rule === 'swipe_down') return mk((u) => [0, lerp(-0.9, 0.9, u)], 0.8);
  if (rule === 'wave') return mk((u) => [0.7 * Math.sin(u * Math.PI * 6), 0], 1.6);
  if (rule === 'no') return mk((u) => [0.45 * Math.sin(u * Math.PI * 4), 0], 1.0, point);
  if (rule === 'yes') return mk((u) => [0, 0.35 * Math.sin(u * Math.PI * 4)], 1.0, fist);
  if (rule === 'circle') return mk((u) => [0.6 * Math.cos(u * Math.PI * 2), 0.6 * Math.sin(u * Math.PI * 2)], 1.3);
  return null;
}
