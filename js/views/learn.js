// تعلّم: يعرض النموذج، ويقارن يدك به لحظياً إصبعاً إصبعاً، ويمنحك نجوماً.
import { h, btn, icon, toast, sleep } from '../ui.js';
import { HandView, animOf } from '../hand3d.js';
import { compareToTarget, describePose, describeMotion, starsFor } from '../learn.js';
import { SHAPES, shapePose } from '../handModel.js';
import { BUILTIN_MOTIONS } from '../motion.js';
import { builtinAnim } from '../anims.js';
import { FINGER_WORDS } from '../arabic.js';

const FINGER_KEYS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

export function createLearnView(app) {
  let root, introEl, listEl, lessonEl, slot, view, canvas, fingerEls = {}, meterEl, hintEl, scoreEl, starsEl, descEl, titleEl, nextBtn, doneBox;
  let lessons = [], cur = null, state = null, off = null;

  function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n, f) => cs.getPropertyValue(n).trim() || f;
    return { line: g('--ink', '#222'), grid: g('--line', '#ccc'), glow: g('--accent-soft', '#e4e2fb'), trail: g('--accent', '#4640d4'), ok: g('--ok', '#14925f'), bad: g('--bad', '#cf3f27') };
  }

  function buildLessons() {
    lessons = [];
    for (const s of app.signs) {
      if (s.kind === 'static' && s.ref) lessons.push({ id: 'sign:' + s.id, group: 'mine', title: s.word, type: 'pose', pose: Float32Array.from(s.ref), sign: s });
      else if (s.kind === 'motion') lessons.push({ id: 'sign:' + s.id, group: 'mine', title: s.word, type: 'motion', sign: s, key: 'sign:' + s.id });
      else if (s.kind === 'builtin') {
        if (s.rule.startsWith('shape_')) lessons.push({ id: 'sign:' + s.id, group: 'mine', title: s.word, type: 'pose', pose: shapePose(s.rule), sign: s });
        else lessons.push({ id: 'sign:' + s.id, group: 'mine', title: s.word, type: 'motion', sign: s, key: 'builtin:' + s.rule });
      }
    }
    for (const sh of SHAPES) lessons.push({ id: 'shape:' + sh.id, group: 'shapes', title: sh.name, type: 'pose', pose: shapePose(sh.id), icon: sh.emoji });
    for (const m of BUILTIN_MOTIONS) lessons.push({ id: 'motion:' + m.id, group: 'motions', title: m.name, type: 'motion', rule: m.id, key: 'builtin:' + m.id, hint: m.hint });
  }

  const starsText = (n) => h('span.stars', [1, 2, 3].map((i) => h('span' + (i <= n ? '' : '.off'), '★')));

  function renderList() {
    buildLessons();
    listEl.innerHTML = '';
    const groups = [['mine', 'إشاراتي', 'إشارات قاموسك'], ['shapes', 'أشكال اليد الأساسية', 'تمرين لتعوّد أصابعك على الأوضاع (أشكال عامة، ليست كلمات).'], ['motions', 'حركات جاهزة', 'تمرير وتلويح وهزّ سبابة/قبضة ورسم دائرة، تُستعمل أيضاً في «أوامر».']];
    for (const [g, name, sub] of groups) {
      const ls = lessons.filter((l) => l.group === g);
      if (!ls.length) continue;
      const done = ls.filter((l) => app.progress[l.id]).length;
      listEl.append(h('div.row.between', { style: { marginTop: '8px' } }, h('h2', name), h('span.small.muted', `${done}/${ls.length}`)));
      listEl.append(h('p.small.muted', sub));
      const col = h('div.list');
      ls.forEach((l) => {
        const pr = app.progress[l.id];
        col.append(h('button.item', { type: 'button', style: { border: 0, textAlign: 'start', cursor: 'pointer', color: 'inherit' }, onclick: () => openLesson(l) },
          h('div.grow', h('div.ttl', (l.icon ? l.icon + ' ' : '') + l.title), h('div.meta', l.type === 'motion' ? 'حركة' : 'وضعية يد')),
          pr ? starsText(pr.stars) : h('span.badge', 'جديد')));
      });
      listEl.append(col);
    }
    if (!app.signs.length) listEl.prepend(h('div.empty', 'قاموسك فارغ. ابدأ بالأشكال الأساسية أو أضف إشارتك من «قاموسي».'));
  }

  function openLesson(l) {
    cur = l;
    state = { ok: 0, last: 0, ema: 0, done: false, best: 0, t0: performance.now() };
    listEl.hidden = true; lessonEl.hidden = false; introEl.hidden = true;
    document.getElementById('main').scrollTo({ top: 0 });
    titleEl.textContent = l.title;
    doneBox.hidden = true; nextBtn.hidden = true;
    hintEl.textContent = '';
    FINGER_KEYS.forEach((k) => fingerEls[k].className = '');
    meterEl.style.width = '0'; scoreEl.textContent = '';
    view.setColors(themeColors()); view._fit?.();
    if (l.type === 'pose') {
      view.setPose(l.pose); view.setFeedback(null);
      descEl.textContent = describePose(l.pose);
      lessonEl.querySelector('[data-fingers]').hidden = false;
    } else {
      const a = l.sign ? animOf(l.sign) : builtinAnim(l.rule);
      if (a) view.play(a);
      descEl.textContent = l.hint || (l.sign ? (l.sign.kind === 'motion' ? describeMotion(l.sign) : '') : '');
      lessonEl.querySelector('[data-fingers]').hidden = true;
    }
    app.mountStage(slot);
    off?.(); off = app.cam.onFrame(onFrame);
    if (!app.cam.running) hintEl.textContent = 'شغّل الكاميرا لتبدأ المقارنة.';
    else hintEl.textContent = l.type === 'pose' ? 'قلّد شكل اليد وثبّته.' : 'نفّذ الحركة أمام الكاميرا.';
  }

  function closeLesson() {
    cur = null; off?.(); off = null; view.stop(); app.unmountStage();
    lessonEl.hidden = true; listEl.hidden = false; introEl.hidden = false; renderList();
  }

  async function succeed(score) {
    state.done = true;
    await app.addProgress(cur.id, score);
    const n = starsFor(score) || 1;
    doneBox.hidden = false;
    doneBox.replaceChildren(h('div', { style: { textAlign: 'center' } }, h('h2', 'أحسنت!'), starsText(n), h('p.small.muted', `النتيجة ${score}٪`)));
    nextBtn.hidden = false;
    if (navigator.vibrate) navigator.vibrate([40, 30, 60]);
    app.say('أحسنت' + (cur.title ? ' — ' + cur.title : ''));
  }

  function onFrame(out) {
    if (!cur || state.done) return;
    if (cur.type === 'pose') {
      if (!out.hand || !out.frame) {
        state.ok = 0; hintEl.textContent = 'ضع يدك أمام الكاميرا'; FINGER_KEYS.forEach((k) => fingerEls[k].className = ''); return;
      }
      const r = compareToTarget(out.frame.p, cur.pose);
      state.ema = state.ema ? 0.65 * state.ema + 0.35 * r.score : r.score;
      for (const k of FINGER_KEYS) fingerEls[k].className = r.fingers[k];
      meterEl.style.width = Math.round(state.ema) + '%';
      scoreEl.textContent = Math.round(state.ema) + '٪';
      hintEl.textContent = r.ok ? 'ممتاز! ثبّت يدك…' : (r.hints.slice(0, 2).join(' · ') || 'اقتربت…');
      if (r.ok && state.ema >= 72) {
        state.ok += out.t - (state.last || out.t);
        state.best = Math.max(state.best, state.ema);
        if (state.ok >= 0.85) succeed(Math.round(state.best));
      } else state.ok = Math.max(0, state.ok - 0.05);
      state.last = out.t;
    } else {
      const ev = out.events.find((e) => e.key === cur.key);
      if (ev) { succeed(Math.round(78 + 22 * (ev.conf ?? 1))); return; }
      if (out.motionResult && out.events.length === 0) hintEl.textContent = 'قريب… جرّب أبطأ وأوضح.';
      else if (out.moving) hintEl.textContent = 'حسناً… أكمل الحركة';
      else if (out.events.length) hintEl.textContent = 'حركة مختلفة، حاول مرة أخرى.';
    }
  }

  return {
    mount(el) {
      root = el;
      listEl = h('div');
      canvas = h('canvas');
      slot = h('div');
      titleEl = h('h2');
      descEl = h('p.small.muted');
      meterEl = h('i'); scoreEl = h('span.small.muted');
      hintEl = h('p', { style: { minHeight: '2.8em', fontWeight: 600 }, 'aria-live': 'polite' });
      doneBox = h('div.card', { hidden: true });
      nextBtn = btn('التالي', { cls: 'primary', ic: 'chev', onclick: () => { const i = lessons.findIndex((x) => x.id === cur.id); const nx = lessons[(i + 1) % lessons.length]; openLesson(nx); } });
      const fingers = h('div.fingers', { dataset: { fingers: '' } }, FINGER_KEYS.map((k) => (fingerEls[k] = h('span', FINGER_WORDS[k]))));
      lessonEl = h('div', { hidden: true, style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        h('div.row.between', btn('رجوع', { ic: 'chev', cls: 'ghost sm', onclick: closeLesson }), titleEl),
        h('div.duo', h('div.avatar-box', canvas, h('div.hint', 'النموذج · اسحب لتدويره')), slot),
        descEl,
        fingers,
        h('div.row', h('div.meter.grow', meterEl), scoreEl),
        hintEl,
        doneBox,
        h('div.row', nextBtn, btn('أعد المحاولة', { cls: 'ghost', ic: 'refresh', onclick: () => openLesson(cur) })));
      lessonEl.hidden = true;
      introEl = h('div.card', h('h2', 'تعلّم الإشارات'), h('p.sub', 'يقارن التطبيق يدك بالنموذج لحظياً ويقول لك أي إصبع يحتاج تعديلاً. مناسب للأهل والزملاء الذين يتعلمون.'));
      root.append(introEl, listEl, lessonEl);
      lessonEl.style.display = 'none';
      view = new HandView(canvas, { mirror: true, colors: themeColors() });
      const sync = () => { lessonEl.style.display = lessonEl.hidden ? 'none' : 'flex'; };
      new MutationObserver(sync).observe(lessonEl, { attributes: true, attributeFilter: ['hidden'] });
      app.on('signs', () => { if (!cur && root.classList.contains('on')) renderList(); });
    },
    show() { if (!cur) renderList(); else { app.mountStage(slot); off?.(); off = app.cam.onFrame(onFrame); } },
    hide() { off?.(); off = null; if (cur) view.stop(); app.unmountStage(); cur = null; lessonEl.hidden = true; listEl.hidden = false; introEl.hidden = false; },
  };
}
void toast; void sleep; void icon;
