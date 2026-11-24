// فحص سهولة الوصول (axe-core) لكل شاشات التطبيق في متصفح حقيقي، فاتح وداكن.
// التشغيل: npm i --no-save playwright axe-core && npx playwright install chromium && node tests/a11y-check.browser.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const ROOT = path.resolve('.');
const TABS = ['translate', 'ray', 'listen', 'course', 'learn', 'streak', 'dict', 'commands', 'namesign', 'room'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.task': 'application/octet-stream', '.wasm': 'application/wasm' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
let total = 0;
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, colorScheme: scheme });
  for (const tab of TABS) {
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html#${tab}`);
    await page.waitForTimeout(3500);
    await page.addScriptTag({ content: AXE });
    const res = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }));
    for (const v of res.violations) {
      total += v.nodes.length;
      console.log(`✗ [${scheme}] ${tab}: ${v.id} (${v.impact}) ×${v.nodes.length} — ${v.help}`);
      for (const n of v.nodes.slice(0, 2)) console.log('    ', n.target.join(' '));
    }
    await page.close();
  }
  await ctx.close();
}
await browser.close();
server.close();
console.log(total ? `\n${total} accessibility problem(s)` : '✓ accessibility: 0 problems on all screens (light + dark)');
process.exit(total ? 1 : 0);
