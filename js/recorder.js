// تسجيل إشارات جديدة من نقاط اليد: ثابتة (عيّنات) أو متحركة (لقطات DTW + رسم متحرك للأفاتار).
import { MotionSegmenter, segmentToSeq } from './motion.js';
import { POSE_LEN } from './features.js';
import { sleep } from './ui.js';

const r4 = (v) => Math.round(v * 10000) / 10000;
const r3 = (v) => Math.round(v * 1000) / 1000;

export class Cancel extends Error {}

/**
 * يلتقط عيّنات ثابتة لمدة معيّنة.
 * @param {object} o {seconds, target, onProgress(n,target,state), shouldStop()}
 */
export async function captureStatic(app, o = {}) {
  const seconds = o.seconds ?? 5, target = o.target ?? 70, two = o.hands === 2;
  const samples = [], samples2 = [], locs = [];
  let last = -1, lostSince = null, sizes = [];
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    const off = app.cam.onFrame((out) => {
      const now = performance.now();
      if (o.shouldStop?.()) { off(); reject(new Cancel()); return; }
      const el = (now - t0) / 1000;
      const frames = out.frames || (out.frame ? [out.frame] : []);
      const ready = two ? frames.length >= 2 : frames.length >= 1;
      if (ready) {
        lostSince = null;
        const f1 = frames[0], f2 = frames[1];
        const slow = two ? f1.speed < 1.5 && f2.speed < 1.5 : f1.speed < 1.2;
        if (slow && (last < 0 || now - last > 65)) {
          last = now;
          if (two) {
            samples2.push([
              ...Array.from(f1.p, r4), ...Array.from(f2.p, r4),
              r4(f1.wi[0]), r4(f1.wi[1]), r4(f2.wi[0]), r4(f2.wi[1]),
              r4(f1.size), r4(f2.size),
            ]);
            sizes.push((f1.size + f2.size) / 2);
          } else {
            samples.push([...Array.from(f1.p, r4), r4(f1.w[0]), r4(f1.w[1])]);
            sizes.push(f1.size);
          }
          if (f1.loc) locs.push({ x: r4(f1.loc.x), y: r4(f1.loc.y) });
        }
      } else if (lostSince == null) lostSince = now;
      const n = two ? samples2.length : samples.length;
      o.onProgress?.(n, target, { hand: ready, hands: frames.length, elapsed: el, lost: lostSince != null && now - lostSince > 700 });
      if (el >= seconds || n >= target) {
        off();
        const size = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
        resolve({ samples, samples2, locs, size });
      }
    });
  });
}

/** يبني رسماً متحركاً مختصراً للأفاتار من مقطع حركة. */
export function segmentToAnim(frames, n = 14) {
  const out = { frames: [], offs: [], dur: frames[frames.length - 1].t - frames[0].t };
  const s0 = frames[0];
  for (let i = 0; i < n; i++) {
    const f = frames[Math.round((i * (frames.length - 1)) / (n - 1))];
    out.frames.push(Array.from(f.p, r3));
    out.offs.push([r3((f.wi[0] - s0.wi[0]) / s0.size), r3((f.wi[1] - s0.wi[1]) / s0.size)]);
  }
  out.dur = r3(Math.min(2.5, Math.max(0.5, out.dur)));
  return out;
}

/** ينتظر حركة واحدة ويعيد لقطتها. */
export function captureMotionTake(app, o = {}) {
  const seg = new MotionSegmenter({ still: 0.3 });
  const t0 = performance.now();
  const timeout = (o.timeout ?? 6) * 1000;
  return new Promise((resolve, reject) => {
    const off = app.cam.onFrame((out) => {
      if (o.shouldStop?.()) { off(); reject(new Cancel()); return; }
      const res = seg.push(out.frame, out.t);
      o.onState?.({ hand: out.hand, moving: seg.isActive, elapsed: (performance.now() - t0) / 1000 });
      if (res) {
        if (res.dur < 0.3) { return; }
        off();
        const seq = segmentToSeq(res.frames);
        resolve({ seq: Array.from(seq, r3), anim: segmentToAnim(res.frames), dur: res.dur });
        return;
      }
      if (performance.now() - t0 > timeout) { off(); resolve({ error: 'timeout' }); }
    });
  });
}

export async function countdown(n, onTick) {
  for (let i = n; i >= 1; i--) { onTick(i); await sleep(800); }
  onTick(0);
}

export { POSE_LEN };
