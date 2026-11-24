// Quality tiers for Chongqing 3D.
export const QUALITY = {
  ultra:  { name: 'ultra',  dpr: 2.0, shadow: 2048, aoQuality: [4, 7], taa: true,  ao: true,  sharpen: 0.40, heightField: 1024, range: 1.35, waterSSR: true },
  high:   { name: 'high',   dpr: 1.5, shadow: 2048, aoQuality: [3, 6], taa: true,  ao: true,  sharpen: 0.42, heightField: 1024, range: 1.0,  waterSSR: true },
  medium: { name: 'medium', dpr: 1.0, shadow: 1024, aoQuality: [2, 4], taa: true,  ao: true,  sharpen: 0.42, heightField: 512,  range: 0.78, waterSSR: false },
  low:    { name: 'low',    dpr: 1.25, shadow: 1024, aoQuality: [2, 3], taa: false, ao: false, sharpen: 0.30, heightField: 512,  range: 0.55, waterSSR: false },
};

export function pickQuality(params) {
  const q = params.get('q');
  if (q && QUALITY[q]) return { ...QUALITY[q] };
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const mem = navigator.deviceMemory || 8;
  if (mobile) return { ...QUALITY.low };
  if (mem <= 4) return { ...QUALITY.medium };
  return { ...QUALITY.high };
}
