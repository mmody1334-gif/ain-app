// أدوات واجهة صغيرة: بناء عناصر، أيقونات، رسائل، نوافذ.

const ICONS = {
  translate: '<path d="M7 11V5.5a1.5 1.5 0 013 0V11m0-1V4a1.5 1.5 0 013 0v6m0-5a1.5 1.5 0 013 0v5m0-3a1.5 1.5 0 013 0v7a7 7 0 01-7 7h-1.5a6 6 0 01-5-2.6L4 14.5a1.6 1.6 0 012.6-1.8L7 13.5"/>',
  listen: '<path d="M8 14a6 6 0 1112 0c0 3-2 3.5-2 6"/><path d="M11 14a3 3 0 116 0c0 1.5-1 2-1 3"/><path d="M4 9a9 9 0 012-4"/>',
  learn: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/><path d="M22 9v6"/>',
  dict: '<path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z"/><path d="M5 17a3 3 0 013-3h11"/><path d="M9 8h6"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  flip: '<path d="M3 7h13l-3-3M21 17H8l3 3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
  download: '<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14"/>',
  upload: '<path d="M12 16V5m0 0l-4 4m4-4l4 4M5 20h14"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
  chev: '<path d="M15 5l-7 7 7 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
};

export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.9'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = ICONS[name] || '';
  return s;
}

/** h('div.card#id', {onclick, hidden, style:{}}, ...children) */
export function h(tag, props, ...kids) {
  const m = tag.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m && m[1] ? m[1] : 'div');
  if (m && m[2]) for (const t of m[2].match(/[.#][\w-]+/g)) { if (t[0] === '.') el.classList.add(t.slice(1)); else el.id = t.slice(1); }
  if (props && (props.nodeType || typeof props === 'string' || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k in el && k !== 'list') { try { el[k] = v; } catch (_) { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

export function btn(label, opts = {}) {
  const { cls = '', ic, onclick, title, disabled } = opts;
  const b = h('button.btn' + (cls ? '.' + cls.split(' ').join('.') : ''), { onclick, title, disabled, type: 'button' });
  if (ic) b.append(icon(ic));
  if (label) b.append(h('span', label));
  return b;
}

let toastEl = null, toastTimer = 0;
export function toast(msg, kind = '') {
  if (toastEl) toastEl.remove();
  toastEl = h('div.toast' + (kind ? '.' + kind : ''), { role: 'status' }, msg);
  document.body.append(toastEl);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl?.remove(); toastEl = null; }, 2600);
}

/** نافذة سفلية. build(close) تعيد عناصر المحتوى. */
export function sheet(title, build, opt = {}) {
  const scrim = h('div.scrim');
  const body = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => { scrim.remove(); opt.onClose?.(); };
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim && !opt.persistent) close(); });
  const head = h('header', h('h2', title), opt.noClose ? null : h('button.iconbtn', { onclick: close, 'aria-label': 'إغلاق' }, icon('x')));
  body.append(h('div.grab'), head);
  const content = build(close, body);
  if (content) body.append(content);
  scrim.append(body);
  document.body.append(scrim);
  return { close, body, scrim };
}

export function confirmSheet(title, text, okLabel = 'نعم', cls = 'danger') {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet(title, (close) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
      h('p', text),
      h('div.row', btn(okLabel, { cls, onclick: () => { done = true; close(); resolve(true); } }), btn('إلغاء', { cls: 'ghost', onclick: () => close() }))),
      { onClose: () => { if (!done) resolve(false); } });
    void s;
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
