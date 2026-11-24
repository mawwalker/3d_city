// Chongqing 3D building archetypes, roof types, surface kinds, and shared deterministic facade-grid helpers.
// Shared contract with pipeline/21_heights_styles.py, buildingGeom.js, facadeKit.js, roofGeom.js, and buildingMaterial.js.

// ---- 20 Chongqing architectural archetypes (0..19) + 20 reserved for landmark prism helpers
export const ST = {
  generic: 0,
  cbd_supertall: 1,     // Modern Chongqing CBD glass curtain-wall supertall (>100m, vertical fins, mechanical louvers, LED crown)
  office_glass: 2,      // Contemporary glass curtain-wall office tower (40-100m, podium + mullions)
  office_grid: 3,       // Granite/aluminum punched-window office / mixed-use tower
  resi_modern: 4,       // Contemporary Chongqing 25-45F residential high-rise (3D balconies, glass railings, bay windows, concrete fins)
  resi_old_highrise: 5, // Classic 1990s-2000s Chongqing high-rise / slab tower (mosaic tiles, ledges, enclosed sunrooms, dense AC units)
  resi_walkup: 6,       // Old 6-8F walk-up residential (overhanging balconies, sunshade canopies, stair-core glass blocks)
  bayu_vernacular: 7,   // Bayu hillside vernacular / diaojiaolou-inspired block (cantilevered timber galleries, struts, grey pitched roofs)
  historic_masonry: 8,  // Historic Republican / opening-port sandstone & brick masonry (rusticated base, pilasters, dentil cornices)
  commercial_mall: 9,   // Jiefangbei / Guanyinqiao commercial mall & street arcade (double-height glazed shopfronts, canopies, LED billboards)
  hotel: 10,            // Upscale hotel / serviced apartment tower (grand entrance canopy, stone podium, warm evening rhythm)
  civic: 11,            // Civic / cultural / government institutional building (monumental colonnade, limestone/granite)
  campus: 12,           // School / university / hospital (bright horizontal ribbon-window galleries, sunshade eyebrows)
  industrial: 13,       // Industrial / warehouse / logistics hall (corrugated steel / precast panels, clerestory windows)
  temple: 14,           // Traditional Bayu temple / pavilion / heritage hall (xieshan upturned dark-grey tile roof, crimson timber)
  bigroof: 15,          // Large-span terminal / station / stadium hall
  canopy: 16,           // Open canopy / shelter
  tank: 17,             // Industrial tank / silo / cooling tower
  parking: 18,          // Multi-story parking garage (deep open concrete decks)
  construction: 19,     // Under-construction structural frame
  landmark_glass: 20,   // Reserved for addPrism landmark curtain walls
};

// ---- Roof types (0..10)
export const ROOF = {
  flat: 0,
  gable: 1,
  hip: 2,
  pyramid: 3,
  xieshan: 4,
  mansard: 5,
  stepped_crown: 6,
  dome: 7,
  shed: 8,
  round: 9,
  sawtooth: 10,
};

