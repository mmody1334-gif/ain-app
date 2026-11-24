// طابور النطق: لا نقطع جملة جارية إلا لخطر (urgent) أو لضغطة المستخدم (cancel).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// محرك نطق وهمي: يسجّل ما بدأ وما انقطع، ونُنهي الجملة يدوياً عبر finish()
const log = [];
let current = null;
globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
globalThis.speechSynthesis = {
  speaking: false, pending: false,
  getVoices: () => [], addEventListener() {},
  speak(u) { if (current) throw new Error('native queue used: ' + u.text); current = u; this.speaking = true; log.push('start:' + u.text); },
  cancel() { if (current) { log.push('cut:' + current.text); const u = current; current = null; this.speaking = false; u.onend?.(); } },
};
const finish = () => { const u = current; current = null; globalThis.speechSynthesis.speaking = false; u?.onend?.(); };
const { tts } = await import(pathToFileURL(path.resolve('js/speech.js')).href);
const reset = () => { tts.cancel(); log.length = 0; };
const opt = (o = {}) => ({ fusha: false, ...o });

test('a new sentence waits for the current one instead of cutting it', () => {
  reset();
  tts.speak('الجملة الأولى', opt());
  tts.speak('الجملة الثانية', opt());
  assert.deepEqual(log, ['start:الجملة الأولى']);
  finish();
  assert.deepEqual(log, ['start:الجملة الأولى', 'start:الجملة الثانية']);
  finish();
});

test('urgent (danger/SOS) cuts in immediately and drops the waiting queue', () => {
  reset();
  tts.speak('شرح طويل', opt());
  tts.speak('جملة منتظرة', opt());
  tts.speak('توقف، عائق أمامك', opt({ urgent: true }));
  assert.deepEqual(log, ['start:شرح طويل', 'cut:شرح طويل', 'start:توقف، عائق أمامك']);
  finish();
  assert.equal(log.length, 3, 'the waiting sentence must not play after an emergency');
});

test('user-pressed «speak» (cancel:true) interrupts, as the user expects', () => {
  reset();
  tts.speak('أ', opt());
  tts.speak('ب', opt({ cancel: true }));
  assert.deepEqual(log, ['start:أ', 'cut:أ', 'start:ب']);
  finish();
});

test('stale queued items (maxAgeMs) are skipped; queue is bounded', async () => {
  reset();
  tts.speak('جملة', opt());
  tts.speak('تحذير رادار قديم', opt({ maxAgeMs: 10 }));
  for (let i = 0; i < 10; i++) tts.speak('كلمة' + i, opt());
  await new Promise((r) => setTimeout(r, 30));
  finish();
  assert.ok(!log.includes('start:تحذير رادار قديم'), 'stale radar warning must be dropped');
  let n = 0; while (current && n++ < 20) finish();
  const started = log.filter((x) => x.startsWith('start:كلمة'));
  assert.ok(started.length <= 3, `queue must stay short, played ${started.length}`);
  assert.equal(started.at(-1), 'start:كلمة9', 'the newest item is kept');
});

test('a lost "onend" (Chrome Android bug) does not freeze the queue forever', async () => {
  reset();
  tts.speak('جملة لن ينتهي حدثها', opt({ watchdogMs: 20 }));
  tts.speak('التالية', opt());
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(log.includes('start:التالية'), JSON.stringify(log));
  finish();
});
