// ترجمة: الكاميرا ترى الإشارة، والتطبيق ينطقها ويكوّن جملة. ومعها مفضلة وسجل للجمل.
import { h, btn, icon, toast } from '../ui.js';
import { URGENT_WORDS, Siren } from '../commands.js';
import { room } from '../room.js';

const _siren = new Siren();

const MAX_HIST = 30;

export function createTranslateView(app) {
  let root, slot, bigEl, sentEl, tipEl, words = [], off = null, activeEl = null, camBtn, favEl, histEl, quickEl;
  let saved = { favs: [], hist: [] };
  let torchActive = false;
  let torchBtn = null;

  async function loadSent() { saved = { favs: [], hist: [], ...(await app.store.getMeta('sentences', null)) }; }
  async function saveSent() { await app.store.setMeta('sentences', saved); renderSaved(); }
  const textOf = (s) => s.words.map((w) => w.text).join(' ');

  function loadSentence(s, speak = false) {
    words = s.words.map((w) => ({ ...w }));
    bigEl.textContent = words.length ? words[words.length - 1].text : '';
    renderSentence();
    if (speak && words.length) app.say(textOf(s));
  }

  function renderSaved() {
    if (!favEl || !histEl) return;
    // شريط نطق سريع: كل جملة مفضلة تُنطق بضغطة واحدة — ذاكرة جاهزة للمواقف
    if (quickEl) {
      quickEl.innerHTML = '';
      if (saved.favs.length) quickEl.append(h('div.row', { style: { gap: '6px', flexWrap: 'wrap' } },
        saved.favs.slice(0, 8).map((s) => h('button.btn.sm', { type: 'button', title: 'انطق الآن', onclick: () => { loadSentence(s, true); } }, s.text.split(' ').slice(0, 3).join(' ') + (s.text.split(' ').length > 3 ? '…' : '')))));
    }
    favEl.innerHTML = '';
    histEl.innerHTML = '';
    if (!saved.favs.length) { favEl.append(h('p.small.muted', 'لا جمل مفضلة بعد. كوّن جملة من الإشارات ثم اضغط زر النجمة لتحفظها.')); }
    else {
      const list = h('div.list');
      saved.favs.forEach((s, i) => list.append(h('div.item',
        h('div.grow', h('button.ttl', { style: { border: 0, background: 'none', color: 'inherit', cursor: 'pointer', textAlign: 'start', font: 'inherit', padding: 0 }, onclick: () => loadSentence(s, true) }, s.text.split(' ').slice(0, 6).join(' ')), h('div.meta', `${s.words.length} كلمة`)),
        h('button.iconbtn', { 'aria-label': 'انطق', onclick: () => app.say(textOf(s)) }, icon('speaker')),
        h('button.iconbtn', { 'aria-label': 'حذف من المفضلة', onclick: async () => { saved.favs.splice(i, 1); await saveSent(); } }, icon('heart')))));
      favEl.append(list);
    }
    if (!saved.hist.length) { histEl.append(h('p.small.muted', 'كل جملة تُنطق تُسجَّل هنا تلقائيًا.')); }
    else {
      const list = h('div.list');
      saved.hist.forEach((s, i) => list.append(h('div.item',
        h('div.grow', h('button.ttl', { style: { border: 0, background: 'none', color: 'inherit', cursor: 'pointer', textAlign: 'start', font: 'inherit', padding: 0 }, onclick: () => loadSentence(s, true) }, s.text.split(' ').slice(0, 6).join(' ')), h('div.meta', `${s.words.length} كلمة`)),
        h('button.iconbtn', { 'aria-label': 'أضف للمفضلة', onclick: async () => { if (!saved.favs.some((f) => f.text === s.text)) { saved.favs.unshift({ words: s.words, text: s.text, at: Date.now() }); await saveSent(); } toast('أُضيفت للمفضلة', 'ok'); } }, icon('star')))));
      histEl.append(list);
    }
  }

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

      // كلمات الطوارئ العاجلة: صوت أعلى + اهتزاز مضاعف + وميض أحمر
      const isUrgent = URGENT_WORDS.has(e.sign.word);
      if (isUrgent) {
        _siren.pulse();
        if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
        bigEl.animate([
          { background: '#b3170a', color: '#fff', borderRadius: '12px' },
          { background: 'transparent', color: 'var(--accent)', borderRadius: '0' },
        ], { duration: 800 });
        app.say(e.sign.word, { rate: 0.75 }); // أبطأ وأوضح
      } else {
        if (navigator.vibrate) navigator.vibrate(30);
        if (app.settings.speakEach) app.say(e.sign.word);
      }

      renderSentence();

      // إرسال الإشارة للأجهزة في الغرفة
      if (room.roomCode) room.sendSign(e.sign.word, e.sign.id);
    }
  }

  /** تسجيل الجملة في السجل عند نطقها: بلا تكرار متتالٍ، وآخر 30 جملة فقط. */
  async function recordHistory() {
    if (!words.length) return;
    const s = { words: words.map((w) => ({ ...w })), text: textOf({ words }), at: Date.now() };
    if (saved.hist.length && saved.hist[0].text === s.text) return;
    saved.hist.unshift(s);
    if (saved.hist.length > MAX_HIST) saved.hist.length = MAX_HIST;
    await app.store.setMeta('sentences', saved);
    renderSaved();
  }

  async function saveFav() {
    if (!words.length) { toast('لا جملة لحفظها.', 'bad'); return; }
    const s = { words: words.map((w) => ({ ...w })), text: textOf({ words }), at: Date.now() };
    if (saved.favs.some((f) => f.text === s.text)) { toast('الجملة في المفضلة بالفعل', ''); return; }
    saved.favs.unshift(s);
    await app.store.setMeta('sentences', saved);
    renderSaved();
    toast('حُفظت «' + s.text.split(' ').slice(0, 4).join(' ') + '…» في المفضلة', 'ok');
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

function quickShare() {
  const t = words.map((w) => w.text).join(' ');
  if (!t) { toast('لا جملة للمشاركة', 'bad'); return; }
  const copy = () => navigator.clipboard?.writeText(t).then(() => toast('نُسِخت الجملة', 'ok')).catch(() => {});
  if (navigator.share) navigator.share({ text: t }).catch(copy);
  else copy();
}

  return {
    mount(el) {
      root = el;
      slot = h('div');
      bigEl = h('div.bigword', { 'aria-live': 'polite' }, '');
      sentEl = h('div.sentence', { 'aria-live': 'polite' });
      tipEl = h('div');
      favEl = h('div');
      histEl = h('div');
      quickEl = h('div');
      camBtn = null;
      const actions = h('div.row',
        btn('انطق الجملة', { ic: 'speaker', cls: 'primary grow', onclick: () => { const t = words.map((w) => w.text).join(' '); if (t) { app.say(t); recordHistory(); } } }),
        btn('', { ic: 'star', cls: 'ghost', title: 'احفظ في المفضلة', onclick: saveFav }),
        btn('', { ic: 'share', cls: 'ghost', title: 'مشاركة أو نسخ الجملة', onclick: quickShare }),
        btn('', { ic: 'undo', cls: 'ghost', title: 'تراجع', onclick: () => { words.pop(); renderSentence(); } }),
        btn('', { ic: 'trash', cls: 'ghost', title: 'مسح', onclick: () => { words = []; bigEl.textContent = ''; renderSentence(); } }));
      root.append(slot, bigEl, sentEl, actions, quickEl, tipEl,
        h('div.card', h('h2', 'جملي المفضلة'), favEl),
        h('div.card', h('h2', 'السجل'), histEl));
      loadSent().then(renderSaved);
      renderSentence();
      app.on('camera', renderTip);
      app.on('signs', renderTip);
    },
    show() {
      app.mountStage(slot);
      app.cam.showSkeleton = app.settings.skeleton;
      off = app.cam.onFrame(onEvent);

      // زر الفلاش داخل أدوات المسرح
      torchActive = false;
      torchBtn = document.createElement('button');
      torchBtn.className = 'iconbtn';
      torchBtn.setAttribute('aria-label', 'تشغيل/إيقاف الفلاش');
      torchBtn.title = 'إضاءة الفلاش للتصوير في الظلام';
      torchBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2l-5 9h8l-2 11 10-13h-7z"/></svg>`;
      torchBtn.onclick = async () => {
        try {
          const track = app.cam.video?.srcObject?.getVideoTracks?.()?.[0];
          if (!track) { toast('شغّل الكاميرا أولاً'); return; }
          torchActive = !torchActive;
          await track.applyConstraints({ advanced: [{ torch: torchActive }] });
          torchBtn.style.color = torchActive ? '#f5b64e' : '';
          torchBtn.style.background = torchActive ? 'rgba(245,182,78,.25)' : '';
        } catch (e) { toast('هذا الجهاز لا يدعم الفلاش عبر المتصفح', 'bad'); }
      };
      // أضف الزر لأدوات المسرح
      const tools = app.stage.querySelector('.tools');
      if (tools && !tools.querySelector('[data-torch]')) {
        torchBtn.dataset.torch = '1';
        tools.insertBefore(torchBtn, tools.firstChild);
      }

      renderTip();
      loadSent().then(renderSaved);
    },
    hide() {
      off?.(); off = null;
      // أطفئ الفلاش عند مغادرة الشاشة
      if (torchActive) {
        try {
          const track = app.cam.video?.srcObject?.getVideoTracks?.()?.[0];
          track?.applyConstraints({ advanced: [{ torch: false }] });
        } catch (e) {}
        torchActive = false;
        if (torchBtn) { torchBtn.style.color = ''; torchBtn.style.background = ''; }
      }
      app.unmountStage();
      recordHistory();
    },
  };
}
