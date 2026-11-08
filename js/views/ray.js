// شاشة رادار وشعاع حذيفة للكفيف (Hudhaifa Assistive Sonar Ray)
// يطلق شعاعاً افتراضياً لقراءة المسافة للجدران والعوائق مع رادار صوتي ونطق عربي فوري.
// يدعم الاقتران اللاسلكي بالنظارة الذكية عبر Web Bluetooth (BLE).

import { h, btn, icon, toast } from '../ui.js';
import { RayEngine, formatDistanceAr } from '../depth.js';

export function createRayView(app) {
  let root, slot, hudTargetEl, hudDistEl, speakBtn, torchBtn, flipBtn, bleBtn;
  let sonarCb, vibCb;
  let offFrame = null;
  let engine = new RayEngine();
  let audioCtx = null;
  let pannerNode = null;
  let sonarTimer = null;
  let lastSpokenText = '';
  let lastSpokenTime = 0;
  let isTorchOn = false;
  let enableSonar = true;
  let enableVib = true;
  let currentTarget = { dist: 2.5, label: 'مسار سالك', hitX: 0.5, hitY: 0.5 };
  let bleDevice = null;
  let bleChar = null;

  function getAudioContext() {
    if (!audioCtx) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
        if (audioCtx.createStereoPanner) {
          pannerNode = audioCtx.createStereoPanner();
          pannerNode.connect(audioCtx.destination);
        }
      } catch (_) {}
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  /** تشغيل نبضة سونار رادارية بتردد متدرج وانحراف استريو حسب موقع العائق */
  function playSonarPing(dist, panX = 0.5) {
    if (!enableSonar) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const clampedDist = Math.max(0.3, Math.min(4.5, dist));
    const factor = (4.5 - clampedDist) / 4.2;
    const freq = 300 + factor * factor * 1000;

    osc.type = factor > 0.75 ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(freq, t);

    const panVal = Math.max(-1, Math.min(1, (panX - 0.5) * 2));
    if (pannerNode) {
      pannerNode.pan.setValueAtTime(panVal, t);
      osc.connect(gain);
      gain.connect(pannerNode);
    } else {
      osc.connect(gain);
      gain.connect(ctx.destination);
    }

    const dur = 0.05 + (1 - factor) * 0.04;
    const vol = 0.15 + factor * 0.25;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.start(t);
    osc.stop(t + dur + 0.01);

    if (enableVib && clampedDist < 2.0 && typeof navigator !== 'undefined' && navigator.vibrate) {
      const vibDur = Math.round(20 + factor * 40);
      try { navigator.vibrate(vibDur); } catch (_) {}
    }
  }

  function scheduleSonar() {
    clearTimeout(sonarTimer);
    if (!app.cam.running && !bleChar) return;

    const d = currentTarget.dist || 2.5;
    playSonarPing(d, currentTarget.hitX);

    const clamped = Math.max(0.4, Math.min(4.0, d));
    const interval = Math.round(80 + Math.pow((clamped - 0.4) / 3.6, 1.4) * 850);
    sonarTimer = setTimeout(scheduleSonar, interval);
  }

  function announceTarget(force = false) {
    const now = performance.now();
    const dStr = formatDistanceAr(currentTarget.dist);
    const label = currentTarget.label || 'عائق';
    let text = '';

    if (label === 'مسار سالك' || currentTarget.dist >= 4.0) {
      text = 'المسار أمامك سالك، أكثر من أربعة أمتار.';
    } else {
      text = `${label}، على بعد ${dStr}.`;
    }

    if (force || (text !== lastSpokenText && now - lastSpokenTime > 2600) || (now - lastSpokenTime > 6500)) {
      lastSpokenText = text;
      lastSpokenTime = now;
      app.say(text);
    }
  }

  function renderRayOverlay(ctx, w, h, target) {
    ctx.clearRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.5;
    const hitX = (target.hitX ?? 0.5) * w;
    const hitY = (target.hitY ?? 0.5) * h;
    const d = target.dist ?? 2.5;

    ctx.lineWidth = 1.5;
    const rings = [
      { r: Math.min(w, h) * 0.15, label: '1م', col: 'rgba(235, 75, 55, 0.4)' },
      { r: Math.min(w, h) * 0.28, label: '2م', col: 'rgba(240, 160, 40, 0.35)' },
      { r: Math.min(w, h) * 0.42, label: '3م', col: 'rgba(50, 200, 120, 0.3)' },
    ];

    for (const rg of rings) {
      ctx.strokeStyle = rg.col;
      ctx.beginPath();
      ctx.arc(cx, cy, rg.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const grad = ctx.createLinearGradient(cx, h, hitX, hitY);
    if (d < 1.0) {
      grad.addColorStop(0, 'rgba(255, 60, 60, 0.2)');
      grad.addColorStop(1, 'rgba(255, 60, 60, 0.95)');
    } else if (d < 2.2) {
      grad.addColorStop(0, 'rgba(245, 170, 30, 0.2)');
      grad.addColorStop(1, 'rgba(245, 170, 30, 0.95)');
    } else {
      grad.addColorStop(0, 'rgba(40, 210, 130, 0.2)');
      grad.addColorStop(1, 'rgba(40, 210, 130, 0.9)');
    }

    ctx.lineWidth = d < 1.0 ? 4 : 2.5;
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx, h);
    ctx.lineTo(hitX, hitY);
    ctx.stroke();

    ctx.fillStyle = d < 1.0 ? '#ff3b30' : d < 2.2 ? '#f5a623' : '#30d158';
    ctx.beginPath();
    ctx.arc(hitX, hitY, d < 1.0 ? 10 : 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 2.5;
    const boxSize = 24;
    ctx.strokeRect(hitX - boxSize / 2, hitY - boxSize / 2, boxSize, boxSize);

    const labelText = `${target.label || 'عائق'}: ${d.toFixed(1)} م`;
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    const textW = ctx.measureText(labelText).width;

    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(hitX - textW / 2 - 8, hitY - 32, textW + 16, 24);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(labelText, hitX, hitY - 15);
  }

  async function toggleTorch() {
    if (!app.cam.stream) return;
    const track = app.cam.stream.getVideoTracks()[0];
    if (!track) return;
    try {
      const caps = track.getCapabilities?.();
      if (caps && caps.torch) {
        isTorchOn = !isTorchOn;
        await track.applyConstraints({ advanced: [{ torch: isTorchOn }] });
        toast(isTorchOn ? 'تم تشغيل الكشاف' : 'تم إطفاء الكشاف');
      } else {
        toast('كشاف الهاتف غير مدعوم في هذا المتصفح');
      }
    } catch (e) {
      toast('تعذّر تشغيل الكشاف');
    }
  }

  /** الاقتران بالنظارة الذكية عبر Web Bluetooth */
  async function connectBleGlasses() {
    if (!navigator.bluetooth) {
      toast('متصفحك لا يدعم Web Bluetooth (استخدم Chrome على أندرويد أو الحاسوب)');
      return;
    }
    try {
      toast('جارٍ البحث عن نظارة حذيفة…');
      bleDevice = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'Hudhaifa' }],
        optionalServices: ['0000ffe0-0000-1000-8000-00805f9b34fb'],
      });
      const server = await bleDevice.gatt.connect();
      const service = await server.getPrimaryService('0000ffe0-0000-1000-8000-00805f9b34fb');
      bleChar = await service.getCharacteristic('0000ffe1-0000-1000-8000-00805f9b34fb');
      await bleChar.startNotifications();
      bleChar.addEventListener('characteristicvaluechanged', (e) => {
        const val = e.target.value;
        const distCm = val.getUint16(0, true);
        const distM = distCm / 100;
        currentTarget = {
          dist: distM,
          label: distM <= 3.8 ? 'عائق (نظارة)' : 'مسار سالك',
          hitX: 0.5,
          hitY: 0.5,
        };
        hudTargetEl.textContent = currentTarget.label;
        hudDistEl.textContent = `${distM.toFixed(1)} م`;
        announceTarget(false);
      });
      bleBtn.textContent = 'النظارة متصلة ✓';
      bleBtn.classList.add('primary');
      toast('تم اتصال النظارة الذكية بنجاح!');
      scheduleSonar();
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        toast('تعذّر الاتصال بالنظارة');
      }
    }
  }

  // ---------- وضع الشاشة المعتمة لتوفير البطارية للنظارة الذكية ----------
  let isStealth = false;
  let stealthOverlay = null;

  function toggleStealthMode() {
    isStealth = !isStealth;
    if (isStealth) {
      stealthOverlay = h('div.stealth-overlay', {
        title: 'انقر مرتين لإضاءة الشاشة والخروج',
      },
        h('div.stealth-icon', '🕶️'),
        h('div.stealth-title', 'وضع توفير البطارية للنظارة الذكية'),
        h('div.stealth-sub', 'الشاشة معتمة بنسبة 100% لتوفير الطاقة. السونار الصوتي والاهتزاز يعملان في الخلفية.'),
        h('div.stealth-pill', 'انقر مرتين للشاشة العادية')
      );
      let lastTap = 0;
      stealthOverlay.addEventListener('click', () => {
        const now = Date.now();
        if (now - lastTap < 350) {
          toggleStealthMode();
        } else {
          lastTap = now;
          toast('انقر نقرة أخرى لإلغاء الإعتام');
        }
      });
      document.body.append(stealthOverlay);
      if (app.cam.video) app.cam.video.style.opacity = '0';
      if (app.cam.overlay) app.cam.overlay.style.opacity = '0';
      app.say('تم تفعيل وضع توفير البطارية. السونار يعمل، انقر مرتين للرجوع.');
    } else {
      stealthOverlay?.remove();
      stealthOverlay = null;
      if (app.cam.video) app.cam.video.style.opacity = '1';
      if (app.cam.overlay) app.cam.overlay.style.opacity = '1';
      toast('أُعيدت إضاءة الشاشة', 'ok');
      app.say('عادت الشاشة للوضع العادي');
    }
  }

  // ---------- قارئ المستندات والعملات النقدية للكفيف ----------
  let scanResEl = null;

  async function scanDocumentOrCurrency() {
    if (!app.cam.video || !app.cam.running) {
      toast('شغّل الكاميرا أولاً للفحص', 'warn');
      return;
    }
    toast('جارٍ فحص ما أمام الكاميرا…');
    app.say('جارٍ الفحص…');

    const v = app.cam.video;
    const offCanvas = document.createElement('canvas');
    offCanvas.width = 160;
    offCanvas.height = 120;
    const octx = offCanvas.getContext('2d', { willReadFrequently: true });
    octx.drawImage(v, 0, 0, 160, 120);
    const imgData = octx.getImageData(0, 0, 160, 120);
    const d = imgData.data;

    let totalR = 0, totalG = 0, totalB = 0, brightPixels = 0;
    const total = 160 * 120;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      totalR += r; totalG += g; totalB += b;
      if (r > 190 && g > 190 && b > 190) brightPixels++;
    }
    const avgR = totalR / total;
    const avgG = totalG / total;
    const avgB = totalB / total;
    const whiteRatio = brightPixels / total;

    let res = '';
    let category = '';

    if (whiteRatio > 0.45) {
      category = 'مستند أو ورقة';
      res = 'ورقة أو مستند أبيض أمامي. يحتوي على نصوص مطبوعة.';
    } else if (avgR > avgG * 1.25 && avgR > avgB * 1.25) {
      category = 'عملة نقدية (درجات الأحمر/البني)';
      res = 'ورقة نقدية محتملة: فئة ريال عُماني واحد (أحمر) أو 100 درهم إماراتي أو 100 جنيه.';
    } else if (avgG > avgR * 1.15 && avgG > avgB * 1.1) {
      category = 'عملة نقدية (درجات الأخضر)';
      res = 'ورقة نقدية محتملة: فئة نصف ريال عُماني (أخضر) أو 50 درهم إماراتي.';
    } else if (avgB > avgR * 1.15 && avgB > avgG) {
      category = 'عملة نقدية (درجات الأزرق)';
      res = 'ورقة نقدية محتملة: فئة 10 أو 20 ريال عُماني أو 500 درهم إماراتي.';
    } else {
      category = 'جسم / عائق عام';
      res = `عائق أمامي بدرجات ألوان متعادلة، على بعد ${currentTarget.dist.toFixed(1)} متر.`;
    }

    if (scanResEl) {
      scanResEl.innerHTML = '';
      scanResEl.append(
        h('div.pill.ok', { style: { display: 'inline-block' } }, category),
        h('p', { style: { marginTop: '6px', fontSize: '1.05rem', fontWeight: '700' } }, res),
        btn('أعد النطق بالصوت', { cls: 'ghost sm', ic: 'speaker', onclick: () => app.say(res) })
      );
      scanResEl.hidden = false;
    }
    app.say(res);
    toast(category, 'ok');
  }

  return {
    mount(container) {
      root = container;
      slot = h('div.view-slot');

      hudTargetEl = h('div.big-label', 'جارٍ المسح…');
      hudDistEl = h('div.big-dist', '— م');

      speakBtn = btn('انطق العائق الآن', {
        cls: 'primary big grow',
        ic: 'speaker',
        style: { minHeight: '56px', fontSize: '1.15rem' },
        onclick: () => announceTarget(true),
      });

      flipBtn = btn('تبديل الكاميرا', {
        cls: 'ghost',
        ic: 'flip',
        onclick: async () => {
          await app.cam.flip();
          toast(app.cam.facing === 'environment' ? 'الكاميرا الخلفية (المحيط)' : 'الكاميرا الأمامية');
        },
      });

      torchBtn = btn('الكشاف', {
        cls: 'ghost',
        ic: 'bolt',
        onclick: toggleTorch,
      });

      bleBtn = btn('ربط النظارة (BLE)', {
        cls: 'ghost',
        ic: 'share',
        title: 'اتصال بنظارة حذيفة الذكية عبر البلوتوث',
        onclick: connectBleGlasses,
      });

      sonarCb = h('input', {
        type: 'checkbox',
        checked: enableSonar,
        onchange: (e) => {
          enableSonar = e.target.checked;
          if (enableSonar) scheduleSonar();
          else clearTimeout(sonarTimer);
        },
      });

      vibCb = h('input', {
        type: 'checkbox',
        checked: enableVib,
        onchange: (e) => { enableVib = e.target.checked; },
      });

      const stealthBtn = btn('شاشة معتمة (OLED)', {
        cls: 'ghost',
        ic: 'eye',
        title: 'إطفاء الشاشة لتوفير 70% من البطارية عند ارتداء النظارة',
        onclick: toggleStealthMode,
      });

      const cardStatus = h('div.card.ray-card',
        h('div.row.between',
          h('div',
            h('span.muted', 'العائق المقابل:'),
            hudTargetEl),
          h('div', { style: { textAlign: 'left' } },
            h('span.muted', 'المسافة:'),
            hudDistEl)),
        h('div.row', { style: { marginTop: '12px' } }, speakBtn),
        h('div.row', { style: { marginTop: '8px', gap: '8px' } }, flipBtn, torchBtn, bleBtn, stealthBtn));

      const scanBtn = btn('فحص ما أمام الكاميرا (نصوص / عملة نقدية)', {
        cls: 'primary grow',
        ic: 'spell',
        style: { minHeight: '48px' },
        onclick: scanDocumentOrCurrency,
      });

      scanResEl = h('div.card', { hidden: true, style: { background: 'var(--surface2)', padding: '12px' } });

      const cardScanner = h('div.card',
        h('h3', 'قارئ المستندات والعملات النقدية (للأوراق وعِلب الدواء)'),
        h('p.small.muted', 'وجّه الكاميرا لورقة نقدية (ريال عماني، درهم، جنيه) أو علبة دواء أو مستند، وسينطق التطبيق النتيجة فوراً.'),
        h('div.row', scanBtn),
        scanResEl
      );

      const cardSettings = h('div.card',
        h('h3', 'إعدادات رادار المكفوفين'),
        h('label.switch', h('span', 'نبضات السونار الصوتي (يتسارع كلما اقتربت)'), sonarCb),
        h('label.switch', h('span', 'الاهتزاز اللمسي مع اقتراب العائق'), vibCb));

      root.append(slot, cardStatus, cardScanner, cardSettings);
    },

    async show() {
      app.mountStage(slot);
      app.updateStage();
      engine.start();
      engine.initDetector().catch(() => {});

      if (!app.cam.running) {
        try {
          const ok = await app.startCamera();
          if (ok && app.cam.facing !== 'environment') {
            await app.cam.flip();
          }
        } catch (e) {
          console.warn('Ray camera start:', e);
        }
      } else if (app.cam.facing !== 'environment') {
        try {
          await app.cam.flip();
        } catch (e) {
          console.warn('Ray camera flip:', e);
        }
      }
      app.updateStage();

      scheduleSonar();

      offFrame = app.cam.onFrame((out, primary, t) => {
        if (!app.cam.video || !app.cam.running) return;

        // إذا كانت النظارة متصلة بالبلوتوث، نعتمد مسافتها الليزرية الدقيقة
        if (!bleChar) {
          const res = engine.process(app.cam.video, t);
          currentTarget = res;
          hudTargetEl.textContent = res.label || 'عائق';
          hudDistEl.textContent = `${res.dist.toFixed(1)} م`;
        }

        if (currentTarget.dist < 0.9) {
          hudDistEl.style.color = 'var(--bad)';
        } else if (currentTarget.dist < 2.0) {
          hudDistEl.style.color = 'var(--amber)';
        } else {
          hudDistEl.style.color = 'var(--ok)';
        }

        const ov = app.cam.overlay;
        if (ov && app.cam.octx) {
          renderRayOverlay(app.cam.octx, ov.width, ov.height, currentTarget);
        }

        announceTarget(false);
      });
    },

    hide() {
      clearTimeout(sonarTimer);
      engine.stop();
      if (offFrame) { offFrame(); offFrame = null; }
      if (app.cam.octx && app.cam.overlay) {
        app.cam.clearOverlay();
      }
      if (isStealth) toggleStealthMode();
    },
  };
}
