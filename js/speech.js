// النطق (TTS) والتعرّف على الكلام (STT) عبر واجهات المتصفح.
// النطق مضبوط على العربية الفصحى: اختيار صوت عربي فصيح (ar-SA أولاً)، وتشكيل
// الكلمات الشائعة حتى لا يقرأها المحرّك بلهجة أو بلا حركات فيخطئ في النطق.
// ملاحظة: التعرّف على الكلام في كروم يحتاج إنترنت غالباً، والنطق يعمل بدون إنترنت إن وُجد صوت عربي في الجهاز.

const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
let voices = [];
let voicesAt = 0;
let lastSpoken = { text: '', at: 0 };
const voiceCbs = new Set();
let voiceListenerAdded = false;

function loadVoices() {
  if (!synth) return;
  const v = synth.getVoices() || [];
  if (v.length) { voices = v; voicesAt = Date.now(); }
}
if (synth) {
  loadVoices();
  synth.addEventListener?.('voiceschanged', loadVoices);
  // بعض المتصفحات لا تُطلق voiceschanged؛ نعيد المحاولة بهدوء عند أول نطق.
  setTimeout(loadVoices, 400);
  setTimeout(loadVoices, 1500);
  setTimeout(loadVoices, 3000);
}

// ---------- تشكيل الفصحى ----------
// الكلمات التي يُخطئ المحرّك في نطقها بلا حركات. التشكيل هنا للفصحى فقط.
const FUSHA_WORDS = {
  'أنا': 'أَنَا', 'أنت': 'أَنْتَ', 'أنتِ': 'أَنْتِ', 'هو': 'هُوَ', 'هي': 'هِيَ',
  'نعم': 'نَعَم', 'لا': 'لَا', 'أجل': 'أَجَل', 'كلا': 'كَلَّا',
  'حسنًا': 'حَسَنًا', 'حسنا': 'حَسَنًا', 'طيب': 'طَيِّب', 'موافق': 'مُوَافِق',
  'أحبك': 'أُحِبُّكَ', 'أحبّك': 'أُحِبُّكَ', 'أحسنت': 'أَحْسَنْتَ', 'ممتاز': 'مُمْتَاز', 'شاطر': 'شَاطِر',
  'واحد': 'وَاحِد', 'اثنان': 'اِثْنَان', 'اثنين': 'اِثْنَيْن', 'ثلاثة': 'ثَلَاثَة', 'أربعة': 'أَرْبَعَة',
  'خمسة': 'خَمْسَة', 'ستة': 'سِتَّة', 'سبعة': 'سَبْعَة', 'ثمانية': 'ثَمَانِيَة', 'تسعة': 'تِسْعَة', 'عشرة': 'عَشَرَة',
  'شكرًا': 'شُكْرًا', 'شكرا': 'شُكْرًا', 'مرحبًا': 'مَرْحَبًا', 'مرحبا': 'مَرْحَبًا', 'أهلاً': 'أَهْلًا', 'اهلا': 'أَهْلًا', 'أهلا': 'أَهْلًا',
  'السلام': 'السَّلَام', 'عليكم': 'عَلَيْكُمْ', 'عين': 'عَيْن',
  'من': 'مِنْ', 'فضلك': 'فَضْلِكَ', 'أحتاج': 'أَحْتَاجُ', 'مساعدة': 'مُسَاعَدَة', 'أريد': 'أُرِيدُ',
  'ماء': 'مَاء', 'ماءً': 'مَاءً', 'طبيب': 'طَبِيب', 'طبيباً': 'طَبِيبًا', 'أين': 'أَيْنَ',
  'دورة': 'دَوْرَة', 'المياه': 'الْمِيَاه', 'من فضلك': 'مِنْ فَضْلِكَ',
  'أسمع': 'أَسْمَع', 'أسمعُ': 'أَسْمَعُ', 'تحدث': 'تَحَدَّث', 'تحدّث': 'تَحَدَّث', 'ببطء': 'بِبُطْء',
  'وأنت': 'وَأَنْتَ', 'تنظر': 'تَنْظُر', 'إلي': 'إِلَيَّ', 'إليّ': 'إِلَيَّ', 'اكتب': 'اكْتُب', 'لي': 'لِي',
  'اتصل': 'اِتَّصِل', 'بي': 'بِي', 'توقف': 'تَوَقَّف', 'تعال': 'تَعَالَ', 'مساعدة!': 'مُسَاعَدَة',
  'أحتاج مساعدة': 'أَحْتَاجُ مُسَاعَدَة', 'أنا لا أسمع': 'أَنَا لَا أَسْمَع',
  // الإشارات العشر الجديدة: تشكيلها حتى لا يقرأها المحرّك بلا حركات
  'آسف': 'آسِف', 'أعتذر': 'أَعْتَذِر', 'عذرًا': 'عُذْرًا',
  'بخير': 'بِخَيْر', 'أنا بخير': 'أَنَا بِخَيْر',
  'سعيد': 'سَعِيد', 'مسرور': 'مَسْرُور',
  'صغير': 'صَغِير', 'قليل': 'قَلِيل',
  'يمين': 'يَمِين', 'يسار': 'يَسَار', 'فوق': 'فَوْق', 'تحت': 'تَحْت', 'أعلى': 'أَعْلَى', 'أسفل': 'أَسْفَل',
  'قوي': 'قَوِيّ', 'قوة': 'قُوَّة',
};
const FUSHA_PHRASES = Object.keys(FUSHA_WORDS).filter((k) => k.includes(' ')).sort((a, b) => b.length - a.length);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** يضيف حركات فصحى للكلمات الشائعة، ويحافظ على ما شكّله المستخدم بنفسه. */
export function toFusha(text) {
  if (!text) return text;
  let s = String(text);
  for (const p of FUSHA_PHRASES) s = s.replace(new RegExp(escapeRe(p), 'g'), FUSHA_WORDS[p]);
  // نطابق الكلمة مع حركاتها إن وُجدت، ثم نبحث عنها مجرّدة من التشكيل.
  s = s.replace(/[\u0621-\u0652\u0670\u0640]+/g, (w) => {
    const bare = w.replace(/[\u064B-\u0652\u0670\u0640]/g, '');
    return FUSHA_WORDS[bare] || w;
  });
  return s;
}

