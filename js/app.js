// عين — نقطة البداية: الخدمات المشتركة، التنقّل، مسرح الكاميرا، الإعدادات.

import { h, icon, btn, toast, sheet } from './ui.js';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { CameraHub } from './camera.js';
import { tts, stt } from './speech.js';
import { buildIndex } from './arabic.js';
import { BUILTIN_NAMES } from './names.js';
import { POSE_LEN, poseToFeatures, FEATURE_LEN } from './features.js';
import { setFingerCalibration } from './motion.js';
import { runCalibration } from './calibrate.js';
import { MODEL_VERSION } from './classifier.js';
import { createTranslateView } from './views/translate.js';
import { createListenView } from './views/listen.js';
import { createLearnView } from './views/learn.js';
import { createDictView } from './views/dict.js';
import { createCommandsView } from './views/commands.js';

const DEFAULT_SETTINGS = {
  holdSec: 0.6, speakEach: true, rate: 0.92, ttsLang: 'ar-SA', sttLang: 'ar-SA', ttsVoice: '', facing: 'user', theme: 'auto', skeleton: true, detector: 'cpu',
};

const TABS = [
  { id: 'translate', label: 'ترجمة', ic: 'translate', make: createTranslateView, camera: true },
  { id: 'listen', label: 'اسمع', ic: 'listen', make: createListenView, camera: false },
  { id: 'learn', label: 'تعلّم', ic: 'learn', make: createLearnView, camera: true },
  { id: 'dict', label: 'قاموسي', ic: 'dict', make: createDictView, camera: false },
  { id: 'commands', label: 'أوامر', ic: 'bolt', make: createCommandsView, camera: true },
];

/** أقرب عيّنة إلى المتوسط تُستعمل كوضعية مرجعية للأفاتار والتعلّم. */
function medoidPose(samples) {
  const n = samples.length;
  const F = samples.map((a) => poseToFeatures(Float32Array.from(a.slice(0, POSE_LEN)), [0.5, 0.5]));
  const mean = new Float32Array(F[0].length);
  for (const f of F) for (let d = 0; d < f.length; d++) mean[d] += f[d] / n;
  let best = 0, bd = 1e9;
  F.forEach((f, i) => { let s = 0; for (let d = 0; d < f.length; d++) s += (f[d] - mean[d]) ** 2; if (s < bd) { bd = s; best = i; } });
  return Array.from(samples[best].slice(0, POSE_LEN), (v) => +v.toFixed(4));
}

/** بصمة الإشارات الثابتة: تتغير عند أي تعديل في العيّنات أو المصدر، فيُعاد التدريب. */
function modelKey(groups) {
  let h = 2166136261;
  const add = (s) => {
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= 0x9e; h = Math.imul(h, 16777619);
  };
  add('v' + MODEL_VERSION + '|' + FEATURE_LEN);
  const sorted = groups.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  let total = 0;
  for (const g of sorted) {
    const list = g.hands === 2 ? (g.samples2 || []) : (g.samples || []);
    total += list.length;
    add(g.id + ':' + (g.source || '') + ':' + (g.hands || 1) + ':' + list.length);
    for (const a of list) {
      add('n' + a.length);
      for (let i = 0; i < a.length; i += 5) add(String(Math.round(a[i] * 1000)));
      add(String(Math.round(a[a.length - 1] * 1000)));
    }
  }
  return (h >>> 0).toString(36) + '-' + total;
}

class App {
  constructor() {
    this.store = new Store();
    this.engine = new Engine();
    this.settings = { ...DEFAULT_SETTINGS };
    this.signs = [];
    this.index = buildIndex([]);
    this.progress = {};
    this.views = {};
    this.current = null;
    this.handlers = new Map();
    this.trainPct = 0; this.training = false;
    this.tts = tts; this.stt = stt;
  }

  // ---------- أحداث بسيطة ----------
  on(ev, fn) { if (!this.handlers.has(ev)) this.handlers.set(ev, new Set()); this.handlers.get(ev).add(fn); return () => this.handlers.get(ev).delete(fn); }
  emit(ev, data) { this.handlers.get(ev)?.forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }

