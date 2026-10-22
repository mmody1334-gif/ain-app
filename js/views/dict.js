// قاموسي: أضف إشارات جديدة بتسجيل نقاط يدك، وراجع التشابه بينها، وصدّر/استورد القاموس.
import { h, btn, icon, toast, sheet, confirmSheet, uid, sleep } from '../ui.js';
import { HandView, animOf } from '../hand3d.js';
import { captureStatic, captureMotionTake, countdown, Cancel } from '../recorder.js';
import { describePose, describeMotion, compareToTarget } from '../learn.js';
import { evaluateSeparability, pairSeparation } from '../classifier.js';
import { normalizeAr, FINGER_WORDS } from '../arabic.js';
import { SHAPES } from '../handModel.js';
import { BUILTIN_MOTIONS, dtw } from '../motion.js';

const KIND = { static: 'ثابتة', motion: 'متحركة', builtin: 'جاهزة' };
const FINGER_KEYS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n, f) => cs.getPropertyValue(n).trim() || f;
  return { line: g('--ink', '#222'), grid: g('--line', '#ccc'), glow: g('--accent-soft', '#e4e2fb'), trail: g('--accent', '#4640d4'), ok: g('--ok', '#14925f'), bad: g('--bad', '#cf3f27') };
}

/** تقرير التشابه بين إشارة جديدة وباقي الإشارات. يعيد قائمة أسطر. */
export function similarityFor(app, sign) {
  const notes = [];
  if (sign.kind === 'static') {
    const clf = app.engine.clf, data = app.engine.trainData;
    if (!clf || !data || data.length < 2) return notes;
    const seps = pairSeparation(clf, data).filter((p) => p.a === sign.id || p.b === sign.id);
    for (const p of seps) {
      const otherId = p.a === sign.id ? p.b : p.a;
      const other = app.signs.find((s) => s.id === otherId);
      if (!other) continue;
      const level = p.separation < 1.0 ? 'warn' : p.separation < 1.8 ? 'mid' : 'ok';
      let diff = '';
      if (sign.ref && other.ref) {
        const r = compareToTarget(Float32Array.from(sign.ref), Float32Array.from(other.ref), { allowMirror: false });
        const bad = FINGER_KEYS.filter((k) => r.fingers[k] === 'bad').map((k) => FINGER_WORDS[k]);
        diff = bad.length ? `الفرق الأساسي: ${bad.join('، ')}` : 'لا فرق واضح في الأصابع؛ غيّر اتجاه الكف أو وضعه';
        if (r.orient > 38) diff = `الأصابع في اتجاه مختلف (${Math.round(r.orient)}°)`;
      }
      notes.push({ level, a: sign.word, b: other.word, separation: p.separation, diff });
    }
  } else if (sign.kind === 'motion' && sign.takes?.length) {
    for (const o of app.signs) {
      if (o.id === sign.id || o.kind !== 'motion' || !o.takes?.length) continue;
      let best = 1e9;
      for (const a of sign.takes) for (const b of o.takes) best = Math.min(best, dtw(Float32Array.from(a), Float32Array.from(b)));
      const thr = Math.max(app.engine.bank.signs.get(sign.id)?.thr || 0.3, app.engine.bank.signs.get(o.id)?.thr || 0.3);
      const level = best < thr ? 'warn' : best < thr * 1.6 ? 'mid' : 'ok';
      notes.push({ level, a: sign.word, b: o.word, separation: best / thr, diff: level === 'ok' ? '' : 'الحركتان متقاربتان؛ غيّر المسار أو السرعة أو شكل اليد' });
    }
  }
  return notes.sort((x, y) => x.separation - y.separation);
}

function renderNotes(notes) {
  if (!notes.length) return h('p.small.muted', 'لا توجد إشارات أخرى للمقارنة بعد.');
  return h('div.list', notes.slice(0, 6).map((n) => h('div.pair' + (n.level === 'ok' ? '' : '.' + n.level), { style: { flexDirection: 'column', alignItems: 'stretch', gap: '4px' } },
    h('div.row.between', h('span', h('b', n.a), ' ↔ ', h('b', n.b)), h('span.small', n.level === 'warn' ? 'متشابهتان جداً' : n.level === 'mid' ? 'قريبتان' : 'واضحتان')),
    n.diff ? h('span.small', n.diff) : null)));
}

