// محرك العمق والشعاع ثلاثي المناطق للكفيف (Ain 3-Zone Spatial Radar)
// يحلل الكاميرا الخلفية للهاتف لتقدير المسافة والاتجاه: يمين · أمامك · يسار.

export const AR_LABELS = {
  person: 'شخص',
  chair: 'كرسي',
  couch: 'أريكة',
  bed: 'سرير',
  'dining table': 'طاولة',
  table: 'طاولة',
  toilet: 'دورة مياه',
  tv: 'شاشة',
  laptop: 'حاسوب',
  mouse: 'فأرة',
  keyboard: 'لوحة مفاتيح',
  'cell phone': 'هاتف',
  cell_phone: 'هاتف',
  microwave: 'ميكروويف',
  oven: 'فرن',
  sink: 'حوض',
  refrigerator: 'ثلاجة',
  book: 'كتاب',
  clock: 'ساعة',
  vase: 'مزهرية',
  scissors: 'مقص',
  bottle: 'قارورة',
  cup: 'كوب',
  bowl: 'وعاء',
  backpack: 'حقيبة ظهر',
  umbrella: 'مظلة',
  handbag: 'حقيبة',
  suitcase: 'حقيبة سفر',
  car: 'سيارة',
  bus: 'حافلة',
  truck: 'شاحنة',
  bicycle: 'دراجة',
  motorcycle: 'دراجة نارية',
  'traffic light': 'إشارة مرور',
  'stop sign': 'علامة قف',
  bench: 'مقعد',
  cat: 'قطة',
  dog: 'كلب',
  'potted plant': 'نبتة',
  door: 'باب',
  stairs: 'درج',
  wall: 'جدار',
  floor: 'أرضية',
  obstacle: 'عائق',
};

export const DIST_BANDS = [
  { id: 'danger', max: 0.95, text: 'أقل من متر' },
  { id: 'near',   max: 1.80, text: 'متر ونصف' },
  { id: 'mid',    max: 2.80, text: 'متران ونصف' },
  { id: 'far',    max: 4.00, text: 'أكثر من ثلاثة أمتار' },
  { id: 'clear',  max: Infinity, text: 'مسار سالك' },
];

/** يصنّف المسافة إلى فئة مستقرة بهيستيريسيس ±0.3م حول الحدود لمنع التذبذب الصوتي. */
export function quantizeDistanceBand(d, prevId = null, hyst = 0.3) {
  if (d == null || !Number.isFinite(d)) return DIST_BANDS[DIST_BANDS.length - 1];
  if (prevId) {
    const idx = DIST_BANDS.findIndex((b) => b.id === prevId);
    if (idx >= 0) {
      const low = idx === 0 ? -Infinity : DIST_BANDS[idx - 1].max - hyst;
      const high = DIST_BANDS[idx].max + hyst;
      if (d >= low && d <= high) return DIST_BANDS[idx];
    }
  }
  return DIST_BANDS.find((b) => d < b.max) || DIST_BANDS[DIST_BANDS.length - 1];
}

export function formatDistanceAr(d) {
  if (d == null || !Number.isFinite(d)) return '';
  if (d < 0.5) return 'أقل من نصف متر';
  if (d < 0.85) return 'نصف متر تقريباً';
  if (d < 1.3) return 'متر واحد';
  if (d < 1.8) return 'متر ونصف';
  if (d < 2.3) return 'متران';
  if (d < 2.8) return 'متران ونصف';
  if (d < 3.4) return 'ثلاثة أمتار';
  if (d < 4.0) return 'ثلاثة أمتار ونصف';
  return 'أكثر من أربعة أمتار';
}

export const VERY_CLOSE_M = 0.3;
export const CLEAR_M = 4.5;

/** أطوال تقريبية (م) لأشياء تقف على الأرض: لتقدير المسافة من الحجم حين تكون قاعدتها خارج الصورة */
const TYPICAL_HEIGHT_M = {
  person: 1.65, chair: 0.9, couch: 0.85, bed: 0.6, 'dining table': 0.75, table: 0.75, toilet: 0.75,
  refrigerator: 1.7, car: 1.5, bus: 3.0, truck: 3.0, bicycle: 1.0, motorcycle: 1.1, bench: 0.85,
  dog: 0.5, cat: 0.3, 'potted plant': 0.6, suitcase: 0.65, door: 2.0, 'fire hydrant': 0.7,
};
const LOW_CONF_SCORE = 0.5;
const FILL_AREA = 0.55;