// ---- Surface material kinds written per vertex in aNrm.w (0..127)
export const KIND = {
  wall: 0,           // Main procedural facade wall (windows, rooms, shops, weathering)
  roofFlat: 1,       // Waterproofed flat roof (bitumen / concrete with ponding & stains)
  roofTile: 2,       // Pitched Bayu dark-grey tile / clay tile roof
  trim: 3,           // Architectural concrete / limestone trim (coping, sills, ledges, pilasters, cornices, bulkheads)
  mass: 4,           // Distant block mass proxy
  metal: 5,          // Brushed aluminum / steel (curtain-wall fins, tanks, HVAC, awning frames)
  glass: 6,          // Architectural glass (balcony guardrails, sunrooms, bay windows, skylights, glass canopies)
  roofMetal: 7,      // Corrugated / standing-seam metal roof
  soffit: 8,         // Shaded undersides of overhangs, balconies, eaves, canopies, raised blocks
  equipment: 9,      // Mechanical louver bands, refuge floors, elevator/HVAC plant rooms
  plinthStone: 10,   // Chongqing sandstone retaining wall (石砌堡坎) with damp mossy base
  podiumWall: 11,    // Ground-podium granite / limestone architectural cladding
  timber: 12,        // Lacquered dark Bayu timber (diaojiaolou stilts, braces, beams, rafters)
  acUnit: 13,        // 3D air-conditioning outdoor unit box (circular fan grille + side louvers)
  awning: 14,        // 3D street-level shop awning / rain canopy (striped/solid weatherproof cloth or polycarbonate)
  signH: 15,         // 3D horizontal illuminated Chongqing shop signboard lightbox (tSigns)
  signV: 16,         // 3D vertical Chongqing neon / LED blade sign (tSignsVert or stacked tSigns)
  ledStrip: 17,      // Architectural night LED accent strip, crown fin, or glowing facade media billboard
  railMetal: 18,     // Dark powder-coated / iron balcony guardrails, handrails, and security cages
  aviationLight: 19, // Red rooftop aviation warning beacon (pulsing at dusk/night)
  bayuCarving: 20,   // Traditional Bayu carved wooden balustrade / lattice fretwork
  darkFrame: 21,     // Dark bronze/charcoal window & shopfront aluminum mullions, signboard side returns, door frames
  pvcPipe: 22,       // Weathered white/grey exterior PVC drainpipe (落水管) & AC refrigerant wall conduit
  securityCage: 23,  // Brushed stainless-steel window/balcony anti-theft security cage (防盗网) & door pull-handles
  planterFoliage: 24,// Subtropical Chongqing balcony potted greenery & trailing plants (阳台盆栽绿植)
  laundryCloth: 25,  // Lived-in balcony hanging laundry / drying clothes (阳台晾晒衣物)
  wallSconce: 26,    // Exterior architectural pier wall sconce / shop soffit downlight (glows warm 2700K at night)
  terracottaPot: 27, // Warm terracotta / ceramic balcony planter boxes & bush-hammered granite threshold steps
  steelBracket: 28,  // Galvanized steel awning brackets, AC L-brackets, glass railing spigots & clamps
};

// ---- Tile v2 per-building bitmasks (matches pipeline/tilefmt.py)
export const BFLAG = {
  isPart: 1 << 0,
  named: 1 << 1,
  streetFront: 1 << 2,
  osm: 1 << 3,
  steepSlope: 1 << 4,
  commercialGround: 1 << 5,
};

export const BMASK = {
  balconies: 1 << 0,
  acUnits: 1 << 1,
  sunshades: 1 << 2,
  neonBlades: 1 << 3,
  stiltsBase: 1 << 4,
  curtainFins: 1 << 5,
  cornices: 1 << 6,
  crownLeds: 1 << 7,
};

// ---- Per-archetype architectural parameters (shared by geometry builders and facadeKit)
export const STYLE = [];
const def = (id, o) => {
  STYLE[id] = {
    floor: 3.2,
    ground: 4.0,
    parapet: 1.15,
    pitch: 28,
    eave: 0.55,
    bay: 3.4,
    margin: 0.55,
    podiumFloors: 0,
    setback: 0.0,
    curtain: false,
    balcony: 'none',       // 'none' | 'modern' | 'old' | 'walkup' | 'bayu'
    fins: 'none',          // 'none' | 'curtain' | 'pilaster' | 'concrete' | 'quoin'
    ledgeStep: 0,          // horizontal belt cornice every N floors (0 = none)
    eyebrows: false,       // 3D window eyebrow sunshades & sills on lower floors
    acDensity: 0.0,        // 0..1 AC outdoor unit density
    shopProb: 0.55,        // street-front commercial probability
    bladeProb: 0.25,       // vertical neon blade sign probability
    crownLed: false,       // illuminated skyscraper crown fins
    foundation: 'sandstone', // 'sandstone' | 'granite' | 'bayu_stilt' | 'concrete'
    ...o,
  };
};

