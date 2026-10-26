// ربط الأجهزة بكود الغرفة — BroadcastChannel (نفس الجهاز، فوري) + مزامنة HTTPS مع غرفة سحابية
// الغرفة وسجلها يعيشان على الخادم: كل جهاز يستقصي كل 2.5 ثانية، ورسائل ما أثناء الإغلاق تُسلَّم لاحقًا (مخزن-وأرسل)
export const ROOM_EVENTS = { SIGN: 'sign', SOS: 'sos', MSG: 'msg', JOIN: 'join', LEAVE: 'leave', PONG: 'pong' };

const API = 'https://ain-chat.ain-app.workers.dev';
const POLL_MS = 2500;          // استقصاء عادي
const BACKOFF_MS = 3000;       // مهلة إعادة المحاولة بعد فشل (تتزايد، تُصفَّر عند النجاح)
const RETRY_CAP = 30000;
const CONNECTED_WINDOW = 8000; // «متصل» إن نجحت محاولة خلال المدة
const MAX_OUTBOX = 60;
const FETCH_TIMEOUT = 8000;    // أمن ضد الطلبات المعلّقة: ألغِ بعد 8 ثوانٍ

const outboxKey = (c) => `ain_outbox_${c}`;

class RoomClient extends EventTarget {
  constructor() {
    super();
    this.roomCode = null;
    this.deviceId = (() => {
      try {
        let id = localStorage.getItem('ain_device_id');
        if (!id) { id = 'd' + Math.random().toString(36).slice(2, 10); localStorage.setItem('ain_device_id', id); }
        return id;
      } catch (_) { return 'd' + Math.random().toString(36).slice(2, 10); }
    })();
    this.bc = null;
    this.active = false;      // داخل غرفة حتى leave
    this.members = [];        // [{id, at}] من الخادم
    this.missedCount = 0;     // رسائل وصلت والصفحة مغلقة
    this._since = 0;          // آخر طابع رأيناه (محفوظ لكل غرفة)
    this._lastOk = 0;         // آخر نجاح شبكة
    this._sessionStart = Date.now();
    this._timer = null;
    this._delay = POLL_MS;
    this._polls = 0;
    this._busy = false;       // قفل علبة الصادر
  }

  get connected() { return this.active && (Date.now() - this._lastOk) < CONNECTED_WINDOW; }
  get peerCount() {
    if (!this.roomCode) return 0;
    return this.members.filter((m) => m && m.id && m.id !== this.deviceId).length;
  }

  /** مشاركة غرفة — رخيصة وقابلة للتكرار (يُعاد استدعاؤها عند إعادة فتح التطبيق) */
  async join(code) {
    const c = String(code || '').trim().slice(0, 6).toUpperCase();
    if (!c) return null;
    if (this.active && this.roomCode === c) { this._announce(); return this.roomCode; }
    if (this.active) await this.leave();
    this.roomCode = c;
    this.active = true;
    this._sessionStart = Date.now();
    this.missedCount = 0;
    try { this._since = Number(localStorage.getItem('ain_since_' + c) || 0) || 0; } catch (_) { this._since = 0; }
    this._connectBC();
    // قفزات فورية عند العودة للأمام أو عودة الشبكة: التاب الخلفي يخنق المؤقتات،
    // لذا نعتمد على ردّ فعله الخاص عند الاسترجاع لتنعيم غياب الاستقصاء
    if (!this._listeners) {
      this._listeners = true;
      const wake = () => {
        if (this.active && document.visibilityState === 'visible') {
          this._delay = POLL_MS;
          this._schedule(0);
          // علبة الصادر تُفرَّغ فورًا مع أول دورة
        }
      };
      document.addEventListener('visibilitychange', wake);
      window.addEventListener('focus', wake);
      window.addEventListener('online', wake);
      // القفل قد يعلق في حالة حاجة قديمة — تفكيك دوري احتياطي
      setInterval(() => { if (this._busy && Date.now() - this._lastOk > CONNECTED_WINDOW * 4) this._busy = false; }, 15000);
    }
    // إخبار الخادم دون انتظار (يُنشئ/يُجدد الغرفة ويعيد قائمة الأجهزة)
    this._api('/api/room', { code: c, device: this.deviceId }).then((d) => {
      if (d && d.members) { this.members = d.members; this._announce(); }
    }).catch(() => {});
    this._delay = POLL_MS; this._polls = 0;
    this._schedule(0);
    this._announce();
    return this.roomCode;
  }

