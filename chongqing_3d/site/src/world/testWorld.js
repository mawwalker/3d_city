// Mountain-city test scene (?world=test) for standalone renderer/shader/collision testing.
import * as THREE from 'three';
import { standardMaterial, depthMaterial } from '../engine/materials.js';

export function buildTestWorld(scenes) {
  const add = (geo, mat, x, y, z, solid = true) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.updateMatrixWorld();
    scenes.opaque.add(m);
    const d = new THREE.Mesh(geo, depthMaterial()); d.position.copy(m.position); d.updateMatrixWorld();
    if (solid) d.layers.enable(1);
    scenes.shadow.add(d);
    return m;
  };
  const ground = new THREE.PlaneGeometry(4000, 4000); ground.rotateX(-Math.PI / 2);
  add(ground, standardMaterial({ color: 0x4b4e52, roughness: 0.88 }), 0, 0, 0, false);
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const cols = [0xb9b2a6, 0x9aa3ad, 0xc9c2b4, 0x8f8a84, 0xa8b0b8, 0xd8d2c6, 0x7d8a96];
  for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
    if (Math.abs(i) < 1 && Math.abs(j) < 1) continue;
    if (rnd() < 0.25) continue;
    const w = 14 + rnd() * 16, d = 14 + rnd() * 16, h = 12 + rnd() * rnd() * 140;
    const g = new THREE.BoxGeometry(w, h, d);
    add(g, standardMaterial({ color: cols[Math.floor(rnd() * cols.length)], roughness: 0.72 }), i * 42 + (rnd() - 0.5) * 8, h / 2, j * 42 + (rnd() - 0.5) * 8);
  }
  const sph = new THREE.SphereGeometry(1.2, 48, 24);
  add(sph, standardMaterial({ color: 0xd9d9d9, roughness: 0.15, metalness: 1 }), -4, 1.2, -6, false);
  add(sph, standardMaterial({ color: 0x222831, roughness: 0.05, reflectance: 0.6 }), 0, 1.2, -6, false);
  add(sph, standardMaterial({ color: 0xb03a2e, roughness: 0.45 }), 4, 1.2, -6, false);
  add(sph, standardMaterial({ color: 0xffffff, roughness: 0.9 }), 8, 1.2, -6, false);
}
