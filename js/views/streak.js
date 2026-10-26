// التحديات: رحلة 30 يوماً تزداد صعوبة كل يوم، هدفها إتقان 50% من إشارات القاموس في اليوم الأخير.
// الأيام القادمة ظاهرة لكنها مقفولة، ويُفتح يوم واحد فقط في كل يوم تقويمي بعد إكمال سابقه.
// كل مهمة تُحسب تلقائياً من نشاطك الحقيقي (دروس «تعلّم» وترجمات الكاميرا)، ومعها مؤثرات صوتية.
import { h, btn, toast } from '../ui.js';
import { DAYS, GOAL, todayStr, learnable, isMastered, planDay, taskState, difficulty, targetAt } from '../journey.js';
import { sfx } from '../sfx.js';

const BADGE_LIST = [
  { id: 'first_day', emoji: '🌱', name: 'أول يوم' },
  { id: 'days3', emoji: '✨', name: '3 أيام' },
  { id: 'week', emoji: '🔥', name: 'أسبوع' },
  { id: 'days14', emoji: '💪', name: '14 يوم' },
  { id: 'month', emoji: '💎', name: 'شهر كامل' },
  { id: 'xp50', emoji: '⭐', name: '50 نقطة' },
  { id: 'xp100', emoji: '🌟', name: '100 نقطة' },
  { id: 'xp500', emoji: '🏆', name: '500 نقطة' },
  { id: 'half', emoji: '🎓', name: 'أتقنت نصف الإشارات' },
];

const LEVELS = { 1: ['مبتدئ', 'ok'], 2: ['متوسط', 'warn'], 3: ['متقدم', 'warn'], 4: ['خبير', 'bad'] };

