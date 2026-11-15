/* Record a short hero-only clip to capture shooting stars in the sky band. */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'playwright-core'));
const EXE = path.join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell');
const OUT = path.join(__dirname, '..', 'shots');

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--hide-scrollbars'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: { dir: OUT, size: { width: 1600, height: 900 } },
  });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4747/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 15000 });
  await page.waitForTimeout(14000);
  await ctx.close();
  await browser.close();
  const files = fs.readdirSync(OUT).filter(f => f.endsWith('.webm') && f !== 'demo.webm');
  console.log('video:', files.map(f => `${f} (${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0)} KB)`));
})().catch(e => { console.error('FAIL', e); process.exit(1); });
