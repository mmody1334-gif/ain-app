// محرك عمق وشعاع حذيفة (Hudhaifa Sonar Ray)
// يحسب المسافة المترية للجدران والعوائق أمام الكفيف باستخدام كاميرا الهاتف وزاوية الميلان

export const AR_LABELS = {
  person: 'شخص',
  chair: 'كرسي',
  couch: 'أريكة',
  bed: 'سرير',
  'dining table': 'طاولة',
  table: 'طاولة',
  tv: 'شاشة',
  door: 'باب',
  laptop: 'حاسوب',
  cell_phone: 'هاتف',
  bottle: 'قارورة',
  cup: 'كوب',
  backpack: 'حقيبة',
  handbag: 'حقيبة',
  suitcase: 'حقيبة سفر',
  wall: 'جدار',
  floor: 'أرضية',
  obstacle: 'عائق',
};

export function formatDistanceAr(d) {
  if (d == null || !Number.isFinite(d)) return '';
  if (d < 0.5) return 'أقل من نصف متر';
  if (d < 0.8) return 'نصف متر تقريباً';
  if (d < 1.3) return 'متر واحد';
  if (d < 1.8) return 'متر ونصف';
  if (d < 2.3) return 'متران';
  if (d < 2.8) return 'متران ونصف';
  if (d < 3.3) return 'ثلاثة أمتار';
  if (d < 4.0) return 'ثلاثة أمتار ونصف';
  return 'أكثر من أربعة أمتار';
}

export class RayEngine {
  constructor(opt = {}) {
    this.camHeight = opt.camHeight ?? 1.30; // ارتفاع الهاتف عن الأرض (بالمتر) في يد الكفيف
    this.vfov = (opt.vfovDeg ?? 60) * (Math.PI / 180); // زاوية الرؤية الرأسية للكاميرا
    this.pitch = 0.15; // زاوية ميل الهاتف للأمام (طبيعة الإمساك باليد مائلاً قليلاً للأمام ~8.5 درجات)
    this.roll = 0;
    this.heading = 0;
    this.hasGyro = false;

    // كانفاس التحليل السريع منخفض الدقة (للحفاظ على سلاسة 30 إطار/ثانية وبلا تسخين للهاتف)
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (this.canvas) {
      this.canvas.width = 120;
      this.canvas.height = 160;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    } else {
      this.ctx = null;
    }

    this.lastDist = 2.0;
    this.target = null; // { label, dist, conf, x, y, isWall }
    this._onOrientation = this._handleOrientation.bind(this);
    this._detector = null;
    this._detectorLoading = false;
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
    // beta: إمالة للأمام/الخلف (-180 إلى 180 درجة). 90° = هاتف عمودي في اليد.
    // ميل خفيف للأمام يعني beta أصغر من 90 (مثلاً 75°).
    const deg = 85 - e.beta; // زاوية الميل للأسفل بالدرجات
    this.pitch = Math.max(-0.4, Math.min(0.7, deg * (Math.PI / 180)));
    this.roll = (e.gamma || 0) * (Math.PI / 180);
    this.heading = (e.alpha || 0) * (Math.PI / 180);
  }

