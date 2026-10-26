// قواعد الجملة: يحوّل ترتيب كلمات الإشارة (شبيه ISL) إلى جملة عربية منطوقة طبيعية.
// دوال نقية بلا DOM — تصلح للاختبار في Node مباشرة.

// أفعال معروفة: إن كانت آخر كلمة فعلاً نعيد ترتيبها نحو الجملة العربية (فاعل ثم فعل ثم مفعول)
export const VERB_LEXICON = new Set([
  'أريد', 'اريد', 'شرب', 'اشرب', 'أكل', 'اكل', 'جاء', 'ذهب', 'راح', 'حب', 'أحب',
  'اعطي', 'اعطني', 'تعال', 'قال', 'أخذ', 'مشي', 'نام', 'يقظ', 'فهم', 'لا أفهم',
  'اكثر', 'كفى',
]);

// كلمات سؤال لا نسبقها بـ«هل» إن بدأت بها الجملة
const QUESTION_WORDS = ['هل', 'متى', 'أين', 'اين', 'من', 'ماذا', 'ليش', 'لماذا', 'كيف', 'ما'];

// صفات/ضمائر تُعدّ فاعلاً صالحاً
const SUBJECT_WORDS = new Set(['أنا', 'انا', 'أنت', 'انت', 'هو', 'هي', 'نحن', 'هم', 'أهلًا', 'أهلاً', 'مرحبا']);

function isVerb(w) {
  return VERB_LEXICON.has(w) || /ني$/.test(w);
}

/** حذف التكرارات المتتالية (مطابقة جزئية تكفي: أهلًا/أهلاً). */
export function dedupeWords(words) {
  const out = [];
  for (const w of words) {
    const t = (w || '').trim();
    if (!t) continue;
    const prev = out[out.length - 1];
    if (prev && (prev === t || prev.includes(t) || t.includes(prev))) continue;
    out.push(t);
  }
  return out;
}

/** إعادة الترتيب: إن كانت الفعل أخيراً نضعه بعد أول فاعل (أو في المقدمة). */
export function reorderSVO(list) {
  const a = list.slice();
  if (a.length < 3 || !isVerb(a[a.length - 1])) return a;
  const verb = a.pop();
  // «من أنا» أو ضمير أو كلمة سؤال أولى: نضع الفعل بعدها
  let subjIdx = -1;
  if (a[0] === 'من' && a[1] && SUBJECT_WORDS.has(a[1])) subjIdx = 1;
  else if (SUBJECT_WORDS.has(a[0]) || QUESTION_WORDS.includes(a[0])) subjIdx = 0;
  if (subjIdx >= 0) a.splice(subjIdx + 1, 0, verb);
  else a.unshift(verb);
  return a;
}

/**
 * assembleSentence(words, face) → { text, spoken }
 * words: [{text, id}] حديثة النطق، face: 'question' | 'negation' | 'affirm' | null
 */
export function assembleSentence(words, face = null) {
  let list = dedupeWords(words.map((w) => (typeof w === 'string' ? w : w?.text || '')));

  // دمج التحية باسمها: «أهلاً فهد» تبقى معاً ولا تُفصل
  if (list.length > 1 && list[0].startsWith('أهلاً') && !SUBJECT_WORDS.has(list[1])) {
    // لا شيء: الزوج يبقى كما هو لأن التحية أولى والاسم يتبعها
  }

  list = reorderSVO(list);

  let text = list.join(' ');

  // تعابير الوجه تعدل الجملة
  if (face === 'negation') {
    if (text.includes('لا أفهم')) text = text.replace('لا أفهم', 'ما أفهم');
    else {
      const i = list.findIndex(isVerb);
      if (i >= 0) list.splice(i, 0, 'لا');
      else list.unshift('لا');
      text = list.join(' ');
    }
  } else if (face === 'affirm') {
    text = 'نعم ' + text;
  } else if (face === 'question') {
    const startsQ = QUESTION_WORDS.some((q) => text.startsWith(q + ' ')) || text.startsWith('هل');
    if (!startsQ) text = 'هل ' + text;
  }

  // الجملة السؤالية تنتهي بعلامة استفهام
  if ((face === 'question' || text.startsWith('هل ')) && !text.endsWith('؟')) text += '؟';

  return { text, spoken: text };
}
