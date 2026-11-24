// Time-of-day model. One clock value drives the real solar geometry for Beijing and, from the sun's
// elevation, every light / sky / haze colour in the scene. All world materials share these uniform objects.

import * as THREE from 'three';

const LAT = 39.907 * Math.PI / 180;
const LON = 116.391;
const DAY_OF_YEAR = 291;            // 18 October – clear, golden Beijing autumn

// Keyframes indexed by solar elevation (degrees). Colours are linear RGB, already scaled by intensity.
const E = [-18, -9, -5, -2, 0.5, 4, 9, 18, 35, 60];
const KEYS = {
  sun: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0.20, 0.05, 0.012], [1.5, 0.50, 0.14], [3.3, 1.55, 0.58], [4.3, 2.55, 1.20], [4.4, 3.3, 2.2], [4.2, 3.8, 3.2], [4.2, 3.95, 3.6]],
  zenith: [[0.006, 0.010, 0.028], [0.012, 0.022, 0.060], [0.030, 0.055, 0.15], [0.06, 0.105, 0.27], [0.085, 0.15, 0.36], [0.105, 0.20, 0.46], [0.12, 0.25, 0.56], [0.13, 0.30, 0.68], [0.13, 0.33, 0.78], [0.12, 0.33, 0.82]],
  horizon: [[0.050, 0.043, 0.052], [0.075, 0.068, 0.10], [0.16, 0.14, 0.24], [0.33, 0.26, 0.36], [0.50, 0.38, 0.42], [0.60, 0.47, 0.47], [0.66, 0.56, 0.54], [0.68, 0.70, 0.74], [0.66, 0.77, 0.88], [0.64, 0.78, 0.92]],
  glow: [[0.055, 0.045, 0.052], [0.16, 0.10, 0.12], [0.62, 0.26, 0.15], [1.2, 0.50, 0.19], [1.9, 0.85, 0.30], [2.1, 1.15, 0.48], [1.9, 1.25, 0.66], [1.25, 1.10, 0.90], [0.85, 0.90, 0.95], [0.74, 0.85, 0.95]],
  ambSky: [[0.010, 0.016, 0.036], [0.016, 0.026, 0.058], [0.045, 0.065, 0.13], [0.11, 0.13, 0.23], [0.16, 0.18, 0.29], [0.20, 0.235, 0.36], [0.25, 0.29, 0.42], [0.34, 0.41, 0.57], [0.40, 0.50, 0.70], [0.41, 0.51, 0.72]],
  ambGround: [[0.006, 0.007, 0.010], [0.008, 0.009, 0.014], [0.020, 0.020, 0.028], [0.045, 0.04, 0.042], [0.085, 0.066, 0.052], [0.13, 0.098, 0.07], [0.19, 0.15, 0.105], [0.27, 0.235, 0.18], [0.30, 0.275, 0.24], [0.30, 0.28, 0.25]],
  fogDensity: [2.0e-5, 2.2e-5, 2.3e-5, 2.4e-5, 2.5e-5, 2.5e-5, 2.2e-5, 1.9e-5, 1.7e-5, 1.6e-5],
  glowSharp: [3, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6, 6],
  exposure: [1.15, 1.15, 1.2, 1.15, 1.0, 0.9, 0.86, 0.86, 0.86, 0.86],
  cloud: [0.0, 0.0, 0.0, 0.1, 0.3, 0.42, 0.45, 0.42, 0.4, 0.4],     // cloud-shadow strength
  bloom: [3.2, 3.2, 3.0, 2.4, 2.0, 1.8, 1.5, 1.2, 1.0, 1.0],              // additive strength of the thresholded highlights
  bloomThreshold: [0.30, 0.30, 0.36, 0.6, 1.0, 1.25, 1.4, 1.5, 1.6, 1.6],
};

function sample(key, e) {
  const k = KEYS[key];
  if (e <= E[0]) return k[0];
  if (e >= E[E.length - 1]) return k[k.length - 1];
  let i = 0;
  while (e > E[i + 1]) i++;
  let t = (e - E[i]) / (E[i + 1] - E[i]);
  t = t * t * (3 - 2 * t);
  const a = k[i], b = k[i + 1];
  if (typeof a === 'number') return a + (b - a) * t;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Solar azimuth (clockwise from north) and elevation, radians, for a Beijing wall-clock hour. */
export function solarPosition(hour, doy = DAY_OF_YEAR) {
  const B = 2 * Math.PI * (doy - 81) / 364;
  const decl = 23.45 * Math.PI / 180 * Math.sin(B);
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);     // minutes
  const solar = hour + (4 * (LON - 120) + eot) / 60;
  const H = (solar - 12) * 15 * Math.PI / 180;
  const sinEl = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT) - Math.tan(decl) * Math.cos(LAT)) + Math.PI;
  return { az, el };
}

