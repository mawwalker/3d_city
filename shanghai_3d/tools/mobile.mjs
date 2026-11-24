// Phone smoke test: an emulated handset (touch, small portrait and landscape screens, mobile user agent -> the "low" tier).
//   node mobile.mjs ["query"]      writes ../shots/mobile_portrait.png and mobile_landscape.png
import { chromium, devices } from 'playwright-core';
const q = process.argv[2] || 'pos=1752,1.7,-433&look=20,-3&mode=walk&hour=15';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu'] });
for (const [name, dev] of [['portrait', devices['iPhone 13']], ['landscape', devices['iPhone 13 landscape']]]) {
  const ctx = await browser.newContext({ ...dev });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push('[error] ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message.slice(0, 300)));
  await page.goto('http://127.0.0.1:8766/?' + q, { waitUntil: 'load' });
  await page.evaluate(async () => window.__app.settle(90000));
  const before = await page.evaluate(() => window.__app.player.getPose());
  // left half of the screen: the walking stick; right half: look
  const vp = page.viewportSize(), cdp = await ctx.newCDPSession(page);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const sx = vp.width * 0.22, sy = vp.height * 0.72, lx = vp.width * 0.75, ly = vp.height * 0.5;
  await touch('touchStart', [[sx, sy], [lx, ly]]);
  for (let k = 1; k <= 12; k++) { await touch('touchMove', [[sx, sy - k * 5], [lx + k * 6, ly]]); await page.waitForTimeout(120); }
  await page.waitForTimeout(600);
  await touch('touchEnd', []);
  const after = await page.evaluate(() => window.__app.player.getPose());
  const info = await page.evaluate(() => { const a = window.__app; return { quality: a.quality.name, size: [innerWidth, innerHeight, devicePixelRatio], bench: a.bench(40), people: a.people ? a.people.shown : 0, cars: a.traffic ? a.traffic.count : 0 }; });
  await page.screenshot({ path: `../shots/mobile_${name}.png` });
  console.log(JSON.stringify({ name, info, moved: +Math.hypot(after.x - before.x, after.z - before.z).toFixed(1), turned: +(after.yaw - before.yaw).toFixed(1), logs: [...new Set(logs)].slice(0, 5) }));
  await ctx.close();
}
await browser.close();
