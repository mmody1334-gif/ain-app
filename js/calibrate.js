// معايرة يد المستخدم: نقيس «مفرود» و«مطوي» على يده هو، ثم نضبط عتبات الأصابع.
// تُستعمل النتائج في fingerStates وdetectBuiltinShape، فتنخفض أخطاء الإصبع
// التي تنتج عن اختلاف حجم اليد أو شكلها أو زاوية الكاميرا.

import { h, btn, toast } from './ui.js';
import { setFingerCalibration } from './motion.js';

const STEPS = [
  { id: 'open', title: 'كف مفتوحة', hint: 'افتح أصابعك كلها وابعد الإبهام قليلاً عن الكف، وثبّت يدك.' },
  { id: 'fist', title: 'اقبض يدك', hint: 'اقبض أصابعك على راحة يدك بقدر ما تستطيع، وثبّت.' },
  { id: 'thumb', title: 'الإبهام مرفوع', hint: 'ارفع إبهامك فقط (مثل علامة «ممتاز») وأبقِ باقي الأصابع مطوية.' },
];

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * يشغّل معايرة كاملة. يعيد true إذا حُفظت، وfalse إذا أُلغيت أو فشلت الكاميرا.
 */
export async function runCalibration(app) {
  if (!app.cam.running) {
    app.go('translate');
    const ok = await app.startCamera();
    if (!ok) { toast('شغّل الكاميرا أولاً ثم أعد المعايرة', 'bad'); return false; }
  }

  return new Promise((resolve) => {
    let step = 0, phase = 'count', t0 = performance.now(), cancelled = false, done = false;
    const samples = STEPS.map(() => ({ ext: [[], [], [], [], []], tdist: [], size: [] }));
    // نوقف التعرّف أثناء المعايرة حتى لا تُضاف كلمات إلى الجملة من وضعيات المعايرة
    const prev = { static: app.engine.enableStatic, motion: app.engine.enableMotion, shapes: app.engine.enableShapes };
    app.engine.enableStatic = false; app.engine.enableMotion = false; app.engine.enableShapes = false;
    app.engine.reset();
    const restore = () => { app.engine.enableStatic = prev.static; app.engine.enableMotion = prev.motion; app.engine.enableShapes = prev.shapes; };

    const title = h('h2', 'معايرة يدك');
    const hint = h('p', { style: { minHeight: '2.8em', fontWeight: 600 } }, 'سنقيس ثلاث وضعيات بيدك خلال ثوانٍ.');
    const count = h('div.count', '');
    const bar = h('div.meter', h('i'));
    const stepLbl = h('span.small.muted', '');
    const cancelBtn = btn('إلغاء', { cls: 'ghost sm', onclick: () => close(false) });
    const card = h('div.card', { style: { textAlign: 'center', gap: '10px', display: 'flex', flexDirection: 'column' } },
      h('div.row.between', h('b', 'معايرة اليد'), stepLbl), title, hint, count, bar,
      h('p.small.muted', 'المعايرة تبقى على هذا الجهاز فقط، وتُستخدم لضبط قراءة أصابعك.'),
      h('div.row', cancelBtn));
    const overlay = h('div.calib', { role: 'dialog', 'aria-label': 'معايرة اليد' }, card);
    document.body.append(overlay);

    const off = app.cam.onFrame(onFrame);

    function close(ok) {
      if (done) return;
      done = true; restore();
      off();
      overlay.remove();
      resolve(ok);
    }

    function showStep() {
      const s = STEPS[step];
      title.textContent = s.title;
      hint.textContent = s.hint;
      stepLbl.textContent = `${step + 1} / ${STEPS.length}`;
      count.textContent = 'استعد…';
      bar.firstChild.style.width = '0%';
      phase = 'count';
      t0 = performance.now();
    }

    function onFrame(out) {
      if (cancelled) return;
      if (phase === 'count') {
        const el = (performance.now() - t0) / 1000;
        const n = Math.max(1, 3 - Math.floor(el));
        count.textContent = String(n);
        if (el >= 2) { phase = 'collect'; t0 = performance.now(); count.textContent = 'الآن'; }
        return;
      }
      const el = (performance.now() - t0) / 1000;
      bar.firstChild.style.width = Math.min(100, Math.round((el / 1.8) * 100)) + '%';
      if (out.hand && out.frame && out.frame.speed < 2.6) {
        const bucket = samples[step];
        for (let i = 0; i < 5; i++) bucket.ext[i].push(out.frame.ext[i]);
        bucket.tdist.push(out.frame.tdist);
        bucket.size.push(out.frame.size);
      }
      if (!out.hand) hint.textContent = 'أظهر يدك كاملة داخل الإطار';
      else if (out.frame && out.frame.speed >= 2.6) hint.textContent = 'ثبّت يدك قليلاً…';
      if (el >= 1.8) {
        step++;
        if (step < STEPS.length) showStep();
        else finish();
      }
    }

    async function finish() {
      cancelled = true;
      const open = [0, 1, 2, 3, 4].map((i) => median(samples[0].ext[i]));
      const fist = [0, 1, 2, 3, 4].map((i) => median(samples[1].ext[i]));
      const thumbOpen = median(samples[2].tdist) ?? median(samples[0].tdist) ?? 0.88;
      const thumbFist = median(samples[1].tdist) ?? 0.50;
      const sizeOpen = median(samples[0].size) || 0.18;
      const okFingers = open.every((v, i) => typeof v === 'number' && typeof fist[i] === 'number' && v - fist[i] > 0.08);
      const okThumb = thumbOpen - thumbFist > 0.06;
      const cal = {
        v: 1, at: Date.now(), sizeOpen,
        open: okFingers ? open : undefined,
        fist: okFingers ? fist : undefined,
        thumbOpen: okThumb ? thumbOpen : undefined,
        thumbFist: okThumb ? thumbFist : undefined,
      };
      setFingerCalibration(cal);
      try { await app.store.setMeta('calib', cal); app.calib = cal; } catch (e) { /* لا شيء */ }
      title.textContent = 'تمت المعايرة';
      hint.textContent = okFingers ? 'أصبحت قراءة أصابعك مضبوطة على يدك.' : 'لم تكن الوضعيات واضحة بما يكفي؛ أعد المعايرة في إضاءة أفضل.';
      stepLbl.textContent = '';
      count.textContent = '✓';
      bar.firstChild.style.width = '100%';
      cancelBtn.replaceWith(btn('تم', { cls: 'primary', onclick: () => close(true) }));
      try { await app.retrain(); } catch (e) { /* لا شيء */ }
    }

    showStep();
  });
}
