// Quality tiers and view presets.

export const QUALITY = {
  ultra: { name: 'ultra', dpr: 2.0, samples: 4, shadow: 4096, aoSize: 4096, detailRange: 1.25, lodRange: 1.7, detailConcurrency: 4, trees: 1.0, treeNear: 1500, ao: { scale: 1, samples: 16 } },
  high: { name: 'high', dpr: 1.5, samples: 4, shadow: 4096, aoSize: 2048, detailRange: 1.0, lodRange: 1.0, detailConcurrency: 4, trees: 0.8, treeNear: 1150, ao: { scale: 0.5, samples: 14 } },
  medium: { name: 'medium', dpr: 1.25, samples: 2, shadow: 2048, aoSize: 2048, detailRange: 0.8, lodRange: 0.7, detailConcurrency: 3, trees: 0.5, treeNear: 700, ao: { scale: 0.5, samples: 9 } },
  low: { name: 'low', dpr: 1.0, samples: 0, shadow: 2048, aoSize: 1024, detailRange: 0.6, lodRange: 0.45, detailConcurrency: 2, trees: 0.3, maxShell: 5, garnish: 0 },   // skips the outermost ring of base tiles
};

export function pickQuality(renderer) {
  const q = new URLSearchParams(location.search).get('q');
  if (q && QUALITY[q]) return QUALITY[q];
  let name = 'high';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '').toLowerCase();
    const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
    if (mobile) name = 'low';
    else if (/swiftshader|llvmpipe|software/.test(s)) name = 'low';
    else if (/intel|iris|uhd|hd graphics/.test(s) && !/arc/.test(s)) name = 'medium';
    else if (/rtx|radeon rx|apple m[2-9]|apple m1 (pro|max|ultra)|arc/.test(s)) name = 'high';
  } catch (e) { /* keep default */ }
  return QUALITY[name];
}

// World frame: x east, z south (north = -z), origin = Tiananmen gate tower. Metres.
export const VIEWS = {
  hero: { x: 2300, z: -250, dist: 9200, heading: 267, pitch: 9.6 },      // keep in sync with the first entry of buildViews() in ui/ui.js
};
