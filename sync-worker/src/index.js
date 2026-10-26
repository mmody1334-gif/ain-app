// ain-chat: خادم غرف «عين» — كل غرفة كائن Durable Object مستقل.
// v3: WebSocket فوري (مع الإسبات: لا تكلفة أثناء السكون) + HTTP احتياطي متوافق مع النسخ القديمة.
// كل رسالة لها رقم تسلسلي seq لا يتكرر، فلا تضيع رسالتان في نفس الملّي ثانية،
// ومعرّف من العميل cid يمنع تكرارها عند إعادة الإرسال.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
});

const MAX_MSGS = 300;                 // سجل الغرفة
const KEEP_MS = 30 * 86400000;        // الرسائل تبقى 30 يوماً
const ROOM_TTL = 90 * 86400000;       // الغرفة تُمحى بعد 90 يوماً بلا نشاط
const ONLINE_HTTP_MS = 20000;         // جهاز يستقصي عبر HTTP يُعدّ متصلاً 20 ثانية بعد آخر طلب
const TYPES = new Set(['sign', 'sentence', 'msg', 'sos']);

const str = (v, n) => (v === undefined || v === null ? undefined : String(v).slice(0, n));

/** يبني رسالة نظيفة من مدخلات العميل (لا نخزّن أي حقل غير معروف) */
function cleanMsg(body) {
  const type = String(body.type || '');
  if (!TYPES.has(type)) return null;
  const m = { type };
  const add = (k, n) => { const v = str(body[k], n); if (v !== undefined && v !== '') m[k] = v; };
  add('cid', 40); add('name', 40);
  add('text', 600); add('word', 80); add('id', 80); add('message', 300);
  if (Array.isArray(body.words)) m.words = body.words.slice(0, 30).map((w) => String(w).slice(0, 80));
  if (type === 'msg' && !m.text) return null;
  if (type === 'sign' && !m.word) return null;
  if (type === 'sentence' && !m.text) return null;
  return m;
}

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.log = [];
    this.members = [];    // [{id, name, at}] — آخر ظهور عبر HTTP
    this.seq = 0;
    ctx.blockConcurrencyWhile(async () => {
      this.log = (await ctx.storage.get('log')) || [];
      this.members = (await ctx.storage.get('members')) || [];
      this.seq = (await ctx.storage.get('seq')) || 0;
      // رسائل النسخة القديمة بلا seq: نرقّمها مرة واحدة
      let fixed = false;
      for (const m of this.log) if (!m.seq) { m.seq = ++this.seq; fixed = true; }
      if (fixed) await this._persist();
    });
    // ردّ ping تلقائي دون إيقاظ الكائن من الإسبات
    try { ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}')); } catch (_) {}
  }

  // ---------- التخزين ----------
  async _persist() {
    await this.ctx.storage.put({ log: this.log, members: this.members, seq: this.seq });
    try { await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL); } catch (_) {}
  }

  async alarm() {
    const last = this.log.length ? this.log[this.log.length - 1].at : 0;
    const lastMember = this.members.reduce((a, m) => Math.max(a, m.at || 0), 0);
    if (Date.now() - Math.max(last, lastMember) >= ROOM_TTL - 60000 && !this.ctx.getWebSockets().length) {
      await this.ctx.storage.deleteAll();
      this.log = []; this.members = []; this.seq = 0;
    } else {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL);
    }
  }

  _trim() {
    const now = Date.now();
    this.log = this.log.filter((m) => now - m.at < KEEP_MS);
    if (this.log.length > MAX_MSGS) this.log = this.log.slice(-MAX_MSGS);
    this.members = this.members.filter((m) => now - (m.at || 0) < ROOM_TTL).slice(-20);
  }

  _touch(device, name) {
    if (!device) return;
    const now = Date.now();
    const i = this.members.findIndex((m) => m.id === device);
    if (i >= 0) { this.members[i].at = now; if (name) this.members[i].name = name; }
    else this.members.push({ id: device, name: name || '', at: now });
  }

  // ---------- الحضور ----------
  _sockets() {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === undefined || ws.readyState === 1).map((ws) => {
      let a = null;
      try { a = ws.deserializeAttachment(); } catch (_) {}
      return { ws, a: a || {} };
    });
  }

  /** الأجهزة المتصلة الآن: مقابس مفتوحة + من استقصى عبر HTTP مؤخراً */
  _online() {
    const map = new Map();
    for (const { a } of this._sockets()) if (a.device) map.set(a.device, { device: a.device, name: a.name || '', live: true });
    const now = Date.now();
    for (const m of this.members) {
      if (!map.has(m.id) && now - (m.at || 0) < ONLINE_HTTP_MS) map.set(m.id, { device: m.id, name: m.name || '', live: false });
    }
    return [...map.values()];
  }

  _broadcast(obj, except = null) {
    const s = JSON.stringify(obj);
    for (const { ws } of this._sockets()) {
      if (ws === except) continue;
      try { ws.send(s); } catch (_) {}
    }
  }

  _presence() { this._broadcast({ t: 'presence', online: this._online() }); }

  // ---------- الرسائل ----------
  async _add(device, body) {
    const m = cleanMsg(body);
    if (!m) return { error: 'رسالة غير صالحة' };
    if (m.cid) {
      const dup = this.log.find((x) => x.cid === m.cid && x.device === device);
      if (dup) return { msg: dup, dup: true };
    }
    m.device = String(device).slice(0, 40);
    m.at = Date.now();
    m.seq = ++this.seq;
    this.log.push(m);
    this._touch(device, m.name);
    this._trim();
    await this._persist();
    this._broadcast({ t: 'msg', m });
    return { msg: m };
  }

  _after(seq, since) {
    if (seq > 0) return this.log.filter((m) => m.seq > seq);
    return this.log.filter((m) => m.at > since);
  }

  // ---------- HTTP + ترقية WebSocket ----------
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*\/api/, '/api');

    if (path === '/api/ws') {
      if ((req.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return json({ ok: false, error: 'websocket مطلوب' }, 426);
      const device = str(url.searchParams.get('device'), 40);
      if (!device) return json({ ok: false, error: 'device مطلوب' }, 400);
      const name = str(url.searchParams.get('name'), 40) || '';
      // جهاز واحد = مقبس واحد: نغلق القديم (تبويب أُعيد فتحه)
      for (const { ws, a } of this._sockets()) if (a.device === device) { try { ws.close(4000, 'replaced'); } catch (_) {} }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [device]);
      server.serializeAttachment({ device, name });
      this._touch(device, name);
      await this._persist();
      const after = Number(url.searchParams.get('after') || 0);
      server.send(JSON.stringify({ t: 'hello', seq: this.seq, online: this._online(), msgs: after > 0 ? this._after(after, 0).slice(-MAX_MSGS) : [] }));
      this._broadcast({ t: 'presence', online: this._online() }, server);
      return new Response(null, { status: 101, webSocket: client });
    }

    let body = {};
    if (req.method === 'POST') { try { body = await req.json(); } catch (_) {} }
    const device = str(body.device, 40);

    if (path === '/api/ping') return json({ ok: true, v: 'do3' });

    if (path === '/api/room') {
      if (!device) return json({ ok: false, error: 'device مطلوب' }, 400);
      this._touch(device, str(body.name, 40));
      this._trim();
      await this._persist();
      this._presence();
      return json({ ok: true, members: this.members.map((m) => m.id), online: this._online(), count: this.members.length, seq: this.seq, lastAt: this.log.length ? this.log[this.log.length - 1].at : 0 });
    }

    if (path === '/api/leave') {
      if (!device) return json({ ok: false, error: 'device مطلوب' }, 400);
      this.members = this.members.filter((m) => m.id !== device);
      for (const { ws, a } of this._sockets()) if (a.device === device) { try { ws.close(1000, 'left'); } catch (_) {} }
      await this._persist();
      this._presence();
      return json({ ok: true, members: this.members.map((m) => m.id) });
    }

    if (path === '/api/msg') {
      if (!device) return json({ ok: false, error: 'device مطلوب' }, 400);
      const r = await this._add(device, body);
      if (r.error) return json({ ok: false, error: r.error }, 400);
      return json({ ok: true, msg: r.msg, lastAt: r.msg.at, seq: r.msg.seq });
    }

    if (path === '/api/messages') {
      const after = Number(url.searchParams.get('after') || 0);
      const since = Number(url.searchParams.get('since') || 0);
      const dev = str(url.searchParams.get('device'), 40);
      if (dev) { this._touch(dev, str(url.searchParams.get('name'), 40)); }   // الاستقصاء يُبقي الجهاز «متصلاً» بلا كتابة إضافية
      const msgs = this._after(after, since).slice(0, 200);
      return json({ ok: true, msgs, seq: this.seq, online: this._online(), lastAt: this.log.length ? this.log[this.log.length - 1].at : 0 });
    }

    return json({ ok: false, error: 'مسار غير معروف' }, 404);
  }

  // ---------- أحداث المقبس (تعمل حتى بعد الإسبات) ----------
  async webSocketMessage(ws, data) {
    let d = null;
    try { d = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)); } catch (_) { return; }
    if (!d || typeof d !== 'object') return;
    let a = {};
    try { a = ws.deserializeAttachment() || {}; } catch (_) {}
    if (d.t === 'ping') { ws.send('{"t":"pong"}'); return; }
    if (d.t === 'msg') {
      const r = await this._add(a.device, { ...d, name: d.name || a.name });
      if (r.error) ws.send(JSON.stringify({ t: 'err', cid: d.cid || null, error: r.error }));
      else if (r.dup) ws.send(JSON.stringify({ t: 'msg', m: r.msg }));   // تأكيد لرسالة وصلت سابقاً
      return;
    }
    if (d.t === 'sync') {
      const msgs = this._after(Number(d.after || 0), Number(d.since || 0)).slice(-MAX_MSGS);
      ws.send(JSON.stringify({ t: 'sync', msgs, seq: this.seq }));
      return;
    }
    if (d.t === 'signing') {
      // مؤشر «يُشير الآن…»: لحظي، لا يُخزَّن
      this._broadcast({ t: 'signing', device: a.device, name: a.name || '', on: !!d.on }, ws);
      return;
    }
    if (d.t === 'name') {
      const name = str(d.name, 40) || '';
      ws.serializeAttachment({ ...a, name });
      this._touch(a.device, name);
      this._presence();
    }
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch (_) {}
    this._presenceSoon();
  }

  async webSocketError(ws) { this._presenceSoon(); }

  _presenceSoon() {
    // المقبس المغلق قد يبقى في القائمة لحظة: نستثنيه
    const online = this._online();
    this._broadcast({ t: 'presence', online });
  }
}

export default {
  async fetch(req, env) {
    // preflight: لا يحمل code في جسمه — يجب الردّ بـ CORS أولًا وإلا منع المتصفح كل POST
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (url.pathname === '/api/ping') return json({ ok: true, v: 'do3' });
    let body = null;
    let code = url.searchParams.get('code');
    const isWs = (req.headers.get('Upgrade') || '').toLowerCase() === 'websocket';
    if (!code && req.method === 'POST') { body = await req.json().catch(() => ({})); code = body.code; }
    code = String(code || '').trim().toUpperCase().slice(0, 12);
    if (!code) return json({ ok: false, error: 'code مطلوب' }, 400);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    if (isWs) return stub.fetch(req);
    const target = new URL(req.url);
    target.searchParams.set('code', code);
    const init = { method: req.method, headers: { 'Content-Type': 'application/json' } };
    if (req.method === 'POST') init.body = body ? JSON.stringify(body) : await req.text();
    return stub.fetch(new Request(target, init));
  },
};
