// Interface chrome: masthead, compass, places, the sun-path time control, switches, loader and credits.
// Everything is plain DOM over the canvas; the 3D model stays the hero.

import { solarPosition } from '../engine/environment.js';

const SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const H0 = 4.5, H1 = 22.5;                  // hours covered by the dial
const QUALITY_NAMES = { low: '省电', medium: '均衡', high: '精细', ultra: '极致' };
const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

const el = (tag, attrs = {}, html = '') => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
};

export function buildViews(L) {
  const at = (k, dx = 0, dz = 0) => ({ x: L[k].x + dx, z: -L[k].y + dz });
  return [
    { id: 'hero', name: '西山落日', hour: 17.05, pose: { x: 2300, z: -250, dist: 9200, heading: 267, pitch: 9.6 } },
    { id: 'city', name: '全城', hour: 16.55, pose: { x: -1200, z: -500, dist: 34000, heading: 2, pitch: 34 } },
    { id: 'axis', name: '中轴线', hour: 16.55, pose: { x: -30, z: 900, dist: 6200, heading: 358.2, pitch: 15 } },
    { id: 'gugong', name: '故宫', hour: 16.55, pose: { ...at('taihedian'), dist: 2000, heading: 356, pitch: 27 } },
    { id: 'tiantan', name: '天坛', hour: 16.4, pose: { ...at('qiniandian', 0, 60), dist: 900, heading: 345, pitch: 24 } },
    { id: 'shichahai', name: '什刹海', hour: 16.55, pose: { x: -380, z: -2650, dist: 1900, heading: 325, pitch: 27 } },
    { id: 'cbd', name: '国贸', hour: 16.8, pose: { ...at('zun', -350, 0), dist: 2500, heading: 300, pitch: 14 } },
    { id: 'olympic', name: '奥林匹克公园', hour: 16.55, pose: { ...at('birdsnest', -150, -250), dist: 2300, heading: 8, pitch: 24 } },
    { id: 'yiheyuan', name: '颐和园', hour: 16.6, pose: { x: -10560, z: -9750, dist: 2500, heading: 346, pitch: 20 } },
    { id: 'night', name: '夜色', hour: 19.6, pose: { ...at('zun', -900, 300), dist: 5200, heading: 286, pitch: 16 } },
  ];
}

export class UI {
  constructor(app, root) {
    this.app = app; this.root = root;
    this.views = [];
    this.tour = false; this._tourT = 0; this._tourI = 0;
    this._build();
    this._bindKeys();
    this.setHourDisplay(app.env.hour);
  }

