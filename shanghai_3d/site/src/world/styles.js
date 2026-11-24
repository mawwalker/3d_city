// Building styles shared by the pipeline (21_heights_styles.py), the geometry worker and the facade shader.

export const ST = { generic: 0, resi_slab: 1, resi_tower: 2, lilong: 3, villa: 4, office_glass: 5, office_grid: 6, retail: 7, industrial: 8, public: 9,
  heritage: 10, temple: 11, bigroof: 12, canopy: 13, tank: 14, construction: 15, village: 16, hotel: 17, parking: 18, special: 19 };
export const ROOF = { flat: 0, gable: 1, hip: 2, pyramid: 3, xieshan: 4, mansard: 5, dome: 7, shed: 8, round: 9, sawtooth: 10 };
// surface kinds written per vertex (aNrm.w)
export const KIND = { wall: 0, roofFlat: 1, roofTile: 2, trim: 3, mass: 4, metal: 5, glass: 6, roofMetal: 7, soffit: 8, equipment: 9 };

// per style: nominal floor height, ground-floor height, parapet height, roof pitch (deg) when pitched, eave overhang
export const STYLE = [];
const def = (id, o) => { STYLE[id] = { floor: 3.2, ground: 3.6, parapet: 0.9, pitch: 28, eave: 0.45, ...o }; };
def(ST.generic, {});
def(ST.resi_slab, { floor: 2.9, ground: 3.0, parapet: 0.7, pitch: 24, eave: 0.6 });
def(ST.resi_tower, { floor: 2.95, ground: 4.2, parapet: 1.2 });
def(ST.lilong, { floor: 3.3, ground: 3.5, parapet: 0.4, pitch: 31, eave: 0.35 });
def(ST.villa, { floor: 3.3, ground: 3.5, parapet: 0.4, pitch: 30, eave: 0.6 });
def(ST.office_glass, { floor: 4.1, ground: 6.0, parapet: 1.6 });
def(ST.office_grid, { floor: 3.7, ground: 4.8, parapet: 1.1 });
def(ST.retail, { floor: 5.0, ground: 5.6, parapet: 1.2 });
def(ST.industrial, { floor: 6.0, ground: 6.0, parapet: 0.5, pitch: 11, eave: 0.3 });
def(ST.public, { floor: 3.8, ground: 4.2, parapet: 0.9 });
def(ST.heritage, { floor: 4.3, ground: 5.2, parapet: 1.0, pitch: 32, eave: 0.3 });
def(ST.temple, { floor: 3.6, ground: 3.6, parapet: 0.0, pitch: 30, eave: 1.3 });
def(ST.bigroof, { floor: 8.0, ground: 8.0, parapet: 0.6 });
def(ST.canopy, { floor: 5.0, ground: 5.0, parapet: 0.0 });
def(ST.tank, { floor: 10.0, ground: 10.0, parapet: 0.0 });
def(ST.construction, { floor: 3.4, ground: 4.0, parapet: 0.0 });
def(ST.village, { floor: 3.2, ground: 3.3, parapet: 0.3, pitch: 27, eave: 0.4 });
def(ST.hotel, { floor: 3.4, ground: 5.5, parapet: 1.3 });
def(ST.parking, { floor: 3.0, ground: 3.2, parapet: 1.1 });
def(ST.special, {});
