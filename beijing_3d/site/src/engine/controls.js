// Map-style camera rig: grab-the-ground pan, orbit, zoom-to-cursor, inertia, touch gestures and smooth fly-to.
//
// State: target (ground point), dist (eye-target distance), heading (deg, 0 = looking north, clockwise),
//        pitch (deg above the horizon of the eye as seen from the target; 90 = straight down).

import * as THREE from 'three';

const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ease = (t) => t * t * t * (t * (6 * t - 15) + 10);

export class CameraRig {
  constructor(camera, dom, opts = {}) {
    this.camera = camera; this.dom = dom;
    this.limits = { minDist: 160, maxDist: 110000, minPitch: 3.5, maxPitch: 89.5, bound: 46000, ...opts.limits };
    this.cur = { x: 0, z: 0, dist: 30000, heading: 0, pitch: 45 };
    this.goal = { ...this.cur };
    this.vel = { x: 0, z: 0 };            // pan inertia (m/s)
    this.fly = null;
    this.enabled = true;
    this.onUserInput = null;              // callback when the user grabs the camera
    this.lastInput = performance.now();
    this.heightAt = opts.heightAt || (() => 0);
    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._v = new THREE.Vector3();
    this._drag = null;
    this._pointers = new Map();
    this._bind();
    this.apply(0);
  }

  // ---------------------------------------------------------------- public API
  set(state) { Object.assign(this.cur, state); Object.assign(this.goal, this.cur); this.vel.x = this.vel.z = 0; this.fly = null; this.apply(0); }

  get() { return { ...this.cur }; }

  /** Smooth flight to a pose. duration in seconds (auto if omitted). */
  flyTo(pose, duration) {
    this.touched = true;
    const from = { ...this.cur };
    const to = { ...from, ...pose };
    let dh = ((to.heading - from.heading + 540) % 360) - 180;
    to.heading = from.heading + dh;
    const travel = Math.hypot(to.x - from.x, to.z - from.z);
    const zoomRatio = Math.abs(Math.log(to.dist / from.dist));
    if (duration === undefined) duration = clamp(1.4 + travel / 9000 + zoomRatio * 0.7, 1.6, 5.5);
    // rise above both ends when travelling far, like a map fly-to
    const mid = Math.max(from.dist, to.dist, travel * 1.15);
    const bump = Math.max(0, Math.log(mid / Math.max(from.dist, to.dist)));
    this.fly = { from, to, t: 0, duration, bump };
    this.vel.x = this.vel.z = 0;
  }

  get flying() { return !!this.fly; }

  /** Seconds since the user last touched the camera. */
  idleTime() { return (performance.now() - this.lastInput) / 1000; }