  // ------------------------------------------------------------------ DOM
  _build() {
    const r = this.root;
    r.append(
      el('header', { class: 'masthead' }, `<span class="seal" aria-hidden="true">京</span><div class="title"><h1>北京</h1><p>五环之内的三维城市</p></div>`),
    );
    this.compass = el('button', { class: 'compass', type: 'button', 'aria-label': '转回正北', title: '转回正北' }, `<span class="rose"><i></i><b>北</b></span>`);
    r.append(this.compass);
    this.compass.addEventListener('click', () => this.app.rig.flyTo({ heading: 0 }, 1.2));

    this.places = el('nav', { class: 'places', 'aria-label': '去处' });
    r.append(this.places);

    // sun-path dial
    const sd = this.sundial = el('section', { class: 'sundial', 'aria-label': '时间' });
    const W = 300, Hh = 78, horizon = 52, k = 0.95;        // px per degree of elevation
    let dDay = '', dNight = '', prevAbove = null;
    const pts = [];
    for (let i = 0; i <= 180; i++) {
      const h = H0 + (H1 - H0) * i / 180;
      const e = Math.max(-20, solarPosition(h).el * 180 / Math.PI);
      pts.push([(i / 180) * W, horizon - e * k, e]);
    }
    for (const [x, y, e] of pts) {
      const above = e >= 0;
      if (above) dDay += (prevAbove === true ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      dNight += (dNight ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      prevAbove = above;
    }
    this._dial = { W, Hh, horizon, k };
    sd.innerHTML = `
      <svg class="arc" viewBox="-12 -6 ${W + 24} ${Hh + 12}" role="slider" tabindex="0" aria-label="一天中的时刻" aria-valuemin="${H0}" aria-valuemax="${H1}">
        <path class="night" d="${dNight}"/>
        <line class="horizon" x1="-8" x2="${W + 8}" y1="${horizon}" y2="${horizon}"/>
        <path class="day" d="${dDay}"/>
        <g class="sun"><circle class="halo" r="13"/><circle class="disc" r="6.5"/></g>
      </svg>
      <p class="clock"><b class="shichen"></b><span class="hm"></span></p>
      <div class="moments"></div>`;
    r.append(sd);
    this.arc = sd.querySelector('.arc'); this.sun = sd.querySelector('.sun');
    this.elShichen = sd.querySelector('.shichen'); this.elHm = sd.querySelector('.hm');
    const moments = sd.querySelector('.moments');
    for (const [name, hour] of [['清晨', 7.3], ['正午', 12], ['金色时刻', 16.55], ['落日', 17.2], ['蓝调', 17.85], ['入夜', 20.2]]) {
      const b = el('button', { type: 'button' }, name);
      b.addEventListener('click', () => this.app.animateHour(hour, 2.2));
      moments.append(b);
    }
    const setFromPointer = (ev) => {
      const rect = this.arc.getBoundingClientRect();
      const vbW = W + 24;
      const x = ((ev.clientX - rect.left) / rect.width) * vbW - 12;
      const h = H0 + Math.min(1, Math.max(0, x / W)) * (H1 - H0);
      this.app.setHour(h);
    };
    this.arc.addEventListener('pointerdown', (ev) => { this.arc.setPointerCapture(ev.pointerId); this._dragging = true; this.app.stopHourAnimation(); setFromPointer(ev); });
    this.arc.addEventListener('pointermove', (ev) => { if (this._dragging) setFromPointer(ev); });
    const end = () => { this._dragging = false; };
    this.arc.addEventListener('pointerup', end); this.arc.addEventListener('pointercancel', end);
    this.arc.addEventListener('keydown', (ev) => {
      const step = ev.shiftKey ? 1 : 1 / 6;
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { this.app.setHour(Math.max(H0, this.app.env.hour - step)); ev.preventDefault(); ev.stopPropagation(); }
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { this.app.setHour(Math.min(H1, this.app.env.hour + step)); ev.preventDefault(); ev.stopPropagation(); }
    });

    // switches
    const sw = this.switches = el('div', { class: 'switches' });
    const toggle = (name, key, on, fn) => {
      const b = el('button', { type: 'button', 'aria-pressed': String(on), 'data-key': key }, `<i></i>${name}`);
      b.addEventListener('click', () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(v)); fn(v); });
      sw.append(b); return b;
    };
    this.swLabels = toggle('地名', 'labels', true, (v) => this.app.labels.setEnabled(v));
    this.swTraffic = toggle('车流', 'traffic', true, (v) => { this.app.ground.uniforms.uTraffic.value = v ? 1 : 0; });
    this.swTour = toggle('巡游', 'tour', false, (v) => this.setTour(v));
    const q = el('button', { type: 'button', class: 'plain' }, `画质：${QUALITY_NAMES[this.app.quality.name] || this.app.quality.name}`);
    q.title = '切换画质（会重新载入）';
    q.addEventListener('click', () => {
      const i = QUALITY_ORDER.indexOf(this.app.quality.name);
      const next = QUALITY_ORDER[(i + 1) % QUALITY_ORDER.length];
      const u = new URL(location.href); u.searchParams.set('q', next); location.href = u.toString();
    });
    const SEASONS = [['autumn', '金秋'], ['snow', '初雪'], ['summer', '盛夏']];
    const season = el('button', { type: 'button', class: 'plain' }, '');
    const showSeason = () => { season.textContent = `时节：${(SEASONS.find((x) => x[0] === this.app.season) || SEASONS[0])[1]}`; };
    showSeason();
    season.addEventListener('click', () => {
      const i = SEASONS.findIndex((x) => x[0] === this.app.season);
      this.app.setSeason(SEASONS[(i + 1) % SEASONS.length][0]);
      showSeason();
    });
    sw.append(season);
    const hide = el('button', { type: 'button', class: 'plain' }, '隐藏界面');
    hide.addEventListener('click', (ev) => { ev.stopPropagation(); this.setBare(true); });
    const about = el('button', { type: 'button', class: 'plain' }, '数据来源');
    about.addEventListener('click', () => this.dialog.showModal());
    sw.append(q, hide, about);
    r.append(sw);

    this.loader = el('div', { class: 'loader', role: 'status' }, `<span class="bar"><i></i></span><span class="msg">正在铺设城区</span>`);
    r.append(this.loader);

    this.hint = el('p', { class: 'hint' }, '拖动平移　右键或 Shift 拖动旋转　滚轮缩放　双击飞往');
    r.append(this.hint);
    setTimeout(() => this.hint.remove(), 11500);

    this.dialog = el('dialog', { class: 'about' }, `
      <h2>这座模型是怎么来的</h2>
      <p>五环内外约九十八万栋建筑，全部来自公开数据；地标按公开的测绘尺寸逐个建模。它是一件作品，不是测绘成果，请勿用于导航或工程。</p>
      <dl>
        <dt>建筑轮廓</dt><dd>OpenStreetMap 贡献者（ODbL）；GlobalBuildingAtlas LoD1，Zhu 等，2025（CC BY 4.0）；3D-GloBFP，Che 等，2024（CC BY 4.0）</dd>
        <dt>建筑高度</dt><dd>OSM 标注的高度与层数优先；其余由遥感高度估算，经以 OSM 实测值训练的模型校准</dd>
        <dt>道路、水系、绿地、地名</dt><dd>© OpenStreetMap 贡献者（ODbL）</dd>
        <dt>地形</dt><dd>Copernicus DEM GLO-30（© DLR / Airbus，ESA 提供）</dd>
        <dt>光照</dt><dd>按北京 10 月 18 日的真实太阳方位计算</dd>
      </dl>
      <p class="keys">拖动平移，右键或按住 Shift 拖动旋转，滚轮缩放，双击飞往该处。H 隐藏界面，L 开关地名，空格开始巡游。</p>
      <form method="dialog"><button>关闭</button></form>`);
    r.append(this.dialog);
    this.dialog.addEventListener('click', (ev) => { if (ev.target === this.dialog) this.dialog.close(); });

    this.credit = el('p', { class: 'credit' }, '3D City © mawwalker · © OpenStreetMap 贡献者 等');
    this.credit.addEventListener('click', () => this.dialog.showModal());
    r.append(this.credit);

    this.labelRoot = el('div', { class: 'labels', 'aria-hidden': 'true' });
    r.prepend(this.labelRoot);
  }

