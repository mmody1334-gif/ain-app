// تحديات يومية متسلسلة: نقاط وشارات وسلسلة مثل Duolingo
import { h, btn, toast } from '../ui.js';

const BADGE_LIST = [
  { id: 'first_day', emoji: '🌱', name: 'أول يوم' },
  { id: 'days3', emoji: '✨', name: '3 أيام' },
  { id: 'week', emoji: '🔥', name: 'أسبوع' },
  { id: 'days14', emoji: '💪', name: '14 يوم' },
  { id: 'month', emoji: '💎', name: 'شهر كامل' },
  { id: 'xp50', emoji: '⭐', name: '50 نقطة' },
  { id: 'xp100', emoji: '🌟', name: '100 نقطة' },
  { id: 'xp500', emoji: '🏆', name: '500 نقطة' },
];

function checkBadges(streak) {
  const existing = new Set((streak.badges || []).map(b => b.id));
  const out = [];
  const conds = {
    first_day: streak.days >= 1, days3: streak.days >= 3, week: streak.days >= 7,
    days14: streak.days >= 14, month: streak.days >= 30,
    xp50: streak.totalXP >= 50, xp100: streak.totalXP >= 100, xp500: streak.totalXP >= 500,
  };
  for (const b of BADGE_LIST) if (!existing.has(b.id) && conds[b.id]) out.push(b);
  return out;
}

function getDailyChallenges(app, today) {
  let s = parseInt(today.replace(/-/g, '').slice(-6), 10) || 1234;
  const lcg = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s; };
  const signs = app.signs.filter(x => x.kind === 'static' || x.kind === 'builtin');
  const pickSign = () => signs.length ? signs[Math.abs(lcg()) % signs.length] : null;

  const base = [
    { id: 'open_app', emoji: '📱', title: 'افتح التطبيق', desc: 'مجرد فتحه يُحسب!', xp: 5 },
    { id: 'use_camera', emoji: '📷', title: 'شغّل الكاميرا', desc: 'افتح شاشة الترجمة وشغّل الكاميرا', xp: 10 },
    { id: 'sign_hello', emoji: '👋', title: 'قل مرحبًا', desc: 'أظهر إشارة «مرحبًا» أمام الكاميرا', xp: 15 },
    { id: 'translate_3', emoji: '🤲', title: 'ترجم 3 إشارات', desc: 'أي 3 إشارات في شاشة الترجمة', xp: 20 },
  ];

  const picked = new Set();
  for (let i = 0; i < 2; i++) {
    const s2 = pickSign();
    if (s2 && !picked.has(s2.id)) {
      picked.add(s2.id);
      base.push({
        id: 'sign_' + s2.id + '_' + today,
        emoji: i === 0 ? '✋' : '🖐',
        title: (i === 0 ? 'تدرّب على: ' : 'راجع: ') + s2.word,
        desc: 'أظهر إشارة «' + s2.word + '» أمام الكاميرا',
        xp: 20,
      });
    }
  }
  return base;
}

