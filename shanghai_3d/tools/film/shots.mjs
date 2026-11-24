// The film: every shot as a camera move. 30 frames a second; the music runs at 72 beats a minute, so a bar is 100 frames and
// a beat 25: shot lengths are counted in bars and cuts fall on bar lines. Every shot is rendered with a tail of TAIL frames
// beyond its length in the edit (the next shot dissolves in over it).
import { readFileSync } from 'node:fs';
import { lerp, lerp3, smooth, smoother, ease, easeIn, spline, orbit, clamp01 } from './lib.mjs';

export const FPS = 30, BAR = 100, TAIL = 40;
const PATHS = JSON.parse(readFileSync(new URL('./paths.json', import.meta.url)));

/** A point `s` metres along a path of points 5 m apart ([x, y, z]), `side` metres to the right of it, `up` metres above it. */
function along(name, s, side = 0, up = 0) {
  const P = PATHS[name], x = Math.max(0, Math.min(P.length - 1.001, s / 5)), i = Math.floor(x), f = x - i, a = P[i], b = P[i + 1];
  const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
  return [lerp(a[0], b[0], f) - dz / l * side, lerp(a[1], b[1], f) + up, lerp(a[2], b[2], f) + dx / l * side];
}
/** The same, smoothed over `w` metres (a camera does not follow every vertex of a mapped line). */
function glide(name, s, side, up, w = 30) { let p = [0, 0, 0]; const n = 7; for (let k = 0; k < n; k++) { const q = along(name, s + (k / (n - 1) - 0.5) * w, side, up); p = [p[0] + q[0] / n, p[1] + q[1] / n, p[2] + q[2] / n]; } return p; }

const bars = (n) => n * BAR + TAIL;

