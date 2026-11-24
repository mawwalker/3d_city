// Screen-space passes: GTAO micro-occlusion, HeightField sky visibility, TAA, dual-filter bloom, auto-exposure, AgX grade.

import { PRECISION, NOISE, GBUFFER_DECODE, TONEMAP } from './glsl.js';

export const GTAO_FRAG = (slices, steps) => /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_DECODE}
uniform mat3 uViewRot;
uniform vec4 uAoParams;           // x: street radius (m), y: depth fraction, z: frame, w: intensity
uniform vec2 uRes;
in vec2 vUv; out vec4 fragColor;
#ifndef PI
#define PI 3.14159265359
#endif
void main() {
  float depth = texture(tDepth, vUv).r;
  if (isSky(depth)) { fragColor = vec4(1.0, 60.0, 0.0, 1.0); return; }
  vec3 P = viewPosAt(vUv, depth);
  float z = -P.z;
  vec3 N = normalize(uViewRot * octDecode(unpack2x12(texture(tNormal, vUv).rgb)));
  vec3 V = normalize(-P);
  float R = max(uAoParams.x, z * uAoParams.y);
  float pxPerM = uProj.y * 0.5 * uRes.y / z;
  float rpx = R * pxPerM;
  if (rpx < 1.5) { fragColor = vec4(1.0, z * 0.001, 0.0, 1.0); return; }
  float maxPx = 0.12 * uRes.y;
  if (rpx > maxPx) { R *= maxPx / rpx; rpx = maxPx; }
  float n1 = ignT(gl_FragCoord.xy, uAoParams.z);
  float n2 = fract(n1 * 7.7 + 0.37);
  float falloffFrom = R * 0.28, falloffRange = R - falloffFrom;
  float falloffMul = -1.0 / falloffRange, falloffAdd = falloffFrom / falloffRange + 1.0;
  float vis = 0.0;
  const int SLICES = ${slices}, STEPS = ${steps};
  for (int s = 0; s < SLICES; s++) {
    float phi = (float(s) + n1) / float(SLICES) * PI;
    vec2 omega = vec2(cos(phi), sin(phi));
    vec3 dirV = vec3(omega, 0.0);
    vec3 orthoDir = dirV - dot(dirV, V) * V;
    vec3 axis = normalize(cross(orthoDir, V));
    vec3 projN = N - axis * dot(N, axis);
    float projLen = length(projN);
    float sgn = sign(dot(orthoDir, projN));
    float cosN = clamp(dot(projN, V) / max(projLen, 1e-5), 0.0, 1.0);
    float n = sgn * acos(cosN);
    float lowCos0 = cos(n + PI * 0.5), lowCos1 = cos(n - PI * 0.5);
    float hc0 = lowCos0, hc1 = lowCos1;
    for (int k = 0; k < STEPS; k++) {
      float t = (float(k) + n2) / float(STEPS);
      // Tighter inner distribution clusters samples inside 5-35cm window reveals, balcony joints & curbs
      t = t * t * sqrt(t);
      vec2 off = omega * max(t * rpx, 1.0) / uRes;
      vec2 uv0 = vUv + off, uv1 = vUv - off;
      vec3 d0 = viewPosAt(uv0, texture(tDepth, uv0).r) - P;
      vec3 d1 = viewPosAt(uv1, texture(tDepth, uv1).r) - P;
      float l0 = length(d0), l1 = length(d1);
      float w0 = clamp(l0 * falloffMul + falloffAdd, 0.0, 1.0), w1 = clamp(l1 * falloffMul + falloffAdd, 0.0, 1.0);
      hc0 = max(hc0, mix(lowCos0, dot(d0 / max(l0, 1e-5), V), w0));
      hc1 = max(hc1, mix(lowCos1, dot(d1 / max(l1, 1e-5), V), w1));
    }
    float h0 = n + clamp(-acos(clamp(hc1, -1.0, 1.0)) - n, -PI * 0.5, PI * 0.5);
    float h1 = n + clamp(acos(clamp(hc0, -1.0, 1.0)) - n, -PI * 0.5, PI * 0.5);
    float iarc0 = (cosN + 2.0 * h0 * sin(n) - cos(2.0 * h0 - n)) * 0.25;
    float iarc1 = (cosN + 2.0 * h1 * sin(n) - cos(2.0 * h1 - n)) * 0.25;
    vis += projLen * (iarc0 + iarc1);
  }
  vis /= float(SLICES);
  vis = pow(clamp(vis, 0.0, 1.0), uAoParams.w);
  vis = mix(1.0, vis, smoothstep(1.5, 4.5, rpx));
  fragColor = vec4(vis, z * 0.001, 0.0, 1.0);
}`;

export const AO_BLUR_FRAG = /* glsl */`${PRECISION}
uniform sampler2D tAo; uniform vec2 uDir;
in vec2 vUv; out vec4 fragColor;
void main() {
  vec2 c = texture(tAo, vUv).rg;
  float sum = c.r * 0.30, w = 0.30;
  float g[3]; g[0] = 0.22; g[1] = 0.10; g[2] = 0.03;
  for (int i = 1; i <= 3; i++) {
    vec2 a = texture(tAo, vUv + uDir * float(i)).rg, b = texture(tAo, vUv - uDir * float(i)).rg;
    float tol = 1.0 / (c.g * 0.02 + 1e-5);
    float wa = g[i - 1] * max(0.0, 1.0 - abs(a.g - c.g) * tol), wb = g[i - 1] * max(0.0, 1.0 - abs(b.g - c.g) * tol);
    sum += a.r * wa + b.r * wb; w += wa + wb;
  }
  fragColor = vec4(sum / w, c.g, 0.0, 1.0);
}`;

export const AO_UPSAMPLE_FRAG = /* glsl */`${PRECISION}
${GBUFFER_DECODE}
uniform sampler2D tAo; uniform vec2 uAoRes;
uniform sampler2D tHeight;
uniform mat3 uCamRot; uniform vec3 uCamPos;
uniform vec4 uHeightRect;
uniform vec2 uHeightConv;
uniform float uFrameN;
in vec2 vUv; out vec4 fragColor;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  float depth = texture(tDepth, vUv).r;
  if (isSky(depth)) { fragColor = vec4(1.0); return; }
  float z0 = linearZ(depth);
  vec2 p = vUv * uAoRes - 0.5; vec2 ip = floor(p), f = p - ip;
  ivec2 hi = ivec2(uAoRes) - 1;
  float s = 0.0, w = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 a = texelFetch(tAo, clamp(ivec2(ip) + ivec2(i, j), ivec2(0), hi), 0).rg;
    float bw = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y) + 0.02;
    float wz = bw / (0.0005 + abs(a.g * 1000.0 - z0) / z0);
    s += a.r * wz; w += wz;
  }
  float ao = s / w;
  float sky = 1.0;
  if (uHeightRect.w > 0.5) {
    vec3 P = viewPosAt(vUv, depth);
    vec3 W = uCamPos + uCamRot * P;
    vec3 N = octDecode(unpack2x12(texture(tNormal, vUv).rgb));
    vec2 uv0 = vec2(W.x - uHeightRect.x, uHeightRect.y - W.z) * uHeightRect.z;
    if (uv0.x > 0.01 && uv0.x < 0.99 && uv0.y > 0.01 && uv0.y < 0.99) {
      float a0 = ign(gl_FragCoord.xy + 17.0 * mod(uFrameN, 16.0)) * 6.2831853;
      float open = 0.0, wsum = 0.0;
      const int DIRS = 6;
      for (int d = 0; d < DIRS; d++) {
        float ang = a0 + float(d) * 6.2831853 / float(DIRS);
        vec2 dir = vec2(cos(ang), sin(ang));
        float facing = dot(dir, N.xz);
        float wd = N.y > 0.7 ? 1.0 : max(facing * 0.5 + 0.5, 0.0);
        if (wd < 0.05) continue;
        float maxTan = 0.0;
        for (int k = 1; k <= 4; k++) {
          float r = 3.0 * float(k * k) + 1.0;
          float h = uHeightConv.x + uHeightConv.y * textureLod(tHeight, uv0 + vec2(dir.x, -dir.y) * r * uHeightRect.z, 0.0).r;
          maxTan = max(maxTan, (h - W.y - 0.6) / r);
        }
        float t2 = maxTan > 0.0 ? maxTan * maxTan / (1.0 + maxTan * maxTan) : 0.0;
        open += wd * (1.0 - t2); wsum += wd;
      }
      sky = wsum > 0.0 ? open / wsum : 1.0;
      vec2 e = min(uv0, 1.0 - uv0);
      sky = mix(1.0, sky, smoothstep(0.0, 0.08, min(e.x, e.y)));
    }
  }
  fragColor = vec4(ao, sky, 0.0, 1.0);
}`;

export const TAA_FRAG = /* glsl */`${PRECISION}
${GBUFFER_DECODE}
uniform sampler2D tCurrent, tHistory;
uniform mat4 uReproject;
uniform vec2 uRes;
uniform vec4 uTaa;
in vec2 vUv; out vec4 fragColor;
vec3 toYCoCg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
vec3 tm(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 itm(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-4); }
vec3 sampleHistory(vec2 uv) {
  vec2 pos = uv * uRes;
  vec2 c = floor(pos - 0.5) + 0.5;
  vec2 f = pos - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (c - 1.0) / uRes, t3 = (c + 2.0) / uRes, t12 = (c + w2 / w12) / uRes;
  vec3 r = texture(tHistory, vec2(t12.x, t0.y)).rgb * (w12.x * w0.y)
         + texture(tHistory, vec2(t0.x, t12.y)).rgb * (w0.x * w12.y)
         + texture(tHistory, vec2(t12.x, t12.y)).rgb * (w12.x * w12.y)
         + texture(tHistory, vec2(t3.x, t12.y)).rgb * (w3.x * w12.y)
         + texture(tHistory, vec2(t12.x, t3.y)).rgb * (w12.x * w3.y);
  float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / ws, 0.0);
}
void main() {
  vec2 px = 1.0 / uRes;
  vec3 cur = tm(texture(tCurrent, vUv).rgb);
  if (uTaa.y < 0.5) { fragColor = vec4(itm(cur), 1.0); return; }
  float d = texture(tDepth, vUv).r; vec2 duv = vUv;
  bool rev = uProjOff.z < 1.5;
  for (int i = 0; i < 4; i++) {
    vec2 o = (i == 0 ? vec2(1, 1) : i == 1 ? vec2(-1, 1) : i == 2 ? vec2(1, -1) : vec2(-1, -1)) * px;
    float di = texture(tDepth, vUv + o).r;
    if (rev ? di > d : di < d) { d = di; duv = vUv + o; }
  }
  vec2 prevUv;
  if (isSky(d)) {
    vec4 pc = uReproject * vec4(viewRay(vUv) * 1.0e5, 0.0);
    prevUv = pc.xy / pc.w * 0.5 + 0.5 + uTaa.zw;
  } else {
    vec4 pc = uReproject * vec4(viewPosAt(duv, d), 1.0);
    prevUv = pc.xy / pc.w * 0.5 + 0.5 + (vUv - duv) + uTaa.zw;
  }
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 c = toYCoCg(tm(texture(tCurrent, vUv + vec2(float(i), float(j)) * px).rgb));
    m1 += c; m2 += c * c;
  }
  m1 /= 9.0; m2 /= 9.0;
  vec3 sigma = sqrt(max(m2 - m1 * m1, 0.0));
  float gamma = 1.25;
  vec3 lo = m1 - gamma * sigma, hi = m1 + gamma * sigma;
  float wHist = uTaa.x;
  if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) wHist = 0.0;
  vec3 hist = toYCoCg(tm(sampleHistory(prevUv)));
  vec3 pc = 0.5 * (hi + lo), ec = 0.5 * (hi - lo) + 1e-5;
  vec3 v = hist - pc; vec3 u = abs(v / ec);
  float mu = max(u.x, max(u.y, u.z));
  if (mu > 1.0) hist = pc + v / mu;
  vec3 curY = toYCoCg(cur);
  float diff = abs(curY.x - hist.x) / max(curY.x, max(hist.x, 0.02));
  wHist *= mix(1.0, 0.82, diff * diff);
  if (texture(tMaterial, duv).a > 0.5) wHist *= 0.14;
  vec3 outc = fromYCoCg(mix(curY, hist, wHist));
  fragColor = vec4(itm(max(outc, 0.0)), 1.0);
}`;

export const DOWN_FRAG = /* glsl */`${PRECISION}
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uFirst; uniform float uThreshold;
in vec2 vUv; out vec4 fragColor;
float karis(vec3 c) { return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
void main() {
  vec2 t = uTexel;
  vec3 a = texture(tSrc, vUv + t * vec2(-2.0, 2.0)).rgb, b = texture(tSrc, vUv + t * vec2(0.0, 2.0)).rgb, c = texture(tSrc, vUv + t * vec2(2.0, 2.0)).rgb;
  vec3 d = texture(tSrc, vUv + t * vec2(-2.0, 0.0)).rgb, e = texture(tSrc, vUv).rgb, f = texture(tSrc, vUv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture(tSrc, vUv + t * vec2(-2.0, -2.0)).rgb, h = texture(tSrc, vUv + t * vec2(0.0, -2.0)).rgb, i = texture(tSrc, vUv + t * vec2(2.0, -2.0)).rgb;
  vec3 j = texture(tSrc, vUv + t * vec2(-1.0, 1.0)).rgb, k = texture(tSrc, vUv + t * vec2(1.0, 1.0)).rgb;
  vec3 l = texture(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb, m = texture(tSrc, vUv + t * vec2(1.0, -1.0)).rgb;
  vec3 col;
  if (uFirst > 0.5) {
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = karis(g0), w1 = karis(g1), w2 = karis(g2), w3 = karis(g3), w4 = karis(g4);
    col = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5) / (0.125 * (w0 + w1 + w2 + w3) + 0.5 * w4);
    float br = max(col.r, max(col.g, col.b));
    float soft = clamp(br - uThreshold + uThreshold * 0.5, 0.0, uThreshold);
    soft = soft * soft / (2.0 * uThreshold + 1e-4);
    col *= max(soft, br - uThreshold) / max(br, 1e-4);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  fragColor = vec4(max(col, 0.0), 1.0);
}`;

export const UP_FRAG = /* glsl */`${PRECISION}
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uRadius;
in vec2 vUv; out vec4 fragColor;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 c = texture(tSrc, vUv).rgb * 4.0;
  c += (texture(tSrc, vUv + vec2(t.x, 0.0)).rgb + texture(tSrc, vUv - vec2(t.x, 0.0)).rgb + texture(tSrc, vUv + vec2(0.0, t.y)).rgb + texture(tSrc, vUv - vec2(0.0, t.y)).rgb) * 2.0;
  c += texture(tSrc, vUv + t).rgb + texture(tSrc, vUv - t).rgb + texture(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture(tSrc, vUv + vec2(-t.x, t.y)).rgb;
  fragColor = vec4(c / 16.0, 1.0);
}`;

export const LUMA_FRAG = /* glsl */`${PRECISION}
uniform sampler2D tSrc;
in vec2 vUv; out vec4 fragColor;
void main() {
  vec3 c = texture(tSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec2 q = vUv - 0.5;
  float w = 1.0 - 0.6 * smoothstep(0.2, 0.7, length(q));
  fragColor = vec4(log(max(l, 1e-4)) * w, w, 0.0, 1.0);
}`;

export const ADAPT_FRAG = /* glsl */`${PRECISION}
uniform sampler2D tLuma, tPrev; uniform vec4 uAdapt;
in vec2 vUv; out vec4 fragColor;
void main() {
  vec2 s = vec2(0.0);
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) s += textureLod(tLuma, (vec2(float(i), float(j)) + 0.5) / 4.0, 3.0).rg;
  float cur = exp(s.r / max(s.g, 1e-4));
  float prev = texture(tPrev, vec2(0.5)).r;
  if (uAdapt.y > 0.5 || !(prev > 0.0)) prev = cur;
  float speed = cur > prev ? uAdapt.z : uAdapt.w;
  float v = prev + (cur - prev) * (1.0 - exp(-uAdapt.x * speed));
  fragColor = vec4(v, cur, 0.0, 1.0);
}`;

export const FINAL_FRAG = /* glsl */`${PRECISION}
uniform sampler2D tScene, tBloom, tExposure;
uniform vec4 uGrade;
uniform vec4 uGrade2;
uniform vec4 uExpo;
uniform vec3 uTint;
uniform vec2 uRes;
in vec2 vUv; out vec4 fragColor;
${TONEMAP}
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 px = 1.0 / uRes;
  vec3 hdr = texture(tScene, vUv).rgb;
  if (uGrade2.y > 0.0) {
    vec3 n = texture(tScene, vUv + vec2(0.0, px.y)).rgb, s = texture(tScene, vUv - vec2(0.0, px.y)).rgb;
    vec3 e = texture(tScene, vUv + vec2(px.x, 0.0)).rgb, w = texture(tScene, vUv - vec2(px.x, 0.0)).rgb;
    vec3 mn = min(hdr, min(min(n, s), min(e, w))), mx = max(hdr, max(max(n, s), max(e, w)));
    vec3 amp = clamp(min(mn, 2.0 - mx) / max(mx, 1e-4), 0.0, 1.0);
    vec3 wgt = sqrt(amp) * (-0.125 * uGrade2.y);
    vec3 sh = (hdr + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt);
    float lum = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
    hdr = mix(sh, hdr, smoothstep(1.0, 4.0, lum));
    hdr = max(hdr, 0.0);
  }
  vec3 bloom = texture(tBloom, vUv).rgb * (1.0 / 5.5);
  float exposure = uGrade.x;
  if (uExpo.w > 0.5) {
    float avg = texture(tExposure, vec2(0.5)).r;
    exposure *= clamp(uExpo.x / max(avg, 1e-4), uExpo.y, uExpo.z);
  }
  vec3 col = (hdr + bloom * uGrade.y) * exposure;
  col = agx(col);
  // Subtle filmic S-curve micro-contrast for deeper photographic shadows & crisper sunlit highlights
  vec3 sc = col * col * (3.0 - 2.0 * col);
  col = mix(col, sc, 0.13);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uGrade2.x);
  // Subtle photographic cool-shadow / warm-highlight filmic split tone
  col *= mix(vec3(0.958, 0.982, 1.035), uTint, smoothstep(0.04, 0.72, l));
  vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y * 0.82;
  col *= mix(1.0, smoothstep(1.0, 0.25, length(q)), uGrade.z);
  col = linearToSRGB(clamp(col, 0.0, 1.0));
  float n = h12(gl_FragCoord.xy + fract(uGrade2.w) * 311.7) - 0.5;
  col += n * (uGrade.w + 1.0 / 255.0);
  col *= uGrade2.z;
  fragColor = vec4(col, 1.0);
}`;
