// النطق (TTS) والتعرّف على الكلام (STT) عبر واجهات المتصفح.
// النطق مضبوط على العربية الفصحى: اختيار صوت عربي فصيح (ar-SA أولاً)، وتشكيل
// الكلمات الشائعة حتى لا يقرأها المحرّك بلهجة أو بلا حركات فيخطئ في النطق.
// ملاحظة: التعرّف على الكلام في كروم يحتاج إنترنت غالباً، والنطق يعمل بدون إنترنت إن وُجد صوت عربي في الجهاز.

const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
let voices = [];
let voicesAt = 0;

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
  arabicVoice(pref = 'ar-SA') {
    if (!voices.length) loadVoices();
    const ar = voices.filter((v) => /^ar([-_]|$)/i.test(v.lang));
    if (!ar.length) return null;
    if (pref) { const exact = ar.find((v) => v.lang.toLowerCase() === pref.toLowerCase()); if (exact) return exact; }
    return ar.map((v) => ({ v, score: voiceScore(v, pref) })).sort((a, b) => b.score - a.score)[0].v;
  },
  get hasArabic() { return !!this.arabicVoice(); },
  speak(text, opt = {}) {
    if (!synth || !text) return false;
    try {
      const u = new SpeechSynthesisUtterance(opt.fusha === false ? text : toFusha(text));
      const chosen = opt.voiceURI ? voices.find((v) => v.voiceURI === opt.voiceURI) : null;
      const v = chosen || this.arabicVoice(opt.lang);
      u.lang = v ? v.lang : (opt.lang || 'ar-SA');
      if (v) u.voice = v;
      u.rate = opt.rate ?? 0.92;
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
};

function voiceScore(v, pref) {
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
