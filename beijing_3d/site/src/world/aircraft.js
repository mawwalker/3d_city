// A little life in the sky: airliners on final approach to Beijing Capital Airport, sliding down the glide slope
// from the south with their navigation lights on at dusk.

import * as THREE from 'three';
import { Kit, MAT } from './landmarkKit.js';
import { createLandmarkMaterial } from './landmarks.js';

function airliner() {
  const kit = new Kit();
  // local frame: nose towards -z (north), +x right wing
  kit.paint('#e9ecef', MAT.metal);
  kit.save(); kit.tiltX(90);
  kit.lathe([[0.05, -19], [1.2, -17.5], [1.95, -14], [2.0, 8], [1.5, 14], [0.5, 19]], { seg: 12 });
  kit.restore();
  kit.box(34, 0.45, 4.6, -0.9, { cz: 0.5, taper: [1, 0.8] });        // wings
  kit.box(12.5, 0.3, 2.6, 0.3, { cz: 17 });                           // tailplane
  kit.paint('#a22f24', MAT.matte);
  kit.box(0.4, 5.6, 4.2, 1.2, { cz: 16.2, taper: [1, 0.55] });        // fin
  kit.paint('#8d9399', MAT.metal);
  for (const x of [-5.6, 5.6]) kit.box(1.6, 1.6, 3.4, -2.3, { cx: x, cz: -1.2 });   // engines
  // navigation lights
  kit.paint('#ff2a1a', MAT.glow, { p0: 9 }); kit.box(0.9, 0.5, 0.9, -0.7, { cx: -17 });
  kit.paint('#22ff66', MAT.glow, { p0: 9 }); kit.box(0.9, 0.5, 0.9, -0.7, { cx: 17 });
  kit.paint('#fff4dc', MAT.glow, { p0: 16 }); kit.box(1.1, 0.6, 1.1, -2.6, { cz: -8 });   // landing light
  kit.paint('#ffffff', MAT.glow, { p0: 10 }); kit.box(0.7, 0.5, 0.7, 6.4, { cz: 17.5 });
  return kit.build();
}

export class Aircraft {
  constructor({ env, scene, count = 3 }) {
    this.planes = [];
    const geo = airliner();
    const mat = createLandmarkMaterial(env);
    // final approach to runway 36R: a straight 3-degree descent, x east / z south, metres
    this.from = new THREE.Vector3(18350, 1250, 5500);
    this.to = new THREE.Vector3(18350, 25, -17600);
    this.duration = 300;                                   // seconds per approach (~77 m/s)
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 2; m.matrixAutoUpdate = false;
      scene.add(m);
      this.planes.push({ mesh: m, phase: i / count + 0.07 * i });
    }
  }

  update(time) {
    for (const p of this.planes) {
      const t = (time / this.duration + p.phase) % 1;
      const m = p.mesh;
      m.position.lerpVectors(this.from, this.to, t);
      m.rotation.set(-0.03, 0, 0);
      m.scale.setScalar(1.6);                               // a touch larger than life so it reads from across the city
      m.updateMatrix(); m.updateMatrixWorld(true);
      m.visible = t < 0.985;
    }
  }
}
