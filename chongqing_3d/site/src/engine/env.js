// Time of day and weather for Chongqing (Jiefangbei 29.557N, 106.577E, CST = UTC+8).
// Includes signature Chongqing "雾都" (Fog City) river-valley mist alongside crisp mountain sun, dusk, cyber-night, and rain.

import * as THREE from 'three';
import { sunTransmittance } from './atmosphere.js';

const LAT = 29.5572 * Math.PI / 180;
const LON = 106.5771;
export const DEFAULT_DOY = 285; // Mid-October: dramatic low-angle golden sunlight across Yuzhong cliffs & bridges

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Solar azimuth (clockwise from north) and elevation, radians, for China Standard Time wall-clock hour. */
export function solarPosition(hour, doy = DEFAULT_DOY) {
  const B = 2 * Math.PI * (doy - 81) / 364;
  const decl = 23.45 * Math.PI / 180 * Math.sin(B);
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const solar = hour + (4 * (LON - 120) + eot) / 60;
  const H = (solar - 12) * 15 * Math.PI / 180;
  const sinEl = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT) - Math.tan(decl) * Math.cos(LAT)) + Math.PI;
  return { az, el };
}

const dirFrom = (az, el, out) => out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));

export const WEATHER = {
  clear:    { haze: 1.9, mist: 0.06, cloud: 0.22, cloudDensity: 0.85, wet: 0.0,  sun: 1.0,  label: '晴' },
  mist:     { haze: 4.4, mist: 0.65, cloud: 0.48, cloudDensity: 1.15, wet: 0.18, sun: 0.62, label: '雾都' },
  haze:     { haze: 5.2, mist: 0.35, cloud: 0.35, cloudDensity: 1.0,  wet: 0.05, sun: 0.88, label: '轻岚' },
  cloudy:   { haze: 2.8, mist: 0.18, cloud: 0.66, cloudDensity: 1.3,  wet: 0.05, sun: 0.82, label: '多云' },
  overcast: { haze: 4.6, mist: 0.45, cloud: 0.96, cloudDensity: 2.1,  wet: 0.25, sun: 0.14, label: '阴' },
  rain:     { haze: 6.4, mist: 0.55, cloud: 1.0,  cloudDensity: 2.5,  wet: 1.0,  sun: 0.05, label: '夜雨' },
};

export class Environment {
  constructor(atmosphere) {
    this.atmo = atmosphere;
    this.hour = 16.8;
    this.doy = DEFAULT_DOY;
    this.weatherName = 'clear';
    this.weather = { ...WEATHER.clear };
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.lightColor = new THREE.Vector3();
    this.elevation = 0;
    this.night = 0;
    this.lights = 0;
    this.shadowStrength = 1;
    this.sunIntensity = 23;
    this.exposureBias = 0;
    this.waterY = 0; // updated when terrain.json loads
    this.wind = new THREE.Vector2();
    this.uniforms = {
      uTime: { value: 0 },
      uLightDir: { value: this.lightDir },
      uNight: { value: new THREE.Vector4(0, 0, 0, 0) },     // x: night, y: city lights 0..1, z: wetness, w: frame
      uWind: { value: new THREE.Vector4(0.85, 0.52, 0.65, 0) },
      uWaterY: { value: 0 },
    };
    this.setHour(this.hour);
  }

  setWaterY(y) {
    this.waterY = y;
    this.uniforms.uWaterY.value = y;
  }

  setWeather(name) {
    if (!WEATHER[name]) return;
    this.weatherName = name;
    this.weatherTarget = { ...WEATHER[name] };
  }

  setHour(hour) {
    this.hour = ((hour % 24) + 24) % 24;
    this._dirty = true;
  }