  /** تحميل كاشف الأجسام من MediaPipe عند توفر الإنترنت، ويعمل بدون تعليق إن لم يتوفر */
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
        scoreThreshold: 0.35,
        maxResults: 4,
      });
    } catch (_) {
      this._detector = null;
    } finally {
      this._detectorLoading = false;
    }
  }

  /**
   * يحلل إطار الفيديو ويُطلق الشعاع نحو المركز
   */
  process(video, timestamp = performance.now()) {
    if (!video || !video.videoWidth || !this.ctx) {
      return { dist: this.lastDist, label: 'مسار سالك', isWall: false, conf: 0, hitX: 0.5, hitY: 0.5 };
    }

    const vw = video.videoWidth, vh = video.videoHeight;
    const cw = this.canvas.width, ch = this.canvas.height;
    this.ctx.drawImage(video, 0, 0, cw, ch);

    let objTarget = null;

    if (this._detector) {
      try {
        const res = this._detector.detectForVideo(video, Math.round(timestamp));
        if (res && res.detections && res.detections.length) {
          let bestDistToCenter = Infinity;
          for (const det of res.detections) {
            const bb = det.boundingBox;
            const cx = (bb.originX + bb.width / 2) / vw;
            const cy = (bb.originY + bb.height / 2) / vh;
            const dCenter = Math.hypot(cx - 0.5, cy - 0.5);
            if (dCenter < 0.35 && dCenter < bestDistToCenter) {
              bestDistToCenter = dCenter;
              const cat = det.categories[0];
              const rawName = cat?.categoryName?.toLowerCase() || 'obstacle';
              const arName = AR_LABELS[rawName] || rawName;
              const bottomY = Math.min(1.0, (bb.originY + bb.height) / vh);
              const estDist = this._calcDistFromRow(bottomY, bb.height / vh);
              objTarget = {
                dist: estDist,
                label: arName,
                isWall: false,
                conf: cat?.score || 0.5,
                hitX: cx,
                hitY: cy,
              };
            }
          }
        }
      } catch (_) {}
    }

    const imgData = this.ctx.getImageData(0, 0, cw, ch);
    const wallTarget = this._analyzeRayFloorWall(imgData);

    let finalTarget = objTarget;
    if (!finalTarget || (wallTarget.isWall && wallTarget.dist < finalTarget.dist - 0.4)) {
      finalTarget = wallTarget;
    }

    const alpha = 0.35;
    this.lastDist = alpha * finalTarget.dist + (1 - alpha) * this.lastDist;
    finalTarget.dist = Math.round(this.lastDist * 10) / 10;
    this.target = finalTarget;
    return finalTarget;
  }

  /** حساب المسافة المترية من رقم السطر الرأسي وزاوية الكاميرا */
  _calcDistFromRow(rowNorm, bboxHeightNorm = 0) {
    // زاوية الميل للأسفل باتجاه الأرض (0.5 في المنتصف = أفق الكاميرا، 1.0 أسفل الإطار = أقدام المستخدم)
    const angleDown = this.pitch + (rowNorm - 0.5) * this.vfov;

    if (angleDown <= 0.08) {
      // الشعاع يرتفع عن الأرض أو موازٍ لها (يتجه مباشرة للجدار المقابل)
      if (bboxHeightNorm > 0.05) {
        const d = (1.1 * 0.8) / Math.max(0.08, bboxHeightNorm);
        return Math.min(5.0, Math.max(0.4, d));
      }
      return 3.5;
    }

    const groundDist = this.camHeight / Math.tan(angleDown);
    return Math.min(5.0, Math.max(0.3, groundDist));
  }

  /**
   * يحلل العمود المركزي للكانفاس (شعاع الليزر) لاكتشاف التقاء الأرضية بالجدار
   */
  _analyzeRayFloorWall(imgData) {
    const cw = imgData.width, ch = imgData.height;
    const data = imgData.data;
    const midX = Math.floor(cw / 2);

    let maxGrad = 0;
    let baseRow = Math.floor(ch * 0.75);

    for (let y = ch - 5; y >= Math.floor(ch * 0.25); y -= 2) {
      let lumCur = 0, lumNext = 0;
      for (let dx = -4; dx <= 4; dx += 2) {
        const i1 = (y * cw + (midX + dx)) * 4;
        const i2 = ((y - 4) * cw + (midX + dx)) * 4;
        lumCur += data[i1] * 0.299 + data[i1 + 1] * 0.587 + data[i1 + 2] * 0.114;
        lumNext += data[i2] * 0.299 + data[i2 + 1] * 0.587 + data[i2 + 2] * 0.114;
      }
      const grad = Math.abs(lumCur - lumNext);
      if (grad > maxGrad && grad > 35) {
        maxGrad = grad;
        baseRow = y;
      }
    }

    const rowNorm = baseRow / ch;
    const dist = this._calcDistFromRow(rowNorm);
    const isWall = dist <= 4.0;
    const label = isWall ? 'جدار' : 'مسار سالك';

    return {
      dist,
      label,
      isWall,
      conf: maxGrad > 60 ? 0.85 : 0.6,
      hitX: 0.5,
      hitY: rowNorm,
    };
  }
}
