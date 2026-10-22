// دروس: كورس تعليمي متسلسل — بنية الوحدات والخطوات في course_data.js.
// تقدم الكورس محفوظ محلياً في meta «courseProgress»، والتحديات تستعير
// نفس عتاد «تعلّم»: مقارنة القياس الحيّ، والشكل الجاهز، وأفاتار اليد.
import { h, btn, icon, toast } from '../ui.js';
import { UNITS } from '../course_data.js';
import { compareToTarget } from '../learn.js';
import { shapePose } from '../handModel.js';
import { HandView, animOf } from '../hand3d.js';

function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n, f) => cs.getPropertyValue(n).trim() || f;
  return { line: g('--ink', '#222'), grid: g('--line', '#ccc'), glow: g('--accent-soft', '#e4e2fb'), trail: g('--accent', '#4640d4'), ok: g('--ok', '#14925f'), bad: g('--bad', '#cf3f27') };
}

export function createCourseView(app) {
  let root, cur = null;              // cur = كائن الوحدة المفتوحة
  let prog = { units: {} };
  let canvas = null, view = null;    // أفاتار هدف التحدي النشط
  let ch = null;                     // التحدي النشط {i, s, slotEl, meterEl, hintEl, okAcc, ema, lastT}
  let camOff = null, signsOff = null;

  const doneOf = (u) => new Set((prog.units[u.id] || []));
  const setDone = (u, i) => { const a = prog.units[u.id] || (prog.units[u.id] = []); if (!a.includes(i)) a.push(i); };
  const save = () => app.store.setMeta('courseProgress', prog);
  const letterDone = (l) => app.signs.some((s) => s.letter && s.letter === l.ch);
  const wordDone = (w) => app.signs.some((s) => s.word === w);

  function isStepDone(u, s, i) {
    if (doneOf(u).has(i)) return true;
    if (s.t === 'record') return s.letters.every(letterDone);
    if (s.t === 'record-word') return s.words.every(wordDone);
    return false;
  }
  const stepsDone = (u) => u.steps.filter((s, i) => isStepDone(u, s, i)).length;

  function markDone(i, silent = false) {
    const u = cur;
    if (!u || doneOf(u).has(i)) return;
    setDone(u, i);
    save();
    if (!silent) { if (navigator.vibrate) navigator.vibrate(25); app.say('أحسنت'); }
    renderUnit();
  }

  // ---------- الواجهة ----------
  function renderList() {
    root.innerHTML = '';
    const all = UNITS.every((u) => stepsDone(u) === u.steps.length);
    root.append(h('div.card',
      h('h2', 'دروس لغة الإشارة'),
      h('p.sub', 'ثماني وحدات: من آداب التواصل إلى الأبجدية كاملة، إلى قاموسك الخاص. تقدمك محفوظ في جهازك وحده.')));
    if (all) root.append(h('div.card', h('h2', 'أنجزت الكورس كاملاً 🎉'), h('p.sub', 'التعلّم الحقيقي يبدأ الآن: استعمل ما تعلمته في لقاء حقيقي أسبوعياً، وصدّر قاموسك احتياطاً.')));
    for (const u of UNITS) {
      const done = stepsDone(u), total = u.steps.length, full = done === total;
      root.append(h('div.card',
        h('div.course-unit-head',
          h('span.course-badge' + (full ? '.done' : ''), full ? '✓' : u.badge),
          h('div.grow', h('h3', u.title), h('p.meta.small.muted', `${done}/${total} خطوة · ${u.desc}`)),
          btn(full ? 'مراجعة' : 'افتح', { cls: (full ? 'ghost' : 'primary') + ' sm', onclick: () => { cur = u; renderUnit(); } })),
        h('div.meter', h('i', { style: { width: Math.round((done / total) * 100) + '%' } }))));
    }
  }

  function stepCard(u, s, i) {
    const done = isStepDone(u, s, i);
    const card = h('div.card');
    card.append(h('div.course-unit-head',
      h('span.course-badge' + (done ? '.done' : ''), done ? '✓' : String(i + 1)),
      h('div.grow', h('h3', s.h || ''), h('p.meta.small.muted', s.label || ''))));
    const body = h('div.step-note');

    if (s.t === 'note') {
      for (const p of s.p) body.append(h('p', p));
      if (!done) {
        body.append(btn('فهمت — التالي', { cls: 'primary block', ic: 'chev', onclick: () => markDone(i) }));
        card.append(body);
      } else {
        const fold = h('details', h('summary', 'نصّ الخطوة'), h('div.step-note', s.p.map((p) => h('p', p))));
        fold.open = false;
        card.append(fold);
      }
      return card;
    }

    if (s.t === 'try') {
      if (done) card.append(h('p.small.muted.okhint', 'فتحت هذا التمرين ✓'));
      else card.append(btn('افتح التمرين في «تعلّم»', { cls: 'primary', ic: 'learn', onclick: () => { app.pendingLesson = s.lessonId; app.go('learn'); markDone(i, true); } }));
      return card;
    }

    if (s.t === 'record' || s.t === 'record-word') {
      const list = h('div.step-note');
      const items = s.t === 'record' ? s.letters.map((l) => ({ label: `${l.ch} — ${l.name}`, ok: letterDone(l), go: () => { app.pendingRecord = { letter: l.ch, name: l.name }; app.go('dict'); } }))
        : s.words.map((w) => ({ label: w, ok: wordDone(w), go: () => { app.pendingNew = { word: w }; app.go('dict'); } }));
      for (const it of items) {
        list.append(h('div.row.spread', h('span.ttl', it.label),
          it.ok ? h('span.okhint', 'مُسجَّل ✓') : btn('سجّل', { cls: 'sm', ic: 'record', onclick: it.go })));
      }
      card.append(list);
      if (!done) card.append(btn('أشِّرها كمنجزة', { cls: 'ghost sm', onclick: () => markDone(i) }));
      return card;
    }

    if (s.t === 'pose' || s.t === 'motion') {
      canvas = h('canvas');
      const slotEl = h('div');
      const meterEl = h('i');
      const hintEl = h('p', { style: { minHeight: '2.2em', fontWeight: 600 }, 'aria-live': 'polite' }, '');
      card.append(h('div.challenge-box',
        h('div.avatar-box', { style: { aspectRatio: '1 / 0.8' } }, canvas),
        s.t === 'pose' ? h('div.challenge-target', s.target.letter || s.target.shape || '') : h('div.challenge-target', '👋'),
        slotEl,
        h('div.meter', meterEl),
        hintEl));
      if (!done) card.append(btn('أشِّرها كمنجزة (تخطّ)', { cls: 'ghost sm', onclick: () => markDone(i) }));
      return { card, slotEl, meterEl, hintEl, canvas, s, i };
    }

    if (s.t === 'link') {
      if (done) card.append(h('p.small.muted.okhint', 'زُر هذا القسم ✓'));
      else card.append(
        btn('اذهب الآن', { cls: 'primary', ic: 'chev', onclick: () => { app.go(s.tab); markDone(i, true); } }));
      return card;
    }
    return card;
  }

  function renderUnit() {
    const u = cur;
    if (!u) { renderList(); return; }
    root.innerHTML = '';
    view?.destroy?.(); view = null;
    root.append(h('div.row',
      btn('رجوع', { ic: 'chev', cls: 'ghost sm', onclick: () => { cur = null; ch = null; camOff?.(); camOff = null; app.unmountStage(); renderList(); } }),
      h('h2.grow', u.title),
      h('span.chip-status', `${stepsDone(u)}/${u.steps.length}`)));

    let target = null; // أول تحدٍّ غير منجز
    u.steps.forEach((s, i) => {
      const c = stepCard(u, s, i);
      const el = c instanceof Element ? c : c.card;
      root.append(el);
      if (c.slotEl && !isStepDone(u, s, i) && !target) target = { ...c };
    });
    camOff?.(); camOff = null; ch = null;
    if (!target) { app.unmountStage(); return; }
    ch = { i: target.i, s: target.s, slotEl: target.slotEl, meterEl: target.meterEl, hintEl: target.hintEl, okAcc: 0, ema: 0, lastT: 0 };
    app.mountStage(ch.slotEl);
    view = new HandView(target.canvas, { mirror: true, colors: themeColors() });
    if (ch.s.t === 'pose') showTargetAnim(poseAnim(ch.s));
    ch.hintEl.textContent = ch.s.t === 'motion' ? 'نفّذ الحركة أمام الكاميرا' : 'قلّد شكل اليد وثبّته…';
    camOff = app.cam.onFrame(chFrame);
    if (!app.cam.running) ch.hintEl.textContent = 'شغّل الكاميرا من زر التشغيل أعلاه.';
  }

  function poseAnim(s) {
    if (s.target.letter) {
      const sign = app.signs.find((x) => x.letter && x.letter === s.target.letter && x.ref);
      return sign ? animOf(sign) : null;
    }
    if (s.target.shape) {
      const p = shapePose(s.target.shape);
      return p ? { frames: [{ p: Float32Array.from(p), off: null }] } : null;
    }
    return null;
  }

  function poseRef(s) {
    if (s.target.letter) {
      const sign = app.signs.find((x) => x.letter && x.letter === s.target.letter && x.ref);
      return sign ? sign.ref : null;
    }
    if (s.target.shape) {
      const p = shapePose(s.target.shape);
      return p ? Float32Array.from(p) : null;
    }
    return null;
  }

  function showTargetAnim(anim) {
    if (!view) return;
    if (!anim) return;
    if (anim.frames.length > 1) view.play(anim);
    else view.setPose(anim.frames[0].p, anim.frames[0].off);
  }

  function chFrame(out) {
    if (!ch || !cur) return;
    const s = ch.s;
    if (s.t === 'motion') {
      const key = 'builtin:' + s.rule;
      const ev = (out.events || []).find((e) => e.key === key);
      if (ev) succeed();
      else if ((out.events || []).length) ch.hintEl.textContent = 'حركة أخرى؛ المطلوب: ' + (s.rule === 'wave' ? 'التلويح يميناً ويساراً' : s.rule);
      else ch.hintEl.textContent = 'نفّذ الحركة أمام الكاميرا';
      return;
    }
    const ref = poseRef(s);
    if (!ref) { ch.hintEl.textContent = `سجّل الحرف «${s.target.letter}» من «قاموسي» أولًا، أو اختر «أشِّرها كمنجزة».`; return; }
    if (!out.hand || !out.frame) { ch.okAcc = 0; ch.hintEl.textContent = 'ضع يدك أمام الكاميرا'; return; }
    if (out.moving) { ch.hintEl.textContent = 'حركة… ثبّت يدك'; ch.okAcc = Math.max(0, ch.okAcc - 0.05); return; }
    const r = compareToTarget(out.frame.p, Float32Array.from(ref));
    ch.ema = ch.ema ? 0.65 * ch.ema + 0.35 * r.score : r.score;
    ch.meterEl.style.width = Math.round(ch.ema) + '%';
    ch.hintEl.textContent = r.ok ? 'ممتاز! ثبّت…' : (r.hints.slice(0, 2).join(' · ') || 'اقتربت…');
    if (r.ok && ch.ema >= 72) {
      ch.okAcc += out.t - (ch.lastT || out.t);
      if (ch.okAcc >= 0.8) { succeed(); return; }
    } else ch.okAcc = Math.max(0, ch.okAcc - 0.05);
    ch.lastT = out.t;
  }

  function succeed() {
    const i = ch?.i;
    ch = null;
    camOff?.(); camOff = null;
    if (i != null) markDone(i);
  }

  // ---------- دورة الحياة ----------
  return {
    mount(el) {
      root = el;
      app.store.getMeta('courseProgress', { units: {} }).then((p) => {
        prog = { units: {}, ...(p || {}) };
        if (!cur) renderList();
      });
      renderList();
    },
    show() {
      signsOff?.(); signsOff = app.on('signs', () => { if (cur) renderUnit(); });
      // تحديث التقدم عند العودة (مثلاً بعد تسجيل حروف من «قاموسي»)
      app.store.getMeta('courseProgress', { units: {} }).then((p) => {
        prog = { units: {}, ...(p || {}) };
        cur ? renderUnit() : renderList();
      });
    },
    hide() {
      signsOff?.(); signsOff = null;
      camOff?.(); camOff = null; ch = null;
      app.unmountStage();
    },
  };
}
