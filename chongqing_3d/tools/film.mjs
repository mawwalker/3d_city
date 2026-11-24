// Deterministic frame-by-frame cinema recorder for Chongqing 3D.
//
// Stops the page's own rAF loop and steps `window.__app.tick(1 / fps)` deterministically
// so the output is 100% immune to frame-rate jitter and every moving landmark (Liziba CRT
// Line 2 monorail, Yangtze Cableway cabins, Two-Rivers cruise ships, traffic, pedestrians,
// rain streaks) hits its exact choreographed mark.
//
// Usage (from chongqing_3d/tools/):
//   node film.mjs --url http://127.0.0.1:8771/ --stills 3 [--only s01,s05]
//   node film.mjs --url http://127.0.0.1:8771/ --enc nvenc [--only s01] [--w 1920 --h 1080 --fps 30]
//   node film.mjs --url http://127.0.0.1:8771/ --cover ../video/cover_raw.png

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const args = argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const W = +arg('w', 1920);
const H = +arg('h', 1080);
const FPS = +arg('fps', 30);
const SUB = +arg('sub', 2);
const outDir = resolve(__dirname, arg('out', '../video/clips'));
const stillsDir = resolve(__dirname, arg('stills-dir', '../shots/film_stills'));
const stills = +arg('stills', 0);
const only = arg('only') ? arg('only').split(',').map((s) => s.trim()).filter(Boolean) : null;
const coverOut = arg('cover', null);
const encMode = arg('enc', 'nvenc');
const shotsPath = resolve(__dirname, arg('shots', 'film/shots.mjs'));
const { shots } = await import(pathToFileURL(shotsPath).href);

if (stills) mkdirSync(stillsDir, { recursive: true });
else if (!coverOut) mkdirSync(outDir, { recursive: true });

const executablePath = existsSync('/usr/bin/chromium')
  ? '/usr/bin/chromium'
  : existsSync('/usr/bin/google-chrome')
    ? '/usr/bin/google-chrome'
    : undefined;

const browser = await chromium.launch({
  executablePath,
  headless: true,
  env: {
    ...process.env,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || '/tmp/cq-chrome-cfg',
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || '/tmp/cq-chrome-cache',
  },
  args: [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-gpu',
    '--enable-webgl',
    '--use-gl=angle',
    '--use-angle=vulkan',
    '--enable-features=Vulkan',
    '--disable-dev-shm-usage',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
});

const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/DevTools|ReadPixels/.test(t)) logs.push(t);
});
page.on('pageerror', (e) => logs.push('[pageerror] ' + (e.stack || e.message)));

const matchShot = (s) => !only || only.some((pat) => s.name === pat || s.name.includes(pat));
const first = shots.find(matchShot) || shots[0];
const c0 = first.cam(0, 0);
const baseUrl = arg('url', 'http://127.0.0.1:8771/');
const initY = c0.agl ? 140 : c0.p[1];
await page.goto(`${baseUrl}?ui=0&q=${arg('q', 'ultra')}&pos=${c0.p[0]},${initY},${c0.p[2]}&hour=${c0.hour ?? 16}&mode=fly`, {
  waitUntil: 'load',
  timeout: 120000,
});
await page.evaluate(async () => { await window.__app.settle(120000); });

