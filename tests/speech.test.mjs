import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { toFusha } = await import(pathToFileURL(path.resolve('js/speech.js')).href);

test('toFusha: words written with tanween get vocalized (جداً، يميناً، عذرًا) and keep their tanween', () => {
  assert.match(toFusha('قريب جداً'), /جِدًّا/);
  assert.match(toFusha('قريب جدًا'), /جِدًّا/);
  assert.equal(toFusha('اتجه يميناً'), 'اِتَّجِه يَمِينًا');
  assert.equal(toFusha('عذرًا'), 'عُذْرًا');
  assert.equal(toFusha('أريد ماءً'), 'أُرِيدُ مَاءً');
});

test('toFusha: radar sentences use correct case endings', () => {
  assert.match(toFusha('كرسي على يسارك'), /عَلَى يَسَارِكَ/);
  assert.match(toFusha('شخص على يمينك'), /عَلَى يَمِينِكَ/);
  assert.match(toFusha('أكثر من ثلاثة أمتار'), /أَكْثَرَ مِنْ ثَلَاثَةِ أَمْتَار/);
});

test('toFusha: ambiguous «من» (مَن/مِن) is left to the voice engine, user diacritics are kept', () => {
  assert.equal(toFusha('من أنت؟'), 'من أَنْتَ؟');
  assert.equal(toFusha('مَنْ هنا'), 'مَنْ هنا');
});
