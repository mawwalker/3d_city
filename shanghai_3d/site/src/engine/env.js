// Time of day and weather. One clock value drives the real solar geometry for Shanghai; light colours come from the
// atmosphere model (sun transmittance), so dawn, noon, dusk and night are all consistent with the sky that is drawn.

import * as THREE from 'three';
import { sunTransmittance } from './atmosphere.js';

const LAT = 31.2354 * Math.PI / 180;
const LON = 121.4672;
export const DEFAULT_DOY = 302;       // 29 October: clear autumn air, the sun low enough to model the towers all day

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Solar azimuth (clockwise from north) and elevation, radians, for a China Standard Time wall-clock hour. */
export function solarPosition(hour, doy = DEFAULT_DOY) {
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

// world frame: x east, y up, z south
const dirFrom = (az, el, out) => out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));

export const WEATHER = {
  clear: { haze: 2.4, cloud: 0.18, cloudDensity: 0.9, wet: 0, sun: 1, label: '晴' },
  haze: { haze: 5.0, cloud: 0.30, cloudDensity: 0.9, wet: 0, sun: 1, label: '薄霾' },
  cloudy: { haze: 2.6, cloud: 0.62, cloudDensity: 1.2, wet: 0, sun: 1, label: '多云' },
  overcast: { haze: 4.5, cloud: 0.98, cloudDensity: 2.2, wet: 0.15, sun: 0.10, label: '阴' },
  rain: { haze: 7.0, cloud: 1.0, cloudDensity: 2.6, wet: 1, sun: 0.04, label: '雨' },
};

