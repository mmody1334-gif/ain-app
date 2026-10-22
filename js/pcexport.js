// يبني ملف الإعداد الذي يقرأه برنامج الحاسوب (ain_pc_controller.py): النموذج + الأوامر.
const r = (a, k = 4) => Array.from(a, (v) => +v.toFixed(k));

export function buildPcConfig({ engine, pc, holdSec }) {
  const clf = engine.clf;
  let classifier = null;
  if (clf && clf.ref) {
    classifier = { ...clf.toJSON(), ref: clf.ref.map((x) => r(x, 3)), refLabel: Array.from(clf.refLabel) };
  }
  return {
    format: 'ain-pc', version: 1, holdSec,
    arm: { key: pc.armKey, seconds: pc.armSeconds }, cooldown: pc.cooldown, bindings: pc.bindings,
    signs: engine.signs.map((s) => ({ id: s.id, word: s.word, kind: s.kind, rule: s.rule || null })),
    classifier,
    sig: Object.fromEntries(engine.sig || []),
    motion: engine.bank.toJSON(),
  };
}
