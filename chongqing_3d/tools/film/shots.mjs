// Chongqing 3D Cinematic Showcase Film — 13-clip / 11-scene choreography (31 bars @ 72 BPM, 30 fps = ~103.3s + 3.7s coda).
//
// Tempo: 72 BPM (4 beats/bar => 1 bar = 100 frames = 3.3333s; 1 beat = 25 frames).
// Every shot renders TAIL extra frames past its editorial bar length so cross-dissolves stay fluid and unhurried.
// Lighting progresses chronologically: Golden Morning/Afternoon -> Mountain Streets & 8D Infrastructure ->
// Sunset Dusk -> Blue Hour -> Spirited-Away Hongyadong Night -> Rainy Cyber Walk -> Nanshan Cyber-Night Finale.

import { lerp, lerp3, smooth, smoother, ease, orbit, clamp01 } from './lib.mjs';

export const FPS = 30;
export const BAR = 100;
export const TAIL = 36;

// Qiansimen Bridge centerline constants (from site/data/landmarks.json)
const QSM_P0 = [299.9, -568.7];
const QSM_U = [-0.36434, -0.93127];
const QSM_PERP = [0.93127, -0.36434];
const QSM_DECK_Y = 68.3;
const qsmPt = (s, side, y) => [
  QSM_P0[0] + QSM_U[0] * s + QSM_PERP[0] * side,
  y,
  QSM_P0[1] + QSM_U[1] * s + QSM_PERP[1] * side,
];

// Hongyadong center & Jialing riverfront frame (from site/data/landmarks.json)
const HYD = [105.92, 26.46, -507.56];
const HYD_N = [-0.2377, -0.9713]; // outward toward Jialing River
const HYD_T = [0.9713, -0.2377];  // east along riverfront

