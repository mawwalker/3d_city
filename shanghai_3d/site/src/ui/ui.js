// Interface: loading veil, mode / time / weather controls, place list, mini-map + full map (teleport), touch controls.

import { WEATHER } from '../engine/env.js';

const ASSET_URL = new URL('../../assets/', import.meta.url).href;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const PRESETS = [['清晨', 6.4], ['上午', 9.5], ['正午', 12.0], ['午后', 15.5], ['黄昏', 16.9], ['蓝调', 17.6], ['入夜', 20.5]];

export class UI {
  constructor(app, root) {
    this.app = app; this.root = root;
    this.places = [];
    root.innerHTML = '';
    // ---- loading veil
    this.veil = el('div', 'veil');
    this.veil.innerHTML = '<div class="veil-box"><div class="veil-title">上海</div><div class="veil-sub">漫步全景 · 正在铺开这座城市</div><div class="veil-bar"><i></i></div></div>';
    root.append(this.veil);
    // ---- title
    const head = el('div', 'head');
    // small screens: the panels fold away; the seal and "菜单" bring them up
    head.addEventListener('click', () => document.body.classList.toggle('menu'));
    head.innerHTML = '<div class="seal">沪</div><div><div class="title">上海</div><div class="subtitle">可以走进去的三维城市</div></div>';
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
    for (const [k, w] of Object.entries(WEATHER)) { const b = el('button', '', w.label); b.addEventListener('click', () => { app.env.setWeather(k); this._syncWeather(k); }); this.wbtn[k] = b; wrow.append(b); }
    const misc = el('div', 'row');
    const help = el('button', '', '操作说明'); help.addEventListener('click', () => this.toggleHelp());
    const hide = el('button', '', '隐藏界面'); hide.addEventListener('click', () => document.body.classList.toggle('bare'));
    misc.append(help, hide);
    ctl.append(modes, wrow, misc);
    root.append(ctl);
    // ---- help card + hint
    this.help = el('div', 'help');
    this.help.innerHTML = `<h3>怎么逛</h3>
<p><b>点击画面</b> 锁定鼠标，移动鼠标环顾；<b>Esc</b> 释放。</p>
<p><b>W A S D</b> 移动 · <b>Shift</b> 加速 · <b>空格</b> 跳跃（步行）或上升（飞行）· <b>C / Q</b> 下降</p>
<p><b>F</b> 在步行与飞行之间切换 · <b>G</b> 落到脚下的地面或屋顶 · <b>滚轮</b> 调节飞行速度 · <b>N</b> 穿墙</p>
<p><b>M</b> 打开地图，点哪儿去哪儿 · <b>H</b> 隐藏界面 · <b>1–9</b> 前往左下角的地点</p>
<p class="dim">手机上：左半屏拖动行走，右半屏拖动环顾。</p>`;
    root.append(this.help);
    this.hint = el('div', 'hint', matchMedia('(pointer: coarse)').matches ? '左半屏拖动行走 · 右半屏拖动环顾' : '点击画面开始漫步');
    root.append(this.hint);
    this.cross = el('div', 'cross');
    root.append(this.cross);
    this.attr = el('div', 'attr', '3D City © mawwalker · © OpenStreetMap 贡献者 · GlobalBuildingAtlas · Meta/WRI 树冠高度 · SinoLC-1 · ambientCG / Poly Haven');
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
    fetch(ASSET_URL + 'map.json').then((r) => r.json()).then((m) => { this.mapMeta = m; });
    this._mapT = 0;
  }

  setPlaces(list) {
    this.places = list;
    this.placeBox.innerHTML = '';
    list.slice(0, 16).forEach((p, i) => { const b = el('button', '', p.name); b.title = p.en + (i < 9 ? `  (${i + 1})` : ''); b.addEventListener('click', () => this.goto(p)); this.placeBox.append(b); });
  }

