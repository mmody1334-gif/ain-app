// حذيفة — نقطة البداية: الخدمات المشتركة، التنقّل، مسرح الكاميرا، الإعدادات.

import { h, icon, btn, toast, sheet } from './ui.js';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { CameraHub } from './camera.js';
import { tts, stt, genderOf } from './speech.js';
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
import { createCourseView } from './views/course.js';
import { createRoomView } from './views/room.js';
import { createNameSignView } from './views/namesign.js';
import { createStreakView } from './views/streak.js';
import { room } from './room.js';

const DEFAULT_SETTINGS = {
  holdSec: 0.6, speakEach: true, rate: 0.88, ttsLang: 'ar-SA', sttLang: 'ar-SA', ttsVoice: '', ttsGender: 'auto', facing: 'user', theme: 'auto', skeleton: true, detector: 'cpu', roomSend: 'auto', roomSpeak: true, sfx: true,
};

// إشارات جاهزة أُضيفت سابقاً للأرقام ثم أُزيلت: أشكالها تتعارض مع إشارات
// «أنا/أنت/واحد» اليومية، فبقيت متاحة في مكتبة «جاهزة» لمن يريد ربطها.
const AMBIGUOUS_STARTER = ['builtin_one', 'builtin_two', 'builtin_three', 'builtin_four', 'builtin_five'];