export function createStreakView(app) {
  let root;

  async function loadStreak() {
    const today = new Date().toISOString().slice(0, 10);
    let streak = await app.store.getMeta('streak', {
      days: 0, lastDate: null, totalXP: 0, badges: [],
      todayXP: 0, todayDate: null, completedChallenges: [],
    });
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (streak.todayDate !== today) {
      streak.todayXP = 0; streak.todayDate = today; streak.completedChallenges = [];
    }
    if (streak.lastDate && streak.lastDate !== today && streak.lastDate !== yesterday) {
      streak.days = 0; // السلسلة انكسرت
    }
    return { streak, today };
  }

  async function render() {
    if (!root) return;
    root.innerHTML = '';
    const { streak, today } = await loadStreak();
    const fire = streak.days >= 7 ? '🔥' : streak.days >= 3 ? '✨' : streak.days >= 1 ? '⭐' : '💤';
    const challenges = getDailyChallenges(app, today);
    const done = new Set(streak.completedChallenges || []);

    // بطاقة السلسلة
    root.append(h('div.card', { style: { textAlign: 'center', padding: '20px 14px' } },
      h('div', { style: { fontSize: '3.5rem', lineHeight: '1.1' } }, fire),
      h('div', { style: { fontSize: '2.2rem', fontWeight: '700', color: 'var(--accent)', fontFamily: 'var(--font-title)', margin: '6px 0' } }, streak.days + ' يوم'),
      h('p.muted.small', streak.days === 0 ? 'ابدأ سلسلتك اليومية الآن!' : streak.days === 1 ? 'يوم واحد — استمر غدًا!' : streak.days + ' يوم متتالٍ — رائع! 🎉'),
      h('div', { style: { display: 'flex', justifyContent: 'center', gap: '32px', marginTop: '14px' } },
        h('div', { style: { textAlign: 'center' } },
          h('div', { style: { fontSize: '1.5rem', fontWeight: '700', color: 'var(--amber)' } }, (streak.totalXP || 0) + ' ⭐'),
          h('div.small.muted', 'مجموع النقاط'),
        ),
        h('div', { style: { textAlign: 'center' } },
          h('div', { style: { fontSize: '1.5rem', fontWeight: '700', color: 'var(--ok)' } }, (streak.todayXP || 0) + ' XP'),
          h('div.small.muted', 'نقاط اليوم'),
        ),
      ),
    ));

    // التحديات اليومية
    const chList = h('div.list');
    for (const ch of challenges) {
      const isDone = done.has(ch.id);
      chList.append(h('div.item',
        h('div', { style: { fontSize: '1.6rem', flexShrink: '0' } }, ch.emoji),
        h('div.grow', h('div.ttl', ch.title), h('div.meta', ch.desc)),
        isDone
          ? h('span.badge.static', '+' + ch.xp + ' ✓')
          : btn('+' + ch.xp + ' XP', { cls: 'sm primary', onclick: () => complete(ch, today) }),
      ));
    }
    root.append(h('div.card', h('h2', '🎯 تحديات اليوم'), chList));

    // الشارات
    if (streak.badges && streak.badges.length) {
      const badgeGrid = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px' } });
      for (const b of streak.badges) {
        badgeGrid.append(h('div', { style: { textAlign: 'center', minWidth: '60px', padding: '8px', background: 'var(--surface2)', borderRadius: '12px' } },
          h('div', { style: { fontSize: '2rem' } }, b.emoji),
          h('div.small', b.name),
        ));
      }
      root.append(h('div.card', h('h2', '🏆 شاراتك'), badgeGrid));
    }
  }

  async function complete(ch, today) {
    const { streak } = await loadStreak();
    if ((streak.completedChallenges || []).includes(ch.id)) return;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    streak.completedChallenges = [...(streak.completedChallenges || []), ch.id];
    streak.todayXP = (streak.todayXP || 0) + ch.xp;
    streak.totalXP = (streak.totalXP || 0) + ch.xp;
    streak.todayDate = today;
    if (streak.lastDate !== today) {
      streak.days = (streak.lastDate === yesterday || !streak.lastDate) ? (streak.days || 0) + 1 : 1;
      streak.lastDate = today;
    }
    const newBadges = checkBadges(streak);
    streak.badges = [...(streak.badges || []), ...newBadges];
    await app.store.setMeta('streak', streak);
    if (navigator.vibrate) navigator.vibrate([40, 20, 40]);
    toast('+' + ch.xp + ' XP! ' + ch.title, 'ok');
    for (const b of newBadges) setTimeout(() => toast('🏆 شارة: ' + b.emoji + ' ' + b.name, 'ok'), 600);
    render();
  }

  return {
    mount(el) { root = el; render(); },
    show() { render(); },
    hide() {},
  };
}
