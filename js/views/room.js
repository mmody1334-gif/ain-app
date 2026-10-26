// واجهة ربط الأجهزة بكود الغرفة — مزامنة عبر الخادم (رسائل تصل حتى بعد الإغلاق)
import { h, btn, icon, toast, sheet } from '../ui.js';
import { room, ROOM_EVENTS } from '../room.js';

export function createRoomView(app) {
  let root, statusEl, msgListEl, msgInput;

  const messages = []; // [{text, from, at, isSign}]

  room.addEventListener('status', () => { renderStatus(); });
  room.addEventListener('peer_join', () => { toast('📱 جهاز جديد انضم للغرفة', 'ok'); renderStatus(); });
  room.addEventListener('message', (e) => {
    const msg = e.detail;
    const fromOther = msg.from && msg.from !== room.deviceId;
    if (msg.type === ROOM_EVENTS.SOS) {
      if (fromOther) {
        toast('🚨 طوارئ من جهاز آخر في الغرفة!', 'bad');
        if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
        app.emit('remote_sos', msg.data || {});
      }
      messages.push({ text: '🚨 ' + (msg.data?.message || 'استغاثة'), from: msg.from, at: msg.at });
      renderMessages();
    } else if (msg.type === ROOM_EVENTS.SIGN) {
      messages.push({ text: '🤲 ' + (msg.data?.word || ''), from: msg.from, at: msg.at, isSign: true });
      renderMessages();
      if (fromOther && app.settings.speakEach) app.say(msg.data.word);
    } else if (msg.type === ROOM_EVENTS.MSG) {
      messages.push({ text: String(msg.data?.text || ''), from: msg.from, at: msg.at });
      renderMessages();
    }
  });

  function renderStatus() {
    if (!statusEl) return;
    statusEl.innerHTML = '';
    if (!room.roomCode) { statusEl.append(h('p.muted.small', 'لم تنضم لأي غرفة بعد.')); return; }
    const color = room.connected ? 'var(--ok)' : 'var(--amber)';
    statusEl.append(
      h('div.row', { style: { gap: '10px', alignItems: 'center' } },
        h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: color, display: 'inline-block', flexShrink: '0' } }),
        h('b', { style: { fontSize: '1.4rem', letterSpacing: '0.15em', fontFamily: 'var(--font-title)' } }, room.roomCode),
        h('span.chip-status' + (room.connected ? '.ok' : ''), room.connected ? 'متصل' : 'جارٍ الاتصال…'),
      ),
      h('div', { style: { marginTop: '4px' } },
        h('p.small.muted', room.peerCount > 0
          ? room.peerCount + ' جهاز آخر في الغرفة 🟢'
          : 'في انتظار انضمام جهاز آخر…'),
        room.missedCount > 0
          ? h('p.small.muted', '📥 وصلتك رسائل وأنت مغلق (' + room.missedCount + ')')
          : null,
      ),
    );
  }

  function renderMessages() {
    if (!msgListEl) return;
    msgListEl.innerHTML = '';
    if (!messages.length) { msgListEl.append(h('p.small.muted', 'الرسائل والإشارات من الأجهزة الأخرى تظهر هنا.')); return; }
    for (const m of messages.slice(-30)) {
      const isMe = m.from === room.deviceId;
      msgListEl.append(h('div', {
        style: {
          padding: '6px 12px', borderRadius: '12px', marginBottom: '4px', maxWidth: '80%',
          background: m.isSign ? 'var(--amber-soft)' : isMe ? 'var(--accent-soft)' : 'var(--surface2)',
          color: m.isSign ? 'var(--amber)' : isMe ? 'var(--accent)' : 'var(--ink)',
          alignSelf: isMe ? 'flex-end' : 'flex-start',
          fontSize: m.isSign ? '1.1rem' : '1rem',
        },
      }, m.text));
    }
    msgListEl.scrollTop = msgListEl.scrollHeight;
  }

  function build() {
    statusEl = h('div');
    msgListEl = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', minHeight: '80px', maxHeight: '220px', overflowY: 'auto', padding: '4px' } });
    msgInput = h('input', { type: 'text', placeholder: 'اكتب رسالة…' });
    msgInput.onkeydown = (e) => { if (e.key === 'Enter') sendMsg(); };

    const joinOrCreate = room.roomCode
      ? [btn('مغادرة الغرفة', { cls: 'danger sm', ic: 'x', onclick: leaveRoom })]
      : [btn('إنشاء غرفة', { cls: 'primary', ic: 'plus', onclick: createRoom }), btn('انضم بكود', { cls: 'ghost', ic: 'bolt', onclick: joinRoom })];

    root.append(
      h('div.card',
        h('h2', '📡 ربط الأجهزة بكود الغرفة'),
        h('p.small.muted', 'أنشئ غرفة أو انضم لواحدة. الإشارات المترجمة والطوارئ تصل لكل الأجهزة فورًا، وما يُرسل وأنت مُغلق يُحفَظ على الخادم ويستقبله التطبيق عند فتحه.'),
        statusEl,
        h('div.row', { style: { marginTop: '8px', gap: '8px' } }, ...joinOrCreate),
      ),
      h('div.card',
        h('h2', '💬 المحادثة'),
        msgListEl,
        h('div.row', { style: { gap: '8px' } }, msgInput, btn('', { ic: 'share', cls: 'primary sm', onclick: sendMsg })),
        h('p.small.muted', 'الإشارات المترجمة من الكاميرا تُرسَل تلقائياً لباقي الأجهزة.'),
      ),
      h('div.card',
        h('h2', 'كيف يعمل؟'),
        h('ol.small', { style: { paddingInlineStart: '20px', lineHeight: '2' } },
          h('li', 'اضغط «إنشاء غرفة» — يظهر كود من 4 أرقام.'),
          h('li', 'أرسل الكود للجهاز الآخر — يدخله عبر «انضم بكود» ولو من شبكة أخرى.'),
          h('li', 'كل إشارة أو طوارئ يصل فورًا للجهاز الآخر عبر خادم سحابي.'),
          h('li', 'إذا كان التطبيق مُغلقاً كانت الرسائل محفوظة وتظهر عند فتحه.'),
          h('li', 'الغرفة ورسائلها تبقى محفوظة أياماً — الكود هو مفتاحها.'),
        ),
      ),
    );
    renderStatus();
    renderMessages();
  }

  async function createRoom() {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    await room.join(code);
    await app.store.setMeta('last_room', code);
    toast('غرفة جديدة: ' + code, 'ok');
    root.innerHTML = ''; build();
  }

  function joinRoom() {
    sheet('انضم لغرفة', (close) => {
      const inp = h('input', { type: 'text', placeholder: 'كود الغرفة', maxlength: '6', inputmode: 'numeric', style: { fontSize: '2rem', textAlign: 'center', letterSpacing: '0.5em' } });
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        inp,
        btn('انضم الآن', { cls: 'primary block', onclick: async () => {
          const code = inp.value.trim();
          if (!code || code.length < 3) { toast('أدخل الكود', 'bad'); return; }
          await room.join(code);
          await app.store.setMeta('last_room', code);
          toast('انضممت للغرفة: ' + code, 'ok');
          close(); root.innerHTML = ''; build();
        } }),
      );
    });
  }

  async function leaveRoom() {
    await room.leave();
    await app.store.setMeta('last_room', null);
    toast('غادرت الغرفة');
    root.innerHTML = ''; build();
  }

  function sendMsg() {
    const text = msgInput?.value.trim(); if (!text) return;
    if (!room.roomCode) { toast('انضم لغرفة أولاً', 'bad'); return; }
    room.sendMsg(text);
    messages.push({ text, from: room.deviceId, at: Date.now() });
    if (msgInput) msgInput.value = '';
    renderMessages();
  }

  return {
    mount(el) { root = el; build(); },
    show() { renderStatus(); renderMessages(); },
    hide() {},
  };
}
