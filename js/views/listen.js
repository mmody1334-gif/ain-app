// اسمع: كلام السامع (ميكروفون أو كتابة) ← نص ← إشارات مرسومة بيدٍ ثلاثية الأبعاد من نفس النقاط المسجَّلة.
// يدعم محادثة الوجه لوجه بالشاشة المنقسمة وكاشف أصوات الخطر المحيطة للصم.
import { h, btn, icon, toast, sleep, haptic } from '../ui.js';
import { HandView, animOf } from '../hand3d.js';
import { matchSentence, normalizeAr } from '../arabic.js';
import { ARABIC_RE } from '../alphabet.js';
import { describePose, describeMotion } from '../learn.js';

export function createListenView(app) {
  let root, input, chipsEl, capEl, canvas, view, micBtn, rec = null, token = 0, items = [], playing = false, speed = 1, quick, desc, playBtn;
  let f2fBtn, f2fModal = null, f2fRec = null;
  let audioCtx = null, analyser = null, micStream = null, soundTimer = null;
  let guardianActive = false;

  function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n, f) => cs.getPropertyValue(n).trim() || f;
    return { line: g('--ink', '#222'), grid: g('--line', '#ccc'), glow: g('--accent-soft', '#e4e2fb'), trail: g('--accent', '#4640d4'), ok: g('--ok', '#14925f'), bad: g('--bad', '#cf3f27') };
  }

  /** حروف الكلمة غير المعروفة: نبحث عن إشارة كل حرف في القاموس لتهجئتها. */
  function spellOf(text) {
    const out = [];
    for (const ch of String(text || '')) if (ARABIC_RE.test(ch)) out.push({ ch, sign: app.index.map.get(normalizeAr(ch)) || null });
    return out;
  }
  const hasSpell = (it) => !!it.sign || !!(it.letters && it.letters.some((l) => l.sign));

  function renderChips() {
    chipsEl.innerHTML = '';
    if (!items.length) { chipsEl.append(h('span.muted.small', 'اكتب جملة أو اضغط على الميكروفون وتكلّم…')); return; }
    items.forEach((it, i) => {
      const c = h('span.word' + (it.sign ? '' : '.unknown'), { dataset: { i } }, it.text);
      if (it.sign) c.onclick = () => playFrom(i);
      else {
        if (it.letters && it.letters.some((l) => l.sign)) {
          c.onclick = () => playFrom(i);
          c.append(h('small.spell', 'تهجئة'));
        }
        c.append(h('button.btn.sm', { style: { marginInlineStart: '8px', padding: '0 8px', minHeight: '26px' }, title: 'أضف إشارة لهذه الكلمة', onclick: (ev) => { ev.stopPropagation(); app.pendingNew = { word: it.text }; app.go('dict'); } }, '+'));
      }
      chipsEl.append(c);
    });
  }

  function mark(i) { [...chipsEl.children].forEach((c, k) => c.classList.toggle('active', k === i)); }

  function setItems(text) {
    stop();
    items = matchSentence(text, app.index).map((it) => (it.sign ? it : { ...it, letters: spellOf(it.text) }));
    renderChips();
    const known = items.filter(hasSpell).length;
    if (items.length && !known) toast('لا توجد إشارات لهذه الكلمات في قاموسك بعد', 'bad');
    else if (known) playFrom(items.findIndex(hasSpell));
  }

  function stop() {
    token++;
    playing = false;
    if (playBtn) playBtn.replaceChildren(icon('play'), h('span', 'شغّل'));
    capEl.textContent = '';
    mark(-1);
  }

  async function playOne(sign, label) {
    const a = animOf(sign);
    if (!a) return;
    capEl.textContent = label;
    desc.textContent = sign.kind === 'motion' ? describeMotion(sign) : describePose(sign.ref || sign.samples?.[0]);
    const delay = Math.round((a.dt || 80) / speed);
    for (const f of a.frames) {
      view.setPose(f.p, f.off);
      await sleep(delay);
    }
  }

  async function playFrom(idx) {
    stop();
    const my = ++token;
    playing = true;
    playBtn.replaceChildren(icon('stop'), h('span', 'إيقاف'));
    for (let i = idx; i < items.length; i++) {
      if (my !== token) return;
      const it = items[i];
      mark(i);
      if (it.sign) { await playOne(it.sign, it.sign.word); continue; }
      const letters = it.letters || [];
      if (!letters.some((l) => l.sign)) { capEl.textContent = it.text + ' — لا إشارة'; await sleep(450); continue; }
      for (const L of letters) {
        if (my !== token) return;
        if (!L.sign) { capEl.textContent = L.ch + ' —'; await sleep(260); continue; }
        await playOne(L.sign, L.ch);
      }
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

  // ---------- محادثة الوجه لوجه بالشاشة المنقسمة ----------
  function openFaceToFace() {
    haptic('medium');
    let partnerText = 'اضغط على الميكروفون وتحدث…';
    let deafText = input.value || 'مرحباً، أنا أستخدم لغة الإشارة.';

    f2fModal = h('div.f2f-modal',
      // النصف العلوي: مقلوب 180 درجة للسامع المقابل
      h('div.f2f-top',
        h('span.pill.dim', 'واجهة الشخص المقابل 👤 (مقلوبة نحوك)'),
        h('div.f2f-partner-text', deafText),
        h('div.f2f-bar',
          btn('انطق كلام الأصم 🔊', {
            cls: 'primary',
            ic: 'speaker',
            onclick: () => app.say(deafText),
          }),
          btn('اضغط وتكلّم أنت 🎙️', {
            cls: 'primary',
            ic: 'mic',
            style: { minHeight: '52px' },
            onclick: () => {
              if (f2fRec) { try { f2fRec.stop(); } catch (_) {} return; }
              f2fRec = app.stt.create(app.settings.sttLang, {
                onInterim: (t) => { partnerText = t; partnerP.textContent = t; },
                onFinal: (t) => {
                  partnerText = t; partnerP.textContent = t;
                  myP.textContent = 'قال المقابل: ' + t;
                  setItems(t);
                },
                onEnd: () => { f2fRec = null; },
              });
              try { f2fRec.start(); toast('تكلّم أنت الآن…'); } catch (_) { f2fRec = null; }
            },
          })
        )
      ),
      // النصف السفلي: موجه للمستخدم الأصم
      h('div.f2f-bottom',
        h('span.pill.dim', 'واجهتك أنت 📱'),
        h('div.f2f-my-text', partnerText),
        h('div.row.center', { style: { gap: '6px' } },
          ['نعم ✔', 'لا ✖', 'شكراً لك', 'بكم هذا؟', 'لحظة من فضلك'].map((w) =>
            btn(w, {
              cls: 'ghost sm',
              onclick: () => {
                deafText = w;
                f2fModal.querySelector('.f2f-partner-text').textContent = w;
                app.say(w);
                haptic('light');
              },
            })
          )
        ),
        h('div.f2f-bar',
          btn('إنهاء محادثة الوجه لوجه ✕', {
            cls: 'ghost block grow',
            onclick: () => {
              try { f2fRec?.stop(); } catch (_) {}
              f2fModal.remove();
              f2fModal = null;
              toast('عُدت للوضع العادي');
            },
          })
        )
      )
    );

    const partnerP = f2fModal.querySelector('.f2f-top .f2f-partner-text');
    const myP = f2fModal.querySelector('.f2f-bottom .f2f-my-text');
    document.body.append(f2fModal);
  }

  // ---------- كاشف أصوات الخطر والإنذارات للصم ----------
  async function startAcousticGuardian() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      guardianActive = true;
      toast('حارس أصوات الخطر يعمل الآن في الخلفية ✔', 'ok');

      let alertCooldown = 0;
      soundTimer = setInterval(() => {
        if (!guardianActive || !analyser) return;
        analyser.getByteFrequencyData(dataArray);

        const sampleRate = audioCtx.sampleRate || 44100;
        const binSize = (sampleRate / 2) / bufferLength;
        const startBin = Math.floor(800 / binSize);
        const endBin = Math.floor(3000 / binSize);

        let sirenEnergy = 0, totalEnergy = 0;
        for (let i = 0; i < bufferLength; i++) {
          totalEnergy += dataArray[i];
          if (i >= startBin && i <= endBin) sirenEnergy += dataArray[i];
        }

        const avgLevel = totalEnergy / bufferLength;
        const sirenRatio = totalEnergy > 0 ? sirenEnergy / totalEnergy : 0;
        const now = Date.now();

        if (now - alertCooldown > 4500 && (avgLevel > 115 || (avgLevel > 70 && sirenRatio > 0.45))) {
          alertCooldown = now;
          haptic([120, 60, 120, 60, 300]);
          document.body.classList.add('danger-flash-border');
          setTimeout(() => document.body.classList.remove('danger-flash-border'), 2500);
          toast('🚨 رُصد صوت صفارة إنذار أو بوق سيارة عالي!', 'warn');
        }
      }, 180);
    } catch (e) {
      toast('لم نتمكن من تشغيل كاشف الأصوات', 'bad');
    }
  }

  function stopAcousticGuardian() {
    guardianActive = false;
    clearInterval(soundTimer);
    try { micStream?.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { audioCtx?.close(); } catch (_) {}
    document.body.classList.remove('danger-flash-border');
    toast('تم إيقاف كاشف أصوات الخطر');
  }

  return {
    showText(text) {
      if (!input) return;
      input.value = String(text || '');
      setTimeout(() => setItems(input.value), 60);
    },
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

      f2fBtn = btn('محادثة وجهاً لوجه ⇄', {
        cls: 'ghost',
        ic: 'flip',
        title: 'شاشة مقلوبة للطرف المقابل للتواصل السريع',
        onclick: openFaceToFace,
      });

      const soundGuardianCb = h('input', {
        type: 'checkbox',
        checked: guardianActive,
        onchange: (e) => {
          if (e.target.checked) startAcousticGuardian();
          else stopAcousticGuardian();
        },
      });

      const cardGuardian = h('div.card',
        h('h2', 'حارس أصوات الخطر (للصم)'),
        h('p.sub', 'يراقب الأصوات المحيطة في الخلفية وينبهك بوميض أحمر واهتزاز متكرر عند سماع صفارات إنذار أو أصوات قوية.'),
        h('label.switch', h('span', 'تفعيل كاشف أصوات الخطر بالمايك'), soundGuardianCb)
      );

      root.append(
        h('div.card', h('h2', 'اسمع ← شاهد الإشارة'), h('p.sub', 'يتكلم السامع، فيحوّل التطبيق كلامه إلى نص ثم يرسم الإشارات المقابلة من نفس النقاط المسجّلة في قاموسك.'),
          h('div.row', h('div.grow', input), micBtn, btn('', { ic: 'chev', cls: 'primary', title: 'اعرض', onclick: () => setItems(input.value) }), f2fBtn)),
        box,
        h('div.row', playBtn, h('div.grow', spd)),
        side,
        desc,
        chipsEl,
        cardGuardian,
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
    hide() {
      stop();
      try { rec?.stop(); } catch (_) { /* لا شيء */ }
      try { f2fRec?.stop(); } catch (_) { /* لا شيء */ }
      if (f2fModal) { f2fModal.remove(); f2fModal = null; }
    },
  };
}
