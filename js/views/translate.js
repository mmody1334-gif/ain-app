// ترجمة: الكاميرا ترى الإشارة، والتطبيق ينطقها ويكوّن جملة.
import { h, btn, icon } from '../ui.js';

export function createTranslateView(app) {
  let root, slot, bigEl, sentEl, tipEl, words = [], off = null, activeEl = null, camBtn;

  function renderSentence() {
    sentEl.innerHTML = '';
    if (!words.length) { sentEl.append(h('span.ph', 'ستظهر الكلمات هنا، واحدة بعد أخرى…')); return; }
    words.forEach((w, i) => sentEl.append(h('span.word' + (i === words.length - 1 ? '.active' : ''), w.text)));
    sentEl.scrollTop = sentEl.scrollHeight;
  }

  function onEvent(out) {
    for (const e of out.events) {
      if (!e.sign) continue;                // أشكال جاهزة غير مربوطة بكلمة لا تُنطق هنا
      words.push({ text: e.sign.word, id: e.sign.id });
      bigEl.textContent = e.sign.word;
      bigEl.animate([{ transform: 'scale(.8)', opacity: 0.3 }, { transform: 'scale(1)', opacity: 1 }], { duration: 220 });
      if (navigator.vibrate) navigator.vibrate(30);
      renderSentence();
      if (app.settings.speakEach) app.say(e.sign.word);
    }
  }

  function renderTip() {
    const n = app.signs.length;
    tipEl.innerHTML = '';
    const st = app.engine.clf?.classes.length || 0;
    if (!app.cam.running) tipEl.append(h('p.small.muted', 'شغّل الكاميرا، ثم ثبّت يدك أمامها نحو ثانية لتُنطَق الإشارة. للتمرير والتلويح لا حاجة للتثبيت.'));
    else if (!n) tipEl.append(h('p.small', 'القاموس فارغ. أضف إشاراتك من «قاموسي».'));
    else tipEl.append(h('p.small.muted', `أعرف ${n} إشارة. لإضافة إشارة جديدة: قاموسي ← إشارة جديدة.`));
    void st;
  }

  return {
    mount(el) {
      root = el;
      slot = h('div');
      bigEl = h('div.bigword', { 'aria-live': 'polite' }, '');
      sentEl = h('div.sentence', { 'aria-live': 'polite' });
      tipEl = h('div');
      camBtn = null;
      const actions = h('div.row',
        btn('انطق الجملة', { ic: 'speaker', cls: 'primary grow', onclick: () => { const t = words.map((w) => w.text).join(' '); if (t) app.say(t); } }),
        btn('', { ic: 'undo', cls: 'ghost', title: 'تراجع', onclick: () => { words.pop(); renderSentence(); } }),
        btn('', { ic: 'trash', cls: 'ghost', title: 'مسح', onclick: () => { words = []; bigEl.textContent = ''; renderSentence(); } }));
      root.append(slot, bigEl, sentEl, actions, tipEl);
      renderSentence();
      app.on('camera', renderTip);
      app.on('signs', renderTip);
    },
    show() {
      app.mountStage(slot);
      app.cam.showSkeleton = app.settings.skeleton;
      off = app.cam.onFrame(onEvent);
      renderTip();
    },
    hide() { off?.(); off = null; app.unmountStage(); },
  };
}
