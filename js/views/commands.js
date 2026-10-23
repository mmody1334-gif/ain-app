// أوامر: (1) جمل المواقف (2) طوارئ (3) التحكم بالحاسوب بالإيماءات.
import { h, btn, icon, toast, sheet } from '../ui.js';
import { buildPcConfig } from '../pcexport.js';
import { ACTIONS, PHRASE_PRESETS, mergeCommands, gestureLabel, gestureOptions, ArmState, Siren, buildSosLinks } from '../commands.js';

export function createCommandsView(app) {
  let root, slot, cfg, off = null, lastEl, armEl, phrasesEl, sosBox, pcBox, simEl, arm, slide = 1, siren = new Siren(), sosTimer = 0, sosOverlay = null, lastPos = null, tickTimer = 0, fab = null;

  const save = () => app.store.setMeta('commands', cfg);

  // ---------- فقاعة الطوارئ (تعمل بلا كاميرا) ----------
  function applyFab() {
    if (!fab) return;
    const want = cfg ? cfg.sos.bubble !== false : true;
    fab.hidden = !want || !!sosOverlay;
  }

  function buildFab() {
    if (fab) return;
    fab = h('button.sos-fab', {
      'aria-label': 'طوارئ — اضغط لبدء النداء',
      title: 'طوارئ: إنذار ورسالة جاهزة، بلا كاميرا',
      onclick: async () => {
        if (sosOverlay) return;
        if (!cfg) cfg = mergeCommands(await app.store.getMeta('commands', null));   // إن لم يُفتح قسم «أوامر» قط
        siren.prime();
        startSos(false);
      },
    }, icon('warn'));
    document.body.append(fab);
  }

  // ---------- مستمع الأحداث ----------
  function onFrame(out) {
    for (const e of out.events) handle(e);
  }

  function handle(e) {
    lastEl.textContent = 'آخر إيماءة: ' + gestureLabel(app, e.key);
    // جمل المواقف
    const ph = cfg.phrases.find((p) => p.key === e.key);
    if (ph) showPhrase(ph.text);
    // طوارئ
    if (cfg.sos.enabled && cfg.sos.key && e.key === cfg.sos.key) startSos();
    // حاسوب (محاكاة داخل المتصفح)
    const r = arm.feed({ key: e.key, t: e.t });
    if (r?.armed) { toast('تم تسليح التحكم ✔', 'ok'); renderArm(); }
    else if (r?.disarmed) { toast('تم قفل التحكم'); renderArm(); }
    else if (r?.action) simulate(r.action);
  }

  // ---------- جمل المواقف ----------
  function showPhrase(text) {
    document.querySelector('.bigphrase')?.remove();
    const el = h('div.bigphrase', { onclick: () => el.remove(), role: 'alert' }, h('div', text, h('small', 'اضغط في أي مكان للإغلاق')));
    document.body.append(el);
    app.say(text);
    if (navigator.vibrate) navigator.vibrate(60);
    setTimeout(() => el.remove(), 9000);
  }

  function renderPhrases() {
    phrasesEl.innerHTML = '';
    const list = h('div.list');
    if (!cfg.phrases.length) list.append(h('p.small.muted', 'لا توجد جمل بعد. اربط إيماءة بجملة تظهر بخط كبير وتُنطَق بصوت عالٍ لمن أمامك.'));
    cfg.phrases.forEach((p, i) => list.append(h('div.item', h('div.grow', h('div.ttl', { style: { whiteSpace: 'normal' } }, p.text), h('div.meta', 'الإيماءة: ' + gestureLabel(app, p.key))),
      h('button.iconbtn', { 'aria-label': 'جرّب', onclick: () => showPhrase(p.text) }, icon('play')),
      h('button.iconbtn', { 'aria-label': 'حذف', onclick: () => { cfg.phrases.splice(i, 1); save(); renderPhrases(); } }, icon('trash')))));
    const gSel = h('select', gestureOptions(app).map((o) => h('option', { value: o.key }, o.label)));
    const tx = h('input', { type: 'text', placeholder: 'نص الجملة' });
    const chips = h('div.row', { style: { gap: '6px' } }, PHRASE_PRESETS.map((t) => h('button.btn.sm', { type: 'button', onclick: () => { tx.value = t; } }, t)));
    phrasesEl.append(list, h('div.sep'), h('label.field', h('span', 'الإيماءة'), gSel), h('label.field', h('span', 'الجملة'), tx), chips,
      btn('أضف الجملة', { cls: 'primary', ic: 'plus', onclick: () => {
        const t = tx.value.trim(); if (!t) { toast('اكتب الجملة', 'bad'); return; }
        if (cfg.phrases.some((p) => p.key === gSel.value)) { toast('هذه الإيماءة مربوطة بجملة بالفعل', 'bad'); return; }
        cfg.phrases.push({ key: gSel.value, text: t }); save(); renderPhrases();
      } }));
  }

  // ---------- طوارئ ----------
  function renderSos() {
    sosBox.innerHTML = '';
    const s = cfg.sos;
    const en = h('input', { type: 'checkbox', checked: s.enabled, onchange: (e) => { s.enabled = e.target.checked; siren.prime(); if (s.enabled && s.location) askLocation(); save(); } });
    const fabSw = h('input', { type: 'checkbox', checked: s.bubble !== false, onchange: (e) => { s.bubble = e.target.checked; save(); applyFab(); } });
    const gSel = h('select', h('option', { value: '' }, 'اختر إيماءة'), gestureOptions(app).map((o) => h('option', { value: o.key, selected: o.key === s.key }, o.label)));
    gSel.onchange = () => { s.key = gSel.value || null; save(); };
    const phone = h('input', { type: 'tel', value: s.phone, placeholder: 'رقم شخص تثق به (اختياري)', dir: 'ltr', oninput: (e) => { s.phone = e.target.value; save(); } });
    const msg = h('textarea', { oninput: (e) => { s.message = e.target.value; save(); } }, s.message);
    const loc = h('input', { type: 'checkbox', checked: s.location, onchange: (e) => { s.location = e.target.checked; if (s.location) askLocation(); save(); } });
    sosBox.append(
      h('label.switch', h('span', 'تفعيل الطوارئ'), en),
      h('label.switch', h('span', 'فقاعة طوارئ عائمة دائمة على الشاشة (تعمل بلا كاميرا، بضغطة واحدة)'), fabSw),
      h('label.field', h('span', 'إيماءة الطوارئ (اختر شيئاً لا تفعله عن غير قصد)'), gSel),
      h('label.field', h('span', 'رقم للاتصال/الرسالة'), phone),
      h('label.field', h('span', 'نص الرسالة'), msg),
      h('label.switch', h('span', 'أرفق موقعي'), loc),
      h('p.small.muted', 'عند الإيماءة أو الضغط على الفقاعة: عدّ تنازلي 5 ثوانٍ يمكنك إلغاؤه، ثم صفّارة عالية ووميض واهتزاز وجملة منطوقة وأزرار اتصال/رسالة جاهزة. الفقاعة تعمل حتى والكاميرا مغلقة. المتصفح لا يسمح بإرسال رسالة أو إجراء مكالمة تلقائياً، فتحتاج ضغطة واحدة. الإيماءة تعمل فقط والتطبيق مفتوح والكاميرا شغّالة.'),
      btn('جرّب الطوارئ الآن', { cls: 'danger', ic: 'warn', onclick: () => { siren.prime(); startSos(true); } }));
  }

  function askLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => { lastPos = { lat: p.coords.latitude, lng: p.coords.longitude }; }, () => {}, { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
  }

  function startSos(test = false) {
    if (sosOverlay) return;
    siren.prime();
    if (fab) fab.hidden = true;    // لا تشغّل الفقاعة أثناء الإنذار
    if (cfg.sos.location) askLocation();
    let n = cfg.sos.countdown || 5;
    const title = h('h1', 'طوارئ');
    const sub = h('p', { style: { fontSize: '1.3rem' } }, `سيبدأ الإنذار بعد ${n}…`);
    const cancel = btn('ألغِ — لا توجد طوارئ', { cls: 'block', onclick: closeSos });
    cancel.style.background = '#fff'; cancel.style.color = '#b3170a';
    sosOverlay = h('div.sos', { role: 'alertdialog' }, title, sub, cancel);
    document.body.append(sosOverlay);
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    clearInterval(sosTimer);
    sosTimer = setInterval(() => {
      n--;
      if (n > 0) { sub.textContent = `سيبدأ الإنذار بعد ${n}…`; return; }
      clearInterval(sosTimer);
      fireSos(title, sub, cancel, test);
    }, 1000);
  }

  function fireSos(title, sub, cancel, test) {
    sosOverlay.classList.add('flash');
    title.textContent = test ? 'تجربة طوارئ' : 'أحتاج مساعدة!';
    const links = buildSosLinks(cfg.sos, lastPos);
    sub.textContent = links.msg;
    if (!test) siren.start();
    app.say(cfg.sos.message, { rate: 0.9 });
    const vib = setInterval(() => navigator.vibrate?.([400, 200, 400]), 1200);
    const say = setInterval(() => app.say(cfg.sos.message, { rate: 0.9 }), 7000);
    sosOverlay._clear = () => { clearInterval(vib); clearInterval(say); };
    const actions = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '360px' } });
    const link = (label, href) => { const a = h('a.btn', { href, style: { background: '#fff', color: '#b3170a', textDecoration: 'none', minHeight: '54px' } }, label); return a; };
    if (links.tel) actions.append(link('اتصل الآن', links.tel));
    actions.append(link('رسالة واتساب جاهزة', links.wa), link('رسالة نصية جاهزة', links.sms));
    if (navigator.share) actions.append(btn('مشاركة الرسالة', { cls: 'block', onclick: () => navigator.share({ text: links.msg }).catch(() => {}) }));
    sosOverlay.insertBefore(actions, cancel);
    cancel.textContent = 'إيقاف الإنذار';
  }

  function closeSos() {
    clearInterval(sosTimer);
    siren.stop();
    sosOverlay?._clear?.();
    sosOverlay?.remove(); sosOverlay = null;
    navigator.vibrate?.(0);
    app.tts.cancel();
    applyFab();
  }

  // ---------- التحكم بالحاسوب ----------
  function renderArm() {
    if (!armEl) return;
    if (cfg.pc.alwaysArm) { armEl.className = 'chip-status ok'; armEl.textContent = 'مفعّل دائماً ✔'; return; }
    const t = (performance.now() - app.cam.t0) / 1000;
    const on = arm.isArmed(t);
    armEl.className = 'chip-status ' + (on ? 'ok' : '');
    armEl.textContent = on ? `مُسلَّح ${Math.ceil(arm.remaining(t))}ث` : 'مقفول — اعرض إيماءة التسليح';
  }

  function simulate(action) {
    const a = ACTIONS.find((x) => x.id === action);
    if (action === 'right' || action === 'pagedown' || action === 'down') slide = Math.min(8, slide + 1);
    else if (action === 'left' || action === 'pageup' || action === 'up') slide = Math.max(1, slide - 1);
    else if (action === 'home') slide = 1; else if (action === 'end') slide = 8;
    simEl.querySelector('.n').textContent = `${slide} / 8`;
    simEl.querySelector('.k').textContent = a ? a.label : action;
    simEl.animate([{ transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 200 });
    renderArm();
  }

  function renderPc() {
    pcBox.innerHTML = '';
    const pc = cfg.pc;
    const opts = gestureOptions(app);
    const sel = (value, onchange, optList) => { const s = h('select', optList.map((o) => h('option', { value: o.key ?? o.id, selected: (o.key ?? o.id) === value }, o.label))); s.onchange = () => onchange(s.value); return s; };
    const secs = h('input', { type: 'text', inputMode: 'numeric', value: String(pc.armSeconds), onchange: (e) => { pc.armSeconds = Math.max(5, Math.min(300, +e.target.value || 25)); e.target.value = pc.armSeconds; save(); } });
    const always = h('input', { type: 'checkbox', checked: !!pc.alwaysArm, onchange: (e) => { pc.alwaysArm = e.target.checked; save(); arm.setConfig(pc); renderArm(); } });
    const rows = h('div.list');
    pc.bindings.forEach((b, i) => rows.append(h('div.item', { style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
      sel(b.key, (v) => { b.key = v; save(); }, opts), h('div.row', h('div.grow', sel(b.action, (v) => { b.action = v; save(); }, ACTIONS)), h('button.iconbtn', { 'aria-label': 'حذف', onclick: () => { pc.bindings.splice(i, 1); save(); renderPc(); } }, icon('trash'))))));
    simEl = h('div.card', { style: { alignItems: 'center', textAlign: 'center', background: 'var(--surface2)' } }, h('span.small.muted', 'محاكاة داخل المتصفح (لا تضغط أزرار حاسوبك)'), h('div.bigword.n', `${slide} / 8`), h('span.kbd.k', '—'));
    armEl = h('span.chip-status', '');
    // ضبط سريع لتنقّل الشرائح: اليسار = التالي، اليمين = السابق
    const applyNav = () => {
      const rest = pc.bindings.filter((b) => b.key !== 'builtin:swipe_left' && b.key !== 'builtin:swipe_right');
      pc.bindings = [
        { key: 'builtin:swipe_left', action: 'right' },
        { key: 'builtin:swipe_right', action: 'left' },
        ...rest,
      ];
      arm.setConfig(pc); save(); renderPc(); toast('تم الضبط: يسار = التالي، يمين = السابق', 'ok');
    };
    // بطاقة التثبيت خطوة بخطوة (تُبنى منفصلةً لسهولة القراءة)
    const detailRow = (label, href) => h('a.btn.ghost.sm', { href, download: href.startsWith('http') ? undefined : href.split('/').pop(), target: href.startsWith('http') ? '_blank' : null, rel: 'noopener' }, icon('download'), h('span', label));
    const stepsCard = h('details', { open: true }, h('summary', 'تثبيت برنامج الحاسوب خطوة بخطوة'),
      h('ol.small', { style: { paddingInlineStart: '20px', lineHeight: '1.9' } },
        h('li', 'ثبّت Python 3.10–3.12 من python.org، وفعّل خيار «Add Python to PATH» أثناء التثبيت.'),
        h('li', 'نزّل ثلاثة ملفات وضعها في مجلد واحد: ', h('b', 'ain_pc_controller.py'), '، و', h('b', 'control_config.json'), ' من زر «صدّر إعداد الحاسوب»، و', h('b', 'hand_landmarker.task'), ' من الرابط أدناه.'),
        h('li', 'افتح Terminal أو CMD في المجلد، ونفّذ مرة واحدة: ', h('span.kbd', 'py -m pip install opencv-python mediapipe numpy')),
        h('li', 'أو استعمل ', h('b', 'run_windows.bat'), ' — يثبّت المكتبات ويشغّل البرنامج بضغطة واحدة.')),
      h('p.small.muted', 'إذا لم تظهر الكاميرا فأغلق أي برنامج آخر يستخدمها. وإذا فشل تثبيت mediapipe فاستخدم Python 3.11.'),
      h('div.row',
        detailRow('تحميل Python', 'https://www.python.org/downloads/'),
        detailRow('نموذج اليد', 'vendor/hand_landmarker.task'),
        detailRow('برنامج التحكم', 'pc/ain_pc_controller.py')));
    // بطاقة يوم اللجنة: عرض جاهز يُدار بالإيماءات
    const demoRow = h('div.row',
      h('a.btn.primary', { href: 'demo/hudhaifa_demo.pptx', download: 'hudhaifa_demo.pptx', style: { textDecoration: 'none' } }, icon('download'), h('span', 'نزّل عرض اللجنة التجريبي')),
      h('a.btn.ghost', { href: 'pc/run_windows.bat', download: 'run_windows.bat', style: { textDecoration: 'none' } }, icon('download'), h('span', 'تشغيل بضغطة')),
      h('a.btn.ghost', { href: 'pc/requirements.txt', download: 'requirements.txt', style: { textDecoration: 'none' } }, icon('download'), h('span', 'المتطلبات')));
    const committeeCard = h('div.card', h('h2', 'يوم اللجنة'),
      h('p.small.muted', 'عرض تقديمي جاهز مبني لهذا المشروع — شريحة «جرّبها معنا الآن» تدعو أستاذك أن يلوّح كفه، فتتجاوب الشرائح مع يده بلا لمس.'),
      demoRow,
      h('ol.small', { style: { paddingInlineStart: '20px', lineHeight: '1.9' } },
        h('li', 'قبل اليوم: نزّل ', h('b', 'عرض اللجنة التجريبي'), ' وافتحه في PowerPoint للتأكد. شريحة «جرّبها معنا الآن» هي الشريحة الخامسة.'),
        h('li', 'صدّر ', h('b', 'إعداد الحاسوب'), ' (الزر أعلاه) وضعه في مجلد واحد مع ', h('b', 'run_windows.bat'), ' و', h('b', 'ain_pc_controller.py'), ' و', h('b', 'hand_landmarker.task'), '.'),
        h('li', 'نزّل Python إن لم يكن مثبتاً، ثم اضغط ', h('b', 'تشغيل بضغطة'), ' — أول ضغطة تثبّت المكتبات وحدها.'),
        h('li', 'فعّل «التحكم مفعّل دائماً» أعلى هذا القسم، واضغط F5 في PowerPoint.'),
        h('li', 'قف أمام كاميرا الحاسوب: لوِّح لليسار للشريحة التالية ولليمين للسابقة — تتحكم في العرض الحي وأنت واقف بعيداً عن الكمبيوتر.'),
        h('li', 'لحظة الإبهار الثانية: افتح التطبيق على الهاتف، واضغط فقاعة الطوارئ الحمراء العائمة — صفّارة ورسالة جاهزة أمام الجميع.')));
    pcBox.append(
      h('p.small.muted', 'تشغّل برنامجاً صغيراً على الحاسوب (بكاميرته) فيضغط الأزرار عند إيماءاتك: تلويح اليد في الهواء لليسار = الشريحة التالية في PowerPoint، ولليمين = الشريحة السابقة، مع تحكم بالفيديو والصوت. جرّب الإيماءات هنا أولاً.'),
      h('label.switch', h('span', 'التحكم مفعّل دائماً (بلا إيماءة تسليح — أخطر على الأخطاء العشوائية)'), always),
      h('label.field', h('span', 'إيماءة التسليح (تثبّتها لتفعيل التحكم، فلا تضغط الأزرار إلا بعدها) — تُستعمل إن أطفيت الخيار أعلاه'), sel(pc.armKey, (v) => { pc.armKey = v; arm.setConfig(pc); save(); }, opts)),
      h('label.field', h('span', 'مدة بقاء التحكم مسلَّحاً بعد آخر أمر (ثوانٍ)'), secs),
      h('div.row.between', h('b', 'الأوامر'), armEl),
      h('div.row.between', { style: { gap: '8px' } },
        h('span.small.muted', 'الافتراضي: تحريك اليد لليسار = التالي، ولليمين = السابق'),
        btn('اضبط تنقّل الشرائح', { cls: 'ghost sm', ic: 'bolt', onclick: applyNav })),
      rows,
      btn('أضف أمراً', { cls: 'ghost', ic: 'plus', onclick: () => { pc.bindings.push({ key: opts[0].key, action: 'right' }); save(); renderPc(); } }),
      simEl,
      h('div.row', btn('صدّر إعداد الحاسوب', { cls: 'primary', ic: 'download', onclick: exportPc }), h('a.btn.ghost', { href: 'pc/ain_pc_controller.py', download: 'ain_pc_controller.py' }, icon('download'), h('span', 'برنامج الحاسوب'))),
      stepsCard,
      committeeCard,
    );
    renderArm();
  }

  function exportPc() {
    const payload = buildPcConfig({ engine: app.engine, pc: cfg.pc, holdSec: app.settings.holdSec });
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'control_config.json' });
    document.body.append(a); a.click(); a.remove();
    toast('تم تنزيل control_config.json', 'ok');
  }

  return {
    mount(el) {
      root = el;
      slot = h('div');
      lastEl = h('span.chip-status', 'آخر إيماءة: —');
      phrasesEl = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
      sosBox = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
      pcBox = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
      buildFab();
      // تحضير إعدادات الأوامر مبكراً كي تعمل فقاعة الطوارئ حتى قبل فتح القسم
      app.store.getMeta('commands', null).then((c) => { if (!cfg) { cfg = mergeCommands(c); applyFab(); } });
      root.append(
        h('div.card', h('h2', 'أوامر بالإيماءات'), h('p.sub', 'اجعل إيماءة تنطق جملة، أو تستدعي النجدة، أو تقلّب شرائح العرض على الحاسوب.')),
        slot, h('div.row', lastEl),
        h('div.card', h('h2', 'جمل المواقف'), phrasesEl),
        h('div.card', h('h2', 'طوارئ SOS'), sosBox),
        h('div.card', h('h2', 'التحكم بالحاسوب'), pcBox));
    },
    async show() {
      cfg = mergeCommands(await app.store.getMeta('commands', null));
      arm = new ArmState(cfg.pc);
      applyFab();
      app.mountStage(slot);
      off?.(); off = app.cam.onFrame(onFrame);
      renderPhrases(); renderSos(); renderPc();
      clearInterval(tickTimer); tickTimer = setInterval(renderArm, 500);
      document.addEventListener('pointerdown', () => siren.prime(), { once: true });
    },
    hide() { off?.(); off = null; clearInterval(tickTimer); app.unmountStage(); },
  };
}
void sheet;
