---
name: mediapipe-vision-web
description: قواعد العمل مع MediaPipe Tasks Vision على الويب في «عين». يُستخدم عند أي عمل على camera.js أو motion.js أو engine.js أو features.js أو depth.js.
---

# رؤية MediaPipe على الويب في «عين»

## قواعد الكشف والأداء
- `GestureRecognizer.recognizeForVideo` و`HandLandmarker.detectForVideo` و`PoseLandmarker.detectForVideo` استدعاءات **متزامنة وحاجبة** على الخيط الرئيسي داخل `requestAnimationFrame`.
- عند نقل الكشف إلى **Web Worker** أو تفعيل **GPU delegate**، حافظ دائماً على مسار السقوط التلقائي إلى `CPU` (`fallbackToCpu`) لتفادي تعطل هواتف WebGL الضعيفة.
- انتبه للفروق بين `runningMode: 'VIDEO'` و`'IMAGE'`: في وضع `'VIDEO'` يجب أن تتزايد الطوابع الزمنية (`timestamp`) **تزايداً صارماً** في كل استدعاء (انظر `lastTs = Math.max(lastTs + 1, Math.round(t * 1000))` في `js/camera.js`). أي طابع زمني مساوٍ أو أصغر يرمي استثناءً من MediaPipe.

## انعكاس كاميرا السيلفي
- `CameraHub.setMirror(facing === 'user')` يعكس الفيديو والـ overlay عبر **CSS `scaleX(-1)` فقط**.
- نقاط اليد `landmarks` وتسميات `handedness` (`Left`/`Right`) تبقى بمنظور الصورة الخام غير المعكوسة.
- أي منطق يعتمد على يمين/يسار (سواء تثبيت خانتي اليدين في `_trackHands` أو اتجاهات التمرير) يجب أن يعوّض هذا الانعكاس بوضوح.

## العمل بلا إنترنت والنماذج المحلية
- `vendor/` يحوي حالياً النماذج المحلية الثلاثة: `gesture_recognizer.task`، `hand_landmarker.task`، `pose_landmarker_lite.task`.
- `vendor/tasks-vision/vision_bundle.mjs` غير موجود محلياً حالياً، فيسقط التحميل إلى `cdn.jsdelivr.net` ويُخزَّن مؤقتاً عبر `HEAVY` في `sw.js`.
- دائماً فضّل الملفات المحلية في `vendor/` أولاً ثم CDN؛ لا تكسر العمل بلا إنترنت، وتجنّب فحوص `HEAD` المتسلسلة البطيئة عند البدء.