  /** Floating place names (shown from the air). list: [{ name, x, y, z }] */
  setLabels(list) {
    if (!this.labelRoot) { this.labelRoot = el('div', 'labels'); this.root.prepend(this.labelRoot); }
    const tall = { '东方明珠': 480, '上海中心': 645, '陆家嘴': 120, '外滩': 60 };
    this.labels = list.map((l) => { const e = el('div', 'label', l.name); this.labelRoot.append(e); return { ...l, y: tall[l.name] ?? l.y, e, on: false }; });
  }
  updateLabels(camera) {
    if (!this.labels) return;
    const show = this.app.player.mode === 'fly' && !document.body.classList.contains('bare');
    const w = window.innerWidth, h = window.innerHeight;
    const m = camera.matrixWorldInverse.elements, pr = camera.projectionMatrix.elements;
    for (const l of this.labels) {
      const x = m[0] * l.x + m[4] * l.y + m[8] * l.z + m[12], y = m[1] * l.x + m[5] * l.y + m[9] * l.z + m[13], z = m[2] * l.x + m[6] * l.y + m[10] * l.z + m[14];
      const d = -z;
      const vis = show && d > 150 && d < 16000;
      if (vis) {
        const sx = (x * pr[0] / d * 0.5 + 0.5) * w, sy = (0.5 - y * pr[5] / d * 0.5) * h;
        if (sx > 40 && sx < w - 40 && sy > 60 && sy < h - 140) { l.e.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`; l.e.style.opacity = Math.min(1, (16000 - d) / 6000, (d - 150) / 300).toFixed(2); if (!l.on) { l.e.style.display = 'block'; l.on = true; } continue; }
      }
      if (l.on) { l.e.style.display = 'none'; l.on = false; }
    }
  }

  goto(p) { this.app.gotoPlace(p); this.toggleMap(false); }
  toggleHelp() { this.help.classList.toggle('on'); }
  _syncMode() { const m = this.app.player.mode; this.btnWalk.classList.toggle('on', m === 'walk'); this.btnFly.classList.toggle('on', m === 'fly'); }
  _syncWeather(k) { for (const [n, b] of Object.entries(this.wbtn)) b.classList.toggle('on', n === k); }

  setProgress(p, done) {
    const bar = this.veil.querySelector('i');
    if (bar) bar.style.width = Math.round(p * 100) + '%';
    if (done) { this.veil.classList.add('gone'); setTimeout(() => this.veil.remove(), 1400); }
  }

  toggleMap(on) {
    const want = on === undefined ? !this.bigMap.classList.contains('on') : on;
    this.bigMap.classList.toggle('on', want);
    if (want) { document.exitPointerLock?.(); this._drawBig(); }
  }

  _drawBig() {
    const m = this.mapMeta; if (!m || !this.mapImg.complete) return;
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
      g.fillStyle = 'rgba(30,26,22,.85)'; g.beginPath(); g.arc(x, y, 3, 0, 6.3); g.fill();
      g.fillText(pl.name, x + 6, y);
    }
    this._bigScale = s;
  }

  _mapClick(e) {
    if (e.target !== this.bigCanvas) { this.toggleMap(false); return; }
    const m = this.mapMeta; if (!m) return;
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
    // clock
    const h = env.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    this.clock.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    if (document.activeElement !== this.slider) this.slider.value = h;
    this.hint.classList.toggle('off', p.locked || app.frames > 60 * 30);
    // mini-map at ~8 Hz
    this._mapT += dt;
    if (this._mapT > 0.12 && this.mapMeta && this.mapImg.complete && this.mapImg.naturalWidth) {
      this._mapT = 0;
      const m = this.mapMeta, c = this.mapCanvas, g = c.getContext('2d');
      const span = Math.min(6000, Math.max(700, 500 + p.pos.y * 4));            // metres across
      const sx = (p.pos.x - m.x0) / m.mpp, sy = m.h - (-p.pos.z - m.y0) / m.mpp, sw = span / m.mpp;
      g.fillStyle = '#dcd8d0'; g.fillRect(0, 0, c.width, c.height);
      g.imageSmoothingQuality = 'high';
      g.drawImage(this.mapImg, sx - sw / 2, sy - sw / 2, sw, sw, 0, 0, c.width, c.height);
      // heading wedge
      g.save(); g.translate(c.width / 2, c.height / 2); g.rotate(p.yaw);
      g.fillStyle = 'rgba(200,50,30,.22)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 70, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); g.closePath(); g.fill();
      g.fillStyle = '#c8321e'; g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3.5); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke();
      g.restore();
      this.coord.textContent = `${p.mode === 'walk' ? '步行' : '飞行'} · 高度 ${Math.round(p.pos.y)} m${p.mode === 'fly' ? ` · ${Math.round(p.flySpeed * 3.6)} km/h` : ''}`;
    }
  }
}
