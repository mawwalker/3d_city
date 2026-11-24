// The imperial core: Tiananmen, the Forbidden City (walls, gates, corner towers, the three great halls on their
// marble terrace) and the Temple of Heaven's ritual axis.
//
// Dimensions follow published surveys; placement comes from the real footprints (data/landmarks.json).

import { Kit, MAT } from '../landmarkKit.js';

const YELLOW = '#dba02b';      // imperial glazed tile
const RED = '#a3352a';         // palace timber
const WALL_RED = '#9a3027';    // plastered masonry
const STONE = '#dcd7cb';       // white marble
const BRICK = '#8a847b';       // city-wall brick
const BLUE = '#24418a';        // Temple of Heaven glaze
const GOLD = '#d9a520';

// A gate tower: battered masonry base with gateways, a marble plinth and a double-eave hall on top.
function gateTower(kit, { baseL, baseW, baseH, hallL, hallW, wallH = 9, arches = 3, base = WALL_RED, tile = YELLOW, rise }) {
  kit.paint(base, MAT.matte);
  kit.box(baseL, baseH, baseW, 0, { taper: [0.985, 1] });
  // gateways: dark recesses on both long faces
  kit.paint('#1c1512', MAT.matte);
  const gw = Math.min(6.2, baseL / (arches * 2.6)), gh = Math.min(baseH * 0.72, 8.8);
  for (let i = 0; i < arches; i++) {
    const x = (i - (arches - 1) / 2) * (baseL / (arches + 1.2));
    const s = i === (arches - 1) / 2 ? 1 : 0.84;
    for (const side of [1, -1]) kit.box(gw * s, gh * s, 0.5, 0, { cz: side * (baseW / 2 - 0.1), top: false });
  }
  // parapet
  kit.paint(STONE, MAT.marble, { p0: 1.1 });
  kit.box(baseL * 0.985 + 0.4, 1.1, baseW + 0.4, baseH, { top: false });
  kit.save(); kit.move(0, baseH, 0);
  const h = kit.hall({ L: hallL, W: hallW, wallH, eaves: 2, platformH: 0.9, platformMargin: 2.2, tile, rise });
  kit.restore();
  return baseH + h;
}

function tiananmen(kit, L) {
  kit.at(L.tiananmen, (lm) => {
    kit.flood(0.9);
    const h = gateTower(kit, { baseL: 2 * lm.hl, baseW: 2 * lm.hw, baseH: 12.3, hallL: 62, hallW: 27, wallH: 11.5, arches: 5, rise: 9.5 });
    kit.mark('天安门', h + 6, { rank: 1 });
  });
  kit.at(L.duanmen, (lm) => {
    kit.flood(0.4);
    gateTower(kit, { baseL: 2 * lm.hl, baseW: 2 * lm.hw, baseH: 12.3, hallL: 62, hallW: 27, wallH: 11.5, arches: 5, rise: 9.5 });
  });
}

// The Meridian Gate: a U-shaped fortress base carrying the main hall, four corner pavilions and galleries ("five-phoenix tower").
function wumen(kit, L) {
  kit.at(L.wumen, (lm) => {
    kit.flood(0.5);
    const W = 2 * lm.hw;                  // north-south extent of the whole U
    const zN = -W / 2, zS = W / 2;
    const bar = 36, wing = 25, ox = 63.5; // bar depth, wing width, half outer width
    const zBar = zN + bar;
    kit.paint(WALL_RED, MAT.matte);
    kit.prism([[-ox, zS], [-ox + wing, zS], [-ox + wing, zBar], [ox - wing, zBar], [ox - wing, zS], [ox, zS], [ox, zN], [-ox, zN]], 0, 12);
    kit.paint('#1c1512', MAT.matte);
    for (const x of [-11, 0, 11]) for (const z of [zBar - 0.1, zN + 0.1]) kit.box(x === 0 ? 5.6 : 4.6, x === 0 ? 8.6 : 7.4, 0.5, 0, { cx: x, cz: z, top: false });
    kit.paint(STONE, MAT.marble, { p0: 1.1 });
    kit.prism([[-ox, zS], [-ox + wing, zS], [-ox + wing, zBar], [ox - wing, zBar], [ox - wing, zS], [ox, zS], [ox, zN], [-ox, zN]], 12, 13.1, { top: false });
    // main hall
    kit.save(); kit.move(0, 12, zN + bar / 2);
    const h = kit.hall({ L: 60, W: 25, wallH: 13, eaves: 2, platformH: 0.9, platformMargin: 2, rise: 9.5 });
    kit.restore();
    // corner pavilions and connecting galleries on the wings
    const xw = ox - wing / 2;
    for (const sx of [-1, 1]) {
      for (const z of [zN + bar / 2, zS - 11]) {
        kit.save(); kit.move(sx * xw, 12, z);
        kit.hall({ L: 15, W: 15, wallH: 8, eaves: 2, pyramid: true, platformH: 0.6, platformMargin: 1.2, rise: 6.5 });
        kit.restore();
      }
      kit.save(); kit.move(sx * xw, 12, (zN + bar / 2 + zS - 11) / 2); kit.turn(90);
      kit.hall({ L: zS - 11 - (zN + bar / 2) - 17, W: 11, wallH: 5.5, platformH: 0.5, platformMargin: 0.8, rise: 4 });
      kit.restore();
    }
    kit.mark('午门', 12 + h + 5, { rank: 2 });
  });
}

