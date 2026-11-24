---
name: cf-workers-deploy
description: قواعد النشر وإعدادات Cloudflare Workers والخدمة الخلفية في «عين». يُستخدم عند أي تعديل يمس wrangler.jsonc أو sw.js أو _headers أو deploy_all.bat أو sync-worker/.
---

# نشر Cloudflare Workers في «عين»

## معمارية النشر
- التطبيق منشور عبر **Workerَين منفصلين**:
  1. **`ain`** (`wrangler.jsonc` في الجذر): يخدم مجلد `_deploy` كأصول ثابتة (`assets.directory = "./_deploy"`).
  2. **`ain-chat`** (`sync-worker/`): Worker للغرف الفورية مع Durable Object باسم `Room` (تخزين SQLite، وترحيلات `new_sqlite_classes` في `sync-worker/wrangler.jsonc`).
- النشر يتم يدوياً من جهاز المستخدم عبر `deploy_all.bat`:
  - ينفّذ `git pull` ثم يبني `_deploy` عبر `robocopy` (باستثناء `.git`, `_deploy`, `sync-worker`, `pc`, `demo`, `android`, `.github`, `node_modules`, `.wrangler`, `videos`, `scratch` وملفات `*.bat`, `*.md`, `wrangler.jsonc`, `netlify.toml`, `.gitignore`).
  - أي ملف أصول أو كود جديد يجب أن يقع ضمن قواعد النسخ في `deploy_all.bat` حتى يُنشر.
- `wrangler.jsonc` لا يثبّت `account_id` (يعتمد على حساب `wrangler` المسجّل على الجهاز).

## قواعد Service Worker والأمان
- عند أي تحديث للواجهة أو ملفات `js/`:
  1. أضف أي ملف `js/` جديد إلى مصفوفة `SHELL` في `sw.js`.
  2. ارفع رقم `VERSION` في `sw.js` (حالياً `ain-v33`) حتى تتجدد النسخة على هواتف المستخدمين.
- راقب حدود الخطة المجانية لـ Cloudflare Workers / Durable Objects (الإسبات WebSocket Hibernation مفعّل في `Room` لتقليل الاستهلاك).
- تنبيه للمستخدم في كل تسليم: التعديلات تحتاج `git pull` ثم `deploy_all.bat` من جهازه لتظهر على `ain.ain-app.workers.dev`.