export function createStreakView(app) {
  let root, busy = false, visible = false;

  // ---------- التخزين ----------
  async function loadAll() {
    const today = todayStr();
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yesterday = todayStr(y);
    const streak = await app.store.getMeta('streak', { days: 0, lastDate: null, totalXP: 0, badges: [], todayXP: 0, todayDate: null });
    if (streak.todayDate !== today) { streak.todayXP = 0; streak.todayDate = today; }
    if (streak.lastDate && streak.lastDate !== today && streak.lastDate !== yesterday) streak.days = 0;   // انكسرت السلسلة
    const j = await app.store.getMeta('journey', { done: {}, awarded: {}, recognized: {} });
    j.done ||= {}; j.awarded ||= {}; j.recognized ||= {};
    return { streak, j, today, yesterday };
  }
  const saveAll = async (streak, j) => { await app.store.setMeta('streak', streak); await app.store.setMeta('journey', j); };

  /** اليوم الحالي في الرحلة، وهل يومه التالي ما زال مقفولاً حتى الغد */
  function position(j, today) {
    const doneDays = Object.keys(j.done).map(Number).filter((d) => d >= 1 && d <= DAYS);
    const last = doneDays.length ? Math.max(...doneDays) : 0;
    if (last >= DAYS) return { day: DAYS, finished: true, waiting: false, last };
    const doneToday = last > 0 && j.done[last] === today;
    return { day: doneToday ? last : last + 1, finished: false, waiting: doneToday, last };
  }

  function checkBadges(streak, mastery) {
    const have = new Set((streak.badges || []).map((b) => b.id));
    const cond = {
      first_day: streak.days >= 1, days3: streak.days >= 3, week: streak.days >= 7, days14: streak.days >= 14, month: streak.days >= 30,
      xp50: streak.totalXP >= 50, xp100: streak.totalXP >= 100, xp500: streak.totalXP >= 500, half: mastery >= GOAL,
    };
    return BADGE_LIST.filter((b) => !have.has(b.id) && cond[b.id]);
  }

  function masteryOf() {
    const L = learnable(app.signs);
    const m = L.filter((s) => isMastered(app.progress, s)).length;
    return { m, n: L.length, frac: L.length ? m / L.length : 0 };
  }

  // ---------- التحقق التلقائي ----------
  async function evaluate(loud = true) {
    if (busy) return; busy = true;
    try {
      const { streak, j, today, yesterday } = await loadAll();
      const pos = position(j, today);
      if (pos.waiting || pos.finished && j.done[DAYS]) { busy = false; return; }
      const plan = planDay(pos.day, app.signs);
      const ctx = { progress: app.progress, today, recognized: j.recognized, signs: app.signs, diff: plan.diff };
      const newly = [];
      let allDone = plan.tasks.length > 0;
      for (const t of plan.tasks) {
        const st = taskState(t, ctx);
        if (!st.done) { allDone = false; continue; }
        if (!j.awarded[t.key]) { j.awarded[t.key] = 1; newly.push(t); streak.totalXP = (streak.totalXP || 0) + t.xp; streak.todayXP = (streak.todayXP || 0) + t.xp; }
      }
      let dayDone = false;
      if (allDone && !j.done[pos.day]) {
        j.done[pos.day] = today; dayDone = true;
        if (streak.lastDate !== today) { streak.days = streak.lastDate === yesterday || !streak.lastDate ? (streak.days || 0) + 1 : 1; streak.lastDate = today; }
      }
      const mast = masteryOf();
      const badges = checkBadges(streak, mast.frac);
      streak.badges = [...(streak.badges || []), ...badges];
      if (newly.length || dayDone || badges.length) await saveAll(streak, j);
      if (loud) {
        if (dayDone) {
          pos.day === DAYS ? sfx.goal() : sfx.day();
          navigator.vibrate?.([60, 40, 60, 40, 120]);
          toast(pos.day === DAYS ? '🏁 أنهيت رحلة الشهر! مبروك' : `🎉 أنهيت اليوم ${pos.day}! اليوم ${pos.day + 1} يُفتح غداً`, 'ok');
        } else if (newly.length) {
          sfx.task();
          for (const t of newly) toast(`✅ ${t.title} (+${t.xp} XP)`, 'ok');
        }
        if (badges.length) setTimeout(() => { sfx.badge(); for (const b of badges) toast('🏆 شارة جديدة: ' + b.emoji + ' ' + b.name, 'ok'); }, dayDone ? 1400 : 500);
      }
      if (visible && (newly.length || dayDone || badges.length)) render();
    } finally { busy = false; }
  }

  // تُستدعى من أي مكان في التطبيق، حتى لو لم تكن صفحة التحديات مفتوحة
  app.on('progress', () => evaluate(true));
  app.on('recognized', async () => {
    const { j, today } = await loadAll();
    j.recognized[today] = (j.recognized[today] || 0) + 1;
    for (const k of Object.keys(j.recognized)) if (k < todayStr(new Date(Date.now() - 7 * 86400000))) delete j.recognized[k];
    await app.store.setMeta('journey', j);
    evaluate(true);
  });
  app.on('signs', () => { if (visible) render(); });

  // ---------- العرض ----------
  const bar = (frac, color = 'var(--accent)', marker = null) => h('div', { style: { position: 'relative', height: '12px', borderRadius: '99px', background: 'var(--surface2)', overflow: 'visible' } },
    h('div', { style: { width: Math.round(Math.min(1, frac) * 100) + '%', height: '100%', borderRadius: '99px', background: color, transition: 'width .4s' } }),
    marker != null ? h('div', { title: 'الهدف', style: { position: 'absolute', top: '-4px', insetInlineStart: Math.round(marker * 100) + '%', width: '3px', height: '20px', background: 'var(--amber)', borderRadius: '2px' } }) : null);

  function untilMidnight() {
    const now = new Date(), m = new Date(now); m.setHours(24, 0, 0, 0);
    const mins = Math.round((m - now) / 60000);
    return mins >= 60 ? `${Math.floor(mins / 60)} س ${mins % 60} د` : `${mins} د`;
  }

  function goTask(t) {
    sfx.tap();
    if (t.kind === 'translate') { app.go('translate'); return; }
    if (t.sign) { app.pendingLesson = 'sign:' + t.sign.id; app.go('learn'); return; }
    app.go('learn');
  }

  async function render() {
    if (!root) return;
    const { streak, j, today } = await loadAll();
    const pos = position(j, today);
    const mast = masteryOf();
    root.innerHTML = '';
    const fire = streak.days >= 7 ? '🔥' : streak.days >= 3 ? '✨' : streak.days >= 1 ? '⭐' : '💤';

    // السلسلة والنقاط
    root.append(h('div.card', { style: { textAlign: 'center', padding: '18px 14px' } },
      h('div', { style: { fontSize: '3rem', lineHeight: '1.1' } }, fire),
      h('div', { style: { fontSize: '2rem', fontWeight: '700', color: 'var(--accent)', fontFamily: 'var(--font-title)', margin: '4px 0' } }, streak.days + ' يوم متتالٍ'),
      h('div', { style: { display: 'flex', justifyContent: 'center', gap: '32px', marginTop: '10px' } },
        h('div', h('div', { style: { fontSize: '1.4rem', fontWeight: '700', color: 'var(--amber)' } }, (streak.totalXP || 0) + ' ⭐'), h('div.small.muted', 'مجموع النقاط')),
        h('div', h('div', { style: { fontSize: '1.4rem', fontWeight: '700', color: 'var(--ok)' } }, (streak.todayXP || 0) + ' XP'), h('div.small.muted', 'نقاط اليوم')))));

    // التقدّم نحو الهدف
    const expected = pos.day ? targetAt(pos.day, mast.n) / Math.max(1, mast.n) : 0;
    root.append(h('div.card',
      h('div.row', { style: { justifyContent: 'space-between', alignItems: 'baseline' } },
        h('h2', '🎓 تقدّمك في لغة الإشارة'),
        h('b', { style: { fontSize: '1.3rem', color: mast.frac >= GOAL ? 'var(--ok)' : 'var(--accent)' } }, Math.round(mast.frac * 100) + '٪')),
      bar(mast.frac, mast.frac >= GOAL ? 'var(--ok)' : 'var(--accent)', GOAL),
      h('p.small.muted', { style: { marginTop: '8px' } },
        mast.n ? `أتقنت ${mast.m} من ${mast.n} إشارة (نجمتان فأكثر في «تعلّم»). الهدف ${Math.round(GOAL * 100)}٪ في اليوم ${DAYS}` + (expected ? ` — المطلوب حتى اليوم ${pos.day}: ${Math.round(expected * 100)}٪.` : '.') : 'أضف إشارات إلى قاموسك لتبدأ الرحلة.')));

    // اليوم الحالي
    const plan = planDay(pos.day, app.signs);
    const ctx = { progress: app.progress, today, recognized: j.recognized, signs: app.signs, diff: plan.diff };
    const lv = LEVELS[plan.diff.level];
    const todayCard = h('div.card', { style: { border: '2px solid var(--accent)' } },
      h('div.row', { style: { justifyContent: 'space-between', alignItems: 'center' } },
        h('h2', `🎯 اليوم ${pos.day} من ${DAYS}`),
        h('span.chip-status.' + lv[1], 'المستوى: ' + lv[0])),
      h('p.small.muted', plan.title + ` · الدقة المطلوبة ${plan.diff.score}٪`));
    if (pos.waiting || (pos.finished && j.done[DAYS])) {
      todayCard.append(h('div', { style: { textAlign: 'center', padding: '14px 4px' } },
        h('div', { style: { fontSize: '2.6rem' } }, pos.finished ? '🏁' : '🎉'),
        h('b', pos.finished ? 'أنهيت رحلة الثلاثين يوماً!' : `أنهيت اليوم ${pos.day}`),
        h('p.small.muted', pos.finished ? 'استمر في المراجعة من «تعلّم» لتحافظ على مستواك.' : `اليوم ${pos.day + 1} يُفتح غداً — بعد ${untilMidnight()}`)));
    } else {
      const list = h('div.list');
      let doneCount = 0;
      for (const t of plan.tasks) {
        const st = taskState(t, ctx);
        if (st.done) doneCount++;
        list.append(h('div.item', { style: st.done ? { opacity: '.75' } : {} },
          h('div', { style: { fontSize: '1.5rem', flexShrink: '0' } }, st.done ? '✅' : t.emoji),
          h('div.grow',
            h('div.ttl', t.title),
            h('div.meta', t.desc),
            !st.done ? h('div', { style: { marginTop: '6px' } }, bar(st.need ? st.cur / st.need : 0, 'var(--amber)'), h('div.small.muted', `${st.cur}${st.unit} / ${st.need}${st.unit}`)) : null),
          st.done ? h('span.badge.static', '+' + t.xp + ' ✓') : btn('ابدأ', { cls: 'sm primary', onclick: () => goTask(t) })));
      }
      todayCard.append(h('div', { style: { margin: '6px 0 10px' } }, bar(plan.tasks.length ? doneCount / plan.tasks.length : 0, 'var(--ok)'), h('div.small.muted', `${doneCount} / ${plan.tasks.length} مهام`)), list);
    }
    root.append(todayCard);

    // مسار الأيام: المنجزة، والحالية، والمقفولة
    const path = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
    for (let d = 1; d <= DAYS; d++) {
      const p = planDay(d, app.signs);
      const done = !!j.done[d];
      const isCur = d === pos.day && !done;
      const locked = !done && !isCur;
      const diff = difficulty(d);
      const dots = h('span', { 'aria-label': 'الصعوبة ' + diff.level + ' من 4', style: { letterSpacing: '2px', color: 'var(--amber)' } }, '●'.repeat(diff.level) + '○'.repeat(4 - diff.level));
      const goalNote = d === DAYS ? ` · الهدف: ${Math.round(GOAL * 100)}٪` : ` · ${Math.round((targetAt(d, mast.n) / Math.max(1, mast.n)) * 100)}٪ من الإشارات`;
      const row = h('button', {
        type: 'button',
        'aria-label': `اليوم ${d}${locked ? ' مقفول' : done ? ' منجز' : ''}`,
        style: {
          display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'start', font: 'inherit', color: 'var(--ink)', cursor: 'pointer',
          padding: '10px 12px', borderRadius: '14px',
          border: isCur ? '2px solid var(--accent)' : '1px solid var(--line)',
          background: done ? 'var(--ok-soft)' : isCur ? 'var(--accent-soft)' : 'var(--surface)',
          opacity: locked ? '.6' : '1',
        },
        onclick: () => {
          if (locked) {
            sfx.locked(); navigator.vibrate?.(30);
            toast(d === pos.day + 1 && pos.waiting ? `🔒 اليوم ${d} يُفتح غداً (بعد ${untilMidnight()})` : `🔒 أكمل اليوم ${d - 1} أولاً`, '');
          } else { sfx.tap(); root.scrollTo?.({ top: 0, behavior: 'smooth' }); document.getElementById('main')?.scrollTo({ top: 0, behavior: 'smooth' }); }
        },
      },
      h('div', { style: { width: '42px', height: '42px', flexShrink: '0', borderRadius: '50%', display: 'grid', placeItems: 'center', fontWeight: '700', fontSize: '1.05rem', background: done ? 'var(--ok)' : isCur ? 'var(--accent)' : 'var(--surface2)', color: done || isCur ? '#fff' : 'var(--muted)' } }, done ? '✓' : locked ? '🔒' : String(d)),
      h('div', { style: { flex: '1', minWidth: '0' } },
        h('div', { style: { fontWeight: '700' } }, `اليوم ${d}` + (d === DAYS ? ' 🏁' : '')),
        h('div.small.muted', locked ? `${p.fresh.length ? p.fresh.length + ' جديدة · ' : ''}${p.tasks.length} مهام · دقة ${diff.score}٪${goalNote}` : done ? `أُنجز ${j.done[d]}` : p.title)),
      dots);
      path.append(row);
    }
    root.append(h('div.card', h('h2', '🗺️ رحلة 30 يوماً'), h('p.small.muted', 'كل يوم أصعب من الذي قبله. يُفتح يوم واحد في اليوم بعد إكمال سابقه.'), path));

    // الشارات + الصوت
    if (streak.badges && streak.badges.length) {
      const grid = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px' } });
      for (const b of streak.badges) grid.append(h('div', { style: { textAlign: 'center', minWidth: '64px', padding: '8px', background: 'var(--surface2)', borderRadius: '12px' } }, h('div', { style: { fontSize: '2rem' } }, b.emoji), h('div.small', b.name)));
      root.append(h('div.card', h('h2', '🏆 شاراتك'), grid));
    }
    const snd = h('input', { type: 'checkbox', checked: app.settings.sfx !== false, onchange: async (e) => { await app.saveSettings({ sfx: e.target.checked }); sfx.setMuted(!e.target.checked); if (e.target.checked) sfx.task(); } });
    root.append(h('div.card', h('label.switch', h('span', '🔊 المؤثرات الصوتية'), snd)));
  }

  sfx.setMuted(app.settings.sfx === false);
  return {
    mount(el) { root = el; render(); },
    show() { visible = true; render(); evaluate(true); },
    hide() { visible = false; },
  };
}
