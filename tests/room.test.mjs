// خادم الغرف: الموقع لا يبقى أكثر من 24 ساعة، والرسائل العادية تبقى.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

globalThis.WebSocketRequestResponsePair = class {};
const { Room } = await import(pathToFileURL(path.resolve('sync-worker/src/index.js')).href);

function makeRoom() {
  const store = new Map();
  const ctx = {
    blockConcurrencyWhile: (fn) => fn(),
    storage: { get: async (k) => store.get(k), put: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, v); }, setAlarm: async () => {}, deleteAll: async () => store.clear() },
    getWebSockets: () => [],
    setWebSocketAutoResponse() {},
  };
  return new Room(ctx, {});
}
const post = (room, body) => room.fetch(new Request('https://x/api/msg', { method: 'POST', body: JSON.stringify(body) }));
const read = async (room) => (await (await room.fetch(new Request('https://x/api/messages?after=0&since=0'))).json()).msgs;

test('room server: SOS location is served while fresh and stripped after 24h, text stays', async () => {
  const room = makeRoom();
  await new Promise((r) => setTimeout(r, 0));
  await post(room, { device: 'd1', type: 'sos', message: 'ساعدني', lat: 24.25, lng: 55.79, acc: 10 });
  await post(room, { device: 'd1', type: 'msg', text: 'مرحبا' });
  let msgs = await read(room);
  assert.equal(msgs[0].lat, 24.25);

  const realNow = Date.now;
  Date.now = () => realNow() + 25 * 3600 * 1000;
  try {
    msgs = await read(room);
    assert.equal(msgs[0].lat, undefined, 'location must be gone after 24h');
    assert.equal(msgs[0].lng, undefined);
    assert.equal(msgs[0].message, 'ساعدني');
    assert.equal(msgs[1].text, 'مرحبا');
  } finally { Date.now = realNow; }
});
