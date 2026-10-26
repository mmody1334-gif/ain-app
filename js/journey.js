// رحلة الثلاثين يوماً: منهج يومي يزداد صعوبة، هدفه إتقان 50% من إشارات القاموس في اليوم 30.
// كل مهمة تُتحقق تلقائياً من نشاطك الحقيقي (دروس «تعلّم» وترجمات الكاميرا)، لا بضغطة زر.
export const DAYS = 30;
export const GOAL = 0.5;          // نسبة الإشارات المطلوب إتقانها في نهاية الشهر
export const MASTER_SCORE = 78;   // «أتقنتها» = نجمتان فأكثر في «تعلّم»

export const todayStr = (d = new Date()) => {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;   // بالتوقيت المحلي
};

/** الإشارات القابلة للتعلّم بنفس ترتيب «تعلّم»: الوضعيات الثابتة أولاً (أسهل)، ثم الحركات */
export function learnable(signs) {
  const pose = [], motion = [];
  for (const s of signs || []) {
    if (s.kind === 'static' && s.ref) pose.push(s);
    else if (s.kind === 'builtin' && s.rule && s.rule.startsWith('shape_')) pose.push(s);
    else if (s.kind === 'motion' || s.kind === 'builtin') motion.push(s);
  }
  return [...pose, ...motion];
}

const lid = (s) => 'sign:' + s.id;
export const isMastered = (progress, s) => ((progress[lid(s)] || {}).best || 0) >= MASTER_SCORE;

/** عدد الإشارات المتقنة المستهدف عند نهاية يوم d */
export const targetAt = (d, n) => Math.ceil(n * GOAL * Math.min(1, d / DAYS));

/** صعوبة اليوم d: الدقة المطلوبة، عدد المراجعات، عدد الترجمات */
export function difficulty(d) {
  const k = (d - 1) / (DAYS - 1);
  return {
    score: Math.round(60 + 30 * k),            // 60% في اليوم 1 ← 90% في اليوم 30
    review: Math.min(8, 1 + Math.floor(d / 4)),  // مراجعات إشارات سابقة
    translate: 3 + Math.round(d * 0.6),          // ترجمات حقيقية بالكاميرا
    level: k < 0.25 ? 1 : k < 0.5 ? 2 : k < 0.75 ? 3 : 4,
  };
}

/** خطة اليوم d: الإشارات الجديدة ومهام المراجعة والترجمة (حتمية: نفس الخطة كل مرة) */
export function planDay(d, signs) {
  const L = learnable(signs), n = L.length;
  const diff = difficulty(d);
  const from = targetAt(d - 1, n), to = Math.max(targetAt(d, n), d === 1 ? Math.min(1, n) : 0);
  const fresh = L.slice(from, to);
  const prev = L.slice(0, from);
  // المراجعة تدور على ما سبق تعلّمه، الأقدم أولاً، وتختلف كل يوم
  const review = [];
  if (prev.length) {
    const cnt = Math.min(diff.review, prev.length);
    for (let i = 0; i < cnt; i++) review.push(prev[(d * 3 + i * 5) % prev.length]);
  }
  const uniq = [...new Map(review.map((s) => [s.id, s])).values()].filter((s) => !fresh.includes(s));
  const tasks = [];
  for (const s of fresh) tasks.push({ key: `d${d}:new:${s.id}`, kind: 'new', sign: s, emoji: '🆕', title: `تعلّم إشارة «${s.word}»`, desc: `في «تعلّم» بدقة ${diff.score}٪ أو أكثر`, xp: 20 });
  for (const s of uniq) tasks.push({ key: `d${d}:rev:${s.id}`, kind: 'review', sign: s, emoji: '🔁', title: `راجع «${s.word}»`, desc: `تمرين اليوم بدقة ${Math.max(55, diff.score - 5)}٪ أو أكثر`, xp: 10 });
  tasks.push({ key: `d${d}:tr`, kind: 'translate', count: diff.translate, emoji: '📷', title: `ترجم ${diff.translate} إشارات`, desc: 'إشارات حقيقية تتعرّف عليها الكاميرا في «ترجمة» اليوم', xp: 15 + d });
  if (d === DAYS) tasks.push({ key: `d${d}:goal`, kind: 'goal', emoji: '🏁', title: `الاختبار النهائي: أتقن ${Math.round(GOAL * 100)}٪ من الإشارات`, desc: `${Math.ceil(n * GOAL)} إشارة من ${n} بنجمتين فأكثر`, xp: 100 });
  const title = d === DAYS ? 'اليوم الأخير — الاختبار النهائي'
    : fresh.length ? `${fresh.length === 1 ? 'إشارة جديدة' : fresh.length + ' إشارات جديدة'}${uniq.length ? ' + مراجعة' : ''}`
    : 'يوم مراجعة وتثبيت';
  return { d, title, tasks, diff, fresh, target: targetAt(d, n), total: n };
}

/** حالة مهمة: { done, cur, need } */
export function taskState(t, ctx) {
  const { progress, today, recognized, signs } = ctx;
  if (t.kind === 'new') {
    const p = progress[lid(t.sign)] || {};
    const need = ctx.diff.score;
    return { done: (p.best || 0) >= need, cur: p.best || 0, need, unit: '٪' };
  }
  if (t.kind === 'review') {
    const p = progress[lid(t.sign)] || {};
    const need = Math.max(55, ctx.diff.score - 5);
    const todayBest = p.day === today ? (p.dayBest || 0) : 0;
    return { done: todayBest >= need, cur: todayBest, need, unit: '٪' };
  }
  if (t.kind === 'translate') {
    const c = recognized[today] || 0;
    return { done: c >= t.count, cur: Math.min(c, t.count), need: t.count, unit: '' };
  }
  if (t.kind === 'goal') {
    const L = learnable(signs), need = Math.ceil(L.length * GOAL);
    const c = L.filter((s) => isMastered(progress, s)).length;
    return { done: c >= need, cur: c, need, unit: '' };
  }
  return { done: false, cur: 0, need: 1, unit: '' };
}