const AR_NAMES = /majed|maged|hamed|hamid|tariq|tarik|salma|laila|layla|arabic|العربية|naayf|zeina|hoda/i;
const FUSHA_PREFS = ['ar-sa', 'ar-eg', 'ar-ae', 'ar-jo', 'ar-kw', 'ar-qa', 'ar-bh', 'ar-om', 'ar'];

// تمييز جنس الصوت (ذكر/أنثى) من اسمه — أسماء الأصوات العربية المعروفة في الأنظمة.
const NAMES_FEMALE = /salma|amira|amina|laila|layla|hoda|zeina|zariyah|hind|sana|fatima|maryam|mariam|heba|rania|najat|zowena|woman|female|zira|noor/i;
const NAMES_MALE = /maged|majed|tariq|tarik|hamed|hamid|naayf|nayef|fahed|hussein|amr|ibrahim|ahmed|muhammad|mohammed|abdullah|man\b|male|karim|bassel|yaakov/i;

/** قِس جنس الصوت من اسمه: 'female' | 'male' | 'unknown'. */
export function genderOf(v) {
  const n = String(v?.name || '').toLowerCase();
  if (NAMES_FEMALE.test(n)) return 'female';
  if (NAMES_MALE.test(n)) return 'male';
  return 'unknown';
}

const _displayNames = (() => {
  try { return new Intl.DisplayNames(['ar'], { type: 'language' }); } catch (e) { return null; }
})();

/** اسم عربي مقروء لرمز لغة مثل en-US → «الإنجليزية (US)». */
export function langLabel(code) {
  const [base, region] = String(code || '').split('-');
  const name = _displayNames ? (_displayNames.of(base) || base) : base;
  return region ? `${name} (${region.toUpperCase()})` : name;
}

