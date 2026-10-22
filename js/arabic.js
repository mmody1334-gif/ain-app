// معالجة النص العربي: توحيد الحروف، ثم مطابقة الجمل مع قاموس الإشارات (أطول عبارة أولاً).

const DIACRITICS = /[ً-ٰٟـ]/g;

export function normalizeAr(s) {
  return (s || '')
    .replace(DIACRITICS, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^ء-يa-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function variants(tok) {
  const out = [tok];
  const strip = (w, p) => (w.startsWith(p) && w.length > p.length + 1 ? w.slice(p.length) : null);
  for (const pre of ['وال', 'بال', 'كال', 'فال', 'لل', 'ال', 'و', 'ب', 'ل', 'ف']) {
    const w = strip(tok, pre);
    if (w) { out.push(w); const w2 = strip(w, 'ال'); if (w2) out.push(w2); }
  }
  return out;
}

/** يبني فهرساً من القاموس: كلمة/مرادف موحَّد → إشارة. */
export function buildIndex(signs) {
  const map = new Map();
  let maxLen = 1;
  for (const s of signs) {
    const keys = [s.word, ...(s.aliases || [])].map(normalizeAr).filter(Boolean);
    for (const k of keys) {
      if (!map.has(k)) map.set(k, s);
      maxLen = Math.max(maxLen, k.split(' ').length);
    }
  }
  return { map, maxLen };
}

/**
 * يقسّم الجملة إلى أجزاء مطابقة للقاموس.
 * @returns {Array<{text:string, sign:object|null}>}
 */
export function matchSentence(text, index) {
  const raw = (text || '').match(/[\u0621-\u065F\u0670\u0640a-zA-Z0-9\u0660-\u0669]+/g) || [];
  const toks = raw.map(normalizeAr);
  const out = [];
  let i = 0;
  while (i < toks.length) {
    if (toks[i].length === 1 && 'وفبل'.includes(toks[i])) { i++; continue; }   // حروف عطف منفردة
    let found = null, used = 1;
    for (let n = Math.min(index.maxLen, toks.length - i); n >= 1 && !found; n--) {
      const phrase = toks.slice(i, i + n).join(' ');
      if (index.map.has(phrase)) { found = index.map.get(phrase); used = n; break; }
      if (n === 1) {
        for (const v of variants(phrase)) if (index.map.has(v)) { found = index.map.get(v); break; }
      }
    }
    out.push({ text: raw.slice(i, i + used).join(' '), sign: found });
    i += used;
  }
  return out;
}

export const FINGER_WORDS = { thumb: 'الإبهام', index: 'السبّابة', middle: 'الوسطى', ring: 'البنصر', pinky: 'الخنصر' };
