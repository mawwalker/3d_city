// Camera choreography math helpers for Chongqing 3D Cinema Film.
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp01 = (t) => Math.max(0, Math.min(1, t));
export const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const smoother = (t) => { t = clamp01(t); return t * t * t * (t * (6 * t - 15) + 10); };
/** Blend between linear (k=0) and smoothstep (k=1) for motivated, unhurried camera motion. */
export const ease = (t, k = 0.65) => lerp(clamp01(t), smooth(t), k);
/** Smooth ease-in that settles into steady cruising speed (ideal when dissolving out while moving). */
export const easeIn = (t, k = 0.35) => {
  t = clamp01(t);
  return t < k ? (t * t) / (2 * k) / (1 - k / 2) : (t - k / 2) / (1 - k / 2);
};
/** Uniform Catmull-Rom spline through control points, t in 0..1. */
export function spline(pts, t) {
  const n = pts.length - 1;
  const x = clamp01(t) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p3 = pts[Math.min(n, i + 2)];
  const out = [];
  for (let k = 0; k < p1.length; k++) {
    const a = 2 * p1[k];
    const b = p2[k] - p0[k];
    const c = 2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k];
    const d = -p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k];
    out.push(0.5 * (a + b * f + c * f * f + d * f * f * f));
  }
  return out;
}
/** Point on a horizontal circle around (cx, cz) at altitude y; deg = 0 is north (-Z), clockwise. */
export const orbit = (cx, cz, r, deg, y) => [
  cx + Math.sin((deg * Math.PI) / 180) * r,
  y,
  cz - Math.cos((deg * Math.PI) / 180) * r,
];