  async boot() {
    await this.store.open();
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.store.getMeta('settings', {})) };
    this.progress = await this.store.getMeta('progress', {});
    // معايرة يد المستخدم قبل بناء النموذج، حتى تُحسب بوابة الأصابع على يده
    this.calib = await this.store.getMeta('calib', null);
    setFingerCalibration(this.calib);
    this.applyTheme();
    this.stage = document.getElementById('stage');
    this.cam = new CameraHub(this.engine, { video: this.stage.querySelector('video'), overlay: this.stage.querySelector('canvas.overlay') });
    this.cam.showSkeleton = this.settings.skeleton;
    this.cam.pref = this.settings.detector;
    this.buildStage();
    this.buildTabs();
    document.getElementById('btn-settings').append(icon('gear'));
    document.getElementById('btn-settings').onclick = () => this.openSettings();

    // قاموس البداية: إشارات ثابتة مسجّلة + إشارات جاهزة تعمل بقواعد بلا تسجيل
    const starter = await this.loadStarter();
    let signs = await this.store.allSigns();
    const seeded = await this.store.getMeta('seeded', false);
    const applied = await this.store.getMeta('starterVersion', 0);
    const seenStarter = await this.store.getMeta('starterSeen', null);
    if (!signs.length && !seeded && starter.signs.length) {
      signs = starter.signs;
      for (const s of signs) await this.store.putSign(s);
      await this.store.setMeta('seeded', true);
      await this.store.setMeta('starterVersion', starter.version);
      await this.store.setMeta('starterSeen', signs.map((s) => s.id));
    } else if (signs.length && starter.version > applied) {
      // ترقية: نضيف الإشارات الجاهزة الجديدة فقط، ولا نعيد ما حذفه المستخدم
      const known = new Set(seenStarter || [...signs.map((s) => s.id), 'ana', 'enta', 'huwa']);
      const add = starter.signs.filter((s) => !known.has(s.id) && !signs.some((x) => x.id === s.id));
      for (const s of add) await this.store.putSign(s);
      signs = signs.concat(add);
      await this.store.setMeta('starterVersion', starter.version);
      await this.store.setMeta('starterSeen', [...new Set([...known, ...starter.signs.map((s) => s.id)])]);
    }
    this.starterNote = starter.note || '';
    this.signs = signs;
    for (const s of this.signs) this.ensureRef(s);
    await this.retrain();

    const hash = (location.hash || '').replace('#', '');
    this.go(TABS.some((t) => t.id === hash) ? hash : 'translate');
    this.setStatus();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.__SB_MOCK__) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    window.__sb = this;      // للاختبار والتشخيص
  }

  async loadStarter() {
    try {
      const j = await (await fetch('data/starter.json')).json();
      return {
        version: j.version || 1,
        note: j.note || '',
        signs: j.signs.map((s) => ({
          ...s,
          aliases: s.aliases || [],
          kind: s.kind || s.type || 'static',
          source: 'starter',
          created: s.created || Date.now(),
          samples: s.samples || [],
        })),
      };
    } catch (e) { return { version: 0, note: '', signs: [] }; }
  }

  ensureRef(s) {
    if (s.kind === 'static' && s.hands !== 2 && !s.ref && s.samples?.length) s.ref = medoidPose(s.samples);
    return s;
  }

  // ---------- الإعدادات والمظهر ----------
  applyTheme() { const t = this.settings.theme; if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t; this.emit('theme'); }
  async saveSettings(patch) {
    Object.assign(this.settings, patch);
    await this.store.setMeta('settings', this.settings);
    this.engine.holdSec = this.settings.holdSec;
    if (this.cam) this.cam.showSkeleton = this.settings.skeleton;
    this.applyTheme();
  }

  // ---------- الإشارات والنموذج ----------
  setStatus() {
    const chip = document.getElementById('status-chip');
    const st = this.signs.filter((s) => s.kind === 'static').length, mo = this.signs.filter((s) => s.kind === 'motion').length, bi = this.signs.filter((s) => s.kind === 'builtin').length;
    if (this.training) { chip.textContent = `تدريب ${Math.round(this.trainPct * 100)}٪`; chip.className = 'chip-status warn'; return; }
    const n = this.signs.length;
    chip.textContent = n === 0 ? 'لا إشارات' : n === 1 ? 'إشارة واحدة' : n === 2 ? 'إشارتان' : n <= 10 ? `${n} إشارات` : `${n} إشارة`;
    chip.className = 'chip-status ok';
    chip.title = `ثابتة ${st} · متحركة ${mo} · جاهزة ${bi}`;
  }

  async retrain() {
    this.training = true; this.trainPct = 0; this.setStatus();
    this.index = buildIndex(this.signs);
    this.engine.holdSec = this.settings.holdSec;
    const staticData = this.signs.filter((s) => s.kind === 'static' &&
      ((s.hands === 2 && s.samples2 && s.samples2.length >= 8) || ((s.hands || 1) !== 2 && s.samples && s.samples.length >= 8)));
    const key = modelKey(staticData);
    let cached = null;
    try {
      const meta = await this.store.getMeta('model', null);
      if (meta && meta.key === key && (meta.one || meta.two || meta.model)) cached = meta.one || meta.two ? { one: meta.one || null, two: meta.two || null } : meta.model;
    } catch (e) { /* لا شيء */ }
    try {
      const clf = await this.engine.setSigns(this.signs, (p) => { this.trainPct = p; this.setStatus(); this.emit('train', p); }, cached);
      const parts = this.engine.modelParts || {};
      const needOne = !!this.engine.clf && !parts.one;
      const needTwo = !!this.engine.clf2 && !parts.two;
      if (staticData.length && (!cached || needOne || needTwo)) {
        try {
          await this.store.setMeta('model', {
            key,
            one: clf ? clf.toJSON() : null,
            two: this.engine.clf2 ? this.engine.clf2.toJSON() : null,
            at: Date.now(),
          });
        } catch (e) { /* لا شيء */ }
      }
      this.modelCached = this.engine.trainInfo === 'cache';
    } catch (e) { console.error(e); toast('تعذّر تدريب النموذج', 'bad'); }
    this.training = false; this.setStatus(); this.emit('signs');
  }

  async saveSign(sign, { retrain = true } = {}) {
    this.ensureRef(sign);
    await this.store.putSign(sign);
    const i = this.signs.findIndex((s) => s.id === sign.id);
    if (i >= 0) this.signs[i] = sign; else this.signs.push(sign);
    if (retrain) await this.retrain(); else { this.index = buildIndex(this.signs); this.engine.refreshMaps(this.signs); this.emit('signs'); }
  }

  async removeSign(id) {
    await this.store.deleteSign(id);
    this.signs = this.signs.filter((s) => s.id !== id);
    await this.retrain();
  }

  async replaceAll(signs) {
    await this.store.clearSigns();
    for (const s of signs) await this.store.putSign(this.ensureRef(s));
    this.signs = signs;
    await this.retrain();
  }

  async addProgress(id, score) {
    const p = this.progress[id] || { best: 0, stars: 0, n: 0 };
    p.best = Math.max(p.best, score); p.n++;
    p.stars = Math.max(p.stars, score >= 90 ? 3 : score >= 78 ? 2 : 1);
    this.progress[id] = p;
    await this.store.setMeta('progress', this.progress);
  }

  // ---------- النطق ----------
  say(text, opt = {}) { return tts.speak(text, { rate: this.settings.rate, lang: this.settings.ttsLang, voiceURI: this.settings.ttsVoice, ...opt }); }

  // ---------- التنقّل ----------
  buildTabs() {
    const nav = document.getElementById('tabs');
    for (const t of TABS) {
      const b = h('button', { role: 'tab', 'aria-selected': 'false', 'data-tab': t.id, onclick: () => this.go(t.id) }, icon(t.ic), h('span', t.label));
      nav.append(b);
      this.views[t.id] = { def: t, root: document.getElementById('view-' + t.id), api: null, built: false };
    }
  }

  go(id) {
    if (this.current === id) return;
    const prev = this.views[this.current];
    if (prev) { prev.api?.hide?.(); prev.root.classList.remove('on'); }
    const v = this.views[id];
    if (!v) return;
    if (!v.built) { v.api = v.def.make(this); v.api.mount(v.root); v.built = true; }
    this.current = id;
    for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === id));
    v.root.classList.add('on');
    document.getElementById('main').scrollTo({ top: 0 });
    if (!v.def.camera && this.cam.running) this.stopCamera();
    v.api.show?.();
    try { history.replaceState(null, '', '#' + id); } catch (e) { /* لا شيء */ }
  }

  // ---------- مسرح الكاميرا ----------
  buildStage() {
    const st = this.stage;
    const tools = st.querySelector('.tools');
    const flip = h('button.iconbtn', { 'aria-label': 'قلب الكاميرا', onclick: async () => { await this.cam.flip(); this.updateStage(); } }, icon('flip'));
    const off = h('button.iconbtn', { 'aria-label': 'إيقاف الكاميرا', onclick: () => this.stopCamera() }, icon('x'));
    tools.append(flip, off);
    st.querySelector('[data-act="start-cam"]').onclick = () => this.startCamera();
    this.cam.onFrame((out) => this.onStageFrame(out));
    this.updateStage();
  }

  /** يضع المسرح داخل حاوية القسم الحالي. */
  mountStage(slot) {
    this.stage.hidden = false;
    slot.append(this.stage);
    this.stageSlot = slot;
  }
  unmountStage() { this.stage.hidden = true; this.stageSlot = null; }

  async startCamera() {
    const shade = this.stage.querySelector('[data-hud="shade"]');
    shade.innerHTML = '';
    shade.append(h('span.spin'), h('p', 'جارٍ التحضير…'));
    this.updateStageStatus = (m) => { const p = shade.querySelector('p'); if (p) p.textContent = m; };
    const ok = await this.cam.start(this.settings.facing, (m) => this.updateStageStatus(m));
    if (!ok) { this.showCamError(); }
    this.updateStage();
    this.emit('camera', ok);
    return ok;
  }

  stopCamera() { this.cam.stop(); this.engine.reset(); this.updateStage(); this.emit('camera', false); }

  showCamError() {
    const shade = this.stage.querySelector('[data-hud="shade"]');
    const e = this.cam.error;
    let msg = 'تعذّر تشغيل الكاميرا.';
    const name = e?.name || e?.message || '';
    if (/NotAllowed|Permission/i.test(name)) msg = 'لم تُمنح صلاحية الكاميرا. اسمح بها من إعدادات المتصفح ثم أعد المحاولة.';
    else if (/NotFound|Overconstrained/i.test(name)) msg = 'لم يُعثر على كاميرا في هذا الجهاز.';
    else if (/no-camera-api/.test(name)) msg = 'المتصفح لا يدعم الكاميرا هنا. استخدم رابط https أو افتح التطبيق من الشاشة الرئيسية.';
    else if (/fetch|import|network|Failed|load/i.test(String(e?.message || ''))) msg = 'تعذّر تحميل محرّك اليد. تأكد من الإنترنت لأول مرة، أو ضع ملفات vendor (راجع README).';
    shade.innerHTML = '';
    shade.append(h('h2', 'تعذّر التشغيل'), h('p', msg), btn('إعادة المحاولة', { cls: 'primary', onclick: () => this.startCamera() }));
    console.warn('camera error', e);
  }

  updateStage() {
    const running = this.cam.running;
    const shade = this.stage.querySelector('[data-hud="shade"]');
    if (running) shade.hidden = true;
    else if (this.cam.status !== 'error' && this.cam.status !== 'loading') {
      shade.hidden = false;
      shade.innerHTML = '';
      shade.append(h('h2', 'الكاميرا مغلقة'), h('p', 'تعمل المعالجة كلها داخل هاتفك. لا يُرسَل أي فيديو إلى أي مكان.'),
        btn('تشغيل الكاميرا', { cls: 'primary', ic: 'cam', onclick: () => this.startCamera() }));
    }
    this.stage.querySelector('.tools').hidden = !running;
  }

  onStageFrame(out) {
    const st = this.stage;
    const bar = st.querySelector('.holdbar i');
    const left = st.querySelector('[data-hud="left"]');
    const word = st.querySelector('[data-hud="word"]');
    const quality = st.querySelector('[data-hud="quality"]');
    const hold = out.hold;
    bar.style.width = hold ? Math.round(hold.progress * 100) + '%' : '0';
    if (!out.hand) { left.textContent = this.cam.diag.errors > 0 ? 'تعذّر كشف اليد: افتح الإعدادات ← التشخيص' : 'ضع يدك أمام الكاميرا'; }
    else if (out.moving) left.textContent = 'حركة…';
    else if (hold) left.textContent = hold.sign ? hold.sign.word : (this.builtinName(hold.id) || 'شكل');
    else left.textContent = 'ثبّت يدك';
    if (hold && hold.sign && hold.progress > 0.2) { word.hidden = false; word.textContent = hold.sign.word; word.classList.toggle('ok', hold.progress >= 1); }
    else word.hidden = true;
    if (quality) {
      const q = this.qualityOf(out);
      quality.textContent = q.text;
      quality.className = 'pill ' + q.cls;
    }
  }

  /** مؤشر جودة بسيط: قرب اليد، الإضاءة، سرعة المعالجة، والثبات. */
  qualityOf(out) {
    if (!out.hand || !out.frame) return { text: 'لا أرى يدك', cls: 'bad' };
    const size = out.frame.size || 0;
    if (size < 0.085) return { text: 'قرّب يدك', cls: 'warn' };
    if (size > 0.34) return { text: 'أبعد يدك', cls: 'warn' };
    const light = this.cam.light;
    if (light != null && light < 45) return { text: 'أضئ المكان', cls: 'warn' };
    if (this.cam.fps > 0 && this.cam.fps < 9) return { text: 'المعالجة بطيئة', cls: 'warn' };
    if (out.moving) return { text: 'حركة', cls: 'dim' };
    if (out.hold) return { text: 'جودة جيدة', cls: 'ok' };
    return { text: 'ثبّت يدك', cls: 'warn' };
  }

  builtinName(id) { return BUILTIN_NAMES[id] || null; }

  // ---------- إعدادات ----------
  openSettings() {
    const s = this.settings;
    sheet('الإعدادات', (close) => {
      const hold = h('input', { type: 'range', min: 0.3, max: 1.4, step: 0.1, value: s.holdSec, style: { width: '100%' } });
      const holdLbl = h('span.muted.small', `${s.holdSec.toFixed(1)} ث`);
      hold.oninput = () => { holdLbl.textContent = `${(+hold.value).toFixed(1)} ث`; };
      hold.onchange = () => this.saveSettings({ holdSec: +hold.value });
      const rate = h('input', { type: 'range', min: 0.6, max: 1.3, step: 0.05, value: s.rate, style: { width: '100%' } });
      rate.onchange = () => this.saveSettings({ rate: +rate.value });
      const av = tts.arabicVoices();
      const voiceSel = h('select', { onchange: (e) => this.saveSettings({ ttsVoice: e.target.value }) },
        h('option', { value: '' }, 'تلقائي — صوت عربي فصيح (موصى به)'),
        av.length ? av.map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === s.ttsVoice }, `${v.name} — ${v.lang}`))
          : h('option', { value: '', disabled: true }, 'لا توجد أصوات عربية مثبّتة في هذا المتصفح'));
      const speakEach = h('input', { type: 'checkbox', checked: s.speakEach, onchange: (e) => this.saveSettings({ speakEach: e.target.checked }) });
      const skel = h('input', { type: 'checkbox', checked: s.skeleton, onchange: (e) => this.saveSettings({ skeleton: e.target.checked }) });
      const theme = h('div.seg', ['auto', 'light', 'dark'].map((v) => h('button', { type: 'button', 'aria-pressed': String(s.theme === v), onclick: (e) => { this.saveSettings({ theme: v }); theme.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); } }, { auto: 'تلقائي', light: 'فاتح', dark: 'داكن' }[v])));
      const cam = h('div.seg', ['user', 'environment'].map((v) => h('button', { type: 'button', 'aria-pressed': String(s.facing === v), onclick: (e) => { this.saveSettings({ facing: v }); cam.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); } }, v === 'user' ? 'أمامية' : 'خلفية')));
      const det = h('div.seg', ['cpu', 'gpu'].map((v) => h('button', { type: 'button', 'aria-pressed': String((s.detector || 'cpu') === v), onclick: async (e) => {
        det.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true');
        await this.saveSettings({ detector: v });
        const was = this.cam.running; this.cam.stop(); this.cam.detector = null; this.cam.pref = v;
        if (was) await this.startCamera(); else this.updateStage();
      } }, v === 'cpu' ? 'المعالج (أثبت)' : 'كرت الشاشة (أسرع)')));
      const dg = this.cam.diag || {};
      const diagText = `engine=${dg.backend || '-'} video=${dg.video || '-'} frames=${dg.frames || 0} hands=${dg.hands || 0} pose=${dg.pose || 0} errors=${dg.errors || 0} rvfc=${dg.rvfc ? 1 : 0}${dg.lastError ? ' last=' + dg.lastError : ''}`;
      const voiceInfo = tts.supported ? (tts.hasArabic ? 'صوت عربي فصيح متوفر على جهازك.' : 'لا يوجد صوت عربي مثبّت في جهازك؛ ثبّت صوتاً عربياً (فصحى) من إعدادات النظام.') : 'النطق غير مدعوم في هذا المتصفح.';
      const testBtn = btn('جرّب الصوت', { ic: 'speaker', cls: 'sm', onclick: () => this.say('مرحبًا، أنا عين') });
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        h('div.card', h('label.field', h('div.row.between', h('span', 'مدة تثبيت اليد لتأكيد الإشارة'), holdLbl), hold), h('p.small.muted', 'أطول = أدق وأقل أخطاء، أقصر = أسرع.')),
        h('div.card', h('label.switch', h('span', 'انطق كل كلمة فور التعرّف عليها'), speakEach),
          h('label.field', h('span', 'صوت النطق (العربية الفصحى)'), voiceSel),
          h('label.field', h('span', 'سرعة النطق'), rate), h('div.row', testBtn, h('span.small.muted', voiceInfo)),
          h('p.small.muted', 'يُضيف التطبيق التشكيل تلقائياً للكلمات الشائعة حتى ينطقها المحرّك بالفصحى، لا بلهجة محلية.')),
        h('div.card', h('label.switch', h('span', 'ارسم نقاط اليد فوق الكاميرا'), skel), h('div.field', h('span.muted.small', 'الكاميرا المفضّلة'), cam), h('div.field', h('span.muted.small', 'المظهر'), theme)),
        h('div.card', h('h2', 'معايرة يدك'),
          h('p.small.muted', this.calib
            ? `آخر معايرة: ${new Date(this.calib.at || Date.now()).toLocaleDateString('ar')} — تعيد ضبط قراءة الأصابع على يدك.`
            : 'لم تُجرَ معايرة بعد. المعايرة تقيس «مفرود» و«مطوي» على يدك أنت، فتنخفض أخطاء الإصبع.'),
          h('div.row',
            btn('معايرة اليد الآن', { cls: 'primary', ic: 'cam', onclick: () => { close(); setTimeout(() => runCalibration(this), 250); } }),
            btn('إعادة الافتراضي', { cls: 'ghost sm', onclick: async () => { setFingerCalibration(null); this.calib = null; await this.store.setMeta('calib', null); await this.retrain(); toast('أُعيدت العتبات الافتراضية'); } }))),
        h('div.card', h('h2', 'كشف اليد'), h('div.field', h('span.muted.small', 'محرّك الكشف'), det), h('p.small.muted', { dir: 'ltr', style: { textAlign: 'left', wordBreak: 'break-word' } }, diagText), h('p.small.muted', 'إن لم تظهر نقاط يدك: بدّل المحرّك أعلاه، وأرسل لي هذا السطر.')),
        h('div.card', h('h2', 'حول التطبيق'), h('p.small.muted', 'كل المعالجة تتم داخل جهازك: الكاميرا والتدريب والتخزين. لا حساب ولا خادم. صدّر قاموسك من «قاموسي» لتحتفظ بنسخة أو تنقله إلى الحاسوب.'),
          h('p.small.muted', 'الإشارات الثلاث الثابتة (أنا/أنت/هو) من تسجيلات المشروع الأصلي، ومعها إشارات جاهزة (نعم/لا/مرحبًا/أحسنت/حسنًا/أحبك/اتصل بي/الأرقام ١–٥) تعمل بقواعد على نقاط اليد بلا تدريب.'),
          h('p.small.muted', 'يمكنك تسجيل إشارات بيدين، والأبجدية العربية من «قاموسي». ويقيس التطبيق موقع اليد بالنسبة للكتفين لتمييز الإشارات المتشابهة في شكل اليد.')),
        btn('إغلاق', { cls: 'primary block', onclick: close }));
    });
  }
}

const app = new App();
app.boot().catch((e) => {
  console.error(e);
  document.body.prepend(h('div.card', { style: { margin: '16px' } }, h('h2', 'حدث خطأ أثناء التشغيل'), h('p.small', String(e && e.message || e))));
});
export default app;