  update(dt) {
    dt = Math.min(dt, 0.1);
    const c = this.cur, g = this.goal, L = this.limits;
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / f.duration);
      const k = ease(f.t);
      c.x = f.from.x + (f.to.x - f.from.x) * k;
      c.z = f.from.z + (f.to.z - f.from.z) * k;
      c.heading = f.from.heading + (f.to.heading - f.from.heading) * k;
      c.pitch = f.from.pitch + (f.to.pitch - f.from.pitch) * k;
      const ld = Math.log(f.from.dist) + (Math.log(f.to.dist) - Math.log(f.from.dist)) * k + Math.sin(Math.PI * k) * f.bump;
      c.dist = Math.exp(ld);
      Object.assign(g, c);
      if (f.t >= 1) { this.fly = null; c.heading = ((c.heading % 360) + 360) % 360; Object.assign(g, c); }
    } else {
      // inertia
      if (!this._drag && (Math.abs(this.vel.x) > 0.01 || Math.abs(this.vel.z) > 0.01)) {
        g.x += this.vel.x * dt; g.z += this.vel.z * dt;
        const decay = Math.exp(-dt * 4.2);
        this.vel.x *= decay; this.vel.z *= decay;
      }
      g.dist = clamp(g.dist, L.minDist, L.maxDist);
      g.pitch = clamp(g.pitch, L.minPitch, L.maxPitch);
      g.x = clamp(g.x, -L.bound, L.bound); g.z = clamp(g.z, -L.bound, L.bound);
      const a = 1 - Math.exp(-dt * 14);
      c.x += (g.x - c.x) * a; c.z += (g.z - c.z) * a;
      c.dist = Math.exp(Math.log(c.dist) + (Math.log(g.dist) - Math.log(c.dist)) * a);
      c.heading += (g.heading - c.heading) * a;
      c.pitch += (g.pitch - c.pitch) * a;
    }
    this.apply(dt);
  }

  apply() {
    const c = this.cur, cam = this.camera;
    const h = c.heading * DEG, p = c.pitch * DEG;
    const fx = Math.sin(h), fz = -Math.cos(h);
    const ty = this.heightAt(c.x, c.z);
    const horiz = c.dist * Math.cos(p);
    let ey = ty + c.dist * Math.sin(p);
    const ex = c.x - fx * horiz, ez = c.z - fz * horiz;
    // never dip below the terrain under the eye
    const ground = this.heightAt(ex, ez) + 25;
    if (ey < ground) ey = ground;
    cam.position.set(ex, ey, ez);
    cam.up.set(0, 1, 0);
    if (p > 89.4 * DEG) cam.up.set(fx, 0, fz);
    cam.lookAt(c.x, ty, c.z);
    cam.near = clamp(c.dist * 0.03, 1.5, 1200);
    cam.far = 320000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- picking
  groundPoint(clientX, clientY, out = new THREE.Vector3()) {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(ndc, this.camera);
    const hit = this._ray.ray.intersectPlane(this._plane, out);
    const maxD = Math.max(this.cur.dist * 6, 4000);
    if (!hit || out.distanceTo(this.camera.position) > maxD) {
      // looking above the horizon: clamp to a far point along the ray's ground direction
      const d = this._ray.ray.direction;
      const hl = Math.hypot(d.x, d.z) || 1;
      out.set(this.camera.position.x + d.x / hl * maxD, 0, this.camera.position.z + d.z / hl * maxD);
    }
    return out;
  }

  _touchInput() { this.touched = true; this.lastInput = performance.now(); if (this.fly) { this.fly = null; Object.assign(this.goal, this.cur); } if (this.onUserInput) this.onUserInput(); }

  // ---------------------------------------------------------------- events
  _bind() {
    const el = this.dom;
    el.style.touchAction = 'none';
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    const up = (e) => this._up(e);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !e.buttons) up(e); });
    el.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    el.addEventListener('dblclick', (e) => this._dbl(e));
    window.addEventListener('keydown', (e) => this._key(e));
  }

  _down(e) {
    if (!this.enabled) return;
    this._touchInput();
    this.dom.setPointerCapture?.(e.pointerId);
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.vel.x = this.vel.z = 0;
    if (this._pointers.size === 1) {
      const rotate = e.button === 2 || e.button === 1 || e.ctrlKey || e.shiftKey || e.metaKey;
      this._drag = { mode: rotate ? 'rotate' : 'pan', x: e.clientX, y: e.clientY, anchor: this.groundPoint(e.clientX, e.clientY), t: performance.now(), hist: [] };
      // pan with the pose frozen at grab time so the anchor maps consistently
      Object.assign(this.goal, this.cur);
    } else if (this._pointers.size === 2) {
      const [a, b] = [...this._pointers.values()];
      this._drag = { mode: 'gesture', d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, ay: a.y, by: b.y };
    }
  }

  _move(e) {
    if (!this._pointers.has(e.pointerId) || !this._drag) return;
    this._touchInput();
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = this._drag, g = this.goal;
    if (d.mode === 'pan') {
      // move the target so the grabbed ground point stays under the cursor
      const p = this.groundPoint(e.clientX, e.clientY, this._v);
      const dx = d.anchor.x - p.x, dz = d.anchor.z - p.z;
      g.x += dx; g.z += dz;
      // apply immediately (no lag while dragging), then re-evaluate
      this.cur.x = g.x; this.cur.z = g.z; this.apply();
      const now = performance.now();
      d.hist.push({ t: now, x: g.x, z: g.z });
      while (d.hist.length > 2 && now - d.hist[0].t > 120) d.hist.shift();
    } else if (d.mode === 'rotate') {
      g.heading -= (e.clientX - d.x) * 0.22;
      g.pitch += (e.clientY - d.y) * 0.16;
      g.pitch = clamp(g.pitch, this.limits.minPitch, this.limits.maxPitch);
      d.x = e.clientX; d.y = e.clientY;
    } else if (d.mode === 'gesture' && this._pointers.size >= 2) {
      const [a, b] = [...this._pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (d.d > 0) g.dist = clamp(g.dist * d.d / Math.max(dist, 1), this.limits.minDist, this.limits.maxDist);
      let da = (ang - d.ang) / DEG; if (da > 180) da -= 360; if (da < -180) da += 360;
      g.heading -= da;
      // tilt only when both fingers travel the same way vertically (so a pinch does not also tilt)
      const dya = a.y - d.ay, dyb = b.y - d.by;
      if (dya * dyb > 0 && Math.abs(dya - dyb) < Math.max(Math.abs(dya), Math.abs(dyb)) * 0.8) g.pitch = clamp(g.pitch + (dya + dyb) * 0.5 * 0.22, this.limits.minPitch, this.limits.maxPitch);
      d.d = dist; d.ang = ang; d.cx = cx; d.cy = cy; d.ay = a.y; d.by = b.y;
    }
  }

  _up(e) {
    if (!this._pointers.has(e.pointerId)) return;
    this._pointers.delete(e.pointerId);
    const d = this._drag;
    if (d && d.mode === 'pan' && d.hist.length >= 2) {
      const a = d.hist[0], b = d.hist[d.hist.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt > 0.01 && performance.now() - b.t < 60) { this.vel.x = (b.x - a.x) / dt; this.vel.z = (b.z - a.z) / dt; }
    }
    this._drag = null;
    if (this._pointers.size === 1) {
      const [p] = [...this._pointers.values()];
      this._drag = { mode: 'pan', x: p.x, y: p.y, anchor: this.groundPoint(p.x, p.y), t: performance.now(), hist: [] };
    }
  }

  _wheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this._touchInput();
    const g = this.goal;
    if (e.ctrlKey && Math.abs(e.deltaY) < 50 && e.deltaMode === 0 && !Number.isInteger(e.deltaY)) {
      // trackpad pinch
      this._zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.012));
      return;
    }
    if (e.shiftKey) { g.heading += (e.deltaY || e.deltaX) * 0.05; return; }
    const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 400 : 1;
    this._zoomAt(e.clientX, e.clientY, Math.exp(clamp(e.deltaY * unit, -240, 240) * 0.0016));
  }

  _zoomAt(cx, cy, scale) {
    const g = this.goal, L = this.limits;
    const nd = clamp(g.dist * scale, L.minDist, L.maxDist);
    const s = nd / g.dist;
    if (s === 1) return;
    const p = this.groundPoint(cx, cy, this._v);
    // keep the ground point under the cursor (approximately) fixed
    g.x = p.x + (g.x - p.x) * s; g.z = p.z + (g.z - p.z) * s;
    g.dist = nd;
  }

  _dbl(e) {
    if (!this.enabled) return;
    const p = this.groundPoint(e.clientX, e.clientY);
    this.flyTo({ x: p.x, z: p.z, dist: Math.max(this.limits.minDist * 2, this.cur.dist * 0.45) }, 1.1);
  }

  _key(e) {
    if (!this.enabled || e.target.tagName === 'INPUT') return;
    const g = this.goal, c = this.cur;
    const step = c.dist * 0.12;
    const h = c.heading * DEG;
    const fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    let used = true;
    switch (e.key) {
      case 'ArrowUp': case 'w': case 'W': g.x += fx * step; g.z += fz * step; break;
      case 'ArrowDown': case 's': case 'S': g.x -= fx * step; g.z -= fz * step; break;
      case 'ArrowLeft': case 'a': case 'A': g.x -= rx * step; g.z -= rz * step; break;
      case 'ArrowRight': case 'd': case 'D': g.x += rx * step; g.z += rz * step; break;
      case 'q': case 'Q': g.heading -= 15; break;
      case 'e': case 'E': g.heading += 15; break;
      case '+': case '=': g.dist *= 0.8; break;
      case '-': case '_': g.dist *= 1.25; break;
      case 'PageUp': g.pitch += 8; break;
      case 'PageDown': g.pitch -= 8; break;
      default: used = false;
    }
    if (used) { this._touchInput(); e.preventDefault(); }
  }
}