  async leave() {
    const code = this.roomCode;
    this.active = false;
    clearTimeout(this._timer); this._timer = null;
    this.roomCode = null; this.members = []; this.bc = null; this.missedCount = 0;
    if (code) {
      try { await this._fetch(API + '/api/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, device: this.deviceId }), keepalive: true }); } catch (_) {}
      try { localStorage.removeItem(outboxKey(code)); } catch (_) {}
    }
    this.dispatchEvent(new CustomEvent('status', { detail: { connected: false, peers: 0 } }));
  }

  // == الشبكة ============================================================
  /** fetch بمهلة صريحة: تعليق الشبكة لا يجمّد دورة الاستقصاء ولا علبة الصادر */
  async _fetch(path, init = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
    try { return await fetch(path, { ...init, signal: ctl.signal }); }
    finally { clearTimeout(t); }
  }

  async _api(path, payload) {
    const r = await this._fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || d.ok === false) throw new Error((d && d.error) || ('http ' + r.status));
    this._lastOk = Date.now();
    return d;
  }

  _schedule(ms) {
    clearTimeout(this._timer);
    if (!this.active) return;
    this._timer = setTimeout(() => { this._timer = null; this._poll().catch(() => {}); }, ms);
  }

  async _poll() {
    if (!this.active || !this.roomCode) return;
    // كل ~5 استقصاءات: تجديد عضويتنا وترتيب الأجهزة (يبقي الغرفة حية على الخادم)
    try {
      if (++this._polls % 5 === 0) {
        const d = await this._api('/api/room', { code: this.roomCode, device: this.deviceId });
        if (d && d.members) { this.members = d.members; this._announce(); }
      }
      await this._flushOutbox();
    } catch (_) { /* نتابع الاستقصاء الأساسي رغم ذلك */ }

    try {
      const r = await this._fetch(`${API}/api/messages?code=${encodeURIComponent(this.roomCode)}&since=${this._since}`);
      const d = await r.json();
      if (!r.ok || !d || d.ok === false) throw new Error('http ' + r.status);
      this._lastOk = Date.now();
      let newLast = this._since;
      for (const m of d.msgs || []) {
        if (m.at > newLast) newLast = m.at;
        if (m.device === this.deviceId) continue; // رسائل جهازنا تُعرض محليًا (أو عبر Channel بين التبويبات)
        if (m.at < this._sessionStart) this.missedCount++; // جاءت أثناء انغلاق الصفحة تقريبًا
        this._dispatchIncoming(m);
      }
      if (newLast > this._since) {
        this._since = newLast;
        try { localStorage.setItem('ain_since_' + this.roomCode, String(this._since)); } catch (_) {}
      }
      this._announce();
      this._delay = POLL_MS; // نجاح — صفّر التأخير
      this._schedule(this._delay);
    } catch (_) {
      this._delay = Math.min(RETRY_CAP, Math.max(BACKOFF_MS, this._delay * 1.75));
      this._announce(); // بلا نجاج — غير متصل
      this._schedule(this._delay);
    }
  }

  /** ما فشل إرساله محفوظ محليًا ويُدفع مع أول استقصاء ناجح */
  async _flushOutbox() {
    if (!this.roomCode || this._busy) return;
    const key = outboxKey(this.roomCode);
    let q = [];
    try { q = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) { q = []; }
    if (!q.length) return;
    this._busy = true;
    try {
      while (q.length) {
        await this._api('/api/msg', { code: this.roomCode, device: this.deviceId, ...q[0] });
        q.shift();
        try { localStorage.setItem(key, JSON.stringify(q)); } catch (_) {}
      }
    } catch (_) {
    } finally { this._busy = false; }
  }

  // == الإرسال ===========================================================
  _broadcast(msg) { try { this.bc?.postMessage(msg); } catch (_) {} }

  /** مسار واحد لكل الأنواع: فوري بين تبويبات الجهاز، وإرسال مخزّن على الخادم لباقي الأجهزة */
  send(type, data = {}) {
    if (!this.roomCode || !this.active) return;
    const rec = { at: Date.now(), type, from: this.deviceId, data, ...data };
    this._broadcast(rec); // مسار فوري محلي
    this._fetch(API + '/api/msg', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: this.roomCode, device: this.deviceId, type, ...data }),
    }).then(() => { this._lastOk = Date.now(); }).catch(() => {
      // الشبكة غير متاحة الآن — علبة الصادر تفرغ عند أول استقصاء ناجح
      try {
        const k = outboxKey(this.roomCode);
        const q = JSON.parse(localStorage.getItem(k) || '[]');
        q.push({ type, ...data });
        localStorage.setItem(k, JSON.stringify(q.slice(-MAX_OUTBOX)));
      } catch (_) {}
    });
  }
  sendSign(word, id) { this.send(ROOM_EVENTS.SIGN, { word, id }); }
  sendSOS(message) { this.send(ROOM_EVENTS.SOS, { message }); }
  sendMsg(text) { this.send(ROOM_EVENTS.MSG, { text }); }

  // == استقبال ===========================================================
  _connectBC() {
    if (!('BroadcastChannel' in window)) return;
    try {
      this.bc = new BroadcastChannel('ain-room-' + this.roomCode);
      this.bc.onmessage = (e) => {
        const m = e.data;
        if (!m || !m.type) return;
        // رسائل التبويبات الأخرى لنفس جهازنا فقط تمرّ من هنا (جهاز مختلف يعبر من الخادم)
        if (m.type === ROOM_EVENTS.JOIN) {
          this._broadcast({ type: ROOM_EVENTS.PONG, at: Date.now(), from: this.deviceId });
          return; // بعض تبويباتنا — لا نعرضها كرسالة
        }
        if (m.type === ROOM_EVENTS.LEAVE || m.type === ROOM_EVENTS.PONG) return;
        this._emitMessage({ ...m, from: m.from || this.deviceId, device: m.from || this.deviceId });
      };
    } catch (_) {}
  }

  _dispatchIncoming(m) {
    if (m.type === ROOM_EVENTS.SIGN || m.type === ROOM_EVENTS.SOS || m.type === ROOM_EVENTS.MSG) {
      this._emitMessage(m);
    }
  }

  _emitMessage(m) {
    // الشكل الموحّد: {at, device, from, type, data:{…payload}}
    const payload = { ...(m.data !== undefined ? m.data : m) };
    for (const k of ['at', 'device', 'type', 'from', 'room', 'data']) delete payload[k];
    const from = m.from || m.device;
    this.dispatchEvent(new CustomEvent('message', {
      detail: { at: m.at || Date.now(), device: from, from, type: m.type, data: payload },
    }));
  }

  _announce() {
    this.dispatchEvent(new CustomEvent('status', { detail: { connected: this.connected, peers: this.peerCount, code: this.roomCode } }));
  }
}

export const room = new RoomClient();
export default room;