// The three great halls on the three-tier marble terrace.
function threeHalls(kit, L) {
  const c = L.zhonghedian;
  kit.at(c, () => {
    kit.flood(0.35);
    // I-shaped terrace ("three platforms"), 8.13 m in three tiers; z south
    const tier = (inset, y0, y1) => {
      const ws = 65 - inset, wn = 55 - inset, wk = 35 - inset, zs = 126 - inset, zk1 = 36 + inset * 0.2, zk0 = -31 - inset * 0.2, zn = -96 + inset;
      kit.prism([[-ws, zs], [ws, zs], [ws, zk1], [wk, zk1], [wk, zk0], [wn, zk0], [wn, zn], [-wn, zn], [-wn, zk0], [-wk, zk0], [-wk, zk1], [-ws, zk1]], y0, y1);
    };
    kit.paint(STONE, MAT.marble, { p0: 2.71 }); tier(0, 0, 2.71);
    kit.paint(STONE, MAT.marble, { p0: 2.71 }); tier(4.2, 2.71, 5.42);
    kit.paint(STONE, MAT.marble, { p0: 2.71 }); tier(8.4, 5.42, 8.13);
    // processional stairs (south and north)
    kit.paint('#cfcabd', MAT.marble);
    kit.box(20, 8.13, 26, 0, { cz: 126 + 9, taper: [1, 0.05] });
    kit.box(14, 8.13, 20, 0, { cz: -96 - 7, taper: [1, 0.05] });
    const y = 8.13;
    const dT = (L.taihedian.y - c.y), dB = (L.baohedian.y - c.y);
    // Hall of Supreme Harmony: 11 bays, double-eave hip roof, 26.9 m
    kit.save(); kit.move(0, y, -dT);           // north is -z: a hall south of the centre sits at +z
    kit.hall({ L: 64, W: 37, wallH: 15, eaves: 2, platformH: 0.9, platformMargin: 3, rise: 10.5 });
    kit.mark('太和殿', 34, { rank: 2 });
    kit.restore();
    // Hall of Central Harmony: square, single-eave pyramidal roof with a gilded finial
    kit.save(); kit.move(0, y, 0);
    kit.hall({ L: 24.2, W: 24.2, wallH: 8, pyramid: true, platformH: 0.6, platformMargin: 2, rise: 9 });
    kit.restore();
    // Hall of Preserving Harmony
    kit.save(); kit.move(0, y, -dB);
    kit.hall({ L: 50, W: 25, wallH: 12.5, eaves: 2, platformH: 0.8, platformMargin: 2.5, rise: 9 });
    kit.restore();
  });
  // Gate of Supreme Harmony
  kit.at(L.taihemen, () => {
    kit.flood(0.3);
    kit.hall({ L: 58, W: 30, wallH: 11, eaves: 2, platformH: 3.4, platformMargin: 5, rise: 8.5 });
  }, { angle: c.angle });
}

// Outer wall of the Forbidden City with its four corner towers and the north / east / west gates.
function palaceWall(kit, L) {
  const g = L.gugong;
  kit.at(g, () => {
    // local +x runs north -> south along the long axis; the Meridian Gate's wings stick out past the south wall
    const half = g.hl, w = g.hw;
    const xN = -half, xS = -half + 961, T = 8.2, H = 9.9;
    kit.paint(BRICK, MAT.brick);
    kit.box(T, H, 2 * w, 0, { cx: xN, taper: [0.8, 1] });
    kit.box(T, H, 2 * w, 0, { cx: xS, taper: [0.8, 1] });
    kit.box(xS - xN, H, T, 0, { cx: (xN + xS) / 2, cz: w, taper: [1, 0.8] });
    kit.box(xS - xN, H, T, 0, { cx: (xN + xS) / 2, cz: -w, taper: [1, 0.8] });
    // corner towers: a square pavilion with cross wings and stacked roofs
    for (const x of [xN, xS]) for (const z of [-w, w]) {
      kit.save(); kit.move(x, H, z);
      kit.flood(0.8);
      kit.paint(STONE, MAT.marble, { p0: 1 }); kit.box(17, 1, 17);
      kit.save(); kit.move(0, 1, 0);
      for (const a of [0, 90]) { kit.save(); kit.turn(a); kit.hall({ L: 15.5, W: 7.5, wallH: 5.2, platformH: 0, rise: 3.2 }); kit.restore(); }
      kit.move(0, 4.6, 0);
      kit.hall({ L: 9.5, W: 9.5, wallH: 5.5, eaves: 2, pyramid: true, platformH: 0, rise: 5.2 });
      kit.restore();
      kit.flood(0);
      kit.restore();
    }
  });
  kit.at(L.shenwumen, () => {
    kit.flood(0.5);
    const h = gateTower(kit, { baseL: 62, baseW: 26, baseH: 10, hallL: 41, hallW: 14, wallH: 9, arches: 3, rise: 7 });
    kit.mark('神武门', h + 4, { rank: 3 });
  });
  for (const key of ['donghuamen', 'xihuamen']) {
    kit.at(L[key], () => { kit.flood(0.3); gateTower(kit, { baseL: 46, baseW: 24, baseH: 10, hallL: 30, hallW: 13, wallH: 8.5, arches: 3, rise: 6.5 }); });
  }
}

