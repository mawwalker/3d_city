// Place labels drawn as DOM over the canvas.
// Landmarks get vertical (traditional map style) names on a hairline stem; areas and districts get quiet horizontal names.

import * as THREE from 'three';

const _v = new THREE.Vector3();

export class Labels {
  constructor(root) {
    this.root = root;
    this.items = [];
    this.enabled = true;
    this._frame = 0;
  }

  /** items: [{ name, x, y, z, rank (1..3), kind ('landmark' | 'water' | 'park' | 'district' | ...) }] in world coordinates */
  add(items) {
    for (const it of items) {
      const el = document.createElement('div');
      const point = it.kind === 'landmark';
      el.className = `label ${point ? 'point' : 'area'} k-${it.kind} r${it.rank}`;
      el.innerHTML = point ? `<span class="name">${it.name}</span><i class="stem"></i>` : `<span class="name">${it.name}</span>`;
      this.root.appendChild(el);
      this.items.push({ ...it, el, on: false, sx: 0, sy: 0, w: 0, h: 0 });
    }
  }

  setEnabled(v) { this.enabled = v; this.root.classList.toggle('off', !v); }

  update(camera, width, height) {
    if (!this.enabled || !this.items.length) return;
    this._frame++;
    const eye = camera.position;
    const relayout = this._frame % 4 === 0;
    const placed = [];
    // nearest and most important first
    if (relayout) this.items.sort((a, b) => (a.rank - b.rank) || (a._d - b._d));
    for (const it of this.items) {
      _v.set(it.x, it.y, it.z);
      const d = _v.distanceTo(eye);
      it._d = d;
      _v.project(camera);
      const inFront = _v.z > -1 && _v.z < 1;
      const sx = (_v.x * 0.5 + 0.5) * width, sy = (-_v.y * 0.5 + 0.5) * height;
      // how far each rank stays readable
      const maxD = it.rank === 1 ? 48000 : it.rank === 2 ? 12000 : 5200;
      const minD = it.kind === 'landmark' ? 0 : 900;
      let vis = inFront && d < maxD && d > minD && sx > 20 && sx < width - 20 && sy > 60 && sy < height - 90;
      if (vis && relayout) {
        if (!it.w) { const r = it.el.firstElementChild.getBoundingClientRect(); it.w = r.width || 20; it.h = (r.height || 20) + (it.kind === 'landmark' ? 34 : 0); }
        const point = it.kind === 'landmark';
        const box = point ? [sx - it.w / 2 - 4, sy - it.h - 4, sx + it.w / 2 + 4, sy + 2] : [sx - it.w / 2 - 6, sy - it.h / 2 - 4, sx + it.w / 2 + 6, sy + it.h / 2 + 4];
        for (const b of placed) if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) { vis = false; break; }
        if (vis) placed.push(box);
        it._vis = vis;
      } else if (!relayout) vis = vis && it._vis !== false;
      if (vis !== it.on) { it.on = vis; it.el.classList.toggle('on', vis); }
      if (vis) it.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
    }
  }
}