/**
 * إحصاءات تغطية الإطار: نسبة بكسلات لون الجلد (YCbCr) ومتوسط التباين بين البكسلات المتجاورة.
 * كف ملاصق للعدسة = جلد يملأ الصورة + تفاصيل شبه معدومة (ضبابي).
 */
export function frameCoverageStats(imgData, step = 4) {
  const { width: cw, height: ch, data } = imgData;
  let n = 0, skin = 0, gradSum = 0, gradN = 0;
  const lum = (i) => data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  for (let y = 0; y < ch - step; y += step) {
    for (let x = 0; x < cw - step; x += step) {
      const i = (y * cw + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) skin++;
      n++;
      const l = lum(i);
      gradSum += Math.abs(l - lum(i + step * 4)) + Math.abs(l - lum(i + step * cw * 4));
      gradN += 2;
    }
  }
  return { skinFrac: n ? skin / n : 0, texture: gradN ? gradSum / gradN : 0 };
}

/** الإطار مغطى: أغلبه جلد وبلا تفاصيل، أو بلا أي تفاصيل إطلاقاً (قماش/إصبع على العدسة). */
export function isFrameOccluded({ skinFrac, texture }) {
  return (skinFrac >= 0.7 && texture < 6) || texture < 1.5;
}

export class RayEngine {
  constructor(opt = {}) {
    this.camHeight = opt.camHeight ?? 1.32;
    this.vfov = (opt.vfovDeg ?? 62) * (Math.PI / 180);
    this.pitch = 0.16;
    this.roll = 0;
    this.heading = 0;
    this.hasGyro = false;

    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (this.canvas) {
      this.canvas.width = 120;
      this.canvas.height = 160;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    } else {
      this.ctx = null;
    }

    // البداية «سالك»: لا نخترع عائقاً قبل أن نرى شيئاً (كان يبدأ بـ 2.5م فينطق تحذيراً وهمياً عند التشغيل)
    this.zones = { left: CLEAR_M, center: CLEAR_M, right: CLEAR_M };
    this.lastDist = CLEAR_M;
    this.lastActiveZone = 'center';
    this.target = null;
    this._onOrientation = this._handleOrientation.bind(this);
    this._detector = null;
    this._detectorLoading = false;
    this._lastDetPerf = 0;
    this._lastDetTsMs = 0;
    this.lastDetections = [];
  }