  setViews(views) {
    this.views = views;
    this.places.innerHTML = '';
    views.forEach((v, i) => {
      const b = el('button', { type: 'button', 'data-id': v.id }, v.name);
      b.addEventListener('click', () => { this.setTour(false); this.goto(i); });
      this.places.append(b);
    });
  }

  goto(i, duration) {
    const v = this.views[i]; if (!v) return;
    this._tourI = i;
    this.app.rig.flyTo(v.pose, duration);
    if (v.hour !== undefined) this.app.animateHour(v.hour, 2.6);
    for (const b of this.places.children) b.classList.toggle('current', b.dataset.id === v.id);
    this._current = v.id;
  }

  clearCurrent() {
    if (!this._current) return;
    this._current = null;
    for (const b of this.places.children) b.classList.remove('current');
  }

  setTour(on) {
    this.tour = on; this._tourT = 0;
    this.swTour.setAttribute('aria-pressed', String(on));
    if (on) this.goto((this._tourI + 1) % this.views.length);
  }

  setBare(v) {
    document.body.classList.toggle('bare', v);
    if (v) {
      const restore = () => { this.setBare(false); window.removeEventListener('keydown', restore); this.root.removeEventListener('pointerdown', restore, true); };
      setTimeout(() => { window.addEventListener('keydown', restore, { once: true }); }, 0);
    }
  }

  _bindKeys() {
    window.addEventListener('keydown', (ev) => {
      if (ev.target.closest && ev.target.closest('dialog, .arc')) return;
      if (ev.key === 'h' || ev.key === 'H') this.setBare(!document.body.classList.contains('bare'));
      else if (ev.key === 'l' || ev.key === 'L') this.swLabels.click();
      else if (ev.key === ' ') { this.setTour(!this.tour); ev.preventDefault(); }
      else if (ev.key >= '1' && ev.key <= '9') { this.setTour(false); this.goto(+ev.key - 1); }
    });
  }

  // ------------------------------------------------------------------ per frame
  setHourDisplay(h) {
    const { W, horizon, k } = this._dial;
    const e = Math.max(-20, solarPosition(h).el * 180 / Math.PI);
    const x = ((h - H0) / (H1 - H0)) * W, y = horizon - e * k;
    this.sun.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    this.sundial.classList.toggle('night', e < -1);
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60 + 0.5) % 60;
    this.elHm.textContent = `${String(hh + (Math.floor((h - hh) * 60 + 0.5) === 60 ? 1 : 0)).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    this.elShichen.textContent = SHICHEN[Math.floor(((h + 1) % 24) / 2)] + '时';
    this.arc.setAttribute('aria-valuenow', h.toFixed(2));
    this.arc.setAttribute('aria-valuetext', `${this.elShichen.textContent} ${this.elHm.textContent}`);
  }

  update(dt) {
    const app = this.app;
    // compass
    const hd = app.rig.cur.heading;
    if (hd !== this._hd) { this._hd = hd; this.compass.firstElementChild.style.transform = `rotate(${(-hd).toFixed(1)}deg)`; }
    // loader
    if (!this._loaded) {
      const p = app.progress;
      this.loader.querySelector('i').style.transform = `scaleX(${Math.max(0.02, p).toFixed(3)})`;
      if (app.loaded) { this._loaded = true; this.loader.classList.add('done'); }
    }
    // tour: hold each place for a while, drifting slowly around it
    if (this.tour && !app.rig.flying) {
      this._tourT += dt;
      app.rig.goal.heading += dt * 1.6;
      if (this._tourT > 13) { this._tourT = 0; this.goto((this._tourI + 1) % this.views.length, 6); }
    }
    if (app.hourChanged) { this.setHourDisplay(app.env.hour); app.hourChanged = false; }
  }
}