await page.evaluate(({ range }) => {
  const a = window.__app;
  a.frame = () => {}; // Halt live rAF loop: deterministic external stepping only.
  document.body.classList.add('bare');
  const st = document.createElement('style');
  st.textContent = '#ui, .labels, .label { display: none !important; }';
  document.head.append(st);

  if (range && a.city) {
    a.city.NEAR *= range;
    a.city.MID *= range;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const setWeather = (name, now) => {
    if (!name) return;
    if (a.env.weatherName === name && !now) return;
    a.env.setWeather(name);
    if (now && a.env.weatherTarget) {
      Object.assign(a.env.weather, a.env.weatherTarget);
      a.env.weatherTarget = null;
      a.env._dirty = true;
    }
  };

  // Smooth ground height sampling (5-point small kernel avoids stair-step curb bumps on street dollies).
  const groundAt = (x, z) => {
    const t = a.terrain;
    const base = t ? t.surfaceY(x, z) : 0;
    const c = a.collision;
    let s = base;
    if (c && typeof c.surfaceBelow === 'function') {
      const d = c.surfaceBelow(x, z, base + 14);
      if (Number.isFinite(d) && d > base - 2 && d < base + 14) s = Math.max(base, d);
    }
    return s;
  };

  const smoothGround = (x, z) => {
    const r = 1.6;
    return (
      groundAt(x, z) * 0.40 +
      groundAt(x + r, z) * 0.15 +
      groundAt(x - r, z) * 0.15 +
      groundAt(x, z + r) * 0.15 +
      groundAt(x, z - r) * 0.15
    );
  };

  // Cableway span horizontal basis (North -> South from landmarks.json)
  const cabUx = 0.87772, cabUz = 0.47919;
  const cabRx = -cabUz, cabRz = cabUx; // right of span (SW toward Baixiangju/Yangtze)

  const resolvePose = (s) => {
    let px = s.p[0], py = s.p[1], pz = s.p[2];
    let tx = s.t ? s.t[0] : px, ty = s.t ? s.t[1] : py, tz = s.t ? s.t[2] : pz - 100;

    if (s.track === 'cableway0') {
      // Ensure animated hero mesh is updated for current a.time before reading its world position
      if (a.landmarks && a.landmarks.loaded) a.landmarks.update(0, a.time, a.env, a.camera);
      const cabin = a.scenes?.opaque?.getObjectByName('cableway-cabin-0');
      if (cabin) {
        const cx = cabin.position.x;
        const cy = cabin.position.y - 5.8; // center of hanging red/cream cabin body below bogie pivot
        const cz = cabin.position.z;
        const off = s.trackOffset || [20, 5, 36];
        const lo = s.trackLookOffset || [0, -1, 0];
        px = cx + cabUx * off[0] + cabRx * off[2];
        py = cy + off[1];
        pz = cz + cabUz * off[0] + cabRz * off[2];
        tx = cx + cabUx * lo[0] + cabRx * lo[2];
        ty = cy + lo[1];
        tz = cz + cabUz * lo[0] + cabRz * lo[2];
      }
    } else {
      if (s.agl !== undefined && s.agl !== null) {
        py = smoothGround(px, pz) + s.agl;
      }
      if (s.t && s.tAgl !== undefined && s.tAgl !== null) {
        ty = smoothGround(tx, tz) + s.tAgl;
      }
    }

    const p = a.player;
    p.setMode('fly');
    let yaw = s.yaw, pitch = s.pitch;
    if (s.t || s.track) {
      const dx = tx - px, dy = ty - py, dz = tz - pz;
      yaw = (Math.atan2(dx, -dz) * 180) / Math.PI;
      pitch = (Math.atan2(dy, Math.hypot(dx, dz) || 1) * 180) / Math.PI;
    }
    p.setPose(px, py, pz, yaw, pitch);
    if (s.fov) {
      p.fovBase = s.fov;
      p.fov = s.fov;
    }
    if (s.hour !== undefined) a.env.setHour(s.hour);
    if (s.weather) setWeather(s.weather, false);
  };

  const calm = async (limit) => {
    let waited = 0;
    while (a.city && a.city.busy && waited < limit) {
      await wait(12);
      waited += 12;
      a.tick(1e-4);
    }
    if (waited) {
      for (let i = 0; i < 3; i++) a.tick(1e-4);
    }
    return waited;
  };

  window.__film = {
    async begin(s, pre, tTarget) {
      if (s.weather) setWeather(s.weather, true);
      else setWeather('clear', true);
      // Set app.time so that after `pre` seconds of warmup, a.time lands cleanly on tTarget!
      if (tTarget !== undefined && tTarget !== null) {
        a.time = tTarget - pre;
      }
      resolvePose(s);
      a.pipeline.historyValid = false;
      for (let i = 0; i < 4; i++) { a.tick(1e-4); await wait(25); }
      await calm(60000);
      const steps = Math.max(0, Math.round(pre * 10));
      for (let i = 0; i < steps; i++) {
        a.tick(0.1);
        if (s.track) resolvePose(s);
        if (i % 40 === 39) await wait(0);
      }
      if (tTarget !== undefined && tTarget !== null) a.time = tTarget;
      resolvePose(s);
      await calm(20000);
      a.pipeline.historyValid = false;
      // Settle TAA & auto-exposure cleanly without advancing simulation clock
      for (let i = 0; i < 16; i++) {
        resolvePose(s);
        a.tick(1e-4);
      }
      if (tTarget !== undefined && tTarget !== null) a.time = tTarget;
      return a.stats();
    },

    async frame(s, dt, sub, q, tExact) {
      if (tExact !== undefined && tExact !== null) {
        // Keep exact sync for preview stills
        a.time = tExact;
        resolvePose(s);
        for (let i = 0; i < 12; i++) { resolvePose(s); a.tick(1e-4); }
        a.time = tExact;
      } else {
        for (let i = 0; i < sub; i++) {
          resolvePose(s);
          a.tick(dt / sub);
        }
      }
      const waited = await calm(15000);
      return { waited, jpg: a.renderer.domElement.toDataURL('image/jpeg', q).slice(23) };
    },

    async snapPng(s, pre, tTarget) {
      await this.begin(s, pre, tTarget);
      return a.renderer.domElement.toDataURL('image/png').slice(22);
    },
  };
}, { range: +arg('range', 0) });

// Special single ultra-crisp PNG capture mode for the Chongqing 3D cover poster!
if (coverOut) {
  const coverPose = {
    // Iconic golden-twilight panoramic showcase: Hongyadong golden glow + Qiansimen Bridge +
    // Yuzhong 8D skyline + Raffles City 8 sails & Crystal + Two-Rivers confluence!
    p: [535, 195, -1380],
    t: [420, 128, -560],
    fov: 45,
    hour: 18.65,
    weather: 'clear',
  };
  const customJson = arg('cover-pose', null);
  const poseObj = customJson ? JSON.parse(customJson) : coverPose;
  const pngB64 = await page.evaluate(([s, pre, t0]) => window.__film.snapPng(s, pre, t0), [poseObj, 14, 18.0]);
  const outPath = resolve(__dirname, coverOut);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(pngB64, 'base64'));
  console.log(`cover saved -> ${outPath} (${W}x${H})`);
  await browser.close();
  process.exit(0);
}