def(ST.generic, {
  floor: 3.2, ground: 4.2, parapet: 1.1, bay: 3.4, margin: 0.55,
  podiumFloors: 2, setback: 1.6, balcony: 'walkup', fins: 'concrete',
  ledgeStep: 3, eyebrows: true, acDensity: 0.45, shopProb: 0.72, bladeProb: 0.45,
});
def(ST.cbd_supertall, {
  floor: 4.15, ground: 6.4, parapet: 1.8, bay: 3.6, margin: 0.0,
  podiumFloors: 3, setback: 2.8, curtain: true, fins: 'curtain',
  ledgeStep: 12, eyebrows: true, acDensity: 0.0, shopProb: 0.65, bladeProb: 0.12,
  crownLed: true, foundation: 'granite',
});
def(ST.office_glass, {
  floor: 3.9, ground: 5.6, parapet: 1.5, bay: 3.2, margin: 0.0,
  podiumFloors: 3, setback: 2.2, curtain: true, fins: 'curtain',
  ledgeStep: 10, eyebrows: true, acDensity: 0.0, shopProb: 0.70, bladeProb: 0.22,
  crownLed: true, foundation: 'granite',
});
def(ST.office_grid, {
  floor: 3.7, ground: 5.0, parapet: 1.3, bay: 3.2, margin: 0.55,
  podiumFloors: 2, setback: 2.0, fins: 'pilaster',
  ledgeStep: 4, eyebrows: true, acDensity: 0.15, shopProb: 0.78, bladeProb: 0.30,
  crownLed: true, foundation: 'granite',
});
def(ST.resi_modern, {
  floor: 3.0, ground: 4.6, parapet: 1.25, bay: 3.6, margin: 0.48,
  podiumFloors: 2, setback: 1.8, balcony: 'modern', fins: 'concrete',
  ledgeStep: 5, eyebrows: true, acDensity: 0.42, shopProb: 0.75, bladeProb: 0.32,
  crownLed: true, foundation: 'sandstone',
});
def(ST.resi_old_highrise, {
  floor: 2.95, ground: 4.2, parapet: 1.1, bay: 3.3, margin: 0.45,
  podiumFloors: 2, setback: 1.4, balcony: 'old', fins: 'concrete',
  ledgeStep: 3, eyebrows: true, acDensity: 0.78, shopProb: 0.88, bladeProb: 0.68,
  foundation: 'sandstone',
});
def(ST.resi_walkup, {
  floor: 2.9, ground: 3.8, parapet: 1.0, pitch: 25, eave: 0.65, bay: 3.2, margin: 0.45,
  balcony: 'walkup', fins: 'none', ledgeStep: 2, eyebrows: true,
  acDensity: 0.75, shopProb: 0.85, bladeProb: 0.62, foundation: 'sandstone',
});
def(ST.bayu_vernacular, {
  floor: 3.3, ground: 3.8, parapet: 0.35, pitch: 30, eave: 1.05, bay: 3.4, margin: 0.38,
  balcony: 'bayu', fins: 'none', ledgeStep: 1, eyebrows: false,
  acDensity: 0.25, shopProb: 0.82, bladeProb: 0.55, foundation: 'bayu_stilt',
});
def(ST.historic_masonry, {
  floor: 4.1, ground: 5.0, parapet: 1.1, pitch: 32, eave: 0.55, bay: 3.4, margin: 0.75,
  fins: 'quoin', ledgeStep: 2, eyebrows: true,
  acDensity: 0.15, shopProb: 0.75, bladeProb: 0.28, foundation: 'sandstone',
});
def(ST.commercial_mall, {
  floor: 4.8, ground: 5.8, parapet: 1.5, bay: 4.6, margin: 0.45,
  podiumFloors: 3, setback: 2.4, fins: 'pilaster', ledgeStep: 1, eyebrows: true,
  acDensity: 0.0, shopProb: 0.96, bladeProb: 0.78, crownLed: true, foundation: 'granite',
});
def(ST.hotel, {
  floor: 3.45, ground: 5.6, parapet: 1.35, bay: 3.8, margin: 0.55,
  podiumFloors: 2, setback: 2.0, fins: 'pilaster', ledgeStep: 4, eyebrows: true,
  acDensity: 0.05, shopProb: 0.60, bladeProb: 0.20, crownLed: true, foundation: 'granite',
});
def(ST.civic, {
  floor: 3.9, ground: 5.0, parapet: 1.25, bay: 3.6, margin: 0.70,
  podiumFloors: 2, setback: 1.8, fins: 'pilaster', ledgeStep: 3, eyebrows: true,
  acDensity: 0.08, shopProb: 0.15, bladeProb: 0.0, foundation: 'granite',
});
def(ST.campus, {
  floor: 3.6, ground: 4.3, parapet: 1.15, pitch: 24, eave: 0.55, bay: 3.5, margin: 0.55,
  fins: 'concrete', ledgeStep: 1, eyebrows: true,
  acDensity: 0.35, shopProb: 0.12, bladeProb: 0.0, foundation: 'sandstone',
});
def(ST.industrial, {
  floor: 5.8, ground: 5.8, parapet: 0.65, pitch: 12, eave: 0.40, bay: 6.0, margin: 0.6,
  fins: 'concrete', ledgeStep: 0, eyebrows: false,
  acDensity: 0.12, shopProb: 0.0, bladeProb: 0.0, foundation: 'concrete',
});
def(ST.temple, {
  floor: 3.8, ground: 4.0, parapet: 0.0, pitch: 31, eave: 1.45, bay: 3.3, margin: 0.4,
  balcony: 'bayu', fins: 'none', ledgeStep: 0, eyebrows: false,
  acDensity: 0.0, shopProb: 0.0, bladeProb: 0.0, foundation: 'sandstone',
});
def(ST.bigroof, {
  floor: 7.5, ground: 7.5, parapet: 0.85, pitch: 10, eave: 0.7, bay: 6.0, margin: 0.6,
  fins: 'pilaster', shopProb: 0.2, bladeProb: 0.0, foundation: 'concrete',
});
def(ST.canopy, {
  floor: 4.8, ground: 4.8, parapet: 0.0, pitch: 10, eave: 0.4, bay: 5.0, margin: 0.2,
  shopProb: 0.0, bladeProb: 0.0, foundation: 'concrete',
});
def(ST.tank, {
  floor: 10.0, ground: 10.0, parapet: 0.0, bay: 6.0, margin: 0.0,
  shopProb: 0.0, bladeProb: 0.0, foundation: 'concrete',
});
def(ST.parking, {
  floor: 3.1, ground: 3.6, parapet: 1.15, bay: 6.8, margin: 0.5,
  fins: 'concrete', ledgeStep: 1, shopProb: 0.25, bladeProb: 0.05, foundation: 'concrete',
});
def(ST.construction, {
  floor: 3.4, ground: 4.2, parapet: 0.0, bay: 4.2, margin: 0.3,
  fins: 'concrete', ledgeStep: 1, shopProb: 0.0, bladeProb: 0.0, foundation: 'concrete',
});
def(ST.landmark_glass, {
  floor: 4.2, ground: 5.2, parapet: 1.4, bay: 3.0, margin: 0.0,
  curtain: true, fins: 'curtain', shopProb: 0.0, bladeProb: 0.0, crownLed: true, foundation: 'granite',
});

