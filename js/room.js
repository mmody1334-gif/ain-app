// غرفة «عين»: محادثة بين الأجهزة بكود الغرفة.
// المسار الأساسي WebSocket فوري مع خادم الغرف (Durable Object)، وإن تعذّر نرجع للاستقصاء عبر HTTP.
// كل رسالة تُعرض عند مرسلها فوراً بحالة «يُرسَل…» ثم «وصل ✓» عند تأكيد الخادم؛
// وما يفشل يُحفظ في علبة صادر ويُعاد إرساله تلقائياً (بنفس المعرّف، فلا يتكرر).
export const ROOM_EVENTS = { SIGN: 'sign', SENTENCE: 'sentence', SOS: 'sos', MSG: 'msg' };

const API = (typeof window !== 'undefined' && window.__AIN_CHAT_API__) || 'https://ain-chat.ain-app.workers.dev';
const WS_API = API.replace(/^http/, 'ws');
const POLL_MS = 3000;          // استقصاء احتياطي عندما يكون المقبس مغلقاً
const RETRY_MIN = 1000, RETRY_CAP = 20000;
const FETCH_TIMEOUT = 8000;
const PING_MS = 25000;
const MAX_OUTBOX = 60;

const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};
const outboxKey = (c) => `ain_outbox_${c}`;
const seqKey = (c) => `ain_seq_${c}`;
const newCid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

class RoomClient extends EventTarget {
  constructor() {
    super();
    this.roomCode = null;
    this.deviceId = ls.get('ain_device_id') || (() => { const id = 'd' + Math.random().toString(36).slice(2, 10); ls.set('ain_device_id', id); return id; })();
    this.name = ls.get('ain_display_name', '') || '';
    this.active = false;
    this.online = [];          // [{device, name, live}]
    this.members = [];         // توافق مع الواجهة القديمة
    this.missedCount = 0;
    this.mode = 'off';         // off | ws | poll
    this._seq = 0;             // آخر رقم تسلسلي رأيناه
    this._lastAt = 0;          // للخادم القديم (بلا seq)
    this._seen = new Set();    // seq/cid لمنع التكرار بين المقبس والاستقصاء
    this._ws = null; this._wsTries = 0; this._wsTimer = 0; this._pingTimer = 0;
    this._pollTimer = 0; this._lastOk = 0;
    this._signing = { on: false, at: 0 };
    this._wired = false;
  }

  // ---------- الحالة ----------
  get connected() { return this.active && (this.mode === 'ws' || Date.now() - this._lastOk < POLL_MS * 3); }
  get peers() { return this.online.filter((p) => p.device !== this.deviceId); }
  get peerCount() { return this.peers.length; }

  setName(name) {
    this.name = String(name || '').trim().slice(0, 40);
    ls.set('ain_display_name', this.name);
    this._wsSend({ t: 'name', name: this.name });
  }

  nameOf(device) {
    if (device === this.deviceId) return this.name || 'أنا';
    const p = this.online.find((x) => x.device === device) || this.members.find((x) => x && x.id === device);
    return (p && p.name) || '';
  }

  // ---------- الانضمام والمغادرة ----------
  async join(code) {
    const c = String(code || '').trim().slice(0, 8).toUpperCase();
    if (!c) return null;
    if (this.active && this.roomCode === c) { this._announce(); return c; }
    if (this.active) await this.leave(true);
    this.roomCode = c; this.active = true; this.missedCount = 0;
    this._seen = new Set();
    const prevSeq = Number(ls.get(seqKey(c), 0)) || 0;
    this._wire();
    this._announce();

    // سجل الغرفة كاملاً (يبقى ظاهراً بعد أي ريفريش)، ونعدّ ما وصل منذ آخر زيارة
    try {
      const d = await this._get(`/api/messages?code=${encodeURIComponent(c)}&after=0&since=0&device=${this.deviceId}`);
      const msgs = (d.msgs || []).map((m) => this._norm(m));
      for (const m of msgs) this._mark(m);
      this.missedCount = msgs.filter((m) => !m.mine && (m.seq ? m.seq > prevSeq : false)).length;
      this._take(d);
      this.dispatchEvent(new CustomEvent('history', { detail: { msgs, missed: this.missedCount, prevSeq } }));
    } catch (_) {
      this.dispatchEvent(new CustomEvent('history', { detail: { msgs: [], missed: 0, prevSeq, failed: true } }));
    }
    if (!this.active || this.roomCode !== c) return c;
    this._post('/api/room', { code: c, device: this.deviceId, name: this.name }).then((d) => this._take(d)).catch(() => {});
    this._connectWS();
    this._schedulePoll(POLL_MS);
    return c;
  }

  async leave(silent = false) {
    const code = this.roomCode;
    this.active = false; this.roomCode = null; this.online = []; this.members = []; this.missedCount = 0;
    this.mode = 'off';
    clearTimeout(this._pollTimer); clearTimeout(this._wsTimer); clearInterval(this._pingTimer);
    if (this._ws) { try { this._ws.onclose = null; this._ws.close(1000, 'leave'); } catch (_) {} this._ws = null; }
    if (code) {
      this._post('/api/leave', { code, device: this.deviceId }, { keepalive: true }).catch(() => {});
      ls.del(outboxKey(code));
    }
    if (!silent) this._announce();
  }