const t00 = Date.now();
for (const shot of shots) {
  if (!matchShot(shot)) continue;
  const N = shot.frames;
  const f0 = +arg('from-frame', 0);
  const f1 = Math.min(N, f0 + +arg('frames', N));
  const list = stills
    ? Array.from({ length: stills }, (_, k) => Math.round((k * (N - 1)) / Math.max(1, stills - 1)))
    : Array.from({ length: f1 - f0 }, (_, k) => f0 + k);
  const at = (f) => shot.cam(N > 1 ? f / (N - 1) : 0, f);
  const tStart = shot.t0 ?? 0;
  const t0 = Date.now();

  const preSec = stills ? Math.min(shot.pre ?? 14, 10) : (shot.pre ?? 16);
  const st = await page.evaluate(
    ([s, pre, tTarget]) => window.__film.begin(s, pre, tTarget),
    [at(list[0]), preSec, tStart + list[0] / FPS],
  );

  let ff = null;
  if (!stills) {
    const enc = encMode === 'nvenc'
      ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'constqp', '-qp', arg('qp', '15'), '-bf', '0']
      : ['-c:v', 'libx264', '-preset', 'medium', '-crf', arg('crf', '14')];
    ff = spawn(
      'ffmpeg',
      [
        '-y', '-loglevel', 'error',
        '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
        ...enc, '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        path.join(outDir, shot.name + '.mp4'),
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
  }

  let waitedTot = 0;
  let k = 0;
  for (const f of list) {
    const poseObj = at(f);
    const tExact = stills ? (tStart + f / FPS) : null;
    if (stills && k > 0) {
      await page.evaluate(
        ([s, tTarget]) => window.__film.begin(s, 3, tTarget),
        [poseObj, tExact],
      );
    }
    const r = await page.evaluate(
      ([s, dt, sub, q, te]) => window.__film.frame(s, dt, sub, q, te),
      [poseObj, 1 / FPS, SUB, stills ? 0.92 : 0.96, tExact],
    );
    waitedTot += r.waited;
    const buf = Buffer.from(r.jpg, 'base64');
    if (stills) {
      writeFileSync(path.join(stillsDir, `film_${shot.name}_${k}.jpg`), buf);
    } else if (!ff.stdin.write(buf)) {
      await new Promise((res) => ff.stdin.once('drain', res));
    }
    k++;
    if (!stills && k % 100 === 0) {
      console.log(`  ${shot.name}: ${k}/${list.length} frames (${((Date.now() - t0) / k).toFixed(0)} ms/f)`);
    }
  }
  if (ff) {
    ff.stdin.end();
    await new Promise((res) => ff.on('close', res));
  }
  console.log(
    `${shot.name}: ${list.length} ${stills ? 'stills' : 'frames'} in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
    `(${((Date.now() - t0) / list.length).toFixed(0)} ms/f; tiles wait ${(waitedTot / 1000).toFixed(1)}s; near=${st ? st.near : '?'})`,
  );
}

if (logs.length) console.log('page errors:', logs.slice(0, 8));
console.log(`done in ${((Date.now() - t00) / 1000).toFixed(1)}s`);
await browser.close();
