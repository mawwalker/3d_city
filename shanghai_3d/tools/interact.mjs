// Drives the player with real key events: walks along a street, into a wall, jumps, switches to flight and back.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:8766/?pos=1748,1.8,-520&look=186,0&mode=walk&hour=15', { waitUntil: 'load' });
await page.evaluate(async () => window.__app.settle(60000));
const pose = () => page.evaluate(() => ({ ...window.__app.player.getPose(), ground: window.__app.player.onGround }));
const hold = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(200); };
const out = {};
out.start = await pose();
await hold('KeyW', 3000); out.walked = await pose();
await page.keyboard.down('ShiftLeft'); await hold('KeyW', 2000); await page.keyboard.up('ShiftLeft'); out.ran = await pose();
// turn towards the buildings (west) and push into the wall
await page.evaluate(() => { window.__app.player.yaw = -Math.PI / 2; });
await hold('KeyW', 6000); out.wall = await pose();
await hold('KeyW', 1500); out.wall2 = await pose();
await page.keyboard.press('Space'); await page.waitForTimeout(250); out.jump = await pose(); await page.waitForTimeout(900); out.landed = await pose();
await page.keyboard.press('KeyF'); await hold('Space', 2000); out.fly = await pose();
await page.keyboard.press('KeyF'); await page.waitForTimeout(3500); out.back = await pose();
console.log(JSON.stringify(out, null, 0).replace(/},/g, '},\n'));
if (logs.length) console.log([...new Set(logs)].slice(0, 10).join('\n'));
await browser.close();
