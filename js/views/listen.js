// اسمع: كلام السامع (ميكروفون أو كتابة) ← نص ← إشارات مرسومة بيدٍ ثلاثية الأبعاد من نفس النقاط المسجَّلة.
import { h, btn, icon, toast, sleep } from '../ui.js';
import { HandView, animOf } from '../hand3d.js';
import { matchSentence } from '../arabic.js';
import { describePose, describeMotion } from '../learn.js';

export function createListenView(app) {
  let root, input, chipsEl, capEl, canvas, view, micBtn, rec = null, token = 0, items = [], playing = false, speed = 1, quick, desc, playBtn;

  function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n, f) => cs.getPropertyValue(n).trim() || f;
    return { line: g('--ink', '#222'), grid: g('--line', '#ccc'), glow: g('--accent-soft', '#e4e2fb'), trail: g('--accent', '#4640d4'), ok: g('--ok', '#14925f'), bad: g('--bad', '#cf3f27') };
  }

  function renderChips() {
    chipsEl.innerHTML = '';
    if (!items.length) { chipsEl.append(h('span.muted.small', 'اكتب جملة أو اضغط على الميكروفون وتكلّم…')); return; }
    items.forEach((it, i) => {
      const c = h('span.word' + (it.sign ? '' : '.unknown'), { dataset: { i } }, it.text);
      if (it.sign) c.onclick = () => playFrom(i);
      else c.append(h('button.btn.sm', { style: { marginInlineStart: '8px', padding: '0 8px', minHeight: '26px' }, title: 'أضف إشارة لهذه الكلمة', onclick: (ev) => { ev.stopPropagation(); app.pendingNew = { word: it.text }; app.go('dict'); } }, '+'));
      chipsEl.append(c);
    });
  }

  function mark(i) { [...chipsEl.children].forEach((c, k) => c.classList.toggle('active', k === i)); }

  function setItems(text) {
    stop();
    items = matchSentence(text, app.index);
    renderChips();
    const known = items.filter((x) => x.sign).length;
    if (items.length && !known) toast('لا توجد إشارات لهذه الكلمات في قاموسك بعد', 'bad');
    else if (known) playFrom(items.findIndex((x) => x.sign));
  }

  function stop() { token++; playing = false; view.stop(); capEl.textContent = ''; mark(-1); playBtn.firstChild && (playBtn.replaceChildren(icon('play'), h('span', 'شغّل'))); }

  async function playFrom(start = 0) {
    const my = ++token; playing = true;
    playBtn.replaceChildren(icon('pause'), h('span', 'إيقاف'));
    for (let i = start; i < items.length; i++) {
      if (my !== token) return;
      const it = items[i];
      if (!it.sign) { mark(i); capEl.textContent = it.text + ' — لا إشارة'; await sleep(500); continue; }
      mark(i); capEl.textContent = it.sign.word;
      const anim = animOf(it.sign);
      desc.textContent = it.sign.kind === 'motion' ? describeMotion(it.sign) : (it.sign.ref ? describePose(Float32Array.from(it.sign.ref)) : '');
      if (anim) {
        if (anim.frames.length > 1) view.play(anim, { speed });
        else view.setPose(anim.frames[0].p, anim.frames[0].off);
        await sleep(((anim.frames.length > 1 ? (anim.dur || 1) + 0.8 : 1.25) * 1000) / speed);
      } else await sleep(700);
    }
    if (my === token) { playing = false; playBtn.replaceChildren(icon('play'), h('span', 'أعد')); capEl.textContent = ''; mark(-1); }
  }

  function toggleMic() {
    if (rec) { try { rec.stop(); } catch (_) { /* لا شيء */ } return; }
    if (!app.stt.supported) { toast('هذا المتصفح لا يدعم التعرّف على الكلام؛ اكتب الجملة بدلاً من ذلك', 'bad'); input.focus(); return; }
    rec = app.stt.create(app.settings.sttLang, {
      onInterim: (t) => { input.value = t; },
      onFinal: (t) => { input.value = t; setItems(t); },
      onEnd: () => { rec = null; micBtn.classList.remove('primary'); micBtn.classList.add('ghost'); },
      onError: (c) => { toast(c === 'not-allowed' ? 'لم تُمنح صلاحية الميكروفون' : c === 'no-speech' ? 'لم أسمع شيئاً، حاول مجدداً' : 'تعذّر التعرّف على الكلام (' + c + ')', 'bad'); },
    });
    try { rec.start(); micBtn.classList.add('primary'); micBtn.classList.remove('ghost'); toast('تكلّم الآن…'); } catch (e) { rec = null; }
  }

  function renderQuick() {
    quick.innerHTML = '';
    const words = app.signs.slice(0, 24);
    if (!words.length) return;
    words.forEach((s) => quick.append(h('button.btn.sm', { type: 'button', onclick: () => { input.value = (input.value ? input.value + ' ' : '') + s.word; } }, s.word)));
  }

  return {
    mount(el) {
      root = el;
      canvas = h('canvas', { style: { aspectRatio: '1 / 0.82' } });
      capEl = h('div.cap');
      const box = h('div.avatar-box', { style: { aspectRatio: '1 / 0.82' } }, canvas, capEl, h('div.hint', 'اسحب لتدوير اليد · نقرتان لإعادة الوضع'));
      input = h('input', { type: 'text', placeholder: 'اكتب هنا أو استخدم الميكروفون', enterKeyHint: 'go', onkeydown: (e) => { if (e.key === 'Enter') setItems(input.value); } });
      micBtn = btn('', { ic: 'mic', cls: 'ghost', title: 'تحدّث', onclick: toggleMic });
      playBtn = btn('شغّل', { ic: 'play', cls: 'primary', onclick: () => { if (playing) stop(); else { if (!items.length) setItems(input.value); else playFrom(Math.max(0, items.findIndex((x) => x.sign))); } } });
      chipsEl = h('div.sentence', { style: { minHeight: '56px' } });
      desc = h('p.small.muted', { style: { minHeight: '1.4em' } });
      quick = h('div.row', { style: { gap: '6px' } });
      const spd = h('div.seg', [[0.7, 'بطيء'], [1, 'عادي'], [1.5, 'سريع']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(v === 1), onclick: (e) => { speed = v; spd.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); } }, l)));
      const side = h('div.seg', [[true, 'كما تراها في المرآة'], [false, 'كما يراها المقابل']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(v), onclick: (e) => { view.mirror = v; side.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); view.draw(); } }, l)));
      root.append(
        h('div.card', h('h2', 'اسمع ← شاهد الإشارة'), h('p.sub', 'يتكلم السامع، فيحوّل التطبيق كلامه إلى نص ثم يرسم الإشارات المقابلة من نفس النقاط المسجّلة في قاموسك.'),
          h('div.row', h('div.grow', input), micBtn, btn('', { ic: 'chev', cls: 'primary', title: 'اعرض', onclick: () => setItems(input.value) }))),
        box,
        h('div.row', playBtn, h('div.grow', spd)),
        side,
        desc,
        chipsEl,
        h('div.card', h('h2', 'أضف كلمة من قاموسك'), quick),
      );
      view = new HandView(canvas, { mirror: true, colors: themeColors() });
      renderChips(); renderQuick();
      app.on('signs', renderQuick);
      app.on('theme', () => view.setColors(themeColors()));
      matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => view.setColors(themeColors()));
    },
    show() {
      view.setColors(themeColors());
      view._fit?.();
      if (!items.length && app.signs.length) { const s = app.signs[0]; const a = animOf(s); if (a) view.setPose(a.frames[0].p, a.frames[0].off); }
      if (app.pendingSpeech) { input.value = app.pendingSpeech; app.pendingSpeech = null; }
    },
    hide() { stop(); try { rec?.stop(); } catch (_) { /* لا شيء */ } },
  };
}
