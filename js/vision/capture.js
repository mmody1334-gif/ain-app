// الخطوة 1 (Ain-06): التقاط الكاميرا + MediaPipe HandLandmarker (GPU مع سقوط تلقائي لـ CPU) + رسم هيكل اليد الأخضر فقط.
// بلا PoseLandmarker، بلا GestureRecognizer، وبلا فحوص HEAD متسلسلة.

const CDN_VER = '0.10.14';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${CDN_VER}`;
const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const TIPS = new Set([4, 8, 12, 16, 20]);

export function isMobileDevice(
  ua = (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
  maxTouchPoints = (typeof navigator !== 'undefined' ? (navigator.maxTouchPoints || 0) : 0),
) {
  if (/Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua || '')) return true;
  if (/Macintosh/i.test(ua || '') && maxTouchPoints > 1) return true;
  return false;
}

export function shouldAutoFallbackToCpu({
  backend,
  mobile,
  manualBackend = false,
  everSawHandOnGpu = false,
  elapsedMs = 0,
  emptyFrames = 0,
  slowFrames = 0,
}) {
  if (backend !== 'GPU' || manualBackend) return false;
  if (mobile && !everSawHandOnGpu && elapsedMs >= 2200 && emptyFrames >= 12) return true;
  if (slowFrames >= 8) return true;
  return false;
}

async function loadVisionModule() {
  // تحميل مباشر من CDN (ومخزّن في Service Worker بعد أول زيارة) دون فحوص HEAD متسلسلة
  const mod = await import(`${CDN_BASE}/vision_bundle.mjs`);
  const fileset = await mod.FilesetResolver.forVisionTasks(`${CDN_BASE}/wasm`);
  return { mod, fileset };
}

async function createHandLandmarker(HandLandmarker, fileset, delegate) {
  const localModel = new URL('vendor/hand_landmarker.task', document.baseURI).href;
  const opts = (modelAssetPath) => ({
    baseOptions: { modelAssetPath, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.35,
    minHandPresenceConfidence: 0.35,
    minTrackingConfidence: 0.35,
  });
  try {
    return await HandLandmarker.createFromOptions(fileset, opts(localModel));
  } catch (_) {
    return await HandLandmarker.createFromOptions(fileset, opts(MODEL_CDN));
  }
}

export class VisionCapture {
  constructor(videoEl, overlayEl, opt = {}) {
    this.video = videoEl;
    this.overlay = overlayEl;
    this.ctx = overlayEl.getContext('2d');
    this.facing = opt.facing || 'user';
    this.fit = opt.fit || 'contain'; // 'contain' يمنع قصّ اليدين على أطراف شاشة الهاتف الطولية
    this.preferredBackend = opt.backend || 'GPU';
    this.scanMode = opt.scanMode || 'hands'; // 'hands' | 'radar'
    this.onFrame = opt.onFrame || (() => {});
    this.onStatus = opt.onStatus || (() => {});
    this.transformHands = opt.transformHands || null; // للخطوة 2: One Euro

    this.stream = null;
    this.landmarker = null;
    this.fileset = null;
    this.HandLandmarker = null;
    this.backend = '';
    this.running = false;
    this.fps = 0;
    this.detectMs = 0;
    this.aspect = 4 / 3;

    this._gen = 0;
    this._lastTs = 0;
    this._frameReady = true;
    this._lastDetect = 0;
    this._frames = 0;
    this._fpsT = 0;
    this._switching = false;
    this.isMobile = opt.isMobile ?? isMobileDevice();
    this._manualBackend = false;
    this._gpuStartMs = 0;
    this._everSawHandOnGpu = false;
    this._emptyGpuFrames = 0;
    this._slowGpuFrames = 0;
  }

  setMirror(mirrored) {
    const tf = mirrored ? 'scaleX(-1)' : 'none';
    this.video.style.transform = tf;
    this.overlay.style.transform = this.scanMode === 'radar' ? 'none' : tf;
  }

  async setScanMode(mode) {
    const next = mode === 'radar' ? 'radar' : 'hands';
    if (this.scanMode === next) return;
    this.scanMode = next;
    if (next === 'hands' && this.running && !this.landmarker) {
      await this.initDetector();
    }
    this.setMirror(this.facing === 'user');
    if (this.ctx && this.overlay) {
      this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    }
  }

  async initDetector() {
    if (this.landmarker) return;
    this.onStatus('تحميل HandLandmarker…');
    const { mod, fileset } = await loadVisionModule();
    this.fileset = fileset;
    this.HandLandmarker = mod.HandLandmarker;

    const order = this.preferredBackend === 'CPU' ? ['CPU', 'GPU'] : ['GPU', 'CPU'];
    for (const delegate of order) {
      try {
        this.landmarker = await createHandLandmarker(this.HandLandmarker, fileset, delegate);
        this.backend = delegate;
        if (this.preferredBackend === 'GPU' && delegate === 'CPU') {
          this.onStatus('تعذّر GPU — تم التحويل التلقائي إلى CPU');
        }
        return;
      } catch (_) {
        // السقوط التلقائي إلى CPU عند تعذر GPU
      }
    }
    throw new Error('hand-landmarker-init-failed');
  }

  async setBackend(next, opt = {}) {
    this.preferredBackend = next === 'CPU' ? 'CPU' : 'GPU';
    this._manualBackend = opt.manual !== false;
    const wasRunning = this.running;
    this.stop();
    try { this.landmarker?.close(); } catch (_) {}
    this.landmarker = null;
    this.backend = '';
    if (wasRunning) await this.start(this.facing);
  }

  async _fallbackToCpu() {
    if (this.backend === 'CPU' || this._switching || !this.HandLandmarker || !this.fileset) return;
    this._switching = true;
    try {
      try { this.landmarker?.close(); } catch (_) {}
      this.landmarker = await createHandLandmarker(this.HandLandmarker, this.fileset, 'CPU');
      this.backend = 'CPU';
      this._lastTs = 0;
      this.onStatus('تم التحويل التلقائي إلى CPU');
    } finally {
      this._switching = false;
    }
  }

  async start(facing = this.facing) {
    if (this.running) return true;
    this.facing = facing;
    if (this.scanMode === 'hands') {
      await this.initDetector();
    }
    this.onStatus('تشغيل الكاميرا…');

    const constraints = {
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (_) {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    this.video.srcObject = this.stream;
    await this.video.play();
    await new Promise((r) => {
      if (this.video.videoWidth) r();
      else this.video.onloadedmetadata = () => r();
    });

    this.aspect = this.video.videoWidth / Math.max(1, this.video.videoHeight);
    this.setMirror(facing === 'user');
    this.running = true;
    this._fpsT = performance.now();
    this._frames = 0;
    this._lastTs = 0;
    this._gpuStartMs = this._fpsT;
    this._everSawHandOnGpu = false;
    this._emptyGpuFrames = 0;
    this._slowGpuFrames = 0;
    this.onStatus(`يعمل (${this.scanMode === 'radar' ? 'رادار' : this.backend})`);
    this._loop();
    return true;
  }

  stop() {
    this.running = false;
    this._gen++;
    if (this.stream) {
      this.stream.getTracks().forEach((tr) => tr.stop());
      this.stream = null;
    }
    try { this.video.srcObject = null; } catch (_) {}
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  async flip() {
    const next = this.facing === 'user' ? 'environment' : 'user';
    this.stop();
    return this.start(next);
  }

  _loop() {
    const gen = ++this._gen;
    const hasRvfc = typeof this.video.requestVideoFrameCallback === 'function';
    this._frameReady = true;
    this._lastDetect = 0;

    if (hasRvfc) {
      const cb = () => {
        if (!this.running || gen !== this._gen) return;
        this._frameReady = true;
        this.video.requestVideoFrameCallback(cb);
      };
      this.video.requestVideoFrameCallback(cb);
    }

    const step = () => {
      if (!this.running || gen !== this._gen) return;
      const now = performance.now();
      const fresh = this.video.readyState >= 2 && !this._switching &&
        (hasRvfc ? (this._frameReady || now - this._lastDetect > 150) : now - this._lastDetect >= 30);

      if (!fresh) {
        requestAnimationFrame(step);
        return;
      }

      this._frameReady = false;
      this._lastDetect = now;
      const tSec = now / 1000;

      if (this.scanMode === 'radar') {
        this._frames++;
        if (now - this._fpsT >= 1000) {
          this.fps = Math.round((this._frames * 1000) / (now - this._fpsT));
          this._frames = 0;
          this._fpsT = now;
        }
        const cv = this.overlay;
        const w = cv.clientWidth || 320;
        const h = cv.clientHeight || 240;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
          cv.width = Math.round(w * dpr);
          cv.height = Math.round(h * dpr);
        }
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.onFrame({
          t: tSec,
          nowMs: now,
          hands: [],
          fps: this.fps,
          detectMs: 0,
          backend: 'RADAR',
          aspect: this.aspect,
          mirrored: this.facing === 'user',
          scanMode: 'radar',
          cssW: w,
          cssH: h,
        });
        requestAnimationFrame(step);
        return;
      }

      let hands = [];
      const ts = Math.max(this._lastTs + 1, Math.round(now));
      this._lastTs = ts;
      const t0 = performance.now();
      try {
        const res = this.landmarker.detectForVideo(this.video, ts);
        if (res?.landmarks?.length) {
          const handed = res.handednesses || res.handedness;
          hands = res.landmarks.map((lm, i) => ({
            lm,
            hand: handed?.[i]?.[0]?.categoryName || null,
            score: handed?.[i]?.[0]?.score || 0,
          }));
        }
      } catch (_) {
        this._fallbackToCpu();
      }
      const dtDet = performance.now() - t0;
      this.detectMs = this.detectMs ? +(0.8 * this.detectMs + 0.2 * dtDet).toFixed(1) : +dtDet.toFixed(1);

      if (this.backend === 'GPU' && !this._switching) {
        if (hands.length > 0) {
          this._everSawHandOnGpu = true;
          this._emptyGpuFrames = 0;
        } else {
          this._emptyGpuFrames++;
        }
        this._slowGpuFrames = dtDet > 220 ? this._slowGpuFrames + 1 : 0;
        if (shouldAutoFallbackToCpu({
          backend: this.backend,
          mobile: this.isMobile,
          manualBackend: this._manualBackend,
          everSawHandOnGpu: this._everSawHandOnGpu,
          elapsedMs: now - this._gpuStartMs,
          emptyFrames: this._emptyGpuFrames,
          slowFrames: this._slowGpuFrames,
        })) {
          this._fallbackToCpu();
        }
      }

      if (this.transformHands && hands.length) {
        hands = this.transformHands(hands, tSec);
      }

      this._frames++;
      if (now - this._fpsT >= 1000) {
        this.fps = Math.round((this._frames * 1000) / (now - this._fpsT));
        this._frames = 0;
        this._fpsT = now;
      }

      this._drawSkeleton(hands);
      this.onFrame({
        t: tSec,
        hands,
        fps: this.fps,
        detectMs: this.detectMs,
        backend: this.backend,
        aspect: this.aspect,
        mirrored: this.facing === 'user',
      });

      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  }

  _drawSkeleton(hands) {
    const cv = this.overlay;
    const ctx = this.ctx;
    const w = cv.clientWidth || 320;
    const h = cv.clientHeight || 240;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!hands.length) return;

    const va = this.aspect;
    const ca = w / h;
    let sx = w, sy = h, ox = 0, oy = 0;
    if (this.fit === 'cover') {
      if (va > ca) { sx = h * va; ox = (w - sx) / 2; }
      else { sy = w / va; oy = (h - sy) / 2; }
    } else {
      if (va > ca) { sy = w / va; oy = (h - sy) / 2; }
      else { sx = h * va; ox = (w - sx) / 2; }
    }
    const X = (p) => ox + p.x * sx;
    const Y = (p) => oy + p.y * sy;

    hands.forEach((item, idx) => {
      const lm = item.lm;
      const stroke = idx === 0 ? '#3ccb8e' : '#8d89ff';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo(X(lm[a]), Y(lm[a]));
        ctx.lineTo(X(lm[b]), Y(lm[b]));
      }
      ctx.stroke();

      for (let i = 0; i < lm.length; i++) {
        ctx.beginPath();
        ctx.arc(X(lm[i]), Y(lm[i]), TIPS.has(i) ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = TIPS.has(i) ? '#ffffff' : stroke;
        ctx.fill();
      }
    });
  }
}
