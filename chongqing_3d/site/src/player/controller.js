// First-person player tuned for Chongqing's 8D mountain slopes, staircases, bridge decks, and skybridges.
// Walk mode smoothly climbs steep mountain streets & steps, sticks gently when walking downhill (no bouncing),
// and guarantees the player never falls through DEM terrain or elevated decks.

import * as THREE from 'three';

const EYE = 1.70, RADIUS = 0.42, STEP_UP = 0.78, GRAVITY = 20;

export class Player {
  constructor(camera, canvas, collision) {
    this.camera = camera; this.canvas = canvas; this.col = collision;
    this.mode = 'fly';
    this.pos = new THREE.Vector3(0, 260, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.flySpeed = 65; this.noclip = false;
    this.walkSpeed = 3.8; this.runSpeed = 10.0;
    this.keys = new Set();
    this.move = new THREE.Vector2();
    this.lookRate = new THREE.Vector2();
    this.sensitivity = 0.0022;
    this.locked = false; this.enabled = true;
    this.bob = 0; this.bobAmt = 0;
    this.fovBase = 62; this.fov = 62;
    this.landing = null;
    this.onModeChange = null; this.onInput = null;
    this._bind();
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('click', () => { if (this.enabled && !this.locked && !this._dragged && matchMedia('(pointer: fine)').matches) c.requestPointerLock?.(); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === c; if (this.onLock) this.onLock(this.locked); });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked) this._look(e.movementX, e.movementY);
      else if (this._drag) { this._look(-e.movementX * 0.8, -e.movementY * 0.8); this._dragged = true; }
    });
    c.addEventListener('mousedown', (e) => { if (!this.locked && e.button === 0) { this._drag = true; this._dragged = false; } });
    window.addEventListener('mouseup', () => { this._drag = false; setTimeout(() => { this._dragged = false; }, 0); });
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.target.tagName === 'INPUT') return;
      const k = e.code;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      if (k === 'KeyF') this.setMode(this.mode === 'fly' ? 'walk' : 'fly');
      if (k === 'KeyN') this.noclip = !this.noclip;
      if (k === 'KeyG') this.dropToGround();
      if (k === 'Space' && this.mode === 'walk' && this.onGround) { this.vel.y = 6.5; this.onGround = false; }
      if (this.onInput) this.onInput();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    c.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      if (this.mode === 'fly') this.flySpeed = THREE.MathUtils.clamp(this.flySpeed * Math.pow(1.0018, -e.deltaY), 3, 3000);
    }, { passive: false });
  }

  _look(dx, dy) {
    this.yaw += dx * this.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * this.sensitivity, -1.55, 1.55);
    if (this.onInput) this.onInput();
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'walk') {
      const feet = this.pos.y - EYE;
      const g = this.col.surfaceBelow(this.pos.x, this.pos.z, feet + 0.8);
      if (feet - g > 14) this.landing = { from: this.pos.y, to: g + EYE, t: 0, dur: Math.min(2.2, 0.55 + (feet - g) / 380) };
      else if (feet < g) this.pos.y = g + EYE;
      this.vel.set(0, 0, 0);
    } else { this.landing = null; this.vel.y = 0; }
    if (this.onModeChange) this.onModeChange(mode);
  }

  dropToGround() {
    const g = this.col.surfaceBelow(this.pos.x, this.pos.z, this.pos.y - EYE + 1.0);
    this.pos.y = g + EYE; this.vel.set(0, 0, 0); this.landing = null; this.onGround = true;
  }

  /** yawDeg: 0 = north (-z), clockwise; pitchDeg: positive looks up. */
  setPose(x, y, z, yawDeg, pitchDeg) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.landing = null;
    if (yawDeg !== undefined) this.yaw = yawDeg * Math.PI / 180;
    if (pitchDeg !== undefined) this.pitch = pitchDeg * Math.PI / 180;
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, -this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
  }

  getPose() {
    return {
      x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), z: +this.pos.z.toFixed(2),
      yaw: +(this.yaw * 180 / Math.PI).toFixed(1), pitch: +(this.pitch * 180 / Math.PI).toFixed(1),
      mode: this.mode,
    };
  }

  update(dt) {
    const k = this.keys;
    let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + this.move.y;
    let r = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + this.move.x;
    const turn = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
    if (turn) this.yaw += turn * 1.6 * dt;
    if (this.lookRate.x || this.lookRate.y) { this.yaw += this.lookRate.x * dt; this.pitch = THREE.MathUtils.clamp(this.pitch + this.lookRate.y * dt, -1.55, 1.55); }
    const l = Math.hypot(f, r); if (l > 1) { f /= l; r /= l; }
    const fast = k.has('ShiftLeft') || k.has('ShiftRight');
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const fx = sy, fz = -cy, rx = cy, rz = sy;
    const p = this.pos, v = this.vel;

    if (this.mode === 'fly') {
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const up = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('KeyC') || k.has('KeyQ') || k.has('ControlLeft') ? 1 : 0);
      const speed = this.flySpeed * (fast ? 4 : 1);
      const tx = (fx * cp * f + rx * r) * speed, ty = (sp * f + up) * speed, tz = (fz * cp * f + rz * r) * speed;
      const a = 1 - Math.exp(-dt * 7);
      v.x += (tx - v.x) * a; v.y += (ty - v.y) * a; v.z += (tz - v.z) * a;
      if (this.noclip) {
        p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
      } else {
        const fdist = Math.hypot(v.x, v.y, v.z) * dt;
        const fn = Math.min(24, Math.max(1, Math.ceil(fdist / 0.45)));
        for (let i = 0; i < fn; i++) {
          const ox = p.x, oz = p.z;
          p.x += v.x * dt / fn; p.y += v.y * dt / fn; p.z += v.z * dt / fn;
          const q = { x: p.x, z: p.z };
          if (this.col.resolve(q, 0.65, p.y - 0.65, p.y + 0.65, ox, oz)) { p.x = q.x; p.z = q.z; }
          const g = this.col.surfaceBelow(p.x, p.z, p.y + 0.4);
          if (p.y < g + 0.8) { p.y = g + 0.8; if (v.y < 0) v.y = 0; }
        }
      }
      this.onGround = false; this.bobAmt = 0;
    } else if (this.hold) {
      v.set(0, 0, 0);
    } else {
      if (this.landing) {
        const L = this.landing;
        L.t = Math.min(1, L.t + dt / L.dur);
        const e = L.t * L.t * (3 - 2 * L.t);
        p.y = L.from + (L.to - L.from) * e;
        if (L.t >= 1) { this.landing = null; v.set(0, 0, 0); }
      }
      const speed = fast ? this.runSpeed : this.walkSpeed;
      const tx = (fx * f + rx * r) * speed, tz = (fz * f + rz * r) * speed;
      const a = 1 - Math.exp(-dt * (this.onGround ? 12 : 2.8));
      v.x += (tx - v.x) * a; v.z += (tz - v.z) * a;
      const wasGround = this.onGround;
      if (!this.landing) v.y = Math.max(v.y - GRAVITY * dt, -70);

      const dist = Math.hypot(v.x, v.z) * dt;
      const n = Math.min(32, Math.max(1, Math.ceil(dist / 0.15)));
      for (let i = 0; i < n; i++) {
        const ox = p.x, oz = p.z;
        p.x += v.x * dt / n; p.z += v.z * dt / n;
        const feet = p.y - EYE;
        const q = { x: p.x, z: p.z };
        // Check walls down to feet + 0.25m (blocks all building plinths, retaining walls & piers while allowing terrain/stair step-up!)
        if (!this.noclip && this.col.resolve(q, RADIUS, feet + 0.25, feet + EYE + 0.15, ox, oz)) { p.x = q.x; p.z = q.z; }
        // Step up smoothly along steep Chongqing hills/stairs on each sub-step (never stepping into a solid wall!)
        if (!this.landing && wasGround && v.y <= 0.1) {
          const sg = this.col.surfaceBelow(p.x, p.z, feet + STEP_UP);
          if (sg > feet && sg - feet <= STEP_UP && (this.noclip || !this.col.isInsideSolid(p.x, p.z, sg + 0.25, sg + EYE + 0.15))) {
            p.y = sg + EYE;
          }
        }
      }
      if (!this.landing) {
        p.y += v.y * dt;
        const feet = p.y - EYE;
        const g = this.col.surfaceBelow(p.x, p.z, feet + STEP_UP);
        // Gentle downhill glue so walking down steep Chongqing streets doesn't hop
        const downhillSnap = wasGround && v.y <= 0 && feet > g && feet - g < 0.42;
        if (feet <= g || downhillSnap) {
          const target = g + EYE;
          p.y = v.y <= 0 && Math.abs(target - p.y) < STEP_UP ? p.y + (target - p.y) * Math.min(1, dt * 20) : target;
          if (p.y < g + EYE - 0.05) p.y = g + EYE;
          if (v.y < 0) v.y = 0;
          this.onGround = true;
        } else {
          this.onGround = feet - g < 0.08;
        }
      }
      const sp2 = Math.hypot(v.x, v.z);
      this.bobAmt += ((this.onGround ? Math.min(1, sp2 / this.walkSpeed) : 0) - this.bobAmt) * Math.min(1, dt * 8);
      this.bob += dt * (5.5 + sp2 * 1.15);
    }

    const cam = this.camera;
    const by = this.mode === 'walk' ? Math.sin(this.bob * 2) * 0.020 * this.bobAmt : 0;
    const bx = this.mode === 'walk' ? Math.cos(this.bob) * 0.011 * this.bobAmt : 0;
    cam.position.set(p.x + rx * bx, p.y + by, p.z + rz * bx);
    cam.rotation.set(this.pitch, -this.yaw, 0, 'YXZ');
    const targetFov = this.fovBase + (this.mode === 'walk' && fast && this.bobAmt > 0.5 ? 5 : 0);
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 6);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }
}
