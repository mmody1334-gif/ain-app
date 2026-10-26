@echo off
chcp 65001 >nul
rem نشر موقع «حذيفة» وخادم الغرف على Cloudflare بأمر واحد (يحتاج Node.js وتسجيل دخول wrangler مرة واحدة)
cd /d "%~dp0"
git pull
if exist _deploy rmdir /s /q _deploy
mkdir _deploy
robocopy . _deploy /E /XD .git _deploy sync-worker pc demo android .github node_modules .wrangler /XF *.bat *.md wrangler.jsonc netlify.toml .gitignore >nul
echo ===== نشر الموقع =====
call npx wrangler deploy
echo ===== نشر خادم الغرف =====
cd sync-worker
call npx wrangler deploy
cd ..
echo تم.
pause
