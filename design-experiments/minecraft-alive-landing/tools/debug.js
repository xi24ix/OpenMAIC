const path = require('path');
const os = require('os');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'playwright-core'));
const EXE = path.join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell');

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/chrome-libs/root/usr/lib/x86_64-linux-gnu' },
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text()); });
  await page.goto('http://127.0.0.1:4747/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 15000 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const line = document.getElementById('tickerLine');
    const win = document.querySelector('.ticker-window');
    const cs = getComputedStyle(line);
    const r = line.getBoundingClientRect(), wr = win.getBoundingClientRect();
    return {
      text: line.textContent,
      opacity: cs.opacity,
      transform: cs.transform,
      color: cs.color,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      whiteSpace: cs.whiteSpace,
      lineRect: { x: r.x, y: r.y, w: r.width, h: r.height },
      winRect: { x: wr.x, y: wr.y, w: wr.width, h: wr.height },
      inlineStart: cs.insetInlineStart || cs.right,
      dir: cs.direction,
      visibility: cs.visibility,
      zIndex: cs.zIndex,
    };
  });
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