const dirFrom = (az, el, out) => out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));

export class Environment {
  constructor() {
    this.hour = 17.05;
    this.sunDir = new THREE.Vector3();       // true sun direction (may be below the horizon)
    this.moonDir = dirFrom(152 * Math.PI / 180, 40 * Math.PI / 180, new THREE.Vector3());
    this.elevation = 0;
    this.night = 0; this.lights = 0;
    this.exposure = 1; this.bloom = 0.1;
    this.cloudAmount = 0.42;                 // sky cloud cover 0..1 (art-directed)
    this.wind = new THREE.Vector2(0, 0);
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Vector3() },
      uSkyZenith: { value: new THREE.Vector3() },
      uSkyHorizon: { value: new THREE.Vector3() },
      uSunGlow: { value: new THREE.Vector3() },
      uAmbSky: { value: new THREE.Vector3() },
      uAmbGround: { value: new THREE.Vector3() },
      uFog: { value: new THREE.Vector4(3e-5, 1 / 1100, 1, 5) },
      uTimeNight: { value: new THREE.Vector4(0, 0, 0, 0) },
      uCloud: { value: new THREE.Vector4(0.4, 1 / 5200, 0, 0) },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowParams: { value: new THREE.Vector4(1 / 4096, 0, 1, 0.0008) },
      uShadowMap: { value: null },
      uAoMap: { value: null },
      uAoRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      // sky-only
      uTrueSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: this.moonDir },
      uSunDisk: { value: new THREE.Vector3() },
      uCloudAmount: { value: 0.5 },
      uSeason: { value: 0.62 },            // 0 = midsummer green, 1 = deep autumn
      uSnow: { value: 0 },                 // 0..1 fresh snow
    };
    this.shadowStrength = 1;
    this.setHour(this.hour);
  }

  /** hour: Beijing wall clock, 0..24 */
  setHour(hour) {
    this.hour = hour;
    const { az, el } = solarPosition(hour);
    const e = el * 180 / Math.PI;
    this.elevation = e;
    dirFrom(az, el, this.sunDir);
    const u = this.uniforms;
    u.uTrueSunDir.value.copy(this.sunDir);
    const sun = sample('sun', e);
    const night = 1 - smooth(-8, -1.5, e);
    const moonK = smooth(-5.5, -10, e);          // moon takes over as main light
    this.night = night;
    this.lights = 1 - smooth(-6.5, 3.5, e);
    // main light: sun, cross-fading to a dim cool moon
    if (moonK > 0.5) {
      u.uSunDir.value.copy(this.moonDir);
      const m = (moonK - 0.5) * 2;
      u.uSunColor.value.set(0.045 * m, 0.068 * m, 0.125 * m);
      this.shadowStrength = 0.55 * m;
    } else {
      // keep the light a little above the horizon so shadows stay well conditioned
      const elc = Math.max(el, 2.2 * Math.PI / 180);
      dirFrom(az, elc, u.uSunDir.value);
      const k = 1 - moonK * 2;
      u.uSunColor.value.set(sun[0] * k, sun[1] * k, sun[2] * k);
      this.shadowStrength = smooth(-1.5, 2.5, e) * k;
    }
    u.uSunDisk.value.set(...sample('sun', Math.max(e, 0.5))).multiplyScalar(smooth(-2.5, 0.5, e));
    u.uSkyZenith.value.set(...sample('zenith', e));
    u.uSkyHorizon.value.set(...sample('horizon', e));
    u.uSunGlow.value.set(...sample('glow', e));
    u.uAmbSky.value.set(...sample('ambSky', e));
    u.uAmbGround.value.set(...sample('ambGround', e));
    u.uFog.value.set(sample('fogDensity', e), 1 / 1100, 1.0, sample('glowSharp', e));
    u.uTimeNight.value.y = night;
    u.uTimeNight.value.z = this.lights;
    u.uTimeNight.value.w = smooth(-12, -3, e) * (1 - smooth(-3, 6, e));
    u.uCloud.value.x = sample('cloud', e) * this.cloudAmount * 1.6;
    u.uCloudAmount.value = this.cloudAmount;
    this.exposure = sample('exposure', e);
    this.bloom = sample('bloom', e);
    this.bloomThreshold = sample('bloomThreshold', e);
  }

  update(time) {
    const u = this.uniforms;
    u.uTimeNight.value.x = time;
    // clouds drift east-south-east at ~9 m/s
    this.wind.set(time * 8.5, time * 3.2);
    u.uCloud.value.z = this.wind.x; u.uCloud.value.w = this.wind.y;
  }
}