const ALL = [
  // =========================================================================
  // S1. Chaotianmen & Raffles City Golden Reveal (Bars 1-3, 10.0s)
  // Sweeping aerial orbit around Chaotianmen prow, Raffles 8 curved sails +
  // Crystal skybridge, Yangtze/Jialing confluence & Grand Theatre across river.
  // =========================================================================
  {
    name: 's01_chaotianmen_raffles',
    bars: 3,
    dissolve: 0,
    pre: 12,
    t0: 4.0,
    weather: 'clear',
    cam: (u) => {
      const k = ease(u, 0.72);
      const p = orbit(1020, -900, lerp(920, 740, k), lerp(56, 18, k), lerp(292, 212, k));
      const t = lerp3([965, 162, -885], [1005, 178, -860], k);
      return { p, t, fov: lerp(46, 44, k), hour: 17.35, weather: 'clear' };
    },
  },

  // =========================================================================
  // S2. Street-Level Macro Architectural Dolly (Bars 4-5, 6.7s)
  // Eye-level steadycam gliding gently uphill along an ordinary Yuzhong
  // hillside street past coursed sandstone 堡坎, 3D window frames/mullions,
  // 防盗网, balconies, drainpipes, AC brackets, recessed shopfronts & walkers.
  // =========================================================================
  {
    name: 's02_street_macro',
    bars: 2,
    dissolve: 24,
    pre: 18,
    t0: 8.0,
    weather: 'clear',
    cam: (u) => {
      const k = ease(u, 0.55);
      const p = lerp3([-525, 0, 317], [-497, 0, 294], k);
      const t = lerp3([-466, 0, 268], [-440, 0, 246], k);
      return { p, t, agl: 1.9, tAgl: lerp(6.8, 10.2, k), fov: 50, hour: 15.65, weather: 'clear' };
    },
  },

  // =========================================================================
  // S3. Jiefangbei CBD Canyon Push-In -> Tilt-Up (Bars 6-7, 6.7s)
  // Street-level dolly across Jiefangbei plaza toward the Monument, smoothly
  // tilting UP the soaring skyscraper canyon to WFC (340m) & Guotai crimson beams.
  // =========================================================================
  {
    name: 's03_jiefangbei_cbd',
    bars: 2,
    dissolve: 22,
    pre: 18,
    t0: 10.0,
    weather: 'clear',
    cam: (u) => {
      const k = ease(u, 0.65);
      const kt = smoother(clamp01((u - 0.10) / 0.90));
      const p = lerp3([-28, 0, 58], [-12, 0, 26], k);
      const t = lerp3([2, 124, -4], [58, 258, -185], kt);
      return { p, t, agl: lerp(2.1, 2.5, k), fov: lerp(52, 56, kt), hour: 15.45, weather: 'clear' };
    },
  },

  // =========================================================================
  // S4. Qiansimen Bridge Walkway Glide (Bars 8-9, 6.7s)
  // Low steadycam glide north along Qiansimen Bridge past cracked asphalt,
  // crimson stay-cable dampers & shuttle pylon toward Chongqing Grand Theatre
  // & crimson-arch Chaotianmen Bridge (100% clear of lamp poles!).
  // =========================================================================
  {
    name: 's04_qiansimen_bridge',
    bars: 2,
    dissolve: 22,
    pre: 18,
    t0: 12.0,
    weather: 'clear',
    cam: (u) => {
      const k = ease(u, 0.45);
      const s = lerp(160, 290, k);
      const p = qsmPt(s, lerp(5.8, 6.4, k), QSM_DECK_Y + lerp(2.9, 6.2, smooth(k)));
      const t = lerp3(
        qsmPt(s + 260, -2.5, QSM_DECK_Y + 38),
        [240, QSM_DECK_Y + 42, -1340],
        smooth(clamp01((u - 0.35) / 0.65)),
      );
      return { p, t, fov: 50, hour: 16.45, weather: 'clear' };
    },
  },

  // =========================================================================
  // S5. Liziba 8D Monorail Through Building (Bars 10-12, 10.0s)
  // Upward crane reveal from Liziba Viewing Platform timed to t0 = 0.8s so the
  // 6-car emerald/white CRT Line 2 monorail emerges straight out of the 6-8F
  // building portal overhead (100% unobstructed from Frame 0!).
  // =========================================================================
  {
    name: 's05_liziba_monorail',
    bars: 3,
    dissolve: 24,
    pre: 12,
    t0: 0.8,
    weather: 'clear',
    cam: (u) => {
      const k = ease(u, 0.65);
      const p = lerp3([-3774, 53.8, 384], [-3794, 66.5, 418], k);
      const t = lerp3([-3820, 74.5, 488], [-3806, 73.5, 470], k);
      return { p, t, fov: lerp(48, 46, k), hour: 15.7, weather: 'clear' };
    },
  },

  // =========================================================================
  // S6. Yangtze River Cableway Tracking (Bars 13-14, 6.7s)
  // Silky parallel aerial glide tracking the red-and-cream 80-passenger cabin
  // (live mesh world tracking!) as it crosses the Yangtze past Baixiangju &
  // Dongshuimen Bridge.
  // =========================================================================
  {
    name: 's06_yangtze_cableway',
    bars: 2,
    dissolve: 24,
    pre: 10,
    t0: 2.5,
    weather: 'clear',
    cam: (u) => {
      const k = ease(u, 0.6);
      // Offset relative to cableway-cabin-0 world center [alongSpan, up, rightOfSpan]
      // Smoothly arcs from front-right 3/4 view (showing North Tower & Baixiangju behind)
      // to side-rear 3/4 view (showing Yangtze span & Dongshuimen Bridge ahead!).
      return {
        p: [900, 115, 160], // fallback only; resolved dynamically from live cabin mesh
        t: [860, 106, 120],
        track: 'cableway0',
        trackOffset: [lerp(24, -18, k), lerp(4.5, 8.5, k), lerp(34, 42, k)],
        trackLookOffset: [lerp(-2, 10, k), lerp(-1.5, -2.5, k), lerp(0, -6, k)],
        fov: 46,
        hour: 16.75,
        weather: 'clear',
      };
    },
  },

  // =========================================================================
  // S7a. 8D Mountain Infrastructure — Sujiaba 72m Spiral Overpass (Bars 15-16, 6.7s)
  // Rising helical aerial arc showcasing 8D Chongqing topography, 72m tall
  // concrete piers plunging into the mountain valley & spiraling deck ramps.
  // =========================================================================
  {
    name: 's07a_sujiaba_spiral',
    bars: 2,
    dissolve: 22,
    pre: 16,
    t0: 14.0,
    weather: 'clear',
    cam: (u) => {
      const k = ease(u, 0.6);
      const p = orbit(-2448.7, 2634.5, lerp(164, 144, k), lerp(24, 76, k), lerp(142, 212, k));
      const t = [-2448.7, lerp(144, 154, k), 2634.5];
      return { p, t, fov: 48, hour: 16.05, weather: 'clear' };
    },
  },

  // =========================================================================
  // S7b. 8D Mountain Infrastructure — Shihuang Twin Tunnel Portals (Bars 17-18, 6.7s)
  // Smooth descending approach toward the twin stone-clad mountain tunnel
  // portals as live Chongqing traffic streams cleanly in & out of the cliff!
  // =========================================================================
  {
    name: 's07b_shihuang_tunnels',
    bars: 2,
    dissolve: 20,
    pre: 28,
    t0: 16.0,
    weather: 'clear',
    cam: (u) => {
      const k = ease(u, 0.55);
      const p = lerp3([-1096, 75.0, -464], [-1078, 66.2, -422], k);
      const t = lerp3([-1087, 61.5, -382], [-1086, 60.8, -378], k);
      return { p, t, fov: 48, hour: 15.9, weather: 'clear' };
    },
  },

  // =========================================================================
  // S8a. Great Hall of the People — Sunset Dusk Crane Arc (Bars 19-20, 6.7s)
  // Majestic rising arc around the triple-eaved green dome & crimson colonnade
  // as golden sunlight melts into dusk and warm architectural lighting ignites.
  // =========================================================================
  {
    name: 's08a_greathall_dusk',
    bars: 2,
    dissolve: 26,
    pre: 12,
    t0: 18.0,
    weather: 'clear',
    cam: (u) => {
      const k = ease(u, 0.65);
      const p = orbit(-2246.6, -472.4, lerp(176, 158, k), lerp(104, 68, k), lerp(88, 114, k));
      const t = [-2246.6, lerp(96, 100, k), -472.4];
      return { p, t, fov: 46, hour: lerp(17.75, 18.08, u), weather: 'clear' };
    },
  },

  // =========================================================================
  // S8b. Chongqing Grand Theatre — Blue Hour Glow (Bars 21-22, 6.7s)
  // Sweeping blue-hour arc around the faceted glowing emerald-cyan glass sails
  // on the north bank of the Jialing with Yuzhong skyline lighting up behind.
  // =========================================================================
  {
    name: 's08b_grandtheatre_blue',
    bars: 2,
    dissolve: 28,
    pre: 12,
    t0: 20.0,
    weather: 'clear',
    cam: (u) => {
      const k = ease(u, 0.65);
      const p = orbit(403.4, -1399.9, lerp(255, 228, k), lerp(120, 154, k), lerp(92, 114, k));
      const t = [403.4, lerp(90, 94, k), -1399.9];
      return { p, t, fov: 46, hour: lerp(18.38, 18.72, u), weather: 'clear' };
    },
  },

  // =========================================================================
  // S9. Hongyadong Spirited-Away Night Climax (Bars 23-25, 10.0s)
  // Slow majestic horizontal riverfront dolly + gentle tilt-up across all 11
  // glowing golden-amber diaojiaolou tiers, dougong eaves, crimson lanterns,
  // cliff waterfall & golden reflection across the Jialing River.
  // =========================================================================
  {
    name: 's09_hongyadong_night',
    bars: 3,
    dissolve: 32,
    pre: 16,
    t0: 22.0,
    weather: 'clear',
    cam: (u) => {
      const k = ease(u, 0.68);
      const along = lerp(-54, 58, k);
      const dist = lerp(218, 188, k);
      const p = [
        HYD[0] + HYD_N[0] * dist + HYD_T[0] * along,
        lerp(24, 54, k),
        HYD[2] + HYD_N[1] * dist + HYD_T[1] * along,
      ];
      const t = [
        HYD[0] + HYD_T[0] * lerp(-10, 8, k),
        lerp(52, 72, k),
        HYD[2] + HYD_T[1] * lerp(-10, 8, k),
      ];
      return { p, t, fov: 48, hour: 21.0, weather: 'clear' };
    },
  },

  // =========================================================================
  // S10. Rainy Cyber-Chongqing Street Walk (Bars 26-27, 6.7s)
  // 1.85m steadycam gliding down a neon-lit wet Yuzhong slope with mirror
  // puddle reflections, glowing shop interiors, rain streaks, umbrellas & taxis.
  // =========================================================================
  {
    name: 's10_rainy_cyber_walk',
    bars: 2,
    dissolve: 30,
    pre: 24,
    t0: 26.0,
    weather: 'rain',
    cam: (u) => {
      const k = ease(u, 0.5);
      const p = lerp3([86, 0, 90], [91, 0, 62], k);
      const t = lerp3([84, 0, -140], [72, 0, -165], k);
      return { p, t, agl: 1.85, tAgl: lerp(22, 30, k), fov: 54, hour: 21.2, weather: 'rain' };
    },
  },

  // =========================================================================
  // S11. Grand Finale — Nanshan Yikeshu Cyber-Night Panorama (Bars 28-31, 13.3s)
  // Epic wide pan & gentle pull-back over the glowing 8D Yuzhong peninsula,
  // Two-Rivers cruise ships, illuminated bridges & Raffles sails -> end card!
  // =========================================================================
  {
    name: 's11_nanshan_finale',
    bars: 4,
    dissolve: 34,
    pre: 14,
    t0: 30.0,
    weather: 'clear',
    cam: (u) => {
      const k = smoother(clamp01(u / 0.94));
      const p = lerp3([2355, 294, 1240], [2438, 340, 1302], k);
      const t = lerp3([330, 112, -330], [645, 132, -690], k);
      return { p, t, fov: lerp(46, 44, k), hour: 21.0, weather: 'clear' };
    },
  },
];

for (const x of ALL) {
  x.frames = x.frames || x.bars * BAR + TAIL;
}

export const shots = ALL;
export const TOTAL_BARS = ALL.reduce((s, x) => s + x.bars, 0);
