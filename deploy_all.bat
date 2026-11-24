@echo off
chcp 65001 >nul
rem نشر موقع «عين» وخادم الغرف على Cloudflare بأمر واحد (يحتاج Node.js وتسجيل دخول wrangler مرة واحدة)
cd /d "%~dp0"
rem --ff-only: يرفض الدمج التلقائي لو اختلف التاريخ (حماية بعد تنظيف تاريخ الريبو)
git pull --ff-only
if errorlevel 1 (
  echo تعذّر التحديث: التاريخ المحلي مختلف عن GitHub. لم يتم النشر.
  pause
  exit /b 1
)
if exist _deploy rmdir /s /q _deploy
mkdir _deploy
robocopy . _deploy /E /XD .git _deploy _private_web sync-worker pc demo android android-native .github .agents tests node_modules .wrangler videos scratch /XF *.bat *.md wrangler.jsonc netlify.toml .gitignore >nul
rem ملفات للموقع فقط ولا تُرفع على GitHub (مثل البانر بالأسماء الكاملة) توضع في _private_web بنفس المسارات
if exist _private_web robocopy _private_web _deploy /E >nul
echo ===== نشر الموقع =====
call npx wrangler deploy
echo ===== نشر خادم الغرف =====
cd sync-worker
call npx wrangler deploy
cd ..
echo تم.
pause
