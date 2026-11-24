// Registry of all Chongqing 3D hero landmark modules.
// Uses resilient dynamic imports so each hero module (owned by @hero-yuzhong or @hero-bridges)
// loads cleanly in parallel development and integrates uniformly via the shared builder interface:
//   builder(ctx) -> { group, shadowGroup?, movingGroup?, update?(dt, time, env), colliders?, decks?, lights?, labels? }

const HERO_SPECS = [
  { name: 'hongyadong', path: './hongyadong.js', fn: 'buildHongyadong' },
  { name: 'raffles',    path: './raffles.js',    fn: 'buildRaffles' },
  { name: 'jiefangbei', path: './jiefangbei.js', fn: 'buildJiefangbei' },
  { name: 'civic',      path: './civic.js',      fn: 'buildCivic' },
  { name: 'bridges',    path: './bridges.js',    fn: 'buildBridges' },
  { name: 'monorail',   path: './monorail.js',   fn: 'buildMonorail' },
  { name: 'cableway',   path: './cableway.js',   fn: 'buildCableway' },
];

/** Load and build all available Chongqing hero modules in parallel. */
export async function buildAllHeroes(ctx) {
  const results = [];
  const mods = await Promise.all(HERO_SPECS.map(async (spec) => {
    try {
      const mod = await import(spec.path);
      return { spec, mod };
    } catch (err) {
      // Missing optional module during incremental build vs real syntax error
      console.warn(`[heroes] module ${spec.name} (${spec.path}) not loaded:`, err.message || err);
      return { spec, mod: null };
    }
  }));

  for (const { spec, mod } of mods) {
    if (!mod) continue;
    const fn = mod[spec.fn] || mod.default;
    if (typeof fn !== 'function') {
      console.warn(`[heroes] ${spec.path} missing export ${spec.fn}`);
      continue;
    }
    try {
      const res = await fn(ctx);
      if (res) results.push({ name: spec.name, ...res });
    } catch (err) {
      console.error(`[heroes] ${spec.name} build failed:`, err);
    }
  }
  return results;
}
