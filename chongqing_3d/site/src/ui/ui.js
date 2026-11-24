// Chongqing 3D Interface:
//   - Loading veil, mountain-city HUD (`重庆 · 山城全景`), mode/time/weather controls
//   - 1-9 curated Chongqing landmark teleports (洪崖洞, 解放碑, 来福士/朝天门, 千厮门大桥, 李子坝, 长江索道, 人民大礼堂, 重庆大剧院, 南山一棵树)
//   - Interactive mini-map & full map (with ASL + AGL altitude readout) and touch controls.

import { WEATHER } from '../engine/env.js';

const ASSET_URL = new URL('../../assets/', import.meta.url).href;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// Chongqing solar noon is ~12:55 UTC+8 (106.58°E)
const PRESETS = [
  ['清晨', 7.4],
  ['上午', 10.2],
  ['正午', 13.0],
  ['午后', 16.0],
  ['落日', 18.0],
  ['蓝调', 18.7],
  ['不夜城', 21.0],
];

// Curated 1-9 landmark fallbacks (overridden/merged with site/data/places.json)
const DEFAULT_PLACES = [
  { id: 'hongyadong', name: '洪崖洞', en: 'Hongyadong', x: 105.9, z: -482.1, y: 57.9 },
  { id: 'jiefangbei', name: '解放碑', en: 'Jiefangbei', x: 0.0, z: 0.0, y: 107.6 },
  { id: 'raffles', name: '来福士·朝天门', en: 'Raffles City / Chaotianmen', x: 981.2, z: -849.4, y: 40.6 },
  { id: 'qiansimen', name: '千厮门大桥', en: 'Qiansimen Bridge', x: 140.7, z: -987.0, y: 60.5 },
  { id: 'liziba', name: '李子坝轻轨穿楼', en: 'Liziba CRT Station', x: -3774.4, z: 379.3, y: 46.5 },
  { id: 'cableway', name: '长江索道', en: 'Yangtze Cableway', x: 560.0, z: -56.5, y: 112.0 },
  { id: 'great_hall', name: '人民大礼堂', en: 'Great Hall of the People', x: -2246.6, z: -472.4, y: 68.9 },
  { id: 'grand_theatre', name: '重庆大剧院', en: 'Grand Theatre', x: 403.4, z: -1399.9, y: 64.1 },
  { id: 'nanshan', name: '南山一棵树', en: 'Nanshan Viewpoint', x: 2472.1, z: 1347.0, y: 278.1 },
];