export function createDictView(app) {
  let root, listEl, searchEl, filter = '';

  // ---------- القائمة ----------
  function renderList() {
    listEl.innerHTML = '';
    const q = normalizeAr(filter);
    const signs = app.signs.filter((s) => !q || normalizeAr(s.word).includes(q));
    if (!signs.length) { listEl.append(h('div.empty', app.signs.length ? 'لا نتائج.' : 'القاموس فارغ. اضغط «إشارة جديدة» وسجّل أول إشارة بيدك.')); return; }
    for (const s of signs) {
      const count = s.kind === 'static' ? `${s.samples?.length || 0} عيّنة` : s.kind === 'motion' ? `${s.takes?.length || 0} لقطات` : (SHAPES.find((x) => x.id === s.rule)?.name || BUILTIN_MOTIONS.find((x) => x.id === s.rule)?.name || '');
      listEl.append(h('div.item',
        h('div.grow', h('div.ttl', s.word), h('div.meta', h('span.badge.' + s.kind, KIND[s.kind]), ' ', count, s.source === 'starter' ? ' · من المشروع الأصلي' : '')),
        h('button.iconbtn', { 'aria-label': 'عرض', onclick: () => previewSign(s) }, icon('eye')),
        h('button.iconbtn', { 'aria-label': 'حذف', onclick: async () => { if (await confirmSheet('حذف إشارة', `حذف «${s.word}» نهائياً؟`, 'احذف')) { await app.removeSign(s.id); toast('تم الحذف'); } } }, icon('trash'))));
    }
  }

  function previewSign(s) {
    let view;
    sheet(s.word, (close) => {
      const canvas = h('canvas');
      const box = h('div.avatar-box', { style: { aspectRatio: '1 / 0.8' } }, canvas, h('div.hint', 'اسحب لتدوير اليد'));
      const a = animOf(s);
      const desc = s.kind === 'motion' ? describeMotion(s) : (s.ref ? describePose(Float32Array.from(s.ref)) : '');
      setTimeout(() => {
        view = new HandView(canvas, { mirror: true, colors: themeColors() });
        if (a) { if (a.frames.length > 1) view.play(a); else view.setPose(a.frames[0].p); }
      }, 30);
      const notes = similarityFor(app, s);
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, box, h('p.small.muted', desc),
        h('div.row', btn('انطق', { ic: 'speaker', cls: 'sm', onclick: () => app.say(s.word) }),
          s.kind === 'static' ? btn('أضف عيّنات', { ic: 'plus', cls: 'sm', onclick: () => { close(); openRecorder({ append: s }); } }) : null,
          btn('إعادة تسمية', { cls: 'sm ghost', onclick: () => { close(); renameSign(s); } })),
        notes.length ? h('div', h('h2', { style: { fontSize: '1rem', marginBottom: '6px' } }, 'التشابه مع غيرها'), renderNotes(notes)) : null);
    }, { onClose: () => view?.destroy() });
  }

  function renameSign(s) {
    sheet('إعادة تسمية', (close) => {
      const inp = h('input', { type: 'text', value: s.word });
      const al = h('input', { type: 'text', value: (s.aliases || []).join('، '), placeholder: 'مرادفات (اختياري) مفصولة بفاصلة' });
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, inp, al,
        btn('حفظ', { cls: 'primary', onclick: async () => { const w = inp.value.trim(); if (!w) return; s.word = w; s.aliases = al.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean); await app.saveSign(s, { retrain: false }); close(); renderList(); } }));
    });
  }

  // ---------- المسجّل ----------
  function openRecorder(init = {}) {
    const existing = init.append || null;
    let kind = existing?.kind || 'static';
    let word = existing?.word || init.word || '';
    let aliases = existing?.aliases?.join('، ') || '';
    let samples = [];          // لقطات ثابتة جديدة
    let takes = [], anim = null;
    let busy = false, cancelled = false, stage = 'form';
    const s = sheet(existing ? `إضافة عيّنات: ${existing.word}` : 'إشارة جديدة', (close, body) => {
      const content = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
      const render = () => {
        content.innerHTML = '';
        if (stage === 'form') renderForm();
        else if (stage === 'capture') renderCapture();
        else if (stage === 'saving') content.append(h('div.card', { style: { alignItems: 'center' } }, h('span.spin'), h('p', 'يتعلّم التطبيق إشارتك…'), h('div.meter', { style: { width: '100%' } }, (app._tm = h('i')))));
      };

      function renderForm() {
        const wi = h('input', { type: 'text', value: word, placeholder: 'الكلمة أو الجملة القصيرة، مثل: شكراً', oninput: (e) => { word = e.target.value; }, disabled: !!existing });
        const al = h('input', { type: 'text', value: aliases, placeholder: 'مرادفات (اختياري)، مفصولة بفاصلة', oninput: (e) => { aliases = e.target.value; }, disabled: !!existing });
        const seg = h('div.seg', [['static', 'ثابتة (وضعية يد)'], ['motion', 'متحركة (حركة)']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(kind === v), disabled: !!existing, onclick: (e) => { kind = v; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); help.textContent = helpText(); } }, l)));
        const helpText = () => kind === 'static' ? 'ثبّت يدك على الوضعية نفسها وحرّكها قليلاً (أقرب/أبعد/ميل بسيط) أثناء التسجيل.' : 'ستكرر الحركة 6 مرات. ابدأ بيدك ساكنة ثم نفّذ الحركة بسلاسة.';
        const help = h('p.small.muted', helpText());
        content.append(h('label.field', h('span', 'الكلمة'), wi), h('label.field', h('span', 'مرادفات'), al), h('div.field', h('span.muted.small', 'نوع الإشارة'), seg), help,
          btn('التالي: افتح الكاميرا', { cls: 'primary', ic: 'cam', onclick: () => { if (!word.trim()) { wi.focus(); toast('اكتب الكلمة أولاً', 'bad'); return; } stage = 'capture'; render(); } }));
      }

      function renderCapture() {
        const slot = h('div');
        const info = h('p', { style: { minHeight: '2.6em', fontWeight: 600 }, 'aria-live': 'polite' });
        const prog = h('div.meter', h('i'));
        const dots = h('div.dots');
        const actions = h('div.row');
        const sumEl = h('p.small.muted');
        content.append(h('div.row.between', h('h2', `«${word.trim()}»`), h('span.badge.' + kind, KIND[kind])), slot, info, prog, ...(kind === 'motion' ? [h('div.row.between', dots, h('span.small.muted', 'لقطات الحركة'))] : []), sumEl, actions);
        app.mountStage(slot);
        const center = app.stage.querySelector('[data-hud="center"]');
        const setCount = (n) => { center.innerHTML = ''; if (n > 0) center.append(h('div.countdown', String(n))); };
        const setProg = (v) => { prog.firstChild.style.width = Math.round(v * 100) + '%'; };

        const refreshActions = () => {
          actions.innerHTML = '';
          if (!app.cam.running) { actions.append(btn('شغّل الكاميرا', { cls: 'primary block', ic: 'cam', onclick: async () => { await app.startCamera(); refreshActions(); } })); info.textContent = 'الكاميرا مغلقة.'; return; }
          if (kind === 'static') {
            const total = (existing?.samples?.length || 0) + samples.length;
            sumEl.textContent = samples.length ? `التُقطت ${samples.length} عيّنة جديدة${existing ? ` (المجموع ${total})` : ''}. سجّل جلسة ثانية بزاوية أخرى لدقة أعلى.` : '';
            actions.append(btn(samples.length ? 'جلسة أخرى' : 'ابدأ التسجيل', { cls: samples.length ? 'ghost' : 'primary', ic: 'cam', onclick: doStatic }));
            if (samples.length >= 25) actions.append(btn('حفظ', { cls: 'primary', ic: 'check', onclick: save }));
            if (samples.length) actions.append(btn('', { cls: 'ghost', ic: 'trash', title: 'امسح', onclick: () => { samples = []; refreshActions(); setProg(0); info.textContent = ''; } }));
            if (!samples.length) info.textContent = 'ضع يدك داخل الإطار ثم اضغط «ابدأ».';
          } else {
            dots.innerHTML = '';
            for (let i = 0; i < 6; i++) dots.append(h('i' + (i < takes.length ? '.on' : i === takes.length ? '.cur' : '')));
            sumEl.textContent = takes.length >= 4 ? 'يكفي 4 لقطات؛ كلما زادت اللقطات اتسع تقبّل الاختلافات.' : '';
            actions.append(btn(takes.length ? 'سجّل لقطة أخرى' : 'سجّل أول لقطة', { cls: 'primary', ic: 'cam', onclick: doTake }));
            if (takes.length >= 4) actions.append(btn('حفظ', { cls: 'amber', ic: 'check', onclick: save }));
            if (takes.length) actions.append(btn('', { cls: 'ghost', ic: 'undo', title: 'احذف الأخيرة', onclick: () => { takes.pop(); refreshActions(); } }));
            if (!takes.length) info.textContent = 'اضغط «سجّل»، ابقَ ساكناً ثانية ثم نفّذ الحركة.';
          }
        };

        async function doStatic() {
          if (busy) return; busy = true; actions.querySelectorAll('button').forEach((b) => b.disabled = true);
          try {
            info.textContent = 'استعد…';
            await countdown(3, setCount);
            info.textContent = 'ثبّت يدك وحرّكها قليلاً: أقرب، أبعد، ميل بسيط';
            const r = await captureStatic(app, { seconds: 5.5, target: 75, shouldStop: () => cancelled, onProgress: (n, t, st) => { setProg(n / t); if (st.lost) info.textContent = 'اليد غير ظاهرة! أعدها إلى الإطار'; } });
            if (r.samples.length < 25) info.textContent = 'عيّنات قليلة جداً — تأكد أن يدك ظاهرة بالكامل وثابتة، ثم أعد.';
            else if (r.size < 0.09 * 0.5) info.textContent = 'اليد بعيدة جداً؛ قرّبها للكاميرا وأعد.';
            else { samples = samples.concat(r.samples); info.textContent = `ممتاز! ${r.samples.length} عيّنة.`; }
          } catch (e) { if (!(e instanceof Cancel)) console.error(e); }
          busy = false; setCount(0); refreshActions();
        }

        async function doTake() {
          if (busy) return; busy = true; actions.querySelectorAll('button').forEach((b) => b.disabled = true);
          try {
            info.textContent = 'استعد… ابقَ ساكناً';
            await countdown(2, setCount);
            info.textContent = 'الآن! نفّذ الحركة';
            const r = await captureMotionTake(app, { timeout: 5, shouldStop: () => cancelled, onState: (st) => setProg(st.moving ? 1 : 0.1) });
            if (r.error) info.textContent = 'لم تُلتقط حركة — حرّك يدك أسرع قليلاً وأعد.';
            else { takes.push(r.seq); if (!anim) anim = r.anim; info.textContent = `سُجّلت اللقطة ${takes.length}.`; }
          } catch (e) { if (!(e instanceof Cancel)) console.error(e); }
          busy = false; setCount(0); setProg(0); refreshActions();
        }

        async function save() {
          stage = 'saving'; render();
          const w = word.trim();
          let sign = existing;
          if (!sign) {
            sign = { id: uid(), word: w, aliases: aliases.split(/[,،]/).map((x) => x.trim()).filter(Boolean), kind, source: 'user', created: Date.now() };
            const dup = app.signs.find((x) => normalizeAr(x.word) === normalizeAr(w));
            if (dup && dup.kind === kind) { sign = dup; }
            else if (dup) { toast('توجد إشارة بنفس الكلمة بنوع مختلف؛ تم الحفظ كإشارة منفصلة', ''); }
          }
          if (kind === 'static') {
            let all = (sign.samples || []).concat(samples);
            if (all.length > 260) { const step = all.length / 260; all = Array.from({ length: 260 }, (_, i) => all[Math.floor(i * step)]); }
            sign.samples = all; delete sign.ref;
          } else { sign.takes = (sign.takes || []).concat(takes).slice(-10); if (anim && !sign.anim) sign.anim = anim; }
          const off = app.on('train', (p) => { if (app._tm) app._tm.style.width = Math.round(p * 100) + '%'; });
          await app.saveSign(sign);
          off();
          renderResult(sign);
        }

        function renderResult(sign) {
          content.innerHTML = '';
          const notes = similarityFor(app, sign);
          const worst = notes[0];
          content.append(h('div.card', h('h2', 'تم حفظ «' + sign.word + '»'),
            !notes.length ? h('p.small.muted', 'لا توجد إشارات من النوع نفسه للمقارنة بعد.')
              : worst.level !== 'ok' ? h('p', { style: { color: 'var(--bad)', fontWeight: 600 } }, 'تنبيه: قد يخلط التطبيق بينها وبين إشارات أخرى.')
              : h('p', { style: { color: 'var(--ok)', fontWeight: 600 } }, 'الإشارة واضحة ومختلفة عن الباقي.'),
            notes.length ? renderNotes(notes) : null),
            h('div.row', btn('جرّبها الآن', { cls: 'primary', ic: 'play', onclick: () => { close(); app.go('translate'); } }), btn('إشارة أخرى', { cls: 'ghost', ic: 'plus', onclick: () => { close(); openRecorder({}); } }), btn('تم', { cls: 'ghost', onclick: close })));
        }

        refreshActions();
        if (!app.cam.running) app.startCamera().then(refreshActions);
      }
      render();
      return content;
    }, { persistent: true, onClose: () => { cancelled = true; app.stopCamera(); app.unmountStage(); renderList(); } });
    return s;
  }

  // ---------- إشارات جاهزة ----------
  function openQuickAdd() {
    sheet('إشارات جاهزة بلا تسجيل', (close) => {
      const sel = { rule: null };
      const word = h('input', { type: 'text', placeholder: 'اربطه بكلمة، مثل: لا' });
      const mkItem = (rule, name, kindName, ic) => {
        const b = h('button.item', { type: 'button', style: { border: 0, textAlign: 'start', cursor: 'pointer', color: 'inherit' }, onclick: () => { sel.rule = rule; list.querySelectorAll('.item').forEach((x) => x.style.outline = ''); b.style.outline = '2px solid var(--accent)'; word.focus(); } },
          h('div.grow', h('div.ttl', (ic ? ic + ' ' : '') + name), h('div.meta', kindName)));
        return b;
      };
      const list = h('div.list', { style: { maxHeight: '34vh', overflowY: 'auto' } },
        SHAPES.map((x) => mkItem(x.id, x.name, 'وضعية', x.emoji)), BUILTIN_MOTIONS.map((x) => mkItem(x.id, x.name, 'حركة')));
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        h('p.small.muted', 'اختر شكلاً أو حركة جاهزة ثم اربطها بكلمة. تعمل فوراً بقواعد على نقاط اليد، دون تسجيل أو تدريب.'),
        list, word,
        btn('أضف', { cls: 'primary', ic: 'plus', onclick: async () => {
          const w = word.value.trim();
          if (!sel.rule || !w) { toast('اختر شكلاً واكتب الكلمة', 'bad'); return; }
          if (app.signs.some((x) => x.kind === 'builtin' && x.rule === sel.rule)) { toast('هذا الشكل مربوط بكلمة بالفعل', 'bad'); return; }
          await app.saveSign({ id: uid(), word: w, aliases: [], kind: 'builtin', rule: sel.rule, source: 'user', created: Date.now() }, { retrain: false });
          toast('أُضيفت «' + w + '»', 'ok'); word.value = ''; renderList();
        } }),
        btn('تم', { cls: 'ghost', onclick: close }));
    });
  }

  // ---------- تقرير الخلط ----------
  function openReport() {
    sheet('تقرير الخلط بين الإشارات', (close, body) => {
      const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, h('div.row', h('span.spin'), h('span', 'جارٍ الفحص…')));
      (async () => {
        const data = app.engine.trainData || [];
        if (data.length < 2) { box.innerHTML = ''; box.append(h('p', 'سجّل إشارتين ثابتتين على الأقل للمقارنة.')); return; }
        const clf = app.engine.clf;
        const seps = pairSeparation(clf, data);
        let ev = null;
        try { ev = await evaluateSeparability(data, {}); } catch (e) { /* لا شيء */ }
        box.innerHTML = '';
        const nameOf = (id) => app.signs.find((s) => s.id === id)?.word || id;
        if (ev?.accuracy != null) box.append(h('div.card', h('h2', 'دقة الاختبار على عيّنات لم يرها النموذج'), h('div.bigword', Math.round(ev.accuracy * 100) + '٪'),
          h('p.small.muted', 'تُقاس على آخر 20٪ من تسجيل كل إشارة. تسجيل واحد في جلسة واحدة يعطي دقة أعلى من الواقع؛ سجّل في أوقات وأضواء مختلفة.')));
        box.append(h('h2', 'أقرب الأزواج تشابهاً'));
        const prs = h('div.list');
        for (const p of seps.slice(0, 8)) {
          const lvl = p.separation < 1.0 ? 'warn' : p.separation < 1.8 ? 'mid' : '';
          const sa = app.signs.find((s) => s.id === p.a), sb = app.signs.find((s) => s.id === p.b);
          let diff = '';
          if (sa?.ref && sb?.ref) {
            const r = compareToTarget(Float32Array.from(sa.ref), Float32Array.from(sb.ref), { allowMirror: false });
            const bad = FINGER_KEYS.filter((k) => r.fingers[k] === 'bad').map((k) => FINGER_WORDS[k]);
            diff = bad.length ? 'يختلفان في: ' + bad.join('، ') : 'متقاربتان في الأصابع';
          }
          prs.append(h('div.pair' + (lvl ? '.' + lvl : ''), { style: { flexDirection: 'column', alignItems: 'stretch', gap: '4px' } },
            h('div.row.between', h('span', h('b', nameOf(p.a)), ' ↔ ', h('b', nameOf(p.b))), h('span.small', p.separation < 1 ? 'متشابهتان جداً' : p.separation < 1.8 ? 'قريبتان' : 'واضحتان')),
            h('div.row', h('div.bar' + (lvl ? '.' + lvl : ''), h('i', { style: { width: Math.min(100, p.separation / 4 * 100) + '%' } })), h('span.small', diff))));
        }
        box.append(prs);
        if (ev?.perClass) {
          box.append(h('h2', 'دقة كل إشارة'));
          for (const l of ev.labels) {
            const pc = ev.perClass[l];
            box.append(h('div.row', h('span.grow', nameOf(l)), h('div.bar', { style: { flex: '2' } }, h('i', { style: { width: Math.round(pc.acc * 100) + '%' } })), h('span.small', Math.round(pc.acc * 100) + '٪')));
          }
        }
        box.append(h('div.card', h('h2', 'كيف أحسّن التمييز؟'), h('ul.small', { style: { margin: 0, paddingInlineStart: '18px' } },
          h('li', 'اجعل الإشارتين تختلفان في إصبع واضح أو في اتجاه الكف، لا في تفصيل صغير.'),
          h('li', 'أضف عيّنات بزوايا وأضواء مختلفة من «عرض ← أضف عيّنات».'),
          h('li', 'تجنّب إشارتين إحداهما مفتوحة الكف بلا توتر والأخرى تشبهها؛ ارفع الفرق بين الأصابع.'))));
      })();
      return box;
    });
  }

  // ---------- تصدير/استيراد ----------
  function exportData() {
    const payload = { format: 'signbridge', version: 1, exported: new Date().toISOString(), signs: app.signs.map((s) => ({ ...s })) };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const file = new File([blob], 'ain-dictionary.json', { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) { navigator.share({ files: [file], title: 'قاموس عين' }).catch(() => {}); return; }
    const a = h('a', { href: URL.createObjectURL(blob), download: 'ain-dictionary.json' });
    document.body.append(a); a.click(); a.remove();
    toast('تم تنزيل الملف', 'ok');
  }

  function importData() {
    const inp = h('input', { type: 'file', accept: '.json,application/json', onchange: async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        const j = JSON.parse(await f.text());
        if (j.format !== 'signbridge' || !Array.isArray(j.signs)) throw new Error('bad');
        const merge = await confirmSheet('استيراد القاموس', `يحتوي الملف على ${j.signs.length} إشارة. هل تدمجها مع قاموسك الحالي؟ (الإلغاء لا يغيّر شيئاً)`, 'ادمج', 'primary');
        if (!merge) return;
        const byId = new Map(app.signs.map((s) => [s.id, s]));
        for (const s of j.signs) byId.set(s.id, s);
        await app.replaceAll([...byId.values()]);
        toast('تم الاستيراد', 'ok');
      } catch (e) { toast('الملف غير صالح', 'bad'); }
    } });
    inp.click();
  }

  return {
    mount(el) {
      root = el;
      searchEl = h('input', { type: 'search', placeholder: 'ابحث في القاموس', oninput: (e) => { filter = e.target.value; renderList(); } });
      listEl = h('div.list');
      root.append(
        h('div.card', h('h2', 'قاموسي'), h('p.sub', 'كل إشارة تُسجَّل من نقاط يدك أنت، فتتعلم عليك أنت. أضف ما تشاء من الإشارات.'),
          h('div.row', btn('إشارة جديدة', { cls: 'primary grow', ic: 'plus', onclick: () => openRecorder({}) }), btn('جاهزة', { cls: 'ghost', ic: 'bolt', onclick: openQuickAdd })),
          h('div.row', btn('تقرير الخلط', { cls: 'ghost sm', ic: 'warn', onclick: openReport }), btn('تصدير', { cls: 'ghost sm', ic: 'download', onclick: exportData }), btn('استيراد', { cls: 'ghost sm', ic: 'upload', onclick: importData }))),
        searchEl, listEl);
      app.on('signs', renderList);
      renderList();
    },
    show() {
      renderList();
      if (app.pendingNew) { const p = app.pendingNew; app.pendingNew = null; openRecorder({ word: p.word }); }
    },
    hide() {},
  };
}
void sleep;