  _apply() {
    const { az, el } = solarPosition(this.hour, this.doy);
    const e = el * 180 / Math.PI;
    this.elevation = e;
    dirFrom(az, el, this.sunDir);
    dirFrom(145 * Math.PI / 180, 44 * Math.PI / 180, this.moonDir);
    const a = this.atmo.uniforms, w = this.weather;
    a.uSunDirTrue.value.copy(this.sunDir);
    a.uMoonDir.value.copy(this.moonDir);
    a.uAtmo.value.set(w.haze, 1.35, 0.80, 0.25);
    a.uCloud.value.x = w.cloud;
    a.uCloud2.value.set(w.cloudDensity, 0.52 * smooth(-2, 6, e), 0.3, w.mist || 0);
    const night = 1 - smooth(-8.5, -1.5, e);
    this.night = night;
    this.lights = 1 - smooth(-5.0, 3.5, e);
    const T = sunTransmittance(0.22, Math.sin(el), w.haze, 1.35);
    const sunK = this.sunIntensity * w.sun;
    const sun = new THREE.Vector3(T[0], T[1], T[2]).multiplyScalar(sunK);
    const ov = w.cloud * (1 - Math.min(1, w.sun * 2.5));
    a.uSkyParams.value.y = this.sunIntensity * (0.25 + 0.75 * Math.min(1, w.sun * 3 + 0.25)) * (1 - 0.78 * ov);
    a.uSkyParams.value.z = night;
    a.uSunRadiance.value.copy(sun);
    // Deep moody midnight indigo-navy sky zenith (warm city horizon glow is added selectively near d.y ~ 0 in atmosphere.js)
    const moonK = smooth(-4.5, -10, e);
    const cloudLift = 1.0 + 0.38 * w.cloud + 0.22 * (w.mist || 0) + 0.14 * Math.min(1, w.haze / 5);
    a.uNightSky.value.set(0.0045, 0.0105, 0.028).multiplyScalar(cloudLift * night);
    if (moonK > 0.5) {
      const m = (moonK - 0.5) * 2;
      this.lightDir.copy(this.moonDir);
      this.lightColor.set(0.042, 0.058, 0.095).multiplyScalar(m * (1 - 0.75 * w.cloud));
      this.shadowStrength = 0.75 * m;
    } else {
      dirFrom(az, Math.max(el, 2.0 * Math.PI / 180), this.lightDir);
      const k = 1 - moonK * 2;
      this.lightColor.copy(sun).multiplyScalar(k * smooth(-1.2, 0.8, e));
      this.shadowStrength = smooth(-1.5, 1.8, e) * k;
    }
    const skyAmb = new THREE.Vector3(0.20, 0.31, 0.54).multiplyScalar(this.sunIntensity * 0.045 * smooth(-10, 10, e)).add(a.uNightSky.value);
    skyAmb.lerp(new THREE.Vector3(1, 1, 1).multiplyScalar(skyAmb.y), w.cloud * 0.78);
    skyAmb.multiplyScalar(0.55 + 0.45 * Math.min(1, w.sun / 0.1));
    a.uSkyAmbient.value.copy(skyAmb).addScaledVector(sun, 0.03);
    const groundAlbedo = 0.24;
    a.uGroundRadiance.value.copy(sun).multiplyScalar(Math.max(0, Math.sin(el)) / Math.PI).add(skyAmb.clone().multiplyScalar(0.8)).multiplyScalar(groundAlbedo);
    a.uGroundRadiance.value.add(new THREE.Vector3(1.0, 0.58, 0.30).multiplyScalar(0.018 * this.lights));
    this.uniforms.uNight.value.x = night;
    this.uniforms.uNight.value.y = this.lights;
    this.uniforms.uNight.value.z = w.wet;
  }

  update(time, dt, frame) {
    if (this.weatherTarget) {
      const k = Math.min(1, dt * 1.1);
      let done = true;
      for (const key of ['haze', 'mist', 'cloud', 'cloudDensity', 'wet', 'sun']) {
        const d = (this.weatherTarget[key] ?? 0) - (this.weather[key] ?? 0);
        if (Math.abs(d) > 1e-3) { this.weather[key] = (this.weather[key] ?? 0) + d * k; done = false; }
        else this.weather[key] = this.weatherTarget[key] ?? 0;
      }
      this._dirty = true;
      if (done) this.weatherTarget = null;
    }
    if (this._dirty) { this._apply(); this._dirty = false; }
    const u = this.uniforms;
    u.uTime.value = time;
    u.uNight.value.w = frame;
    this.wind.set(time * 7.5, time * 2.8);
    this.atmo.uniforms.uCloud.value.z = this.wind.x;
    this.atmo.uniforms.uCloud.value.w = this.wind.y;
    this.atmo.uniforms.uSkyParams.value.w = time;
    u.uWind.value.w = time;
  }
}
