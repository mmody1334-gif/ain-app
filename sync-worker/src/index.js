// ain-chat: غرف المخزن-والإرسال على KV
// مفاتيح KV:
//   room:{code}:alive   — بصمة الغرفة (TLS 90 يوم، تُجدد مع كل نشاط)
//   room:{code}:members — مصفوفة [{id, at}] حتى 12 جهاز (TLS 90 يوم)
//   room:{code}:log     — سجل الرسائل [{at, device, type, ...}] آخر 120 (TLS 30 يوم)

const TTL_ROOM = 90 * 24 * 60 * 60;   // ثوانٍ
const TTL_LOG = 30 * 24 * 60 * 60;
const MAX_LOG = 120;
const MAX_MEMBERS = 12;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8', ...CORS },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (path === '/api/ping' && request.method === 'GET') return json({ ok: true });

    let body = {};
    if (request.method === 'POST') {
      try {
        body = await request.json();
        if (typeof body !== 'object' || body === null) body = {};
      } catch (_) {
        return json({ ok: false, error: 'json غير صالح' }, 400);
      }
    }

    const code = String(body.code || url.searchParams.get('code') || '').trim().toUpperCase().slice(0, 6);
    const device = String(body.device || url.searchParams.get('device') || '').trim().slice(0, 40);
    // GET /api/messages يحتاج الكود فقط — الباقي يحتاج جهازًا
    const needDevice = !(path === '/api/messages' && request.method === 'GET');
    if (!code || (needDevice && !device)) return json({ ok: false, error: 'code/device مفقود' }, 400);

    const kAlive = `room:${code}:alive`;
    const kMembers = `room:${code}:members`;
    const kLog = `room:${code}:log`;

    try {
      if (path === '/api/room' && request.method === 'POST') {
        // انضمام/إعادة تنشيط الغرفة
        const now = Date.now();
        let members = [];
        try { members = JSON.parse(await env.ROOMS.get(kMembers) || '[]'); } catch (_) { members = []; }
        const hit = members.find((m) => m && m.id === device);
        if (hit) hit.at = now;
        else {
          // تجاهل الأجهزة المنقضية (بدون نشاط >7 أيام) ثم أضف
          members = members.filter((m) => m && m.id && now - (m.at || 0) < 7 * 24 * 60 * 60 * 1000);
          if (members.length >= MAX_MEMBERS) members.shift();
          members.push({ id: device, at: now });
        }
        const lastLog = await env.ROOMS.get(kLog);
        let lastAt = 0;
        if (lastLog) { try { const arr = JSON.parse(lastLog); lastAt = arr.length ? arr[arr.length - 1].at : 0; } catch (_) {} }
        await env.ROOMS.put(kMembers, JSON.stringify(members), { expirationTtl: TTL_ROOM });
        await env.ROOMS.put(kAlive, JSON.stringify({ at: now }), { expirationTtl: TTL_ROOM });
        return json({ ok: true, members, lastAt, now });
      }

      if (path === '/api/messages' && request.method === 'GET') {
        const since = Number(url.searchParams.get('since') || 0) || 0;
        const raw = await env.ROOMS.get(kLog);
        let log = [];
        if (raw) { try { log = JSON.parse(raw); } catch (_) { log = []; } }
        const msgs = log.filter((m) => m && m.at > since).slice(-60);
        const lastAt = log.length ? log[log.length - 1].at : 0;
        return json({ ok: true, msgs, lastAt });
      }

      if (path === '/api/msg' && request.method === 'POST') {
        const { type } = body;
        if (!type || typeof type !== 'string') return json({ ok: false, error: 'type مفقود' }, 400);
        const at = Date.now();
        const rec = { at, device, type: String(type).slice(0, 24) };
        // نسخ باقي الحقول كحمولة (text/word/id/message/data…)
        for (const key of Object.keys(body || {})) {
          if (!(key in rec) && key !== 'code') rec[key] = body[key];
        }
        let log = [];
        try { log = JSON.parse(await env.ROOMS.get(kLog) || '[]'); } catch (_) { log = []; }
        log.push(rec);
        if (log.length > MAX_LOG) log = log.slice(-MAX_LOG);
        await env.ROOMS.put(kLog, JSON.stringify(log), { expirationTtl: TTL_LOG });
        // تجديد حياة الغرفة والعضوية
        await env.ROOMS.put(kAlive, JSON.stringify({ at }), { expirationTtl: TTL_ROOM });
        let members = [];
        try { members = JSON.parse(await env.ROOMS.get(kMembers) || '[]'); } catch (_) { members = []; }
        const hit = members.find((m) => m && m.id === device);
        if (hit) { hit.at = at; await env.ROOMS.put(kMembers, JSON.stringify(members), { expirationTtl: TTL_ROOM }); }
        return json({ ok: true, lastAt: at });
      }

      if (path === '/api/leave' && request.method === 'POST') {
        let members = [];
        try { members = JSON.parse(await env.ROOMS.get(kMembers) || '[]'); } catch (_) { members = []; }
        members = members.filter((m) => m && m.id !== device);
        await env.ROOMS.put(kMembers, JSON.stringify(members), { expirationTtl: TTL_ROOM });
        return json({ ok: true, members });
      }
    } catch (e) {
      return json({ ok: false, error: String(e && e.message || e) }, 500);
    }

    return json({ ok: false, error: 'مسار غير معروف' }, 404);
  },
};
