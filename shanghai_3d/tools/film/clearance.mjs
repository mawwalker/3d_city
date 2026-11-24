// How near each shot's camera comes to a building that stands as high as the camera: node film/clearance.mjs  (reads work/buildings via python)
import { shots } from './shots.mjs';
const out = {};
for (const s of shots) { const P = []; for (let f = 0; f < s.frames; f += 4) { const c = s.cam(f / (s.frames - 1), f); P.push(c.p); } out[s.name] = P; }
console.log(JSON.stringify(out));
