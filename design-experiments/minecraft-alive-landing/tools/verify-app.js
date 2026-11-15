/* Verify the voxel style integration on the dockerized app (127.0.0.1:3000).
   Minecraft is the default style; the run exercises switching both ways. */
const path = require('path');
const os = require('os');
const { chromium } = require(path.join(
  __dirname, '..', '..', '..', 'node_modules', 'playwright-core',
));

const EXE = path.join(
  os.homedir(),
  '.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell',
);
const BASE = 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, '..', 'shots', 'app-integration');
const ARGS = [
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--autoplay-policy=no-user-gesture-required',
];
const STYLE_BTN = 'button[aria-label="اختر نمط الواجهة"]';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ARGS });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  // ── 1. Default style: Minecraft voxel world ──
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  const state = await page.evaluate(() => ({
    voxel: document.documentElement.classList.contains('voxel-style'),
    canvasVisible: (() => {
      const c = document.querySelector('.voxel-world-canvas');
      return c ? getComputedStyle(c).display !== 'none' : false;
    })(),
    video: (() => {
      const v = document.querySelector('video');
      return v ? { ready: v.readyState, t: +v.currentTime.toFixed(1) } : null;
    })(),
  }));
  console.log('default state:', JSON.stringify(state));
  await page.screenshot({ path: path.join(OUT, '01-voxel-default-home.png') });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(OUT, '02-voxel-home-later.png') });

  // ── 2. Every popover trigger on the homepage (skills, learner, materials,
  //      curriculum picker, …) — each opens over the voxel world ──
  const triggers = page.locator('[aria-haspopup="dialog"]');
  const n = await triggers.count();
  console.log('popover triggers:', n);
  for (let i = 0; i < Math.min(n, 6); i++) {
    const t = triggers.nth(i);
    try {
      await t.click({ timeout: 5000 });
      await page.waitForTimeout(1300);
      await page.screenshot({ path: path.join(OUT, `03-popover-${i}.png`) });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(350);
    } catch (e) {
      console.log(`trigger ${i} skipped:`, e.message.split('\n')[0]);
    }
  }

  // ── 3. Switch to Aurora (current design must be intact) ──
  await page.click(STYLE_BTN);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '04-style-dropdown.png') });
  await page.click('text=أورورا');
  await page.waitForTimeout(2500);
  const aurora = await page.evaluate(
    () => !document.documentElement.classList.contains('voxel-style'),
  );
  console.log('switched to aurora:', aurora);
  await page.screenshot({ path: path.join(OUT, '05-aurora-home.png') });

  // ── 4. Back to Minecraft + persistence across reload ──
  await page.click(STYLE_BTN);
  await page.waitForTimeout(400);
  await page.click('text=ماينكرافت');
  await page.waitForTimeout(3000);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(4000);
  const persisted = await page.evaluate(
    () => document.documentElement.classList.contains('voxel-style'),
  );
  console.log('voxel persisted after reload:', persisted);
  await page.screenshot({ path: path.join(OUT, '06-voxel-home-reload.png') });

  // ── 5. Generation flow: the world runs behind the generation preview ──
  await page.goto(BASE + '/generation-preview?run=verify-voxel', { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(OUT, '07-voxel-generation.png') });

  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
