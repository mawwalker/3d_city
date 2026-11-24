// Small helpers for describing camera moves.
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp01 = (t) => Math.max(0, Math.min(1, t));
export const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const smoother = (t) => { t = clamp01(t); return t * t * t * (t * (6 * t - 15) + 10); };
/** Linear in the middle, eased at the two ends by `k` (0: linear, 1: smoothstep). */
export const ease = (t, k = 1) => lerp(t, smooth(t), k);
/** Eased only at the start (the shot comes to speed and keeps it: for moves that are cut or dissolved away while moving). */
export const easeIn = (t, k = 0.35) => { const a = k; return t < a ? (t * t) / (2 * a) / (1 - a / 2) : (t - a / 2) / (1 - a / 2); };
/** Catmull-Rom through the points, t in 0..1 over the whole run (centripetal enough for camera work: uniform). */
export function spline(pts, t) {
  const n = pts.length - 1, x = clamp01(t) * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const out = [];
  for (let k = 0; k < p1.length; k++) {
    const a = 2 * p1[k], b = p2[k] - p0[k], c = 2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k], d = -p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k];
    out.push(0.5 * (a + b * f + c * f * f + d * f * f * f));
  }
  return out;
}
/** A point on a circle round (cx, cz) at height y: bearing in degrees (0 = north of the centre, clockwise). */
export const orbit = (cx, cz, r, deg, y) => [cx + Math.sin(deg * Math.PI / 180) * r, y, cz - Math.cos(deg * Math.PI / 180) * r];