export class UI {
  constructor(app, root) {
    this.app = app; this.root = root;
    this.places = [];
    this.labels = [];
    root.innerHTML = '';

    // ---- loading veil
    this.veil = el('div', 'veil');
    this.veil.innerHTML = '<div class="veil-box"><div class="veil-title">重庆</div><div class="veil-sub">山城全景 · 正在铺开这座8D魔幻立体之都</div><div class="veil-bar"><i></i></div></div>';
    root.append(this.veil);

    // ---- title
    const head = el('div', 'head');
    head.addEventListener('click', () => document.body.classList.toggle('menu'));
    head.innerHTML = '<div class="seal">渝</div><div><div class="title">重庆 · 山城全景</div><div class="subtitle">可以走进去的三维8D山城</div></div>';
    root.append(head);

    // ---- right: mini-map
    const mapBox = el('div', 'minimap');
    this.mapCanvas = el('canvas'); this.mapCanvas.width = 220; this.mapCanvas.height = 220;
    mapBox.append(this.mapCanvas);
    this.coord = el('div', 'coord');
    mapBox.append(this.coord);
    root.append(mapBox);
    mapBox.addEventListener('click', () => this.toggleMap(true));

    // ---- full map
    this.bigMap = el('div', 'bigmap');
    this.bigCanvas = el('canvas');
    this.bigMap.append(this.bigCanvas, el('div', 'bigmap-hint', '点击地图任意位置前往 · Esc 关闭'));
    root.append(this.bigMap);
    this.bigMap.addEventListener('click', (e) => this._mapClick(e));

    // ---- bottom left: places
    this.placeBox = el('div', 'places');
    root.append(this.placeBox);
    this.setPlaces(DEFAULT_PLACES);

    // ---- bottom centre: time
    const time = el('div', 'timebox');
    this.clock = el('div', 'clock', '');
    this.slider = el('input'); this.slider.type = 'range'; this.slider.min = 0; this.slider.max = 24; this.slider.step = 0.05; this.slider.className = 'slider';
    this.slider.addEventListener('input', () => { app.animHour = null; app.env.setHour(+this.slider.value); });
    const presets = el('div', 'presets');
    for (const [name, h] of PRESETS) { const b = el('button', '', name); b.addEventListener('click', () => app.glideHour(h)); presets.append(b); }
    time.append(this.clock, this.slider, presets);
    root.append(time);

    // ---- bottom right: mode, weather, help
    const ctl = el('div', 'controls');
    const modes = el('div', 'row');
    this.btnWalk = el('button', '', '步行'); this.btnFly = el('button', '', '飞行');
    this.btnWalk.addEventListener('click', () => app.player.setMode('walk'));
    this.btnFly.addEventListener('click', () => app.player.setMode('fly'));
    modes.append(el('span', 'lbl', '模式'), this.btnWalk, this.btnFly);
    const wrow = el('div', 'row');
    wrow.append(el('span', 'lbl', '天气'));
    this.wbtn = {};
    for (const [k, w] of Object.entries(WEATHER)) {
      const b = el('button', '', w.label);
      b.addEventListener('click', () => { app.env.setWeather(k); this._syncWeather(k); });
      this.wbtn[k] = b; wrow.append(b);
    }
    const misc = el('div', 'row');
    const help = el('button', '', '操作说明'); help.addEventListener('click', () => this.toggleHelp());
    const hide = el('button', '', '隐藏界面'); hide.addEventListener('click', () => document.body.classList.toggle('bare'));
    misc.append(help, hide);
    ctl.append(modes, wrow, misc);
    root.append(ctl);

    // ---- help card + hint
    this.help = el('div', 'help');
    this.help.innerHTML = `<h3>怎么逛重庆</h3>
<p><b>点击画面</b> 锁定鼠标，移动鼠标环顾；<b>Esc</b> 释放。</p>
<p><b>W A S D</b> 移动 · <b>Shift</b> 加速 · <b>空格</b> 跳跃（步行）或上升（飞行）· <b>C / Q</b> 下降</p>
<p><b>F</b> 在步行与飞行之间切换 · <b>G</b> 落到脚下的坡地、步道或桥面 · <b>滚轮</b> 调节飞行速度 · <b>N</b> 穿墙</p>
<p><b>M</b> 打开全城地图，点哪儿去哪儿 · <b>H</b> 隐藏界面 · <b>1–9</b> 直达九大重庆地标</p>
<p class="dim">手机上：左半屏拖动行走，右半屏拖动环顾。</p>`;
    root.append(this.help);
    this.hint = el('div', 'hint', matchMedia('(pointer: coarse)').matches ? '左半屏拖动行走 · 右半屏拖动环顾' : '点击画面开始漫步山城');
    root.append(this.hint);
    this.cross = el('div', 'cross');
    root.append(this.cross);
    this.attr = el('div', 'attr', '3D City © mawwalker · © OpenStreetMap 贡献者 · Copernicus GLO-30 DEM · GlobalBuildingAtlas · Overture Maps · ambientCG / Poly Haven');
    root.append(this.attr);

    // ---- keys
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.toggleMap();
      else if (e.code === 'KeyH') document.body.classList.toggle('bare');
      else if (e.code === 'Escape') { this.toggleMap(false); this.help.classList.remove('on'); }
      else if (/^Digit[1-9]$/.test(e.code)) { const p = this.places[+e.code.slice(5) - 1]; if (p) this.goto(p); }
    });
    app.player.onModeChange = () => this._syncMode();
    app.player.onLock = (locked) => { document.body.classList.toggle('locked', locked); };
    this._syncMode(); this._syncWeather(app.env.weatherName);
    this._touch();

    this.mapImg = new Image();
    this.mapImg.src = ASSET_URL + 'map.jpg';
    fetch(ASSET_URL + 'map.json').then((r) => (r.ok ? r.json() : null)).then((m) => { if (m) this.mapMeta = m; }).catch(() => {});
    this._mapT = 0;
  }

  setPlaces(list) {
    if (!list || !list.length) return;
    this.places = list;
    this.placeBox.innerHTML = '';
    list.slice(0, 14).forEach((p, i) => {
      const b = el('button', '', p.name);
      b.title = (p.en || p.name) + (i < 9 ? `  (${i + 1})` : '');
      b.addEventListener('click', () => this.goto(p));
      this.placeBox.append(b);
    });
  }

  /** Floating aerial landmark labels with canonical dedup + priority + screen-space AABB collision culling. */
  setLabels(list) {
    if (!list || !list.length) return;
    if (!this.labelRoot) { this.labelRoot = el('div', 'labels'); this.root.prepend(this.labelRoot); }
    this.labelRoot.innerHTML = '';

    // Canonicalize alias variants so heroes & places.json never duplicate the same landmark
    const ALIAS = {
      '来福士广场': '来福士·朝天门',
      '重庆来福士': '来福士·朝天门',
      '重庆来福士广场': '来福士·朝天门',
      '朝天门广场': '来福士·朝天门',
      '千厮门嘉陵江大桥': '千厮门大桥',
      '东水门长江大桥': '东水门大桥',
      '朝天门长江大桥': '朝天门大桥',
      '菜园坝长江大桥': '菜园坝大桥',
      '石板坡长江大桥': '石板坡大桥',
      '黄花园嘉陵江大桥': '黄花园大桥',
      '渝澳嘉陵江大桥': '渝澳大桥',
      '嘉陵江大桥': '嘉陵江大桥',
      '陆海国际中心 (458m)': '陆海国际中心',
      '重庆环球金融中心 WFC': '环球金融中心',
      '重庆人民大礼堂': '人民大礼堂',
      '李子坝站': '李子坝轻轨穿楼',
      '李子坝轻轨站': '李子坝轻轨穿楼',
      '长江索道北站': '长江索道',
      '长江索道南站': '长江索道',
      '十八梯传统风貌区': '十八梯',
      '魁星楼 (22F悬空广场)': '魁星楼',
    };
    // Lower priority number = higher visual importance when competing for screen space
    const PRI = {
      '来福士·朝天门': 1, '洪崖洞': 1, '解放碑': 1, '千厮门大桥': 1, '重庆大剧院': 1,
      '东水门大桥': 2, '人民大礼堂': 2, '李子坝轻轨穿楼': 2, '长江索道': 2, '南山一棵树': 2, '朝天门大桥': 2, '陆海国际中心': 2,
      '国泰艺术中心': 3, '环球金融中心': 3, '白象居': 3, '魁星楼': 3, '十八梯': 3, '苏家坝立交': 3,
      '菜园坝大桥': 4, '石板坡大桥': 4, '观音桥': 4, '磁器口古镇': 4, '黄桷湾立交': 4,
    };
    const BOOST = {
      '来福士·朝天门': 380, '陆海国际中心': 485, '环球金融中心': 365,
      '千厮门大桥': 235, '东水门大桥': 210, '朝天门大桥': 245,
      '洪崖洞': 142, '解放碑': 178, '人民大礼堂': 158, '重庆大剧院': 145,
      '南山一棵树': 350, '李子坝轻轨穿楼': 125, '长江索道': 152, '白象居': 128,
    };

    const norm = [];
    for (const l of list) {
      if (!l || !l.name) continue;
      const rawName = String(l.name).trim();
      const name = ALIAS[rawName] || rawName;
      const pri = PRI[name] ?? 5;
      const y = BOOST[name] ?? ((l.y ?? 80) + 55);
      norm.push({ name, x: l.x, y, z: l.z, pri });
    }
    // Sort by priority first so iconic canonical names win spatial deduplication
    norm.sort((a, b) => a.pri - b.pri);

    const seenNames = new Set();
    const kept = [];
    for (const item of norm) {
      if (seenNames.has(item.name)) continue;
      // Spatial deduplication: never keep two labels within 260m horizontally
      let tooClose = false;
      for (const k of kept) {
        if (Math.hypot(item.x - k.x, item.z - k.z) < 260) { tooClose = true; break; }
      }
      if (tooClose) continue;
      seenNames.add(item.name);
      const e = el('div', 'label', item.name);
      e.style.display = 'none';
      this.labelRoot.append(e);
      kept.push({ ...item, e, on: false });
    }
    this.labels = kept;
  }

  mergeLabels(extra) {
    if (!extra || !extra.length) return;
    const base = this.labels.map(({ name, x, y, z }) => ({ name, x, y, z }));
    this.setLabels([...base, ...extra]);
  }

  updateLabels(camera) {
    if (!this.labels || !this.labels.length) return;
    const show = this.app.player.mode === 'fly' && !document.body.classList.contains('bare');
    if (!show) {
      for (const l of this.labels) if (l.on) { l.e.style.display = 'none'; l.on = false; }
      return;
    }
    const w = window.innerWidth, h = window.innerHeight;
    const m = camera.matrixWorldInverse.elements, pr = camera.projectionMatrix.elements;
    const cands = [];
    for (const l of this.labels) {
      const x = m[0] * l.x + m[4] * l.y + m[8] * l.z + m[12];
      const y = m[1] * l.x + m[5] * l.y + m[9] * l.z + m[13];
      const z = m[2] * l.x + m[6] * l.y + m[10] * l.z + m[14];
      const d = -z;
      if (d > 180 && d < 11500) {
        const sx = (x * pr[0] / d * 0.5 + 0.5) * w;
        const sy = (0.5 - y * pr[5] / d * 0.5) * h;
        // Stay clear of top-left title, top-right minimap, and bottom HUD bar
        if (sx > 90 && sx < w - 90 && sy > 88 && sy < h - 180 && !(sx > w - 270 && sy < 280) && !(sx < 340 && sy < 120)) {
          cands.push({ l, sx, sy, d });
        }
      }
    }
    // Iconic nearby landmarks win screen-space slots
    cands.sort((a, b) => (a.l.pri * 900 + a.d) - (b.l.pri * 900 + b.d));

    const boxes = [];
    // Reserve space for the center-bottom interaction hint pill while it is visible
    if (this.hint && !this.hint.classList.contains('off')) {
      boxes.push([w * 0.5 - 155, h * 0.56 - 28, w * 0.5 + 155, h * 0.56 + 40]);
    }

    const accepted = new Set();
    const MAX_VISIBLE = 8;
    for (const c of cands) {
      if (accepted.size >= MAX_VISIBLE) break;
      const bw = Math.max(82, c.l.name.length * 15 + 36);
      const bh = 38;
      const x0 = c.sx - bw * 0.5 - 14, x1 = c.sx + bw * 0.5 + 14;
      const y0 = c.sy - bh - 12, y1 = c.sy + 14;
      let hit = false;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) { hit = true; break; }
      }
      if (hit) continue;
      boxes.push([x0, y0, x1, y1]);
      accepted.add(c.l);
      c.l.e.style.transform = `translate(${c.sx.toFixed(1)}px, ${c.sy.toFixed(1)}px) translate(-50%, -100%)`;
      c.l.e.style.opacity = Math.min(0.95, (11500 - c.d) / 4000, (c.d - 180) / 280).toFixed(2);
      if (!c.l.on) { c.l.e.style.display = 'block'; c.l.on = true; }
    }
    for (const l of this.labels) {
      if (!accepted.has(l) && l.on) { l.e.style.display = 'none'; l.on = false; }
    }
  }

  goto(p) { this.app.gotoPlace(p); this.toggleMap(false); }
  toggleHelp() { this.help.classList.toggle('on'); }
  _syncMode() { const m = this.app.player.mode; this.btnWalk.classList.toggle('on', m === 'walk'); this.btnFly.classList.toggle('on', m === 'fly'); }
  _syncWeather(k) { for (const [n, b] of Object.entries(this.wbtn)) b.classList.toggle('on', n === k); }

  setProgress(p, done) {
    const bar = this.veil.querySelector('i');
    if (bar) bar.style.width = Math.round(Math.min(1, Math.max(0, p)) * 100) + '%';
    if (done) { this.veil.classList.add('gone'); setTimeout(() => this.veil.remove(), 1400); }
  }

  toggleMap(on) {
    const want = on === undefined ? !this.bigMap.classList.contains('on') : on;
    this.bigMap.classList.toggle('on', want);
    if (want) { document.exitPointerLock?.(); this._drawBig(); }
  }

  _drawBig() {
    const m = this.mapMeta; if (!m || !this.mapImg.complete || !this.mapImg.naturalWidth) return;
    const c = this.bigCanvas, W = Math.min(window.innerWidth - 40, 1500), H = Math.min(window.innerHeight - 90, W * m.h / m.w);
    const Wf = H * m.w / m.h;
    c.width = Math.round(Wf); c.height = Math.round(H);
    const g = c.getContext('2d');
    g.drawImage(this.mapImg, 0, 0, c.width, c.height);
    const s = c.width / (m.w * m.mpp);
    const p = this.app.player.pos;
    const px = (p.x - m.x0) * s, py = c.height - (-p.z - m.y0) * s;
    g.fillStyle = '#c8321e'; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.arc(px, py, 6, 0, 6.3); g.fill(); g.stroke();
    g.font = '13px serif'; g.textBaseline = 'middle';
    for (const pl of this.places) {
      const x = (pl.x - m.x0) * s, y = c.height - (-pl.z - m.y0) * s;
      g.fillStyle = 'rgba(26,22,18,.88)'; g.beginPath(); g.arc(x, y, 3.2, 0, 6.3); g.fill();
      g.strokeStyle = 'rgba(255,250,240,.85)'; g.lineWidth = 2.5; g.strokeText(pl.name, x + 6, y);
      g.fillText(pl.name, x + 6, y);
    }
    this._bigScale = s;
  }

  _mapClick(e) {
    if (e.target !== this.bigCanvas) { this.toggleMap(false); return; }
    const m = this.mapMeta; if (!m || !this._bigScale) return;
    const r = this.bigCanvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / this._bigScale + m.x0, n = (r.height - (e.clientY - r.top)) / this._bigScale + m.y0;
    this.app.gotoPoint(x, -n);
    this.toggleMap(false);
  }

  _touch() {
    const canvas = this.app.pipeline.renderer.domElement, pl = this.app.player;
    const stick = el('div', 'stick'); const knob = el('i'); stick.append(knob); this.root.append(stick);
    let moveId = null, lookId = null, m0 = null, l0 = null;
    canvas.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.42 && moveId === null) { moveId = t.identifier; m0 = [t.clientX, t.clientY]; stick.style.left = (t.clientX - 55) + 'px'; stick.style.top = (t.clientY - 55) + 'px'; stick.classList.add('on'); }
        else if (lookId === null) { lookId = t.identifier; l0 = [t.clientX, t.clientY]; }
      }
      this.hint.classList.add('off'); e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === moveId) { let dx = (t.clientX - m0[0]) / 50, dy = (t.clientY - m0[1]) / 50; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } pl.move.set(dx, -dy); knob.style.transform = `translate(${dx * 32}px, ${dy * 32}px)`; }
        else if (t.identifier === lookId) { pl._look((t.clientX - l0[0]) * 1.6, (t.clientY - l0[1]) * 1.6); l0 = [t.clientX, t.clientY]; }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) { if (t.identifier === moveId) { moveId = null; pl.move.set(0, 0); stick.classList.remove('on'); knob.style.transform = ''; } if (t.identifier === lookId) lookId = null; } };
    canvas.addEventListener('touchend', end); canvas.addEventListener('touchcancel', end);
  }

  update(dt) {
    const app = this.app, env = app.env, p = app.player;
    const h = env.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    this.clock.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    if (document.activeElement !== this.slider) this.slider.value = h;
    this.hint.classList.toggle('off', p.locked || app.frames > 60 * 30);

    this._mapT += dt;
    if (this._mapT > 0.12) {
      this._mapT = 0;
      const groundY = app.terrain ? app.terrain.surfaceY(p.pos.x, p.pos.z) : 0;
      const agl = Math.max(0, Math.round(p.pos.y - groundY));
      const asl = Math.round(p.pos.y + (app.terrain?.datumAsl ?? 168));
      this.coord.textContent = p.mode === 'walk'
        ? `步行 · 海拔 ${asl} m`
        : `飞行 · 距地 ${agl} m · 海拔 ${asl} m · ${Math.round(p.flySpeed * 3.6)} km/h`;

      if (this.mapMeta && this.mapImg.complete && this.mapImg.naturalWidth) {
        const m = this.mapMeta, c = this.mapCanvas, g = c.getContext('2d');
        const span = Math.min(7000, Math.max(800, 600 + agl * 4.5));
        const sx = (p.pos.x - m.x0) / m.mpp, sy = m.h - (-p.pos.z - m.y0) / m.mpp, sw = span / m.mpp;
        g.fillStyle = '#dcd8d0'; g.fillRect(0, 0, c.width, c.height);
        g.imageSmoothingQuality = 'high';
        g.drawImage(this.mapImg, sx - sw / 2, sy - sw / 2, sw, sw, 0, 0, c.width, c.height);
        g.save(); g.translate(c.width / 2, c.height / 2); g.rotate(p.yaw);
        g.fillStyle = 'rgba(200,50,30,.22)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 70, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); g.closePath(); g.fill();
        g.fillStyle = '#c8321e'; g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3.5); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke();
        g.restore();
      }
    }
  }
}
