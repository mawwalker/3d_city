// Quality tiers.
export const QUALITY = {
  ultra: { name: 'ultra', dpr: 2.0, shadow: 2048, aoQuality: [4, 6], taa: true, ao: true, sharpen: 0.5, heightField: 1024, range: 1.3 },
  high: { name: 'high', dpr: 1.5, shadow: 2048, aoQuality: [3, 5], taa: true, ao: true, sharpen: 0.55, heightField: 1024, range: 1.0 },
  medium: { name: 'medium', dpr: 1.0, shadow: 1024, aoQuality: [2, 4], taa: true, ao: true, sharpen: 0.6, heightField: 512, range: 0.75 },
  low: { name: 'low', dpr: 1.25, shadow: 1024, aoQuality: [2, 3], taa: false, ao: false, sharpen: 0.3, heightField: 512, range: 0.5 },
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
