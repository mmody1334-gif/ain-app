// إشارة الاسم الشخصية: سجّل إشارتك ويناديك التطبيق باسمك
import { h, btn, toast, sheet } from '../ui.js';

export function createNameSignView(app) {
  let root;

  async function render() {
    if (!root) return;
    root.innerHTML = '';
    const saved = app.signs.find(s => s.id === 'personal_name_sign');
    const meta = await app.store.getMeta('personal_name', { name: '', greetCount: 0 });

    const nameInput = h('input', { type: 'text', value: meta.name || '', placeholder: 'اكتب اسمك هنا' });
    nameInput.oninput = async () => {
      const m = await app.store.getMeta('personal_name', {});
      await app.store.setMeta('personal_name', { ...m, name: nameInput.value.trim() });
    };

    const statusEl = h('p.small.muted',
      saved
        ? '✓ إشارة الاسم مسجّلة — عُرِّفتُ بك ' + (meta.greetCount || 0) + ' مرة'
        : 'لم تُسجَّل إشارة اسمك بعد. سجّلها 3 مرات لتُعرَّف بك.'
    );

    const recBtn = btn(saved ? 'أعد تسجيل الإشارة' : 'سجّل إشارة اسمك (3 مرات)', {
      cls: 'primary', ic: 'cam',
      onclick: () => {
        const name = nameInput.value.trim();
        if (!name) { toast('اكتب اسمك أولاً', 'bad'); return; }
        startRecording(name);
      },
    });

    const btns = [recBtn];
    if (saved) btns.push(btn('احذف إشارة الاسم', {
      cls: 'danger sm', ic: 'trash',
      onclick: async () => { await app.removeSign('personal_name_sign'); toast('حُذفت إشارة الاسم'); render(); },
    }));

    root.append(
      h('div.card',
        h('h2', '✨ إشارة اسمك الشخصية'),
        h('p.small.muted', 'سجّل الإشارة التي تستخدمها للتعريف بنفسك مع الصم. التطبيق سيناديك باسمك كلما أظهرت الإشارة.'),
        h('label.field', 'اسمك', nameInput),
        statusEl,
        h('div.row', ...btns),
      ),
    );

    if (saved && meta.name) {
      root.append(h('div.card',
        h('div', { style: { textAlign: 'center', padding: '12px' } },
          h('div', { style: { fontSize: '3.5rem', lineHeight: '1.1' } }, '👋'),
          h('div', { style: { fontSize: '1.5rem', fontWeight: '700', color: 'var(--accent)', fontFamily: 'var(--font-title)', marginTop: '8px' } }, 'أهلاً ' + meta.name + '!'),
          h('p.small.muted', 'هكذا سيرحب بك التطبيق عند رؤية إشارتك'),
        ),
      ));
    }

    root.append(h('div.card',
      h('h2', 'كيف تعمل؟'),
      h('ol.small', { style: { paddingInlineStart: '20px', lineHeight: '2' } },
        h('li', 'اكتب اسمك في الخانة أعلاه.'),
        h('li', 'اضغط «سجّل» — سيطلب التطبيق تثبيت إشارتك 3 مرات.'),
        h('li', 'عند رؤية إشارتك: ينطق التطبيق «أهلاً [اسمك]!» ويهتز الجهاز.'),
        h('li', 'مفيد عند بدء أي محادثة مع صديق أصم — التعريف بالاسم أول خطوة.'),
      ),
    ));
  }

  function startRecording(name) {
    let samples = [];
    const MAX = 3;
    let offFn = null;

    sheet('سجّل إشارة «' + name + '» — ' + MAX + ' مرات', (close) => {
      const dotEls = Array.from({ length: MAX }, () => h('i'));
      const dots = h('div.dots', { style: { justifyContent: 'center', gap: '8px' } }, ...dotEls);
      const instrEl = h('p', { style: { textAlign: 'center', color: 'var(--muted)', minHeight: '2.4em' } },
        'ثبّت إشارتك أمام الكاميرا حتى يعدّها، ثم ارفع يدك — ' + MAX + ' مرات.');
      const slotEl = h('div', { style: { borderRadius: '12px', overflow: 'hidden' } });

      app.mountStage(slotEl);
      app.startCamera().then(() => {
        let lastConfirmed = 0;
        offFn = app.cam.onFrame(out => {
          if (samples.length >= MAX) return;
          if (out.hold && out.hold.progress >= 1 && out.frame?.pose) {
            const now = Date.now();
            if (now - lastConfirmed < 1400) return; // تجنب التكرار السريع
            lastConfirmed = now;
            samples.push(Array.from(out.frame.pose));
            const idx = samples.length - 1;
            if (dotEls[idx]) { dotEls[idx].className = 'on'; }
            if (navigator.vibrate) navigator.vibrate(80);
            instrEl.textContent = samples.length < MAX
              ? 'رائع! ' + samples.length + '/' + MAX + ' — ارفع يدك ثم أعد'
              : 'مكتمل! ' + MAX + '/' + MAX + ' 🎉';

            if (samples.length >= MAX) {
              if (offFn) { offFn(); offFn = null; }
              setTimeout(async () => {
                const sign = {
                  id: 'personal_name_sign',
                  word: 'أهلاً ' + name,
                  aliases: [name, 'أهلاً ' + name],
                  kind: 'static', hands: 1, samples,
                  source: 'personal', created: Date.now(),
                };
                await app.saveSign(sign);
                const m = await app.store.getMeta('personal_name', {});
                await app.store.setMeta('personal_name', { ...m, name, greetCount: 0 });
                toast('تم! سأناديك «' + name + '» 🎉', 'ok');
                close(); render();
              }, 700);
            }
          }
        });
      });

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        slotEl, instrEl, dots,
        btn('إلغاء', { cls: 'ghost', onclick: () => { if (offFn) { offFn(); offFn = null; } app.unmountStage(); close(); } }),
      );
    }, { persistent: true });
  }

  return {
    mount(el) { root = el; render(); },
    show() { render(); },
    hide() {},
  };
}