const ALL = [
  // ------------------------------------------------------------------ the scale of it (bars 1-17)
  // Straight down from six kilometres up, like a map; then the horizon comes up.
  { name: 's03_map', bars: 4, pre: 5,
    cam: (u) => { const k = smooth(clamp01(u / 0.92)), a = lerp(-25, 12, u) * Math.PI / 180; return { p: lerp3([-900, 6200, 900], [-3600, 2700, 1700], k), t: lerp3([-900 + Math.sin(a) * 60, 0, 900 - Math.cos(a) * 60], [9000, 0, -2500], Math.pow(k, 1.35)), fov: 46, hour: 7.7 }; } },
  // Low over the roofs towards Lujiazui.
  { name: 's04_roofs', bars: 2, pre: 20,
    cam: (u) => { const k = easeIn(u, 0.25); return { p: spline([[-150, 250, 260], [350, 225, 40], [850, 195, -180], [1350, 160, -330]], k), t: lerp3([2700, 230, -480], [3000, 250, -420], k), fov: 50, hour: 8.2 }; } },
  // Along the Bund in the morning light (its fronts face east).
  { name: 's11_bund', bars: 2, pre: 30,
    cam: (u) => { const sr = lerp(830, 610, ease(u, 0.25)); const q = along('bund0', sr, -62, 0); return { p: [q[0], lerp(36, 24, u), q[2]], t: along('bund0', sr - 170, 40, 26), fov: 50, hour: 7.6 }; } },
  // Round the three towers.
  { name: 's05_towers', bars: 2, pre: 15,
    cam: (u) => ({ p: orbit(3120, -240, lerp(1250, 1050, u), lerp(232, 190, u), lerp(300, 420, u)), t: [3170, lerp(300, 345, u), -180], fov: 36, hour: 8.9 }) },
  // Under the arch of Lupu Bridge.
  { name: 's06a_lupu', bars: 2, pre: 15,
    cam: (u) => { const k = easeIn(u, 0.25), sr = lerp(1880, 2720, k), g = glide('river', sr, 0, 0, 120), a = glide('river', sr + 400, 0, 0, 120); return { p: [g[0], lerp(18, 78, smooth(k)), g[2]], t: [a[0], lerp(52, 70, k), a[2]], fov: 56, hour: 9.2 }; } },
  // Down the river, up through the cables of Nanpu Bridge, the city beyond.
  { name: 's06_bridge', bars: 3, pre: 15,
    cam: (u) => {
      const k = easeIn(u, 0.25), sr = lerp(4900, 6080, k), g = glide('river', sr, 0, 0, 120), a = glide('river', sr + 420, 0, 0, 120);
      const y = lerp(16, 118, smooth(clamp01((k - 0.12) / 0.7))), w = smooth(clamp01((k - 0.45) / 0.5));
      return { p: [g[0], y, g[2]], t: lerp3([a[0], 48, a[2]], [3000, 210, -420], w), fov: 56, hour: 9.6 };
    } },
  // The interchange from above, turning.
  { name: 's07_interchange', bars: 2, pre: 45,
    cam: (u) => ({ p: orbit(-235, 1012, lerp(260, 200, u), lerp(20, 62, u), lerp(520, 400, u)), t: [-235, 0, 1012], fov: 44, hour: 10.5 }) },

  // ------------------------------------------------------------------ walk in (bars 18-34)
  // Down from the sky into Nanjing Road, and on at eye height towards the river.
  { name: 's08_dive', bars: 4, pre: 30,
    cam: (u) => {
      const k = smooth(clamp01(u / 0.66)), sr = lerp(470, 150, ease(u, 0.4));
      const g = glide('nanjing_e0', sr, 0, 0), ahead = glide('nanjing_e0', sr - 70, 0, 0);
      const y = lerp(250, 3.6, Math.pow(k, 0.85)), w = lerp(0.42, 1, k);      // (it ends a little above the heads: the crowd is seen, not the nearest face)
      return { p: [g[0], y, g[2]], t: [lerp(g[0], ahead[0], w), lerp(0, 2.9, k), lerp(g[2], ahead[2], w)], fov: lerp(48, 60, k), hour: 15.6 };
    } },
  // Under the plane trees.
  { name: 's09_trees', bars: 2, pre: 35,
    cam: (u) => { const sr = lerp(632, 712, ease(u, 0.25)); return { p: glide('hengshan0', sr, 0, 2.3), t: glide('hengshan0', sr + 70, 0, 3.4), fov: 58, hour: 16.1 }; } },
  // Rain: the umbrellas of Nanjing Road from just above them.
  { name: 's14a_umbrellas', bars: 2, pre: 45, weather: 'rain',
    cam: (u) => { const sr = lerp(335, 262, ease(u, 0.25)); return { p: along('nanjing_e0', sr, 0, lerp(8.6, 7.4, u)), t: along('nanjing_e0', sr - 33, 0, 1.0), fov: 54, hour: 15.3, weather: 'rain' }; } },
  // Rain on the Bund: the towers across the water in the mist.
  { name: 's14b_promenade', bars: 2, pre: 45, weather: 'rain',
    cam: (u) => { const sr = lerp(606, 562, ease(u, 0.25)); return { p: along('bund0', sr, -45, 3.3), t: [2650, lerp(56, 78, u), -640], fov: 56, hour: 15.6, weather: 'rain' }; } },
  // The temple with the golden roofs among the towers.
  { name: 's10b_jingan', bars: 2, pre: 25,
    cam: (u) => ({ p: orbit(-2513, 1131, lerp(250, 205, u), lerp(128, 172, u), lerp(84, 58, u)), t: [-2513, 16, 1131], fov: 44, hour: 16.3 }) },
  // The old city: the roofs of the garden, the new city behind them.
  { name: 's10_garden', bars: 2, pre: 20,
    cam: (u) => ({ p: orbit(1775, 722, lerp(210, 170, u), lerp(215, 262, u), lerp(70, 48, u)), t: [1775, 10, 722], fov: 46, hour: 16.5 }) },
  // On the elevated road, above the traffic, towards the river.
  { name: 's12_drive', bars: 3, pre: 45,
    cam: (u) => { const sr = lerp(12350, 12750, ease(u, 0.2)); return { p: glide('yanan0', sr, 1.8, 6.5, 40), t: glide('yanan0', sr + 130, 1.8, 4.0, 40), fov: 60, hour: 16.75 }; } },

  // ------------------------------------------------------------------ evening (bars 35-46)
  // The day goes: the sun down behind the city.
  { name: 's13_dusk', bars: 5, pre: 20,
    cam: (u) => ({ p: lerp3([4500, 520, 150], [4250, 600, 40], ease(u, 0.5)), t: [1500, 60, -200], fov: 48, hour: lerp(16.45, 17.12, u) }) },
  // Up from behind the roofs of the Bund: the afterglow goes, the lights of Lujiazui come on.
  { name: 's17_twilight', bars: 3, pre: 15,
    cam: (u) => { const k = ease(u, 0.8); return { p: lerp3([1400, 96, -185], [1650, 235, -215], k), t: lerp3([2900, 110, -430], [2950, 230, -430], k), fov: lerp(50, 44, k), hour: lerp(17.05, 17.33, u) }; } },
  // Night comes down on the river: the towers lit, their light on the water, the first stars.
  { name: 's18_nightfall', bars: 4, pre: 25,
    cam: (u) => ({ p: lerp3([1960, 4.5, -255], [2075, 7.5, -305], ease(u, 0.6)), t: lerp3([2850, 190, -470], [2900, 210, -470], u), fov: 52, hour: lerp(17.24, 17.62, u) }) },

  // ------------------------------------------------------------------ night (bars 47-55)
  // Over the black water to the lights.
  { name: 's15_night', bars: 3, pre: 25,
    cam: (u) => { const k = ease(u, 0.5), sr = lerp(9350, 10020, k), g = glide('river', sr, 0, 0, 160); return { p: [g[0], lerp(9, 95, smooth(k)), g[2]], t: lerp3([2760, 150, -480], [3000, 230, -360], k), fov: 50, hour: 20.4 }; } },
  // Up and away: the whole city alight.
  { name: 's16_away', bars: 6, pre: 10,
    cam: (u) => { const k = smoother(clamp01(u / 0.85)); return { p: lerp3([2300, 420, -150], [-2600, 4200, 3900], k), t: lerp3([3080, 260, -260], [3200, 0, -1200], k), fov: lerp(50, 44, k), hour: 21 }; } },
];
for (const x of ALL) x.frames = x.frames || x.bars * BAR + TAIL;
export const shots = ALL;
