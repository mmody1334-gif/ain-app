---
name: ain-project-map
description: خريطة بنية مشروع «عين» (ain-app) وقواعد النشر والتعديل. يُستخدم دائماً قبل أي تعديل على المستودع.
---

# بنية مشروع «عين» (`ain-app`)

## قواعد أساسية
- المشروع **Vanilla JS ES Modules** بلا خطوة بناء (no build step). لا تضف أدوات بناء مثل Webpack أو Vite إلا بطلب صريح من المستخدم.
- **النشر يدوي من جهاز المستخدم**: `git pull` ثم تشغيل `deploy_all.bat` (يبني `_deploy` عبر `robocopy` ثم ينشر worker `ain` ثم worker `ain-chat` من `sync-worker/`). أي تعديل لا يصل للموقع المنشور إلا بعد أن ينشره المستخدم من جهازه — **اذكر ذلك في كل خطة تسليم**.
- `wrangler.jsonc` لا يثبّت `account_id`؛ النشر يذهب لحساب Cloudflare المسجّل في `wrangler` على جهاز المستخدم.
- **Service Worker (`sw.js`)**: بعد أي تعديل على ملفات الواجهة أو المنطق، يجب رفع `VERSION` في `sw.js` (حالياً `ain-v33`) والتأكد من وجود أي ملف `js/` جديد داخل قائمة `SHELL`، وإلا بقيت النسخة القديمة مخزنة على هواتف المستخدمين.
- **التخزين المحلي**: بيانات المستخدم والإشارات محفوظة في **IndexedDB** (`signbridge` عبر `js/store.js`) وليس `localStorage`.
- **اللغة**: كل التقارير والشرح للمستخدم بالعربية. الكود وتعليقاته تبقى بأسلوبها الحالي (عربي/إنجليزي حسب الملف).

## خريطة الملفات الأساسية
- خط أنابيب الرؤية والتعرّف: `js/camera.js` ← `js/smooth.js` ← `js/motion.js` ← `js/engine.js` ← `js/classifier.js` / `js/pairmodel.js` / `js/features.js` / `js/fingerpose.js`.
- الشاشات العشر (`js/views/`): `translate.js`, `ray.js`, `listen.js`, `course.js`, `learn.js`, `streak.js`, `dict.js`, `commands.js`, `namesign.js`, `room.js`.
- الرادار والعمق: `js/depth.js` + `js/views/ray.js`.
- النطق والتعرّف على الكلام: `js/speech.js`.
- البيانات المبدئية: `data/starter.json` (25 إشارة: 3 ثابتة + 22 جاهزة بيد واحدة).
- خادم الغرف: `sync-worker/src/index.js` (Cloudflare Worker + Durable Object `Room`).

## ملاحظة ترخيص مهمة
أي مشروع خارجي بلا ملف `LICENSE` وبلا كود مصدري منشور يُعامَل كـ «كل الحقوق محفوظة»: نستلهم منه الأفكار العامة فقط (قاموس صغير متباعد، اثبت-لحظة-قبل-التنفيذ، قفل محور) ولا يُنسخ منه أي كود أو ملفات.