export class Environment {
  constructor(atmosphere) {
    this.atmo = atmosphere;
    this.hour = 16.4;
    this.doy = DEFAULT_DOY;
    this.weatherName = 'clear';
    this.weather = { ...WEATHER.clear };
    this.sunDir = new THREE.Vector3();        // true sun direction
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3(0, 1, 0);   // main shadow-casting light (sun, or moon at night)
    this.lightColor = new THREE.Vector3();
    this.elevation = 0;
    this.night = 0;           // 0 day .. 1 night (sky)
    this.lights = 0;          // 0..1 city lights switched on
    this.shadowStrength = 1;
    this.sunIntensity = 22;   // radiance scale of the sun outside the atmosphere (arbitrary photometric unit)
    this.exposureBias = 0;    // stops
    this.wind = new THREE.Vector2();
    // uniforms shared by G-buffer materials (things the surface itself needs to know)
    this.uniforms = {
      uTime: { value: 0 },
      uLightDir: { value: this.lightDir },
      uNight: { value: new THREE.Vector4(0, 0, 0, 0) },     // x: night factor, y: city lights 0..1, z: wetness, w: frame index
      uWind: { value: new THREE.Vector4(1, 0, 0.6, 0) },    // xz direction, strength, gust phase
    };
    this.setHour(this.hour);
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
    // a fixed, pleasant moon: high in the south-east in the evening
    dirFrom(138 * Math.PI / 180, 42 * Math.PI / 180, this.moonDir);
    const a = this.atmo.uniforms, w = this.weather;
    a.uSunDirTrue.value.copy(this.sunDir);
    a.uMoonDir.value.copy(this.moonDir);
    a.uAtmo.value.set(w.haze, 1.2, 0.8, 0.25);
    a.uCloud.value.x = w.cloud;
    a.uCloud2.value.set(w.cloudDensity, 0.55 * smooth(-2, 6, e), 0.3, 0);
    const night = 1 - smooth(-9, -2, e);
    this.night = night;
    this.lights = 1 - smooth(-5.5, 2.5, e);
    // direct sun colour at the ground from the same transmittance integral the sky uses
    const T = sunTransmittance(0.02, Math.sin(el), w.haze, 1.2);
    const sunK = this.sunIntensity * w.sun;
    const sun = new THREE.Vector3(T[0], T[1], T[2]).multiplyScalar(sunK);
    // under a closed cloud deck the clear-sky glow (horizon, haze between you and the far towers) is as dull as the cloud base
    const ov = w.cloud * (1 - Math.min(1, w.sun * 2.5));
    a.uSkyParams.value.y = this.sunIntensity * (0.25 + 0.75 * Math.min(1, w.sun * 3 + 0.25)) * (1 - 0.8 * ov);
    a.uSkyParams.value.z = night;
    a.uSunRadiance.value.copy(sun);
    // night: moon light and the glow of the city on the haze
    const moonK = smooth(-4.5, -10, e);
    const glow = 0.010 + 0.016 * Math.min(1, w.haze / 5) + 0.02 * w.cloud;
    a.uNightSky.value.set(1.0, 0.72, 0.50).multiplyScalar(glow * this.lights * night).add(new THREE.Vector3(0.004, 0.007, 0.016).multiplyScalar(night));
    if (moonK > 0.5) {
      const m = (moonK - 0.5) * 2;
      this.lightDir.copy(this.moonDir);
      this.lightColor.set(0.035, 0.05, 0.085).multiplyScalar(m * (1 - 0.8 * w.cloud));
      this.shadowStrength = 0.8 * m;
    } else {
      // keep the shadow light slightly above the horizon so the cascades stay well conditioned
      dirFrom(az, Math.max(el, 1.6 * Math.PI / 180), this.lightDir);
      const k = 1 - moonK * 2;
      this.lightColor.copy(sun).multiplyScalar(k * smooth(-1.2, 0.6, e));
      this.shadowStrength = smooth(-1.5, 1.5, e) * k;
    }
    // sky ambient estimate for cloud lighting and the "city seen from above" colour in reflections
    const skyAmb = new THREE.Vector3(0.20, 0.30, 0.52).multiplyScalar(this.sunIntensity * 0.045 * smooth(-10, 10, e)).add(a.uNightSky.value);
    skyAmb.lerp(new THREE.Vector3(1, 1, 1).multiplyScalar(skyAmb.y), w.cloud * 0.8);
    skyAmb.multiplyScalar(0.55 + 0.45 * Math.min(1, w.sun / 0.1));          // rain clouds let less through than a dry overcast
    a.uSkyAmbient.value.copy(skyAmb).addScaledVector(sun, 0.03);
    const groundAlbedo = 0.24;
    a.uGroundRadiance.value.copy(sun).multiplyScalar(Math.max(0, Math.sin(el)) / Math.PI).add(skyAmb.clone().multiplyScalar(0.8)).multiplyScalar(groundAlbedo);
    a.uGroundRadiance.value.add(new THREE.Vector3(0.9, 0.6, 0.35).multiplyScalar(0.012 * this.lights));
    this.uniforms.uNight.value.x = night;
    this.uniforms.uNight.value.y = this.lights;
    this.uniforms.uNight.value.z = w.wet;
  }

  update(time, dt, frame) {
    // weather cross-fade
    if (this.weatherTarget) {
      const k = Math.min(1, dt * 0.9);
      let done = true;
      for (const key of ['haze', 'cloud', 'cloudDensity', 'wet', 'sun']) {
        const d = this.weatherTarget[key] - this.weather[key];
        if (Math.abs(d) > 1e-3) { this.weather[key] += d * k; done = false; } else this.weather[key] = this.weatherTarget[key];
      }
      this._dirty = true;
      if (done) this.weatherTarget = null;
    }
    if (this._dirty) { this._apply(); this._dirty = false; }
    const u = this.uniforms;
    u.uTime.value = time;
    u.uNight.value.w = frame;
    // clouds drift east at ~8 m/s
    this.wind.set(time * 8.0, time * 2.5);
    this.atmo.uniforms.uCloud.value.z = this.wind.x; this.atmo.uniforms.uCloud.value.w = this.wind.y;
    this.atmo.uniforms.uSkyParams.value.w = time;
    u.uWind.value.w = time;
  }
}