export const tts = {
  get supported() { return !!synth; },
  /** كل الأصوات العربية المتاحة، مرتّبة: الفصحى أولاً. */
  arabicVoices() {
    if (!voices.length) loadVoices();
    return voices
      .filter((v) => /^ar([-_]|$)/i.test(v.lang))
      .map((v) => ({ v, score: voiceScore(v, 'ar-SA') }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.v);
  },
  /** كل اللغات المثبّتة في الجهاز كواجهات (العربية أولاً): [{code, label}] على مستوى اللغة الأساسية. */
  languages() {
    if (!voices.length) loadVoices();
    const seen = new Map();
    for (const v of voices) {
      const base = (v.lang || '').split('-')[0].toLowerCase();
      if (!base) continue;
      if (!seen.has(base)) seen.set(base, { code: base, label: langLabel(base), isArabic: base === 'ar' });
    }
    return [...seen.values()].sort((a, b) => (b.isArabic - a.isArabic) || a.label.localeCompare(b.label, 'ar'));
  },
  /** أصوات لغة (أساس) مع مرشّح جنس اختياري: 'auto' | 'male' | 'female'. */
  voicesFor(base, gender = 'auto') {
    if (!voices.length) loadVoices();
    let pool = voices.filter((v) => (v.lang || '').toLowerCase().startsWith(String(base).toLowerCase()));
    if (gender === 'male' || gender === 'female') {
      const g = pool.filter((v) => genderOf(v) === gender);
      if (g.length) pool = g;
    }
    // ترتيب: أصوات من نفس الدولة أولاً ثم الأقرب للفصحى (للعربية)
    const pref = base.toLowerCase() === 'ar' ? 'ar-SA' : String(base);
    return [...pool].sort((a, b) => voiceScore(b, pref) - voiceScore(a, pref));
  },
  arabicVoice(pref = 'ar-SA') {
    return this.pickVoice('', pref) || null;
  },
  /** اختيار صوت: uri محدد فذاته؛ وإلا فلتر اللغة (أول حرفين) والجنس؛ وإلا أي صوت. */
  pickVoice(uri, lang = 'ar-SA', gender = 'auto') {
    if (!voices.length) loadVoices();
    if (uri) { const v = voices.find((x) => x.voiceURI === uri); if (v) return v; }
    if (!voices.length) return null;
    const l = String(lang || 'ar').toLowerCase();
    let pool = voices.filter((v) => (v.lang || '').toLowerCase().startsWith(l.slice(0, 2)));
    if (!pool.length && !l.startsWith('ar')) pool = voices.filter((v) => (v.lang || '').toLowerCase().startsWith('en'));
    if (gender === 'male' || gender === 'female') {
      const g = pool.filter((v) => genderOf(v) === gender);
      if (g.length) pool = g;
    }
    if (!pool.length) return null;
    const pref = l.startsWith('ar') ? 'ar-SA' : l;
    return [...pool].sort((a, b) => voiceScore(b, pref) - voiceScore(a, pref))[0];
  },
  get hasArabic() { return !!this.pickVoice('', 'ar-SA'); },
  speak(text, opt = {}) {
    if (!synth || !text) return false;
    try {
      const spoken = opt.fusha === false ? String(text) : toFusha(text);
      // نفس الكلمة مرتين في أقل من 0.6 ث (حدث مكرر من المحرك ودرس «تعلّم» معاً)
      // كانت تُلغي النطق الأول قبل أن يُسمع؛ نتجاهل التكرار بدل قطعه.
      const now = Date.now();
      if (spoken === lastSpoken.text && now - lastSpoken.at < 600 && opt.cancel !== false) return true;
      lastSpoken = { text: spoken, at: now };
      const u = new SpeechSynthesisUtterance(spoken);
      const v = this.pickVoice(opt.voiceURI, opt.lang, opt.gender);
      u.lang = v ? v.lang : (opt.lang || 'ar-SA');
      if (v) u.voice = v;
      u.rate = opt.rate ?? 0.88;
      u.pitch = opt.pitch ?? 1;
      u.volume = opt.volume ?? 1;
      if (opt.cancel !== false) synth.cancel();
      if (opt.onend) u.onend = opt.onend;
      if (opt.onerror) u.onerror = opt.onerror;
      synth.speak(u);
      return true;
    } catch (e) { return false; }
  },
  cancel() { try { synth?.cancel(); } catch (e) { /* لا شيء */ } },
  /** يُستدعى عند تغيّر الأصوات؛ مستمع واحد مشترك مهما فُتحت الإعدادات مرات. */
  onVoicesChanged(cb) {
    if (!synth) return;
    voiceCbs.add(cb);
    if (!voiceListenerAdded) {
      voiceListenerAdded = true;
      synth.addEventListener?.('voiceschanged', () => { loadVoices(); for (const c of [...voiceCbs]) { try { c(); } catch (e) { /* لا شيء */ } } });
    }
  },
};function voiceScore(v, pref) {
  const lang = (v.lang || '').toLowerCase();
  let s = 0;
  if (pref && lang === pref.toLowerCase()) s += 100;
  const i = FUSHA_PREFS.indexOf(lang);
  if (i >= 0) s += 80 - i * 6;
  else if (lang.startsWith('ar')) s += 30;
  if (AR_NAMES.test(v.name || '')) s += 10;
  if (v.localService) s += 4;
  return s;
}

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

export const stt = {
  get supported() { return !!SR; },
  /** يبدأ الاستماع. handlers: onInterim(text), onFinal(text), onEnd(), onError(code) */
  create(lang, h) {
    if (!SR) return null;
    const rec = new SR();
    rec.lang = lang || 'ar-SA';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = '', fin = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript; else interim += r[0].transcript;
      }
      if (interim) h.onInterim?.(interim);
      if (fin) h.onFinal?.(fin);
    };
    rec.onerror = (e) => h.onError?.(e.error || 'error');
    rec.onend = () => h.onEnd?.();
    return rec;
  },
};
void voicesAt;