// ---- Deterministic hash IDENTICAL to GLSL hash11(float) in engine/glsl.js so 3D kit & shader stay in exact sync
export function hash11(p) {
  let x = p * 0.1031;
  x -= Math.floor(x);
  x *= x + 33.33;
  x *= x + x;
  return x - Math.floor(x);
}

/** Shared storey-height calculation for buildingGeom, facadeKit, and shader attributes. */
export function computeStoreys(rec) {
  const S = STYLE[rec.style] || STYLE[0];
  const height = Math.max(2.2, rec.height);
  const base = rec.base || 0;
  const pitchedRoof = rec.roof !== ROOF.flat && rec.roof !== ROOF.stepped_crown;
  let ph = pitchedRoof ? 0 : Math.min(S.parapet, height * 0.24);
  if (rec.style === ST.tank || rec.style === ST.canopy || rec.style === ST.construction) ph = 0;
  const cap = ph + (pitchedRoof ? 0.25 : 0.35);

  let levels = Math.max(1, rec.levels || 1);
  let gH = Math.min(S.ground, Math.max(2.6, height - cap));
  let fH = S.floor;
  const upper = height - gH - cap;

  if (levels > 1 && upper > 2.2) {
    fH = upper / (levels - 1);
    if (fH < 2.6 || fH > 6.2) {
      levels = 1 + Math.max(1, Math.round(upper / S.floor));
      fH = upper / (levels - 1);
    }
  } else if (upper > 2.5) {
    levels = 1 + Math.max(1, Math.round(upper / S.floor));
    fH = upper / (levels - 1);
  } else {
    levels = 1;
    gH = Math.max(2.2, height - cap);
    fH = S.floor;
  }

  if (base > 0.5) {
    fH = Math.min(6.2, Math.max(2.8, S.floor));
    gH = fH;
    levels = Math.max(2, Math.ceil((height - cap) / fH));
  }

  // Clamp into Uint8 attribute packing ranges (fH * 40 <= 255 -> 6.375m, gH * 20 <= 255 -> 12.75m)
  fH = Math.min(6.35, Math.max(2.4, fH));
  gH = Math.min(12.5, Math.max(2.4, gH));

  // Podium height (prefer tile v2 podium_h when present and valid)
  let podiumH = 0;
  if (base < 0.5 && height >= 20 && (rec.podiumH > 0 || S.podiumFloors > 0)) {
    const nom = rec.podiumH > 0 ? rec.podiumH : gH + Math.max(0, S.podiumFloors - 1) * fH;
    if (nom >= 5.5 && height - nom >= 10.0) {
      podiumH = Math.min(nom, height * 0.35, 22.0);
    }
  }

  const yTop = gH + (levels - 1) * fH;
  return { S, levels, fH, gH, ph, cap, podiumH, yTop };
}