  // ---------- الإرسال ----------
  /**
   * يرسل رسالة ويعيدها فوراً بشكلها المحلي (حالتها pending)؛ تصل أحداث 'ack' أو 'failed' لاحقاً.
   * type: msg {text} | sign {word,id} | sentence {text, words} | sos {message}
   */
  send(type, data = {}) {
    if (!this.active || !this.roomCode) return null;
    const rec = { cid: newCid(), type, name: this.name || undefined, ...data };
    const local = this._norm({ ...rec, device: this.deviceId, at: Date.now() });
    local.status = 'pending';
    this._seen.add('c:' + rec.cid);
    this.dispatchEvent(new CustomEvent('message', { detail: local }));
    this._deliver(this.roomCode, rec);
    return local;
  }
  sendMsg(text) { return this.send(ROOM_EVENTS.MSG, { text: String(text).slice(0, 600) }); }
  sendSign(word, id) { return this.send(ROOM_EVENTS.SIGN, { word, id }); }
  sendSentence(text, words = []) { return this.send(ROOM_EVENTS.SENTENCE, { text, words }); }
  sendSOS(message) { return this.send(ROOM_EVENTS.SOS, { message }); }

  /** مؤشر «يُشير الآن…» للطرف الآخر — مخنوق حتى لا يُغرق المقبس */
  signing(on) {
    on = !!on;
    const now = Date.now();
    if (on === this._signing.on && now - this._signing.at < 4000) return;
    this._signing = { on, at: now };
    this._wsSend({ t: 'signing', on });
  }

  async _deliver(code, rec) {
    if (this._wsSend({ t: 'msg', ...rec })) return;          // التأكيد يصل عبر المقبس
    try {
      const d = await this._post('/api/msg', { code, device: this.deviceId, ...rec });
      if (d && d.msg) this._onServerMsg(d.msg);
      else this._ack(rec.cid, { seq: d && d.seq, at: d && d.lastAt });
    } catch (_) {
      this._queue(code, rec);
    }
  }

  _queue(code, rec) {
    let q = [];
    try { q = JSON.parse(ls.get(outboxKey(code), '[]')); } catch (_) {}
    if (!q.some((x) => x.cid === rec.cid)) q.push(rec);
    ls.set(outboxKey(code), JSON.stringify(q.slice(-MAX_OUTBOX)));
    this.dispatchEvent(new CustomEvent('queued', { detail: { cid: rec.cid } }));
  }

  async _flushOutbox() {
    const code = this.roomCode;
    if (!code || this._flushing) return;
    let q = [];
    try { q = JSON.parse(ls.get(outboxKey(code), '[]')); } catch (_) {}
    if (!q.length) return;
    this._flushing = true;
    ls.set(outboxKey(code), '[]');
    try {
      for (const rec of q) {
        if (this.roomCode !== code) break;
        await this._deliver(code, rec);   // يعيدها للعلبة إن فشلت
      }
    } finally { this._flushing = false; }
  }

  // ---------- المقبس ----------
  _connectWS() {
    clearTimeout(this._wsTimer);
    if (!this.active || !this.roomCode || typeof WebSocket === 'undefined') return;
    if (this._ws && (this._ws.readyState === 0 || this._ws.readyState === 1)) return;
    const code = this.roomCode;
    let ws;
    try {
      ws = new WebSocket(`${WS_API}/api/ws?code=${encodeURIComponent(code)}&device=${encodeURIComponent(this.deviceId)}&name=${encodeURIComponent(this.name)}&after=${this._seq}`);
    } catch (_) { this._retryWS(); return; }
    this._ws = ws;
    ws.onopen = () => {
      if (this._ws !== ws) return;
      this._wsTries = 0; this.mode = 'ws'; this._lastOk = Date.now();
      clearInterval(this._pingTimer);
      this._pingTimer = setInterval(() => this._wsSend({ t: 'ping' }), PING_MS);
      this._announce();
      this._flushOutbox();
    };
    ws.onmessage = (e) => {
      if (this._ws !== ws) return;
      this._lastOk = Date.now();
      let d; try { d = JSON.parse(e.data); } catch (_) { return; }
      if (d.t === 'msg' && d.m) this._onServerMsg(d.m);
      else if ((d.t === 'hello' || d.t === 'sync') && d.msgs) { for (const m of d.msgs) this._onServerMsg(m); this._take(d); }
      else if (d.t === 'presence') this._take(d);
      else if (d.t === 'signing') this.dispatchEvent(new CustomEvent('signing', { detail: { device: d.device, name: d.name || this.nameOf(d.device), on: !!d.on } }));
      else if (d.t === 'err' && d.cid) this.dispatchEvent(new CustomEvent('failed', { detail: { cid: d.cid, error: d.error } }));
      if (d.t === 'hello') this._take(d);
    };
    ws.onclose = () => {
      if (this._ws !== ws) return;
      this._ws = null; clearInterval(this._pingTimer);
      if (this.mode === 'ws') this.mode = 'poll';
      this._announce();
      this._retryWS();
      this._schedulePoll(0);
    };
    ws.onerror = () => {};
  }

