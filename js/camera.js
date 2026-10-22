// الكاميرا + كاشف اليد (MediaPipe Hand Landmarker) + حلقة المعالجة.
// ترتيب تحميل MediaPipe: ملفات محلية في vendor/ إن وُجدت (تعمل بلا إنترنت)، وإلا من CDN.
// للاختبار: window.__SB_MOCK__ = { detect(t) → 21 نقطة | null } يستبدل الكاميرا والكاشف.

import { HAND_CONNECTIONS } from './features.js';

const CDN_VER = '0.10.14';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${CDN_VER}`;
const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const POSE_MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

async function exists(url) {
  try { const r = await fetch(url, { method: 'HEAD', cache: 'no-store' }); return r.ok; } catch (e) { return false; }
}

export async function loadDetector(onStatus = () => {}, pref = 'cpu') {
  const mock = typeof window !== 'undefined' && window.__SB_MOCK__;
  if (mock) return { mock: true, backend: 'mock', detect: (video, t) => mock.detect(t), detectPose: () => (mock.detectPose ? mock.detectPose() : null) };
  let mod, wasmBase, modelUrl;
  const localOk = await exists('vendor/tasks-vision/vision_bundle.mjs');
  if (localOk) {
    onStatus('تحميل المحرّك من الجهاز…');
    mod = await import(new URL('vendor/tasks-vision/vision_bundle.mjs', document.baseURI).href);
    wasmBase = new URL('vendor/tasks-vision/wasm', document.baseURI).href;
  } else {
    onStatus('تحميل المحرّك من الإنترنت…');
    mod = await import(`${CDN_BASE}/vision_bundle.mjs`);
    wasmBase = `${CDN_BASE}/wasm`;
  }
  modelUrl = (await exists('vendor/hand_landmarker.task')) ? new URL('vendor/hand_landmarker.task', document.baseURI).href : MODEL_CDN;
  const poseUrl = (await exists('vendor/pose_landmarker_lite.task')) ? new URL('vendor/pose_landmarker_lite.task', document.baseURI).href : POSE_MODEL_CDN;
  const { FilesetResolver, HandLandmarker, PoseLandmarker } = mod;
  const fileset = await FilesetResolver.forVisionTasks(wasmBase);
  const make = (delegate) => HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelUrl, delegate },
    runningMode: 'VIDEO', numHands: 2,
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  let hl = null, backend = '', lastErr = null;
  // الافتراضي: المعالج (CPU) لأنه الأكثر ثباتاً على الهواتف؛ كرت الشاشة اختياري من الإعدادات
  for (const d of (pref === 'gpu' ? ['GPU', 'CPU'] : ['CPU', 'GPU'])) {
    try { hl = await make(d); backend = d; break; } catch (e) { lastErr = e; }
  }
  if (!hl) throw lastErr || new Error('detector-init-failed');
  // نموذج وضعية الجسم (كتفان/أنف) لمعرفة موقع اليد بالنسبة للجسم. فشله لا يعطّل التطبيق.
  let pl = null;
  try {
    pl = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: poseUrl, delegate: 'CPU' },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
  } catch (e) { pl = null; }
  let lastTs = 0, lastPoseTs = 0;
  return {
    mock: false,
    get backend() { return backend; },
    get hasPose() { return !!pl; },
    detect(video, t) {
      const ts = Math.max(lastTs + 1, Math.round(t * 1000));
      lastTs = ts;
      const r = hl.detectForVideo(video, ts);
      if (!r || !r.landmarks || !r.landmarks.length) return null;
      return r.landmarks.map((lm, i) => ({
        lm,
        hand: r.handednesses?.[i]?.[0]?.categoryName || null,
        score: r.handednesses?.[i]?.[0]?.score || 0,
      }));
    },
    detectPose(video, t) {
      if (!pl) return null;
      const ts = Math.max(lastPoseTs + 1, Math.round(t * 1000));
      lastPoseTs = ts;
      const r = pl.detectForVideo(video, ts);
      return r && r.landmarks && r.landmarks[0] ? r.landmarks[0] : null;
    },
    async fallbackToCpu() {
      if (backend === 'CPU') return false;
      try { hl.close(); } catch (e) { /* لا شيء */ }
      hl = await make('CPU'); backend = 'CPU'; lastTs = 0;
      return true;
    },
  };
}

export class CameraHub {
  constructor(engine, els) {
    this.engine = engine;
    this.video = els.video; this.overlay = els.overlay;
    this.octx = this.overlay.getContext('2d');
    this.detector = null; this.stream = null;
    this.facing = 'user';
    this.listeners = new Set();
    this.running = false; this.fps = 0; this._lastVT = -1; this._frames = 0; this._fpsT = 0;
    this.showSkeleton = true;
    this.status = 'idle';          // idle | loading | running | error
    this.error = null;
    this.t0 = performance.now();
    this.aspect = 4 / 3;
    this.lastLm = null; this.lastOut = null; this.lastPose = null;
    this._mockT = 0;
    this.pref = 'cpu';
    this._gen = 0; this._frameReady = true; this._lastDetect = 0; this._switching = false;
    this.light = null; this._lightT = 0;
    this._lc = document.createElement('canvas'); this._lc.width = 32; this._lc.height = 32;
    this._lctx = this._lc.getContext('2d', { willReadFrequently: true });
    this.diag = { backend: '', frames: 0, hands: 0, pose: 0, errors: 0, lastError: '', rvfc: false, video: '', light: null };
  }

  onFrame(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  setMirror(m) { this.video.style.transform = m ? 'scaleX(-1)' : 'none'; this.overlay.style.transform = m ? 'scaleX(-1)' : 'none'; }

  async start(facing = this.facing, onStatus = () => {}) {
    if (this.running) return true;
    this.facing = facing; this.status = 'loading'; this.error = null;
    try {
      if (!this.detector) this.detector = await loadDetector(onStatus, this.pref);
      this.diag = { backend: this.detector.backend, frames: 0, hands: 0, pose: 0, errors: 0, lastError: '', rvfc: false, video: '', light: null };
      this.lastPose = null;
      if (!this.detector.mock) {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-camera-api');
        onStatus('تشغيل الكاميرا…');
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } }, audio: false,
        });
        this.video.srcObject = this.stream;
        await this.video.play();
        await new Promise((r) => { if (this.video.videoWidth) r(); else this.video.onloadedmetadata = () => r(); });
        this.aspect = this.video.videoWidth / this.video.videoHeight;
        this.diag.video = `${this.video.videoWidth}×${this.video.videoHeight}`;
      } else {
        this.aspect = 4 / 3;
      }
      this.setMirror(facing === 'user');
      this.running = true; this.status = 'running';
      this.engine.reset();
      this._loop();
      return true;
    } catch (e) {
      this.status = 'error'; this.error = e; this.running = false;
      return false;
    }
  }

  stop() {
    this.running = false; this.status = 'idle'; this._gen++;
    this.lastPose = null;
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    try { this.video.srcObject = null; } catch (e) { /* لا شيء */ }
    this.clearOverlay();
  }

  async flip() {
    const next = this.facing === 'user' ? 'environment' : 'user';
    this.stop();
    return this.start(next);
  }

  clearOverlay() { this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height); }

  _onDetectError(e) {
    this.diag.errors++;
    this.diag.lastError = String((e && (e.message || e.name)) || e).slice(0, 140);
    const d = this.detector;
    if (d && !d.mock && d.backend === 'GPU' && !this._switching && d.fallbackToCpu) {
      this._switching = true;
      d.fallbackToCpu().then(() => { this.diag.backend = d.backend; }).catch((err) => { this.diag.lastError = String(err && err.message || err).slice(0, 140); }).finally(() => { this._switching = false; });
    }
  }

  _loop() {
    const gen = ++this._gen;
    const hasRvfc = !this.detector.mock && typeof this.video.requestVideoFrameCallback === 'function';
    this.diag.rvfc = hasRvfc;
    this._frameReady = true; this._lastDetect = 0;
    if (hasRvfc) {
      // إطار جديد من الفيديو (لا نعتمد على currentTime لأنه قد يبقى ثابتاً في بعض الهواتف)
      const cb = () => { if (gen !== this._gen || !this.running) return; this._frameReady = true; this.video.requestVideoFrameCallback(cb); };
      this.video.requestVideoFrameCallback(cb);
    }
    const step = () => {
      if (!this.running || gen !== this._gen) return;
      const now = performance.now();
      const t = (now - this.t0) / 1000;
      let hands = null;
      if (this.detector.mock) {
        try { hands = this.detector.detect(null, t); } catch (e) { hands = null; }
      } else {
        const fresh = this.video.readyState >= 2 && !this._switching &&
          (hasRvfc ? (this._frameReady || now - this._lastDetect > 250) : now - this._lastDetect >= 30);
        if (!fresh) { requestAnimationFrame(step); return; }
        this._frameReady = false; this._lastDetect = now;
        try { hands = this.detector.detect(this.video, t); } catch (e) { hands = null; this._onDetectError(e); }
        this.diag.frames++;
        if (hands) this.diag.hands += hands[0]?.lm ? hands.length : 1;
      }
      this.lastLm = hands;
      let pose = this.lastPose;
      if (this.detector.detectPose && (this.detector.mock || this.diag.frames % 4 === 0)) {
        try { const p = this.detector.detectPose(this.video, t); if (p) { pose = p; this.lastPose = p; this.diag.pose++; } } catch (e) { /* لا شيء */ }
      }
      const out = this.engine.process(t, hands, this.aspect, pose);
      this.lastOut = out;
      this._frames++;
      if (now - this._fpsT > 1000) { this.fps = this._frames * 1000 / (now - this._fpsT); this._frames = 0; this._fpsT = now; }
      // إضاءة تقريبية كل 0.8 ثانية: تكفي لمؤشر «أضئ المكان» بلا تكلفة كبيرة
      if (!this.detector.mock && now - this._lightT > 800 && this.video.readyState >= 2) {
        this._lightT = now;
        try {
          this._lctx.drawImage(this.video, 0, 0, 32, 32);
          const d = this._lctx.getImageData(0, 0, 32, 32).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          this.light = sum / (d.length / 4);
          this.diag.light = Math.round(this.light);
        } catch (e) { /* لا شيء */ }
      }
      this._draw(hands, out);
      const primary = hands?.[0]?.lm || (Array.isArray(hands) && hands.length === 21 ? hands : null);
      for (const fn of this.listeners) { try { fn(out, primary, t); } catch (e) { console.error(e); } }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  _draw(hands, out) {
    const cv = this.overlay, ctx = this.octx;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * 2 || cv.height !== h * 2) { cv.width = w * 2; cv.height = h * 2; }
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const list = hands?.[0]?.lm ? hands : (Array.isArray(hands) && hands.length === 21 ? [{ lm: hands }] : []);
    if (!list.length || !this.showSkeleton) return;
    // الفيديو يُعرض بنمط cover: نحسب نفس التحويل
    const va = this.aspect, ca = w / h;
    let sx = w, sy = h, ox = 0, oy = 0;
    if (va > ca) { sx = h * va; ox = (w - sx) / 2; } else { sy = w / va; oy = (h - sy) / 2; }
    const X = (p) => ox + p.x * sx, Y = (p) => oy + p.y * sy;
    const ok = out && out.hold ? Math.min(1, out.hold.progress) : 0;
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    list.forEach((h, idx) => {
      const lm = h.lm;
      ctx.strokeStyle = ok > 0 ? `rgba(60,203,142,${0.55 + 0.4 * ok})` : idx ? 'rgba(140,150,255,0.75)' : 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) { ctx.moveTo(X(lm[a]), Y(lm[a])); ctx.lineTo(X(lm[b]), Y(lm[b])); }
      ctx.stroke();
      ctx.fillStyle = ok > 0 ? '#3ccb8e' : idx ? '#8f8cff' : '#ffffff';
      for (const p of lm) { ctx.beginPath(); ctx.arc(X(p), Y(p), 3.2, 0, 7); ctx.fill(); }
    });
  }
}
