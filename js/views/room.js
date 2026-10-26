// الغرفة: محادثة بين شخصين (أو أكثر) على أجهزة مختلفة بكود واحد.
// الإشارات المترجمة من الكاميرا تظهر فيها كفقاعات خاصة تُنطق ويمكن مشاهدة رسمها،
// والنص يُكتب عادياً، والطوارئ تصل للجميع. الاتصال فوري عبر WebSocket مع رجوع للاستقصاء.
import { h, btn, icon, toast, sheet } from '../ui.js';
import { room, ROOM_EVENTS } from '../room.js';

const fmtTime = (at) => { try { return new Date(at).toLocaleTimeString('ar', { hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; } };

export function createRoomView(app) {
  let root, headEl, listEl, inputEl, signingEl, visible = false;
  const msgs = [];                // [{key, seq, cid, at, type, data, device, mine, name, status}]
  const byCid = new Map();
  let unreadMark = 0;             // seq آخر رسالة قبل «وصلتك وأنت مغلق»
  const signingPeers = new Map(); // device → {name, until}

  // ---------- البيانات ----------
  const mapUrl = (d) => `https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}`;

  function upsert(m) {
    if (m.cid && byCid.has(m.cid)) { Object.assign(byCid.get(m.cid), m); return; }
    // الموقع الحيّ: فقاعة واحدة لكل جهاز تتحدّث بدل عشرات الفقاعات
    if (m.type === 'loc') {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const x = msgs[i];
        if (x.device !== m.device) continue;
        if (x.type === 'loc' && !x.data.ended && (m.at - x.at) < 30 * 60000) {
          const keepLatLng = m.data.ended && x.data.lat !== undefined;
          x.data = keepLatLng ? { ...x.data, ended: true } : { ...m.data };
          x.at = m.at; x.seq = Math.max(x.seq || 0, m.seq || 0); x.status = m.status;
          if (m.cid) byCid.set(m.cid, x);
          return;
        }
        if (x.type !== 'loc') break;
      }
    }
    if (m.seq && msgs.some((x) => x.seq && x.seq === m.seq)) return;
    const rec = { ...m };
    msgs.push(rec);
    if (rec.cid) byCid.set(rec.cid, rec);
    msgs.sort((a, b) => (a.at || 0) - (b.at || 0));
    if (msgs.length > 400) { const cut = msgs.splice(0, msgs.length - 400); for (const c of cut) if (c.cid) byCid.delete(c.cid); }
  }

  room.addEventListener('history', (e) => {
    const d = e.detail || {};
    msgs.length = 0; byCid.clear();
    for (const m of d.msgs || []) upsert(m);
    unreadMark = d.missed ? d.prevSeq : 0;
    renderAll();
  });

  room.addEventListener('message', (e) => {
    const m = e.detail;
    upsert(m);
    if (!m.mine) {
      if (m.type === ROOM_EVENTS.SOS && m.data.test) {
        toast('🧪 تجربة طوارئ من ' + (m.name || 'جهاز آخر'), '');
      } else if (m.type === ROOM_EVENTS.SOS) {
        toast('🚨 طوارئ من ' + (m.name || 'جهاز آخر') + '!', 'bad');
        if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
        app.emit('remote_sos', { message: m.data.message, name: m.name, device: m.device, lat: m.data.lat, lng: m.data.lng, acc: m.data.acc });
      } else if (m.type === ROOM_EVENTS.LOC) {
        if (m.data.sos && !m.data.test) app.emit('remote_loc', { device: m.device, name: m.name, lat: m.data.lat, lng: m.data.lng, acc: m.data.acc, ended: m.data.ended });
      } else if (app.settings.roomSpeak !== false) {
        const say = m.type === 'sign' ? m.data.word : m.type === 'sentence' ? m.data.text : null;
        if (say) app.say(say);
      }
      if (!visible) app.emit('room_unread', 1);
      signingPeers.delete(m.device);
    }
    renderList(true); renderSigning();
  });
  room.addEventListener('ack', (e) => { const r = byCid.get(e.detail.cid); if (r) { r.status = 'sent'; if (e.detail.seq) r.seq = e.detail.seq; renderList(); } });
  room.addEventListener('queued', (e) => { const r = byCid.get(e.detail.cid); if (r) { r.status = 'queued'; renderList(); } });
  room.addEventListener('failed', (e) => { const r = byCid.get(e.detail.cid); if (r) { r.status = 'failed'; renderList(); } });
  room.addEventListener('status', () => { if (root) { if (!!room.roomCode !== !!root.dataset.inroom) build(); else renderHead(); } });
  room.addEventListener('peer_join', (e) => { if (visible) toast('🟢 ' + (e.detail.name || 'جهاز آخر') + ' دخل الغرفة', 'ok'); });
  room.addEventListener('signing', (e) => {
    const d = e.detail;
    if (d.on) signingPeers.set(d.device, { name: d.name, until: Date.now() + 6000 });
    else signingPeers.delete(d.device);
    renderSigning();
  });
  setInterval(() => { let ch = false; for (const [k, v] of signingPeers) if (v.until < Date.now()) { signingPeers.delete(k); ch = true; } if (ch) renderSigning(); }, 1500);

  // ---------- العرض ----------
  function statusInfo() {
    if (!room.roomCode) return { text: '', color: 'var(--muted)' };
    if (room.mode === 'ws') return { text: 'متصل فوري', color: 'var(--ok)' };
    if (room.connected) return { text: 'متصل (بطيء)', color: 'var(--amber)' };
    return { text: 'غير متصل — تُحفظ رسائلك وتُرسل لاحقاً', color: 'var(--bad)' };
  }

  function renderHead() {
    if (!headEl) return;
    headEl.innerHTML = '';
    const st = statusInfo();
    const peers = room.peers;
    const who = peers.length ? peers.map((p) => p.name || 'جهاز بلا اسم').join('، ') : 'لا أحد غيرك الآن';
    headEl.append(
      h('div.row', { style: { gap: '10px', alignItems: 'center' } },
        h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: st.color, flexShrink: '0' } }),
        h('div.grow',
          h('div.row', { style: { gap: '8px', alignItems: 'baseline' } },
            h('b', { style: { fontSize: '1.3rem', letterSpacing: '0.12em', fontFamily: 'var(--font-title)' } }, room.roomCode),
            h('span.small.muted', st.text)),
          h('div.small.muted', (peers.length ? '🟢 ' : '') + who)),
        h('button.iconbtn', { 'aria-label': 'شارك كود الغرفة', title: 'شارك الكود', onclick: shareCode }, icon('share')),
        h('button.iconbtn', { 'aria-label': 'خيارات الغرفة', title: 'خيارات', onclick: openOptions }, icon('gear'))),
    );
  }

  function renderSigning() {
    if (!signingEl) return;
    const names = [...signingPeers.values()].map((v) => v.name || 'الطرف الآخر');
    signingEl.textContent = names.length ? '🤲 ' + names.join('، ') + ' يُشير الآن…' : '';
    signingEl.hidden = !names.length;
  }

  function bubble(m) {
    const mine = m.mine;
    const kind = m.type;
    const d = m.data || {};
    const name = mine ? '' : (m.name || room.nameOf(m.device) || 'جهاز آخر');
    let body;
    if (kind === 'sign' || kind === 'sentence') {
      const text = kind === 'sign' ? d.word : d.text;
      body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('div', { style: { fontSize: '1.35rem', fontWeight: '700' } }, '🤲 ' + (text || '')),
        h('div.row', { style: { gap: '6px' } },
          h('button.btn.sm', { type: 'button', onclick: () => app.say(text) }, icon('speaker'), h('span', 'انطق')),
          h('button.btn.sm', { type: 'button', onclick: () => showSign(text) }, icon('eye'), h('span', 'شاهد الإشارة'))));
    } else if (kind === 'sos') {
      body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('div', { style: { fontWeight: '700' } }, (d.test ? '🧪 تجربة طوارئ: ' : '🚨 ') + (d.message || 'استغاثة')),
        d.lat !== undefined ? h('a.btn.sm', { href: mapUrl(d), target: '_blank', rel: 'noopener', style: { textDecoration: 'none', alignSelf: 'flex-start' } }, '📍 افتح الموقع في الخرائط') : null);
    } else if (kind === 'loc') {
      const age = Math.max(0, Math.round((Date.now() - m.at) / 60000));
      const title = d.ended ? '📍 آخر موقع (انتهى الإنذار)' : d.sos ? (d.test ? '📍 موقع (تجربة طوارئ) — يتحدّث مباشرة' : '📍 موقع حيّ أثناء الطوارئ') : '📍 موقع مُشارَك';
      body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('div', { style: { fontWeight: '700' } }, title),
        d.lat !== undefined ? h('div.small.muted', `دقة ±${Math.round(d.acc || 0)} م · ${age ? 'منذ ' + age + ' د' : 'الآن'}`) : null,
        d.lat !== undefined ? h('a.btn.sm', { href: mapUrl(d), target: '_blank', rel: 'noopener', style: { textDecoration: 'none', alignSelf: 'flex-start' } }, 'افتح في الخرائط') : null);
    } else {
      body = h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, String(d.text || ''));
    }
    const tick = !mine ? '' : m.status === 'pending' ? ' ⏳' : m.status === 'queued' ? ' ⏸ ستُرسل عند الاتصال' : m.status === 'failed' ? ' ⚠ لم تُرسل' : ' ✓';
    const bg = kind === 'sos' || (kind === 'loc' && d.sos && !d.ended && !d.test) ? 'var(--bad-soft)' : (kind === 'sign' || kind === 'sentence') ? 'var(--amber-soft)' : mine ? 'var(--accent-soft)' : 'var(--surface2)';
    return h('div', {
      style: {
        alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', padding: '8px 12px', borderRadius: mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        background: bg, color: 'var(--ink)', border: kind === 'sos' ? '1px solid var(--bad)' : '0',
      },
    },
    name ? h('div.small', { style: { color: 'var(--accent)', fontWeight: '600', marginBottom: '2px' } }, name) : null,
    body,
    h('div.small.muted', { style: { textAlign: mine ? 'start' : 'end', fontSize: '.72rem', marginTop: '2px' } }, fmtTime(m.at) + tick));
  }

  function renderList(stick = false) {
    if (!listEl) return;
    const atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 80;
    listEl.innerHTML = '';
    if (!msgs.length) {
      listEl.append(h('p.small.muted', { style: { textAlign: 'center', margin: 'auto' } }, 'ابدأ المحادثة: اكتب رسالة، أو افتح «ترجمة» وأشِر فتصل إشاراتك هنا.'));
      return;
    }
    let lineDone = false;
    for (const m of msgs) {
      if (unreadMark && !lineDone && m.seq > unreadMark && !m.mine) {
        listEl.append(h('div.small', { style: { textAlign: 'center', color: 'var(--amber)', margin: '6px 0' } }, '— وصلتك هذه وأنت خارج التطبيق —'));
        lineDone = true;
      }
      listEl.append(bubble(m));
    }
    if (stick || atBottom) listEl.scrollTop = listEl.scrollHeight;
  }

  function renderAll() { renderHead(); renderList(true); renderSigning(); }

  // ---------- البناء ----------
  function build() {
    if (!root) return;
    root.innerHTML = '';
    headEl = listEl = inputEl = signingEl = null;
    if (!room.roomCode) { delete root.dataset.inroom; buildLobby(); return; }
    root.dataset.inroom = '1';
    headEl = h('div.card', { style: { padding: '10px 14px' } });
    listEl = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', height: 'calc(100dvh - 400px)', minHeight: '260px', overflowY: 'auto', padding: '8px 4px' } });
    signingEl = h('div.small', { hidden: true, style: { color: 'var(--accent)', padding: '0 6px', minHeight: '1.2em' } });
    inputEl = h('input', { type: 'text', placeholder: 'اكتب رسالة…', enterKeyHint: 'send', maxlength: '600', onkeydown: (e) => { if (e.key === 'Enter') sendText(); } });
    root.append(
      headEl,
      h('div.card', { style: { padding: '6px' } }, listEl, signingEl,
        h('div.row', { style: { gap: '6px', alignItems: 'center' } },
          h('button.iconbtn', { 'aria-label': 'أشر بالكاميرا', title: 'أشر بالكاميرا (قسم ترجمة)', onclick: () => app.go('translate') }, icon('translate')),
          h('div.grow', inputEl),
          btn('', { ic: 'chev', cls: 'primary', title: 'إرسال', onclick: sendText }))),
    );
    renderAll();
  }

  function buildLobby() {
    const nameInp = h('input', { type: 'text', placeholder: 'اسمك (يظهر للطرف الآخر)', maxlength: '40', value: room.name, onchange: (e) => room.setName(e.target.value) });
    root.append(
      h('div.card',
        h('h2', '💬 غرفة محادثة بين جهازين'),
        h('p.small.muted', 'أنشئ غرفة وأرسل كودها للشخص الآخر. كل ما تكتبه، وكل إشارة تترجمها الكاميرا (إن فعّلت الإرسال في «ترجمة»)، يظهر عنده فوراً ويُنطق بصوت، وتستطيع أن ترى إشاراته مرسومة.'),
        h('label.field', h('span.muted.small', 'اسمك'), nameInp),
        h('div.row', { style: { gap: '8px', marginTop: '8px' } },
          btn('إنشاء غرفة', { cls: 'primary', ic: 'plus', onclick: () => { room.setName(nameInp.value); createRoom(); } }),
          btn('انضم بكود', { cls: 'ghost', ic: 'bolt', onclick: () => { room.setName(nameInp.value); joinRoom(); } }))),
      h('div.card',
        h('h2', 'كيف يعمل؟'),
        h('ol.small', { style: { paddingInlineStart: '20px', lineHeight: '2' } },
          h('li', 'أنشئ غرفة — يظهر كود من 6 أرقام.'),
          h('li', 'أرسل الكود للشخص الآخر — يدخله في «انضم بكود» ولو من شبكة أخرى.'),
          h('li', 'اكتب أو أشِر: الرسائل تصل فوراً، وتظهر علامة ✓ عندما يستلمها الخادم.'),
          h('li', 'إن انقطع الإنترنت تُحفظ رسائلك وتُرسل وحدها عند عودته.'),
          h('li', 'الكود هو مفتاح الغرفة: لا تشاركه إلا مع من تريد.'))),
    );
  }

  // ---------- أفعال ----------
  async function createRoom() {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await room.join(code);
    await app.store.setMeta('last_room', code);
    toast('غرفة جديدة: ' + code, 'ok');
    build();
  }

  function joinRoom() {
    sheet('انضم لغرفة', (close) => {
      const inp = h('input', { type: 'text', placeholder: 'كود الغرفة', maxlength: '8', inputmode: 'numeric', style: { fontSize: '2rem', textAlign: 'center', letterSpacing: '0.4em' } });
      const go = async () => {
        const code = inp.value.trim();
        if (!code || code.length < 3) { toast('أدخل الكود', 'bad'); return; }
        await room.join(code);
        await app.store.setMeta('last_room', room.roomCode);
        toast('انضممت للغرفة: ' + room.roomCode, 'ok');
        close(); build();
      };
      inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      setTimeout(() => inp.focus(), 50);
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, inp, btn('انضم الآن', { cls: 'primary block', onclick: go }));
    });
  }

  function openOptions() {
    sheet('الغرفة ' + room.roomCode, (close) => {
      const nameInp = h('input', { type: 'text', maxlength: '40', value: room.name, placeholder: 'اسمك' });
      const speak = h('input', { type: 'checkbox', checked: app.settings.roomSpeak !== false, onchange: (e) => app.saveSettings({ roomSpeak: e.target.checked }) });
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        h('label.field', h('span.muted.small', 'اسمك في المحادثة'), nameInp),
        btn('حفظ الاسم', { cls: 'sm', onclick: () => { room.setName(nameInp.value); toast('حُفظ الاسم', 'ok'); renderHead(); } }),
        h('label.switch', h('span', 'انطق الإشارات والجمل الواردة'), speak),
        btn('📍 شارك موقعي الحالي', { cls: 'block', onclick: () => { close(); shareLocation(); } }),
        btn('مغادرة الغرفة', { cls: 'danger block', ic: 'x', onclick: async () => { close(); await room.leave(); await app.store.setMeta('last_room', null); msgs.length = 0; byCid.clear(); toast('غادرت الغرفة'); build(); } }));
    });
  }

  function shareCode() {
    const text = `انضم لمحادثتي في تطبيق عين — كود الغرفة: ${room.roomCode}\n${location.origin}${location.pathname}#room`;
    const copy = () => navigator.clipboard?.writeText(text).then(() => toast('نُسخ الكود', 'ok')).catch(() => toast('الكود: ' + room.roomCode));
    if (navigator.share) navigator.share({ text }).catch(copy); else copy();
  }

  function sendText() {
    const text = inputEl?.value.trim();
    if (!text) return;
    room.sendMsg(text);
    inputEl.value = '';
    inputEl.focus();
  }

  function shareLocation() {
    if (!navigator.geolocation) { toast('هذا الجهاز لا يدعم تحديد الموقع', 'bad'); return; }
    toast('جارٍ تحديد موقعك…');
    navigator.geolocation.getCurrentPosition(
      (p) => { room.sendLocation({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); toast('أُرسل موقعك للغرفة ✓', 'ok'); },
      (e) => toast(e && e.code === 1 ? 'لم يُسمح بالموقع — فعّله من إعدادات المتصفح' : 'تعذّر تحديد الموقع', 'bad'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  }

  function showSign(text) {
    if (!text) return;
    app.go('listen');
    app.views.listen?.api?.showText?.(text);
  }

  return {
    mount(el) { root = el; build(); },
    show() { visible = true; app.emit('room_unread', 0); build(); },
    hide() { visible = false; },
  };
}
