/* Record a motion video of the alive voxel landing page (WebM). */
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
  page.on('pageerror', e => console.log('[pageerror]', e.message));

  await page.goto('http://127.0.0.1:4747/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 15000 });
  await page.waitForTimeout(15000);        // intro + alive world (shooting stars fire 1.2–6s, then every 6–10s)
  await page.evaluate(() => document.getElementById('board').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(11000);        // leaderboard life: XP ticks, bubble-up swaps, ticker rotation
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await page.waitForTimeout(3000);
  await ctx.close();                        // flushes the video file
  const files = fs.readdirSync(OUT).filter(f => f.endsWith('.webm'));
  console.log('videos:', files.map(f => `${f} (${(fs.statSync(path.join(OUT, f)).size / 1024 / 1024).toFixed(1)} MB)`));
})().catch(e => { console.error('FAIL', e); process.exit(1); });
