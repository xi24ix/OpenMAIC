/* Capture review screenshots across desktop / iPad / mobile, day & night phases. */
const path = require('path');
const os = require('os');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'playwright-core'));

const EXE = path.join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell');
const OUT = path.join(__dirname, '..', 'shots');
const ARGS = ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-device-scale-factor=1'];

const VIEWPORTS = [
  { name: 'desktop',       w: 1600, h: 900,  phases: true },
  { name: 'ipad-land',     w: 1024, h: 768,  phases: false },
  { name: 'ipad-port',     w: 820,  h: 1180, phases: false },
  { name: 'mobile',        w: 390,  h: 844,  phases: true },
];

async function seekVideo(page, t) {
  await page.evaluate(tt => {
    const v = document.querySelector('video');
    if (v) v.currentTime = tt;
  }, t);
  await page.waitForTimeout(500);
}

(async () => {
  for (const vp of VIEWPORTS) {
    const browser = await chromium.launch({
      executablePath: EXE, headless: true, args: ARGS,
    });
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    page.on('pageerror', e => console.log(`[${vp.name}][pageerror]`, e.message));
    page.on('console', m => { if (m.type() === 'error') console.log(`[${vp.name}][console]`, m.text()); });

    await page.goto('http://127.0.0.1:4747/', { waitUntil: 'load' });
    await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 20000 });
    await page.waitForTimeout(2600); // intro settles

    const videoOk = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v ? { ready: v.readyState, w: v.videoWidth, t: +v.currentTime.toFixed(2) } : null;
    });
    console.log(`[${vp.name}] video:`, JSON.stringify(videoOk));

    if (vp.phases) {
      await seekVideo(page, 2.0);
      await page.screenshot({ path: path.join(OUT, `${vp.name}-hero-bright.png`) });
      await seekVideo(page, 13.0);
      await page.screenshot({ path: path.join(OUT, `${vp.name}-hero-dark.png`) });
    } else {
      await seekVideo(page, 13.0);
      await page.screenshot({ path: path.join(OUT, `${vp.name}-hero.png`) });
    }

    // leaderboard
    const board = page.locator('.board-section');
    await board.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
    await seekVideo(page, 13.0);
    await board.screenshot({ path: path.join(OUT, `${vp.name}-board.png`) });

    // full page
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(700);
    await seekVideo(page, 13.0);
    await page.screenshot({ path: path.join(OUT, `${vp.name}-full.png`), fullPage: true });

    await browser.close();
    console.log(`[${vp.name}] done`);
  }
  console.log('ALL CAPTURED');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
