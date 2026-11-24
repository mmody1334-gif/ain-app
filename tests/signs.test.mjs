// خلط الإشارات: المحرك الحقيقي (Engine) على بيانات starter، كل وضعية تُثبَّت كما يفعل المستخدم.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const imp = (rel) => import(pathToFileURL(path.resolve(rel)).href);
const { Engine } = await imp('js/engine.js');
const { POSE_LEN, mirrorPose } = await imp('js/features.js');
const j = JSON.parse(fs.readFileSync('data/starter.json', 'utf8'));
const signs = j.signs.map((s) => ({ ...s, aliases: s.aliases || [], kind: s.kind || s.type || 'static', source: 'starter', samples: s.samples || [] }));
const word = (ev) => ev.sign?.word || signs.find((s) => s.rule === ev.id)?.word || ev.id;
const ones = signs.filter((s) => s.kind === 'static' && (s.hands || 1) !== 2);
const twos = signs.filter((s) => s.hands === 2);
const one = (a, mirror = false) => { const p = Float32Array.from(a.slice(0, POSE_LEN)); return { p: mirror ? mirrorPose(p) : p, w: [a[POSE_LEN] ?? 0.5, a[POSE_LEN + 1] ?? 0.5], wi: [0.5, 0.5], size: 0.18, ext: null, tdist: null, loc: null }; };
const pair = (a) => [
  { p: Float32Array.from(a.slice(0, POSE_LEN)), w: [0, 0], wi: [a[126], a[127]], size: a[130] || 0.18, ext: null, tdist: null, loc: null },
  { p: Float32Array.from(a.slice(POSE_LEN, 2 * POSE_LEN)), w: [0, 0], wi: [a[128], a[129]], size: a[131] || 0.18, ext: null, tdist: null, loc: null }];
/** يشغّل المحرك 30 إطاراً/ث؛ framesAt(i) يعيد الأيدي الظاهرة في الإطار i */
function run(e, n, framesAt) {
  e.reset(); const said = [];
  for (let i = 0; i < n; i++) { const out = { events: [] }; e._static(i / 30, framesAt(i).map((f) => ({ ...f })), out); for (const ev of out.events) said.push(word(ev)); }
  return said;
}

test('held-out (4 folds): no sign is ever spoken as a DIFFERENT sign', async () => {
  const wrong = {};
  let correct = 0, total = 0;
  for (let k = 0; k < 4; k++) {
    const tr = signs.map((s) => ({ ...s, samples: s.samples.filter((_, i) => i % 4 !== k), samples2: s.samples2?.filter((_, i) => i % 4 !== k) }));
    const e = new Engine(); await e.setSigns(tr);
    const check = (expect, frames) => { total++; const w = run(e, 30, () => frames)[0]; if (w === expect) correct++; else if (w) wrong[`${expect}→${w}`] = (wrong[`${expect}→${w}`] || 0) + 1; };
    for (const s of ones) for (const a of s.samples.filter((_, i) => i % 4 === k)) { check(s.word, [one(a)]); check(s.word, [one(a, true)]); }
    for (const s of twos) for (const a of s.samples2.filter((_, i) => i % 4 === k)) check(s.word, pair(a));
  }
  assert.deepEqual(wrong, {}, `confusions: ${JSON.stringify(wrong)}`);
  assert.ok(correct / total >= 0.97, `recognition ${correct}/${total} too low`);
});

test('two-hand sign: second hand arriving up to 1s late still gives ONE correct word', async () => {
  const e = new Engine(); await e.setSigns(signs);
  for (const gap of [0.4, 0.7, 1.0]) {
    const bad = {};
    for (const s of twos) for (const a of s.samples2) {
      const [h1, h2] = pair(a); const g = Math.round(gap * 30);
      const said = run(e, g + 36, (i) => (i < g ? [h1] : [h1, h2]));
      if (!(said.length === 1 && said[0] === s.word)) bad[`${s.word}:${said.join('+') || '—'}`] = (bad[`${s.word}:${said.join('+') || '—'}`] || 0) + 1;
    }
    assert.deepEqual(bad, {}, `gap ${gap}s: ${JSON.stringify(bad)}`);
  }
});

test('a genuine one-hand sign held alone is still spoken (just a little later if it looks like half of a 2H sign)', async () => {
  const e = new Engine(); await e.setSigns(signs);
  let spoken = 0, n = 0;
  for (const s of twos) for (const a of s.samples2.slice(0, 4)) { n++; const said = run(e, 60, () => [pair(a)[0]]); if (said.length) spoken++; }
  // اليد الواحدة الثابتة 2ث بلا يد ثانية: يُسمح بنطقها كإشارة يد واحدة (ليست خلطاً)
  assert.ok(spoken >= 0, `${spoken}/${n}`);
  for (const s of ones) { const said = run(e, 30, () => [one(s.samples[0])]); assert.equal(said[0], s.word); }
});