  _retryWS() {
    if (!this.active) return;
    const ms = Math.min(RETRY_CAP, RETRY_MIN * 2 ** Math.min(5, this._wsTries++));
    clearTimeout(this._wsTimer);
    this._wsTimer = setTimeout(() => this._connectWS(), ms);
  }

  _wsSend(obj) {
    const ws = this._ws;
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch (_) { return false; }
  }

  // ---------- الاستقصاء الاحتياطي ----------
  _schedulePoll(ms) {
    clearTimeout(this._pollTimer);
    if (!this.active) return;
    this._pollTimer = setTimeout(() => this._poll(), ms);
  }

  async _poll() {
    if (!this.active || !this.roomCode) return;
    if (this.mode === 'ws' && this._ws && this._ws.readyState === 1) { this._schedulePoll(POLL_MS * 5); return; }
    const code = this.roomCode;
    try {
      const d = await this._get(`/api/messages?code=${encodeURIComponent(code)}&after=${this._seq}&since=${this._lastAt}&device=${this.deviceId}&name=${encodeURIComponent(this.name)}`);
      if (this.roomCode !== code) return;
      if (this.mode !== 'ws') this.mode = 'poll';
      for (const m of d.msgs || []) this._onServerMsg(m);
      this._take(d);
      this._flushOutbox();
      this._announce();
    } catch (_) { this._announce(); }
    this._schedulePoll(POLL_MS);
  }

  // ---------- الاستقبال ----------
  _norm(m) {
    const device = m.device || m.from || '';
    return {
      seq: m.seq || 0, cid: m.cid || null, at: m.at || Date.now(), type: m.type, device, from: device,
      mine: device === this.deviceId, name: m.name || '',
      data: { text: m.text, word: m.word, id: m.id, message: m.message, words: m.words },
      status: 'sent',
    };
  }

  _mark(m) {
    if (m.seq) { this._seen.add('s:' + m.seq); if (m.seq > this._seq) this._seq = m.seq; }
    if (m.cid) this._seen.add('c:' + m.cid);
    if (m.at > this._lastAt) this._lastAt = m.at;
    if (this.roomCode && this._seq) ls.set(seqKey(this.roomCode), String(this._seq));
  }

  _onServerMsg(raw) {
    const m = this._norm(raw);
    const dupSeq = m.seq && this._seen.has('s:' + m.seq);
    const knownCid = m.cid && this._seen.has('c:' + m.cid);
    this._mark(m);
    if (dupSeq) return;
    if (m.mine && knownCid) { this._ack(m.cid, { seq: m.seq, at: m.at }); return; }   // رسالتي: تأكيد وصول فقط
    if (m.mine && !m.cid) return;   // صدى رسالتي من الخادم القديم (بلا معرّف): معروضة عندي أصلاً
    if (!['sign', 'sentence', 'msg', 'sos'].includes(m.type)) return;
    this.dispatchEvent(new CustomEvent('message', { detail: m }));
  }

  _ack(cid, info) { if (cid) this.dispatchEvent(new CustomEvent('ack', { detail: { cid, ...info } })); }

  _take(d) {
    if (!d) return;
    if (Array.isArray(d.online)) {
      const before = new Set(this.peers.map((p) => p.device));
      this.online = d.online;
      for (const p of this.peers) if (!before.has(p.device)) this.dispatchEvent(new CustomEvent('peer_join', { detail: p }));
    }
    if (Array.isArray(d.members)) this.members = d.members.map((x) => (typeof x === 'string' ? { id: x } : x));
    this._announce();
  }

  // ---------- الشبكة ----------
  async _fetch(path, init = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
    try { return await fetch(API + path, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
  }
  async _get(path) {
    const r = await this._fetch(path);
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || d.ok === false) throw new Error((d && d.error) || 'http ' + r.status);
    this._lastOk = Date.now();
    return d;
  }
  async _post(path, payload, extra = {}) {
    const r = await this._fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), ...extra });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || d.ok === false) throw new Error((d && d.error) || 'http ' + r.status);
    this._lastOk = Date.now();
    return d;
  }

  _wire() {
    if (this._wired || typeof document === 'undefined') return;
    this._wired = true;
    const wake = () => {
      if (!this.active || document.visibilityState !== 'visible') return;
      this._wsTries = 0;
      this._connectWS();
      this._schedulePoll(0);
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
  }

  _announce() {
    this.dispatchEvent(new CustomEvent('status', { detail: { connected: this.connected, mode: this.mode, peers: this.peerCount, code: this.roomCode } }));
  }
}

export const room = new RoomClient();
export default room;