const TABS = [
  { id: 'translate', label: 'ترجمة', ic: 'translate', make: createTranslateView, camera: true },
  { id: 'listen', label: 'اسمع', ic: 'listen', make: createListenView, camera: false },
  { id: 'course', label: 'دروس', ic: 'book', make: createCourseView, camera: true },
  { id: 'learn', label: 'تعلّم', ic: 'learn', make: createLearnView, camera: true },
  { id: 'streak', label: 'تحديات', ic: 'bolt', make: createStreakView, camera: false },
  { id: 'dict', label: 'قاموسي', ic: 'dict', make: createDictView, camera: false },
  { id: 'commands', label: 'أوامر', ic: 'warn', make: createCommandsView, camera: true },
  { id: 'namesign', label: 'اسمي', ic: 'star', make: createNameSignView, camera: true },
  { id: 'room', label: 'غرفة', ic: 'share', make: createRoomView, camera: false },
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
    // زر تثبيت التطبيق: beforeinstallprompt يصل مرة واحدة قبل القرار
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.installEvent = e; this.emit('install'); });
    this.applyTheme();
    this.stage = document.getElementById('stage');
    this.cam = new CameraHub(this.engine, { video: this.stage.querySelector('video'), overlay: this.stage.querySelector('canvas.overlay') });
    this.cam.showSkeleton = this.settings.skeleton;
    this.cam.pref = this.settings.detector;
    this.buildStage();
    this.buildTabs();
    // بناء قسم «أوامر» مسبقاً حتى تكون فقاعة الطوارئ العائمة (SOS بلا كاميرا) جاهزة من أول لحظة
    const vc = this.views.commands;
    if (vc && !vc.built) { vc.api = vc.def.make(this); vc.api.mount(vc.root); vc.built = true; }
    document.getElementById('btn-settings').append(icon('gear'));
    document.getElementById('btn-settings').onclick = () => this.openSettings();

    // قاموس البداية: إشارات ثابتة مسجّلة + إشارات جاهزة تعمل بقواعد بلا تسجيل
    const starter = await this.loadStarter();
    let signs = await this.store.allSigns();
    const seeded = await this.store.getMeta('seeded', false);
    const applied = await this.store.getMeta('starterVersion', 0);
    const seenStarter = await this.store.getMeta('starterSeen', null);
    // إزالة الأرقام الجاهزة القديمة (كانت تظهر «واحد» عند الإشارة بالسبابة)
    if (signs.length && applied < 4) {
      const rm = new Set(AMBIGUOUS_STARTER);
      const removed = signs.filter((s) => rm.has(s.id) && s.source === 'starter');
      if (removed.length) {
        for (const s of removed) await this.store.deleteSign(s.id);
        signs = signs.filter((s) => !rm.has(s.id) || s.source !== 'starter');
      }
    }
    if (!signs.length && !seeded && starter.signs.length) {
      signs = starter.signs;
      for (const s of signs) await this.store.putSign(s);
      await this.store.setMeta('seeded', true);
      await this.store.setMeta('starterVersion', starter.version);
      await this.store.setMeta('starterSeen', signs.map((s) => s.id));
    } else if (signs.length && starter.version > applied) {
      // ترقية: نضيف الإشارات الجاهزة الجديدة فقط، ولا نعيد ما حذفه المستخدم،
      // ولا نضيف قاعدة سبق أن ربطها المستخدم بكلمة أخرى من «قاموسي» (وإلا صارت قاعدتان لكلمة واحدة)
      const known = new Set(seenStarter || [...signs.map((s) => s.id), 'ana', 'enta', 'huwa']);
      const add = starter.signs.filter((s) => !known.has(s.id) && !signs.some((x) => x.id === s.id) && !(s.kind === 'builtin' && s.rule && signs.some((x) => x.kind === 'builtin' && x.rule === s.rule)));
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
    // التحديات: نبنيها مبكراً حتى تُحسب المهام من أي قسم (تعلّم/ترجمة) حتى لو لم تُفتح صفحتها
    const chTab = this.views.streak;
    if (chTab && !chTab.built) { chTab.api = chTab.def.make(this); chTab.api.mount(chTab.root); chTab.built = true; }
    // الغرفة: نبني واجهتها مبكراً (دون عرضها) حتى تلتقط السجل والرسائل الواردة من أول لحظة
    const roomTab = this.views.room;
    if (roomTab && !roomTab.built) { roomTab.api = roomTab.def.make(this); roomTab.api.mount(roomTab.root); roomTab.built = true; }
    let unread = 0;
    this.on('room_unread', (n) => {
      unread = n ? unread + n : 0;
      const b = document.querySelector('#tabs button[data-tab="room"]');
      if (b) { if (unread) b.dataset.badge = unread > 9 ? '9+' : String(unread); else delete b.dataset.badge; }
    });
    // استعادة الغرفة الأخيرة عند فتح التطبيق
    const lastRoom = await this.store.getMeta('last_room', null);
    if (lastRoom) room.join(lastRoom).catch(() => {});
    // استقبال طوارئ من جهاز آخر: شاشة حمراء + صوت (النص الوارد يُعرض نصاً لا HTML)
    this.on('remote_sos', (data) => {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;z-index:98;background:#b3170a;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;padding:24px;animation:fade .2s ease';
      const h1 = document.createElement('h1'); h1.style.cssText = 'font-size:clamp(2rem,10vw,3.5rem);font-family:var(--font-title)'; h1.textContent = '🚨 طوارئ!';
      const p1 = document.createElement('p'); p1.style.fontSize = '1.2rem'; p1.textContent = (data?.name ? data.name : 'جهاز آخر في الغرفة') + ' يحتاج مساعدة';
      const p2 = document.createElement('p'); p2.style.cssText = 'font-size:1rem;opacity:.85'; p2.textContent = data?.message || '';
      const close = document.createElement('button'); close.className = 'btn'; close.style.cssText = 'background:#fff;color:#b3170a;min-height:52px;font-size:1.1rem;min-width:200px'; close.textContent = 'إغلاق';
      close.onclick = () => el.remove();
      const mapA = document.createElement('a');
      mapA.className = 'btn'; mapA.target = '_blank'; mapA.rel = 'noopener';
      mapA.style.cssText = 'background:#fff;color:#b3170a;min-height:52px;font-size:1.1rem;min-width:200px;text-decoration:none;display:none';
      const locP = document.createElement('p'); locP.style.cssText = 'font-size:.95rem;opacity:.9'; locP.textContent = '📍 في انتظار موقعه…';
      const setLoc = (d) => {
        if (d.ended) { locP.textContent = '📍 انتهى الإنذار — آخر موقع معروف أدناه'; return; }
        if (d.lat === undefined || d.lat === null) return;
        mapA.href = `https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}`;
        mapA.textContent = '📍 افتح موقعه في الخرائط'; mapA.style.display = 'inline-flex';
        locP.textContent = `موقعه محدّد (دقة ±${Math.round(d.acc || 0)} م) ويتحدّث مباشرة`;
      };
      setLoc(data || {});
      const offLoc = this.on('remote_loc', (d) => { if (!data?.device || d.device === data.device) setLoc(d); });
      close.addEventListener('click', () => offLoc());
      el.append(h1, p1, p2, locP, mapA, close);
      document.body.append(el);
      if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
      this.say('طوارئ! ' + (data?.name || 'جهاز آخر في الغرفة') + ' يحتاج مساعدة', { rate: 0.85 });
      setTimeout(() => { el.remove(); offLoc(); }, 60000);
    });
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
    // أفضل نتيجة اليوم (للمراجعة اليومية في التحديات)
    const d = new Date(), z = (n) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
    if (p.day !== today) { p.day = today; p.dayBest = 0; }
    p.dayBest = Math.max(p.dayBest || 0, score); p.last = Date.now();
    this.progress[id] = p;
    await this.store.setMeta('progress', this.progress);
    this.emit('progress', { id, score });
  }

  // ---------- النطق ----------
  say(text, opt = {}) { return tts.speak(text, { rate: this.settings.rate, lang: this.settings.ttsLang, voiceURI: this.settings.ttsVoice, gender: this.settings.ttsGender || 'auto', ...opt }); }

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
    const full = h('button.iconbtn', { 'aria-label': 'ملء الشاشة', onclick: () => this.toggleStageFull() }, icon('full'));
    const flip = h('button.iconbtn', { 'aria-label': 'قلب الكاميرا', onclick: async () => { await this.cam.flip(); this.updateStage(); } }, icon('flip'));
    const off = h('button.iconbtn', { 'aria-label': 'إيقاف الكاميرا', onclick: () => this.stopCamera() }, icon('x'));
    tools.append(full, flip, off);
    this.fullBtn = full;
    st.querySelector('[data-act="start-cam"]').onclick = () => this.startCamera();
    this.cam.onFrame((out) => this.onStageFrame(out));
    this.updateStage();
  }

  /** تكبير مسرح الكاميرا على كامل الشاشة: يُعاد ضبط الـcanvas تلقائيًا لأن الرسم يقيس العميل كل إطار. */
  toggleStageFull() {
    const on = this.stage.classList.toggle('focus');
    this.fullBtn.replaceChildren(icon(on ? 'shrink' : 'full'));
    this.fullBtn.setAttribute('aria-label', on ? 'إخراج من ملء الشاشة' : 'ملء الشاشة');
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
    // إعادة تمكين كل مسارات التعرّف عند كل تشغيل كاميرا: جلسة معايرة متوقِّفة
    // (إغلاق الورقة؟ إعادة تحميل؟) كانت قد تجمّد أي تحرّك مدى الحياة
    this.engine.enableStatic = true; this.engine.enableMotion = true; this.engine.enableShapes = true;
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
    // إشارة الاسم الشخصية: ناد المستخدم باسمه
    for (const e of (out.events || [])) {
      if (e.sign?.id === 'personal_name_sign') {
        this.store.getMeta('personal_name', { name: '', greetCount: 0 }).then(meta => {
          if (!meta.name) return;
          this.say('أهلاً ' + meta.name + '!');
          if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
          this.store.setMeta('personal_name', { ...meta, greetCount: (meta.greetCount || 0) + 1 });
        });
      }
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

  /** بطاقة التثبيت: زر «ثبّت» عند توفر الحدث، وتعليمات سافاري على آيفون، ولا شيء على Chrome المثبّت أصلًا. */
  installCard() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(navigator.standalone);
    const standalone = matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) return h('p.small.muted.okhint', 'التطبيق مثبّت على جهازك ✓');
    if (this.installEvent) {
      return h('div.row',
        btn('ثبّت التطبيق على جهازك', { cls: 'primary', ic: 'download', onclick: async () => {
          try { await this.installEvent.prompt(); await this.installEvent.userChoice; this.installEvent = null; this.emit('install'); toast('تم التثبيت', 'ok'); } catch (e) { /* لا شيء */ }
        } }),
        h('p.small.muted', 'يُثبَّت التطبيق على الشاشة الرئيسية ويعمل كاملاً بلا إنترنت بعدها.'));
    }
    if (ios) return h('p.small.muted', 'لتثبيت التطبيق على الآيفون: في سافاري اضغط زر «مشاركة» ثم «إضافة إلى الشاشة الرئيسية».');
    return h('p.small.muted', 'يمكن تثبيت التطبيق على الشاشة الرئيسية من قائمة المتصفح (تثبيت/إضافة إلى الشاشة الرئيسية).');
  }

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
      // ---- الصوت واللغة: لغة النطق من أصوات الجهاز + نوع الصوت (ذكر/أنثى) + صوت محدد ----
      const langSel = h('select');
      const gSeg = h('div.seg');
      const voiceSel = h('select');
      const gLabels = { auto: 'تلقائي', male: 'صوت رجالي', female: 'صوت نسائي' };
      const baseLang = () => String(s.ttsLang || 'ar').split('-')[0];
      const rebuildLangs = () => {
        langSel.innerHTML = '';
        const langs = tts.languages();
        if (!langs.length) {
          langSel.append(h('option', { value: 'ar' }, 'للمتأخر: لا توجد أصوات مثبّتة في الجهاز بعد'));
          return;
        }
        for (const L of langs) {
          langSel.append(h('option', { value: L.code, selected: L.code === baseLang() }, L.label));
        }
      };
      const rebuildGender = () => {
        gSeg.innerHTML = '';
        gSeg.append(...['auto', 'male', 'female'].map((v) => h('button', { type: 'button', 'aria-pressed': String((s.ttsGender || 'auto') === v), onclick: async (e) => {
          gSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
          e.currentTarget.setAttribute('aria-pressed', 'true');
          s.ttsGender = v;
          await this.saveSettings({ ttsGender: v });
          rebuildVoices();
        } }, gLabels[v])));
      };
      const rebuildVoices = () => {
        voiceSel.innerHTML = '';
        const pool = tts.voicesFor(baseLang(), s.ttsGender || 'auto');
        voiceSel.append(h('option', { value: '' }, pool.length ? 'تلقائي — اختار الأنسب (موصى به)' : `لا أصوات مثبّتة لهذه اللغة؛ ثبّت صوت «${tts.languages().find((L) => L.code === baseLang())?.label || baseLang()}» من إعدادات النظام`));
        for (const v of pool) {
          const g = { male: '(ذكر)', female: '(أنثى)', unknown: '' }[genderOf(v)];
          voiceSel.append(h('option', { value: v.voiceURI, selected: v.voiceURI === s.ttsVoice }, `${v.name} ${g} — ${v.lang}`));
        }
      };
      langSel.onchange = async (e) => {
        await this.saveSettings({ ttsLang: e.target.value, ttsVoice: '' });
        rebuildVoices();
        this.say(baseLang() === 'ar' ? 'مرحبًا' : 'Hello');
      };
      voiceSel.onchange = async (e) => { await this.saveSettings({ ttsVoice: e.target.value }); this.say(baseLang() === 'ar' ? 'مرحبًا أنا حذيفة، سأصدّ ما تقوله' : 'Hello, I am Hudhaifa', { voiceURI: e.target.value }); };
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
      const testBtn = btn('جرّب الصوت', { ic: 'speaker', cls: 'sm', onclick: () => this.say('مرحبًا، أنا حذيفة') });
      rebuildLangs(); rebuildGender(); rebuildVoices();
      // الأصوات قد تتأخر عن فتح الإعدادات (خاصة على الجوال)؛ نُعيد البناء عند بلوغها
      tts.onVoicesChanged(() => { rebuildLangs(); rebuildVoices(); });      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        h('div.card', h('label.field', h('div.row.between', h('span', 'مدة تثبيت اليد لتأكيد الإشارة'), holdLbl), hold), h('p.small.muted', 'أطول = أدق وأقل أخطاء، أقصر = أسرع.')),
        h('div.card', h('h2', 'الصوت واللغات'),
          h('label.switch', h('span', 'انطق كل كلمة فور التعرّف عليها'), speakEach),
          h('label.field', h('span', 'لغة النطق (كل اللغات المثبّتة في جهازك)'), langSel),
          h('label.field', h('span', 'نوع الصوت'), gSeg),
          h('label.field', h('span', 'صوت النطق'), voiceSel),
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
          this.installCard(),
          h('p.small.muted', 'علمياً: نقاط اليد تُستخرج بنموذج MediaPipe (21 نقطة × 63 قيمة)، ثم تُحوّل إلى ميزات هندسية: زوايا الأصابع وبوابات الطيّ وموقع اليد عن الكتفين لتمييز الإشارات المتشابهة في الشكل، ويتعلّم المصنّف الإحصائي من تسجيلاتك أنت، ويُعاد ضبط عتبات الأصابع بمعايرة تُنجز على يدك.'),
          h('div.row', h('span.small.muted', 'الإشارات الثلاث الثابتة (أنا/أنت/هو) من تسجيلات المشروع الأصلي، ومعها إشارات جاهزة (نعم/لا/مرحبًا/أحسنت/حسنًا/أحبك/اتصل بي/بخير/قوي/صغير/يمين/يسار/فوق/تحت/من فضلك/آسف/سعيد) تعمل بقواعد على نقاط اليد بلا تدريب.')),
          h('p.small.muted', 'يمكنك تسجيل إشارات بيدين، والأبجدية العربية من «قاموسي». ويقيس التطبيق موقع اليد بالنسبة للكتفين لتمييز الإشارات المتشابهة في شكل اليد.'),
          h('p.small.muted', 'دروس تعلم لغة الإشارة جاهزة في قسم «دروس»، مع تمرين الأبجدية المتسلسل في «تعلّم»، وجمل مفضلة وسجل في «ترجمة».')),
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
