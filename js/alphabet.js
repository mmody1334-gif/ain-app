// الأبجدية العربية: الحروف وأسماؤها، وتسجيلها كإشارات ثابتة في القاموس.
// لا نخترع أشكال الحروف: يسجّلها المستخدم (أو مختص لغة إشارة) مرة واحدة،
// ثم يستعملها التطبيق لتهجئة الأسماء والكلمات غير الموجودة في القاموس.

export const ARABIC_LETTERS = [
  { ch: 'ا', name: 'ألف' }, { ch: 'ب', name: 'باء' }, { ch: 'ت', name: 'تاء' }, { ch: 'ث', name: 'ثاء' },
  { ch: 'ج', name: 'جيم' }, { ch: 'ح', name: 'حاء' }, { ch: 'خ', name: 'خاء' }, { ch: 'د', name: 'دال' },
  { ch: 'ذ', name: 'ذال' }, { ch: 'ر', name: 'راء' }, { ch: 'ز', name: 'زاي' }, { ch: 'س', name: 'سين' },
  { ch: 'ش', name: 'شين' }, { ch: 'ص', name: 'صاد' }, { ch: 'ض', name: 'ضاد' }, { ch: 'ط', name: 'طاء' },
  { ch: 'ظ', name: 'ظاء' }, { ch: 'ع', name: 'عين' }, { ch: 'غ', name: 'غين' }, { ch: 'ف', name: 'فاء' },
  { ch: 'ق', name: 'قاف' }, { ch: 'ك', name: 'كاف' }, { ch: 'ل', name: 'لام' }, { ch: 'م', name: 'ميم' },
  { ch: 'ن', name: 'نون' }, { ch: 'ه', name: 'هاء' }, { ch: 'و', name: 'واو' }, { ch: 'ي', name: 'ياء' },
];

export const ARABIC_RE = /[\u0621-\u064A]/;

export function letterId(ch) { return 'letter_' + ch.codePointAt(0).toString(16); }

export function letterSign(ch, name) {
  return {
    id: letterId(ch), word: ch, aliases: name ? [name] : [], kind: 'static',
    source: 'alphabet', letter: ch, created: Date.now(),
  };
}

export function letterProgress(signs) {
  const done = new Set(signs.filter((s) => s.letter && s.kind === 'static' && s.samples?.length).map((s) => s.letter));
  return { total: ARABIC_LETTERS.length, done: ARABIC_LETTERS.filter((l) => done.has(l.ch)).length, doneSet: done };
}

export function nextMissingLetter(signs, after = null) {
  const { doneSet } = letterProgress(signs);
  const list = after ? [...ARABIC_LETTERS.slice(ARABIC_LETTERS.findIndex((l) => l.ch === after) + 1), ...ARABIC_LETTERS] : ARABIC_LETTERS;
  return list.find((l) => !doneSet.has(l.ch)) || null;
}