/** Shared bay-grid calculation (exact match with buildingMaterial.js GLSL). */
export function computeBayGrid(edgeLen, style, seed, isShop) {
  const S = STYLE[style] || STYLE[0];
  const bayN = isShop ? 4.2 + 0.8 * hash11(seed + 3.0) : S.bay;
  const margin = isShop ? 0.35 : S.margin;
  const usable = edgeLen - 2.0 * margin;
  const nb = Math.floor(usable / bayN + 0.4);
  if (nb < 1 || usable < 1.2) return { nb: 0, bw: edgeLen, margin: 0, usable: 0 };
  return { nb, bw: usable / nb, margin, usable };
}

/** Exact sync for balcony bay selection between facadeKit.js and buildingMaterial.js. */
export function isBalconyBay(style, south, hb, subtype = 0) {
  if (style === ST.resi_modern) {
    return south ? hb > 0.32 : hb > 0.62;
  }
  if (style === ST.resi_old_highrise) {
    return south ? hb > 0.36 : hb > 0.68;
  }
  if (style === ST.resi_walkup || style === ST.generic) {
    return south ? hb > 0.44 : (subtype > 3 && hb > 0.74);
  }
  if (style === ST.bayu_vernacular) {
    return hb > 0.22;
  }
  return false;
}