// Temple of Heaven: Hall of Prayer for Good Harvests, Imperial Vault of Heaven, Circular Mound Altar.
function templeOfHeaven(kit, L) {
  kit.at(L.qiniandian, () => {
    kit.flood(0.8);
    // three-tier circular marble terrace, 91 m across
    kit.paint(STONE, MAT.marble, { p0: 1.9 }); kit.lathe([[45.5, 0], [45.5, 1.9]], { seg: 72, capTop: true });
    kit.paint(STONE, MAT.marble, { p0: 1.9 }); kit.lathe([[40, 1.9], [40, 3.8]], { seg: 72, capTop: true });
    kit.paint(STONE, MAT.marble, { p0: 1.8 }); kit.lathe([[34.2, 3.8], [34.2, 5.6]], { seg: 72, capTop: true });
    const y = 5.6;
    // triple-eaved circular hall, 32 m tall above the terrace
    kit.paint(RED, MAT.timber, { p0: 6.6 }); kit.lathe([[12.1, y], [12.1, y + 6.6]], { seg: 48 });
    kit.paint(BLUE, MAT.tile); kit.lathe([[16.6, y + 6.2], [13.6, y + 7.3], [11.3, y + 9.0]], { seg: 48 });
    kit.paint('#1f5a57', MAT.timber, { p0: 3.2 }); kit.lathe([[10.9, y + 8.8], [10.9, y + 12.0]], { seg: 48 });
    kit.paint(BLUE, MAT.tile); kit.lathe([[14.1, y + 11.7], [11.3, y + 12.8], [9.4, y + 14.5]], { seg: 48 });
    kit.paint('#1f5a57', MAT.timber, { p0: 3.2 }); kit.lathe([[9.0, y + 14.3], [9.0, y + 17.5]], { seg: 48 });
    kit.paint(BLUE, MAT.tile); kit.lathe([[12.3, y + 17.2], [8.6, y + 19.3], [4.9, y + 22.6], [1.7, y + 26.9], [0.7, y + 28.2]], { seg: 48 });
    kit.paint(GOLD, MAT.metal); kit.lathe([[0.7, y + 28.0], [1.5, y + 29.2], [1.7, y + 30.4], [0.9, y + 31.6], [0.02, y + 32.6]], { seg: 16 });
    kit.mark('祈年殿', y + 38, { rank: 1 });
  });
  kit.at(L.huangqiongyu, () => {
    kit.flood(0.5);
    kit.paint(STONE, MAT.marble, { p0: 2.9 }); kit.lathe([[11.2, 0], [11.2, 2.9]], { seg: 48, capTop: true });
    kit.paint(RED, MAT.timber, { p0: 6.2 }); kit.lathe([[7.8, 2.9], [7.8, 9.1]], { seg: 36 });
    kit.paint(BLUE, MAT.tile); kit.lathe([[10.8, 8.8], [7.6, 10.6], [4.2, 13.4], [1.3, 16.4], [0.5, 17.2]], { seg: 36 });
    kit.paint(GOLD, MAT.metal); kit.lathe([[0.5, 17.0], [1.0, 17.9], [0.6, 18.9], [0.02, 19.5]], { seg: 12 });
    // Echo Wall
    kit.paint('#8f8780', MAT.brick); kit.lathe([[32.9, 0], [32.9, 3.4]], { seg: 72 }); kit.lathe([[32.0, 3.4], [32.0, 0]], { seg: 72 });
    kit.paint(BLUE, MAT.tile); kit.lathe([[33.3, 3.3], [32.45, 3.9], [31.6, 3.3]], { seg: 72 });
  });
  kit.at(L.yuanqiu, () => {
    kit.flood(0.4);
    kit.paint(STONE, MAT.marble, { p0: 1.75 }); kit.lathe([[27.4, 0], [27.4, 1.75]], { seg: 72, capTop: true });
    kit.paint(STONE, MAT.marble, { p0: 1.75 }); kit.lathe([[19.6, 1.75], [19.6, 3.5]], { seg: 72, capTop: true });
    kit.paint(STONE, MAT.marble, { p0: 1.7 }); kit.lathe([[11.8, 3.5], [11.8, 5.2]], { seg: 72, capTop: true });
  });
}

export const LANDMARKS = { tiananmen, wumen, threeHalls, palaceWall, templeOfHeaven };
