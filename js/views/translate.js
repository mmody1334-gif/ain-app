// ترجمة: الكاميرا ترى الإشارة، والتطبيق ينطقها ويكوّن جملة. ومعها مفضلة وسجل للجمل.
import { h, btn, icon, toast } from '../ui.js';
import { room } from '../room.js';
import { assembleSentence } from '../sentence.js';
import { initFace, updateFace, face } from '../face.js';
import { URGENT_WORDS, Siren } from '../commands.js';

// نبضة صوتية بسيطة لكلمات الطوارئ
let _audioCtx = null;
function urgentPulse() {
  try {
    _audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    _audioCtx.resume?.();
    const o = _audioCtx.createOscillator(), g = _audioCtx.createGain();
    o.type = 'square'; g.gain.value = 0.7; o.connect(g); g.connect(_audioCtx.destination);
    o.frequency.value = 880; o.start(); o.stop(_audioCtx.currentTime + 0.15);
  } catch (_) {}
}

const siren = new Siren();

const MAX_HIST = 30;
const AUTO_DELAY = 6000;   // مهلة التجميع الآلي: إن لم تُنطق إشارة جديدة نطقنا الجملة

/** وميض شاشة أحمر للكلمات العاجلة: يزول وحده بعد 2.2 ثانية */
function urgentFlash(word) {
  const ov = h('div.urgent-overlay',
    { style: { position: 'fixed', inset: '0', zIndex: 120, pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', background: 'rgba(179,23,10,.92)' } },
    h('div.urgent-emoji.urgent-ripple', '🚨'),
    h('div.urgent-word', word),
    h('div.urgent-sub', 'طلب مساعدة!'));
  document.body.append(ov);
  setTimeout(() => ov.remove(), 2200);
}

export function createTranslateView(app) {
  let root, slot, bigEl, sentEl, tipEl, words = [], off = null, activeEl = null, camBtn, favEl, histEl, quickEl;
  let saved = { favs: [], hist: [] };
  let torchActive = false;
  let torchBtn = null;
  let faceOn = true, autoOn = true;      // إعدادات المخزن: قواعد الوجه والتجميع الآلي
  let faceChip = null, faceCb = null, faceTimer = 0, sirenTimer = 0;
  let autoTimer = 0;
  let roomBar = null;

  const roomMode = () => app.settings.roomSend || 'auto';   // auto | manual | off

  /** شريط الغرفة: يظهر فقط داخل غرفة — اختيار الإرسال (تلقائي/يدوي/إيقاف) وزر إرسال الجملة */
  function renderRoomBar() {
    if (!roomBar) return;
    roomBar.innerHTML = '';
    roomBar.hidden = !room.roomCode;
    if (!room.roomCode) return;
    const mode = roomMode();
    const st = room.mode === 'ws' ? ['متصل فوري', 'ok'] : room.connected ? ['متصل', 'warn'] : ['غير متصل', ''];
    const peers = room.peerCount;
    const seg = h('div.seg', { style: { width: '100%' } }, [['auto', 'كل إشارة'], ['manual', 'بزر'], ['off', 'إيقاف']].map(([v, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(mode === v), onclick: async () => {
        await app.saveSettings({ roomSend: v });
        if (v === 'off') room.signing(false);
        renderRoomBar();
        toast(v === 'auto' ? 'كل إشارة تُرسل للغرفة فور التعرّف عليها' : v === 'manual' ? 'كوّن الجملة ثم اضغط «أرسل للغرفة»' : 'لن يُرسل شيء للغرفة', 'ok');
      } }, l)));
    roomBar.append(
      h('div.row', { style: { gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
        h('button.chip-status' + (st[1] ? '.' + st[1] : ''), { type: 'button', style: { border: 0, cursor: 'pointer' }, title: 'افتح المحادثة', onclick: () => app.go('room') },
          '💬 الغرفة ' + room.roomCode + ' · ' + st[0] + (peers ? ' · ' + peers + ' معك' : ''))),
      h('div.small.muted', 'إرسال إشاراتك للغرفة:'), seg,
);
    if (mode === 'manual') roomBar.append(btn('أرسل الجملة للغرفة', { ic: 'chev', cls: 'primary block', onclick: sendSentenceToRoom }));
  }

  function sendSentenceToRoom() {
    const a = buildSentence();
    if (!a.text) { toast('كوّن جملة بالإشارات أولاً', 'bad'); return; }
    room.sendSentence(a.text, words.map((w) => w.text));
    toast('أُرسلت للغرفة ✓', 'ok');
    recordHistory(a.text);
    words = []; bigEl.textContent = ''; renderSentence(); clearTimeout(autoTimer);
  }

  async function loadSent() { saved = { favs: [], hist: [], ...(await app.store.getMeta('sentences', null)) }; }
  async function saveSent() { await app.store.setMeta('sentences', saved); renderSaved(); }
  const textOf = (s) => assembleSentence(s.words).text; // النص النهائي المجمَّع (بترتيب عربي)

  /** الجملة النهائية: بترتيب عربي ومع تعبير الوجه الحالي */
  function buildSentence() { return assembleSentence(words, app.cam.running ? face.current : null); }

  /** الجدولة: كلمة جديدة تُمسح المؤقت (ننتظر 6 ثوان قبل النطق الآلي) */
  function armAuto() {
    clearTimeout(autoTimer);
    autoTimer = 0;
    if (!autoOn) return;
    autoTimer = setTimeout(() => {
      autoTimer = 0;
      if (!autoOn || words.length < 2) return;
      const a = buildSentence();
      app.say(a.spoken);
      recordHistory(a.text);
      words = [];
      bigEl.textContent = '';
      renderSentence();
    }, AUTO_DELAY);
  }

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

  /** شريحة تعبير الوجه الصغيرة بجانب الكلمة الكبيرة */
  function updateFaceChip() {
    if (!faceChip) return;
    const cur = faceOn && app.cam.running ? face.current : null;
    const map = { question: ['سؤال؟', 'warn'], negation: ['نفي ✋', ''], affirm: ['نعم 👍', 'ok'] };
    if (cur && map[cur]) {
      faceChip.textContent = map[cur][0];
      faceChip.className = 'chip-status ' + map[cur][1];
      faceChip.hidden = false;
    } else faceChip.hidden = true;
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
        urgentPulse();
        if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
        bigEl.animate([
          { background: '#b3170a', color: '#fff', borderRadius: '12px' },
          { background: 'transparent', color: 'var(--accent)', borderRadius: '0' },
        ], { duration: 800 });
        urgentFlash(e.sign.word);
        app.say(e.sign.word, { rate: 0.7, volume: 1 }); // أبطأ وأعلى صوتاً
        clearTimeout(sirenTimer);
        sirenTimer = setTimeout(() => { siren.start(); setTimeout(() => siren.stop(), 900); }, 1500); // دفعة صفير قصيرة
      } else {
        if (navigator.vibrate) navigator.vibrate(30);
        if (app.settings.speakEach) app.say(e.sign.word);
      }

      renderSentence();
      armAuto();

      // إرسال الإشارة للغرفة: فقط في الوضع التلقائي (في اليدوي تُرسل الجملة بزر)
      if (room.roomCode && roomMode() === 'auto') room.sendSign(e.sign.word, e.sign.id);
    }
  }

  /** تسجيل الجملة المنطوقة (المجمَّعة) في السجل: بلا تكرار متتالٍ، وآخر 30 جملة فقط. */
  async function recordHistory(text) {
    const t = text ?? textOf({ words });
    if (!t) return;
    const s = { words: words.map((w) => ({ ...w })), text: t, at: Date.now() };
    if (saved.hist.length && saved.hist[0].text === s.text) return;
    saved.hist.unshift(s);
    if (saved.hist.length > MAX_HIST) saved.hist.length = MAX_HIST;
    await app.store.setMeta('sentences', saved);
    renderSaved();
  }

  async function saveFav() {
    if (!words.length) { toast('لا جملة لحفظها.', 'bad'); return; }
    const s = { words: words.map((w) => ({ ...w })), text: buildSentence().text, at: Date.now() };
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
    const t = buildSentence().text;
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
      faceChip = h('span.chip-status', { hidden: true });
      sentEl = h('div.sentence', { 'aria-live': 'polite' });
      tipEl = h('div');
      roomBar = h('div.card', { hidden: true, style: { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' } });
      room.addEventListener('status', renderRoomBar);
      favEl = h('div');
      histEl = h('div');
      quickEl = h('div');
      camBtn = null;
      const faceCb = h('input', { type: 'checkbox', checked: faceOn, onchange: async (e) => { faceOn = e.target.checked; await app.store.setMeta('face_grammar', faceOn); updateFaceChip(); } });
      const autoCb = h('input', { type: 'checkbox', checked: autoOn, onchange: async (e) => { autoOn = e.target.checked; await app.store.setMeta('auto_sentence', autoOn); if (!autoOn) clearTimeout(autoTimer); } });
      const actions = h('div.row',
        btn('انطق الجملة', { ic: 'speaker', cls: 'primary grow', onclick: () => { const a = buildSentence(); if (a.text) { app.say(a.spoken); recordHistory(a.text); } } }),
        btn('', { ic: 'star', cls: 'ghost', title: 'احفظ في المفضلة', onclick: saveFav }),
        btn('', { ic: 'share', cls: 'ghost', title: 'مشاركة أو نسخ الجملة', onclick: quickShare }),
        btn('', { ic: 'undo', cls: 'ghost', title: 'تراجع', onclick: () => { words.pop(); renderSentence(); armAuto(); } }),
        btn('', { ic: 'trash', cls: 'ghost', title: 'مسح', onclick: () => { words = []; bigEl.textContent = ''; renderSentence(); clearTimeout(autoTimer); } }));
      root.append(slot,
        h('div.row.center', { style: { justifyContent: 'center', gap: '8px' } }, bigEl, faceChip),
        sentEl, actions, roomBar, quickEl, tipEl,
        h('div.card', h('label.switch', h('span', 'قواعد تعابير الوجه (سؤال/نفي/نعم)'), faceCb),
          h('label.switch', h('span', 'انطق الجملة آلياً بعد 6 ثوانٍ من السكون'), autoCb)),
        h('div.card', h('h2', 'جملي المفضلة'), favEl),
        h('div.card', h('h2', 'السجل'), histEl));
      loadSent().then(renderSaved);
      app.store.getMeta('face_grammar', true).then((v) => { faceOn = v !== false; faceCb.checked = faceOn; });
      app.store.getMeta('auto_sentence', true).then((v) => { autoOn = v !== false; autoCb.checked = autoOn; });
      renderSentence();
      renderRoomBar();
      app.on('camera', () => { renderTip(); updateFaceChip(); if (!app.cam.running) room.signing(false); });
      app.on('signs', renderTip);
    },
    show() {
      app.mountStage(slot);
      app.cam.showSkeleton = app.settings.skeleton;
      off = app.cam.onFrame((out, primary, t) => {
        onEvent(out);
        if (room.roomCode && roomMode() !== 'off') room.signing(out.hand);
        // تعابير الوجه: تشغيل كسول على نفس إطارات الكاميرا، ثم تحديث الشريحة
        if (faceOn && app.cam.running && faceOn !== false) updateFace(app.cam.video, t);
        updateFaceChip();
      });

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

      // تشغيل كاشف الوجه مرة واحدة عند الدخول (فشله صامت)
      if (faceOn && !face.ready) initFace(app.cam.video).then(updateFaceChip);

      // تحديث الشريحة عند انتهاء صلاحية التعبير (كل ثانية)
      clearInterval(faceTimer);
      faceTimer = setInterval(updateFaceChip, 1000);

      renderTip();
      renderRoomBar();
      loadSent().then(renderSaved);
    },
    hide() {
      off?.(); off = null;
      room.signing(false);
      clearInterval(faceTimer);
      clearTimeout(sirenTimer);
      clearTimeout(autoTimer);
      // إطفاء الصفير إن كان رابضاً عند مغادرة الشاشة
      siren.stop();
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
      const a = buildSentence();
      if (a.text) recordHistory(a.text);
    },
  };
}
