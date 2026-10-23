// عين — عامل خدمة بسيط: يخزّن واجهة التطبيق ليعمل بلا إنترنت بعد أول زيارة.
const VERSION = 'ain-v11';
const SHELL = ['./', 'index.html', 'css/style.css', 'manifest.webmanifest', 'data/starter.json', 'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/ui.js', 'js/store.js', 'js/engine.js', 'js/camera.js', 'js/speech.js', 'js/arabic.js', 'js/features.js', 'js/classifier.js', 'js/pairmodel.js', 'js/motion.js', 'js/handModel.js', 'js/calibrate.js', 'js/alphabet.js',
  'js/hand3d.js', 'js/anims.js', 'js/learn.js', 'js/recorder.js', 'js/commands.js', 'js/names.js', 'js/pcexport.js', 'js/course_data.js',
  'js/views/translate.js', 'js/views/listen.js', 'js/views/learn.js', 'js/views/dict.js', 'js/views/commands.js', 'js/views/course.js'];
const HEAVY = /(cdn\.jsdelivr\.net\/npm\/@mediapipe|storage\.googleapis\.com\/mediapipe-models|\/vendor\/)/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (same && !HEAVY.test(req.url)) {
    // الشبكة أولاً ثم النسخة المخزَّنة (يحصل المطوّر على آخر نسخة، ويعمل بلا إنترنت)
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); return r; }).catch(() => caches.match(req).then((m) => m || caches.match('index.html'))));
  } else if (HEAVY.test(req.url)) {
    // ملفات MediaPipe الثقيلة: من المخزن أولاً
    e.respondWith(caches.match(req).then((m) => m || fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); } return r; })));
  }
});