  start() {
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('deviceorientation', this._onOrientation, true);
    }
  }

  stop() {
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('deviceorientation', this._onOrientation, true);
    }
  }

  _handleOrientation(e) {
    if (e.beta == null) return;
    this.hasGyro = true;
    // الهاتف عمودي تماماً (beta=90) = الكاميرا موجّهة للأفق (ميل 0)
    const deg = 90 - e.beta;
    this.pitch = Math.max(-0.4, Math.min(0.75, deg * (Math.PI / 180)));
    this.roll = (e.gamma || 0) * (Math.PI / 180);
    this.heading = (e.alpha || 0) * (Math.PI / 180);
  }

  async initDetector() {
    if (this._detector || this._detectorLoading) return;
    this._detectorLoading = true;
    try {
      const CDN_VER = '0.10.14';
      const mod = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${CDN_VER}/vision_bundle.mjs`);
      const { FilesetResolver, ObjectDetector } = mod;
      const vision = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${CDN_VER}/wasm`);
      this._detector = await ObjectDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        scoreThreshold: 0.36,
        maxResults: 5,
      });
    } catch (_) {
      this._detector = null;
    } finally {
      this._detectorLoading = false;
    }
  }

  process(video) {
    const vw = video?.videoWidth || video?.width || 0;
    const vh = video?.videoHeight || video?.height || 0;
    if (!video || !vw || !this.ctx) {
      return {
        dist: this.lastDist, label: 'مسار سالك', dir: 'center', dirAr: 'أمامك',
        guidance: 'وجّه الكاميرا للأمام', isWall: false, conf: 0,
        hitX: 0.5, hitY: 0.5, zones: { ...this.zones }, dark: false, light: null,
      };
    }

    const cw = this.canvas.width, ch = this.canvas.height;
    this.ctx.drawImage(video, 0, 0, cw, ch);
    const imgData = this.ctx.getImageData(0, 0, cw, ch);
    const zInfo = this._analyzeThreeZones(imgData);

    if (zInfo.dark) {
      this.lastDetections = [];
      const outDark = {
        dist: 4.5,
        label: 'مسار سالك',
        dir: 'center',
        dirAr: 'أمامك',
        guidance: 'الكاميرا مغطاة أو في الظلام',
        isWall: false,
        conf: 0,
        hitX: 0.5,
        hitY: 0.5,
        zones: { left: 4.5, center: 4.5, right: 4.5 },
        dark: true,
        light: zInfo.light,
      };
      this.target = outDark;
      return outDark;
    }

    const nowPerf = performance.now();
    if (this._detector && nowPerf - this._lastDetPerf >= 120) {
      this._lastDetPerf = nowPerf;
      const tsMs = Math.max(this._lastDetTsMs + 1, Math.round(nowPerf));
      this._lastDetTsMs = tsMs;
      try {
        const res = this._detector.detectForVideo(video, tsMs);
        this.lastDetections = (res?.detections || []).map((det) => {
          const bb = det.boundingBox;
          const cat = det.categories?.[0];
          const rawName = (cat?.categoryName || 'obstacle').toLowerCase();
          const cx = (bb.originX + bb.width / 2) / vw;
          const cy = (bb.originY + bb.height / 2) / vh;
          const bottomY = Math.min(1.0, (bb.originY + bb.height) / vh);
          const boxW = bb.width / vw, boxH = bb.height / vh;
          const score = cat?.score ?? 0.5;
          // ثقة ضعيفة: لا نسمّي الشيء (لا نقول «شخص» ونحن غير متأكدين)
          const uncertain = score < LOW_CONF_SCORE;
          // صندوق يملأ أغلب الصورة = الشيء ملاصق للكاميرا؛ تقدير المسافة من الأرض هنا كاذب
          const tooClose = boxW * boxH >= FILL_AREA || (boxH >= 0.9 && boxW >= 0.6);
          return {
            // اسم بلا ترجمة عربية (مثل kite) لا يُنطق بالإنجليزية للكفيف: نقول «عائق»
            label: uncertain ? 'عائق' : (AR_LABELS[rawName] || 'عائق'),
            score,
            uncertain,
            tooClose,
            cx, cy,
            boxW,
            boxH,
            dist: tooClose ? VERY_CLOSE_M : this._estimateObjectDist(rawName, bottomY, boxH),
          };
        });
      } catch (_) {
        // نحافظ على آخر نتائج صالحة دون تعطيل الرادار
      }
    }

    // الكاميرا مغطاة (كف/إصبع/شيء ملاصق): لا نعطي رقماً كاذباً، نقول «قريب جداً»
    if (zInfo.occluded || this.lastDetections.some((d) => d.tooClose)) {
      const z = { left: VERY_CLOSE_M, center: VERY_CLOSE_M, right: VERY_CLOSE_M };
      this.zones = { ...z };
      this.lastDist = VERY_CLOSE_M;
      this.lastActiveZone = 'center';
      const outOcc = {
        dist: VERY_CLOSE_M,
        label: 'شيء ملاصق للكاميرا',
        dir: 'center',
        dirAr: 'أمامك',
        guidance: 'شيء قريب جداً من الكاميرا أو العدسة مغطاة، المسافة غير مؤكدة',
        isWall: false,
        conf: 0,
        hitX: 0.5,
        hitY: 0.5,
        zones: z,
        dark: false,
        occluded: true,
        light: zInfo.light,
      };
      this.target = outOcc;
      return outOcc;
    }

    const alpha = 0.35;
    for (const k of ['left', 'center', 'right']) {
      this.zones[k] = Math.round((alpha * zInfo.zones[k] + (1 - alpha) * this.zones[k]) * 10) / 10;
    }

    let centerObj = null, leftObj = null, rightObj = null;
    for (const d of this.lastDetections) {
      const zone = d.cx < 0.36 ? 'left' : d.cx > 0.64 ? 'right' : 'center';
      if (d.dist < this.zones[zone]) {
        this.zones[zone] = Math.round(d.dist * 10) / 10;
      }
      if (zone === 'center' && (!centerObj || d.dist < centerObj.dist)) centerObj = d;
      else if (zone === 'left' && (!leftObj || d.dist < leftObj.dist)) leftObj = d;
      else if (zone === 'right' && (!rightObj || d.dist < rightObj.dist)) rightObj = d;
    }

    const { left, center, right } = this.zones;
    let activeZone = 'center';
    // هيستيريسيس لاتجاه العائق الجانبي لمنع التردد السريع بين يسار/أمام/يمين
    const enterMargin = 0.4;
    const keepMargin = 0.18;
    const enterMax = 2.25;
    const keepMax = 2.45;

    if (this.lastActiveZone === 'left' && left < center - keepMargin && left < keepMax && left <= right + 0.1) {
      activeZone = 'left';
    } else if (this.lastActiveZone === 'right' && right < center - keepMargin && right < keepMax && right <= left + 0.1) {
      activeZone = 'right';
    } else if (left < center - enterMargin && left < enterMax && left <= right) {
      activeZone = 'left';
    } else if (right < center - enterMargin && right < enterMax && right < left) {
      activeZone = 'right';
    }
    this.lastActiveZone = activeZone;

    let dist = center;
    let label = centerObj ? centerObj.label : (center <= 3.6 ? 'عائق' : 'مسار سالك');
    let hitX = centerObj ? centerObj.cx : 0.5;
    let hitY = centerObj ? centerObj.cy : zInfo.hitY.center;
    let conf = centerObj ? centerObj.score : zInfo.conf;

    if (activeZone === 'left') {
      dist = left;
      label = leftObj ? leftObj.label : 'عائق';
      hitX = leftObj ? leftObj.cx : 0.22;
      hitY = leftObj ? leftObj.cy : zInfo.hitY.left;
    } else if (activeZone === 'right') {
      dist = right;
      label = rightObj ? rightObj.label : 'عائق';
      hitX = rightObj ? rightObj.cx : 0.78;
      hitY = rightObj ? rightObj.cy : zInfo.hitY.right;
    }

    const dirAr = activeZone === 'left' ? 'على يسارك' : activeZone === 'right' ? 'على يمينك' : 'أمامك';
    this.lastDist = Math.round((alpha * dist + (1 - alpha) * this.lastDist) * 10) / 10;

    let guidance = '';
    if (center < 0.85) {
      const alt = left > right + 0.4 && left > 1.6 ? ' · اتجه يساراً' : right > left + 0.4 && right > 1.6 ? ' · اتجه يميناً' : '';
      guidance = `توقف، ${centerObj ? centerObj.label : 'عائق'} قريب جداً أمامك${alt}`;
    } else if (center < 2.2) {
      const freeHint = right > left + 0.5 && right > 2.2 ? ' · اليمين سالك' : left > right + 0.5 && left > 2.2 ? ' · اليسار سالك' : '';
      guidance = `${centerObj ? centerObj.label : 'عائق'} أمامك على بعد ${formatDistanceAr(center)}${freeHint}`;
    } else if (left < 1.15) {
      guidance = `انتبه، ${leftObj ? leftObj.label : 'عائق'} على يسارك (${formatDistanceAr(left)})`;
    } else if (right < 1.15) {
      guidance = `انتبه، ${rightObj ? rightObj.label : 'عائق'} على يمينك (${formatDistanceAr(right)})`;
    } else if (left > 3.6 && center > 3.6 && right > 3.6) {
      // الهاتف عمودي: أقرب أرض تراها الكاميرا على ~2.2م؛ الإمالة للأسفل تكشف القريب
      guidance = this.hasGyro && this.pitch < 0.2
        ? 'المسار أمامك سالك · أمِل الهاتف للأسفل قليلاً لرصد العوائق القريبة'
        : 'المسار أمامك سالك';
    } else {
      guidance = `المسار مفتوح، أقرب حاجز ${dirAr} على بعد ${formatDistanceAr(dist)}`;
    }

    const out = {
      dist: this.lastDist,
      label,
      dir: activeZone,
      dirAr,
      guidance,
      isWall: !centerObj && center <= 3.6,
      conf,
      hitX,
      hitY,
      zones: { ...this.zones },
      dark: false,
      occluded: false,
      light: zInfo.light,
    };
    this.target = out;
    return out;
  }

  /**
   * مسافة شيء مكتشف:
   * - قاعدته ظاهرة: من موضع القاعدة على الأرض (الأدق).
   * - قاعدته مقطوعة بأسفل الصورة: الشيء أقرب من أقرب أرض تراها الكاميرا، فنقدّر من حجمه المعروف
   *   ولا نتجاوز مسافة أسفل الصورة (كان يقول 2.7م لشخص على متر).
   * - للأمان نأخذ الأقرب بين التقديرين حين يتوفر الاثنان.
   */
  _estimateObjectDist(rawName, bottomY, boxH) {
    const ground = this._calcDistFromRow(bottomY, boxH);
    const H = TYPICAL_HEIGHT_M[rawName];
    const size = H && boxH > 0.04 ? H / (boxH * 2 * Math.tan(this.vfov / 2)) : null;
    const clipped = bottomY >= 0.97;
    if (clipped) {
      const floorEdge = this._calcDistFromRow(1.0);
      const est = size != null ? Math.min(size, floorEdge) : floorEdge;
      return Math.min(4.8, Math.max(VERY_CLOSE_M, est));
    }
    const est = size != null ? Math.min(ground, size * 1.25) : ground;
    return Math.min(4.8, Math.max(VERY_CLOSE_M, est));
  }

  _calcDistFromRow(rowNorm, bboxHeightNorm = 0) {
    const angleDown = this.pitch + (rowNorm - 0.5) * this.vfov;
    if (angleDown <= 0.08) {
      if (bboxHeightNorm > 0.05) {
        const d = (1.1 * 0.8) / Math.max(0.08, bboxHeightNorm);
        return Math.min(4.8, Math.max(0.35, d));
      }
      return 3.6;
    }
    const groundDist = this.camHeight / Math.tan(angleDown);
    return Math.min(4.8, Math.max(0.3, groundDist));
  }

  _analyzeThreeZones(imgData) {
    const cw = imgData.width, ch = imgData.height;
    const data = imgData.data;
    const bandCols = {
      left: [Math.floor(cw * 0.14), Math.floor(cw * 0.22), Math.floor(cw * 0.30)],
      center: [Math.floor(cw * 0.42), Math.floor(cw * 0.50), Math.floor(cw * 0.58)],
      right: [Math.floor(cw * 0.70), Math.floor(cw * 0.78), Math.floor(cw * 0.86)],
    };

    const lumAt = (x, y) => {
      const i = (y * cw + x) * 4;
      return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    };

    // فحص الظلام التام (الهاتف في الجيب أو العدسة مغطاة) لمنع ضوضاء الحساس من توليد عوائق وهمية
    let lumSum = 0, lumCnt = 0;
    for (let y = 8; y < ch; y += 8) {
      for (let x = 8; x < cw; x += 8) {
        lumSum += lumAt(x, y);
        lumCnt++;
      }
    }
    const avgLum = lumCnt ? lumSum / lumCnt : 0;
    const light = Math.round(avgLum);
    if (avgLum < 12) {
      return {
        zones: { left: 4.5, center: 4.5, right: 4.5 },
        hitY: { left: 0.5, center: 0.5, right: 0.5 },
        conf: 0,
        dark: true,
        light,
      };
    }

    const occluded = isFrameOccluded(frameCoverageStats(imgData));

    const zones = {};
    const hitY = {};
    let bestConf = 0.55;

    for (const [k, xs] of Object.entries(bandCols)) {
      let maxGrad = 0;
      let baseRow = Math.floor(ch * 0.36);
      let foundNearEdge = false;
      let nearPeakGrad = 0;
      let nearPeakRow = baseRow;

      // المسح من أسفل الإطار (الأقرب لقدمي المستخدم) صعوداً للأفق لالتقاط قاعدة أقرب عائق على الأرض
      // دون أن تطغى الحافة العلوية لنفس العائق وتجعل المسافة تبدو أبعد مما هي عليه
      for (let y = ch - 6; y >= Math.floor(ch * 0.22); y -= 2) {
        let gSum = 0;
        for (const x of xs) {
          gSum += Math.abs(lumAt(x, y) - lumAt(x, y - 4));
        }
        const gAvg = gSum / xs.length;

        if (!foundNearEdge) {
          if (gAvg >= 28) {
            foundNearEdge = true;
            nearPeakGrad = gAvg;
            nearPeakRow = y;
          } else if (gAvg > 14 && gAvg > maxGrad) {
            maxGrad = gAvg;
            baseRow = y;
          }
        } else if (nearPeakRow - y <= 8) {
          if (gAvg > nearPeakGrad) {
            nearPeakGrad = gAvg;
            nearPeakRow = y;
          }
        } else {
          break;
        }
      }

      if (foundNearEdge) {
        maxGrad = nearPeakGrad;
        baseRow = nearPeakRow;
      }
      const rowNorm = baseRow / ch;
      // لا حافة إطلاقاً = لا دليل على عائق: مسار سالك (كان يُرجع 3.6م «جدار» وهمي)
      zones[k] = maxGrad === 0 ? CLEAR_M : this._calcDistFromRow(rowNorm);
      hitY[k] = rowNorm;
      if (maxGrad > 25) bestConf = 0.82;
    }

    return { zones, hitY, conf: bestConf, dark: false, occluded, light };
  }
}
