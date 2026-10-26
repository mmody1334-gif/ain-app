// ain-chat: جسر غرف حذيفة — توجيه الطلبات إلى كائن Room لكل غرفة
// توجيه لكل غرفة عبر Durable Object → اتساق قوي وتسليم فوري وبترتيب صحيح

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
});

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*\/api/, '/api');
    let body = {};
    try { body = await req.json(); } catch (_) {}
    console.log('DO-was-here:', path, JSON.stringify(body).slice(0, 120));

    // سجل الرسائل و الأعضاء — وصول الذاكرة كسرعة، والحفظ الخلفي ضمان دوام
    const MAX_MSGS = 120, MAX_MEMBERS = 12;
    let log = (await this.ctx.storage.get('log')) || [];
    let members = (await this.ctx.storage.get('members')) || [];

    const lastAt = () => (log.length ? log[log.length - 1].at : 0);
    const now = Date.now();

    if (req.method === 'OPTIONS') { this._save(log, members); return new Response(null, { status: 204, headers: CORS }); }

    if (path === '/api/ping') { await this._save(log, members); return json({ ok: true, v: 'do2' }); }

    const device = body && body.device;
    if (!device || !String(device).trim()) {
      for (const p of ['/api/room', '/api/msg', '/api/leave']) { if (path === p) { await this._save(log, members); return json({ ok: false, error: 'device مطلوب' }, 400); } }
    }

    if (path === '/api/room') {
      const code = String(body.code || '').trim();
      if (!code) { await this._save(log, members); return json({ ok: false, error: 'code مطلوب' }, 400); }
      const stamp = now;
      members = members.filter((m) => stamp - (m.at || 0) < 90 * 86400000);
      members = members.filter((m) => m.id !== device);
      members.push({ id: device, at: stamp });
      if (members.length > MAX_MEMBERS) members = members.slice(-MAX_MEMBERS);
      log = log.filter((m) => stamp - (m.at || 0) < 30 * 86400000);
      if (log.length > MAX_MSGS) log = log.slice(-MAX_MSGS);
      await this._save(log, members);
      return json({ ok: true, members: members.map((m) => m.id), count: members.length, lastAt: lastAt() });
    }

    if (path === '/api/leave') {
      members = members.filter((m) => m.id !== device);
      await this._save(log, members);
      return json({ ok: true, members: members.map((m) => m.id) });
    }

    if (path === '/api/msg') {
      const code = String(body.code || '').trim();
      if (!code) { await this._save(log, members); return json({ ok: false, error: 'code مطلوب' }, 400); }
      const { type } = body;
      if (!type) { await this._save(log, members); return json({ ok: false, error: 'type مطلوب' }, 400); }
      const at = Date.now();
      const msg = { at, device, type };
      if (body.text !== undefined) msg.text = String(body.text).slice(0, 400);
      if (body.word !== undefined) msg.word = String(body.word).slice(0, 80);
      if (body.id !== undefined) msg.id = String(body.id).slice(0, 80);
      if (body.message !== undefined) msg.message = String(body.message).slice(0, 300);
      log.push(msg);
      if (log.length > MAX_MSGS) log = log.slice(-MAX_MSGS);
      // تحديث «آخر رؤية» للمُرسل ضمن الأعضاء (أعمّق من رسالة بسيطة بلا قيود هنا)
      const mi = members.findIndex((m) => m.id === device);
      if (mi >= 0) members[mi].at = at;
      await this._save(log, members);
      return json({ ok: true, lastAt: at });
    }

    if (path === '/api/messages') {
      const since = Number(url.searchParams.get('since') || 0);
      let gap = 30 * 86400000; // إبقاء 30 يومًا فقط
      log = log.filter((m) => now - m.at < gap);
      const msgs = log.filter((m) => m.at > since).slice(0, 60);
      await this._save(log, members);
      return json({ ok: true, msgs, lastAt: lastAt() });
    }

    await this._save(log, members);
    return json({ ok: false, error: 'مسار غير معروف' }, 404);
  }

  async _save(log, members) {
    try {
      await this.ctx.storage.setAlarm(Date.now() + 90 * 86400000); // بقاء الغرفة 90 يومًا من آخر نشاط
    } catch (_) {}
    try {
      const st = this.ctx.storage;
      if (!this._s) this._s = { log: null, members: null };
      this._s.log = log; this._s.members = members;
      const compares = [];
      compares.push(st.put('log', log));
      compares.push(st.put('members', members));
      await Promise.all(compares);
    } catch (_) {}
  }
}

const CORS_ALL = CORS;

export default {
  async fetch(req, env, ctx) {
    // preflight: لا يحمل code في جسمه — يجب الردّ بـ CORS أولًا وإلا منع المتصفح كل POST
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (url.pathname === '/api/ping') return json({ ok: true });
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const code = url.searchParams.get('code') || body.code;
    if (!code) return json({ ok: false, error: 'code مطلوب' }, 400);
    const id = env.ROOMS.idFromName(String(code).slice(0, 12));
    const stub = env.ROOMS.get(id);
    const target = new URL(req.url);
    target.searchParams.set('code', String(code).slice(0, 12));
    const init = { method: req.method, headers: { 'Content-Type': 'application/json' } };
    if (req.method === 'POST') init.body = JSON.stringify(body);
    return stub.fetch(new Request(target, init));
  },
};
