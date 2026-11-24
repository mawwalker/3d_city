// Shot list for the introduction film. Poses: x / z = the ground point looked at (x east, z south, metres from Tiananmen),
// dist = eye distance, heading = view direction (0 = north, clockwise), pitch = degrees above the horizon.
// Each shot moves from `a` to `b` over `dur` seconds; hour (and optionally season) can change along the way.
// caption: [name, line] shown at the lower left.

const AUTUMN = [0.62, 0], SNOW = [0.0, 1.0];

export const SHOTS = [
  { id: 'open', dur: 7.5, hour: [17.02, 17.12],
    a: { x: 2600, z: -250, dist: 11000, heading: 262, pitch: 10.5 }, b: { x: 2300, z: -250, dist: 8900, heading: 268, pitch: 9.2 } },
  { id: 'city', dur: 6.5, hour: [15.4, 15.5],
    a: { x: -1200, z: -300, dist: 31000, heading: 352, pitch: 38 }, b: { x: -1200, z: -500, dist: 28500, heading: 6, pitch: 35 },
    caption: ['五环之内', '近百万栋建筑，按真实轮廓与高度建模'] },
  { id: 'axis', dur: 7.5, hour: [16.25, 16.35],
    a: { x: -20, z: 4700, dist: 2300, heading: 359, pitch: 21 }, b: { x: -20, z: 1500, dist: 2100, heading: 359, pitch: 19 },
    caption: ['中轴线', '永定门 · 正阳门 · 天安门'] },
  { id: 'gugong', dur: 8, hour: [16.45, 16.55],
    a: { x: -38, z: -948, dist: 1350, heading: 328, pitch: 31 }, b: { x: -38, z: -948, dist: 1250, heading: 22, pitch: 28 },
    caption: ['故宫', '明清两代的皇宫'] },
  { id: 'tiantan', dur: 6.5, hour: [16.2, 16.25],
    a: { x: 1314, z: 2850, dist: 720, heading: 330, pitch: 24 }, b: { x: 1314, z: 2850, dist: 600, heading: 2, pitch: 21 },
    caption: ['天坛', '祈年殿与古柏林'] },
  { id: 'beihai', dur: 6.5, hour: [16.6, 16.65],
    a: { x: -650, z: -2050, dist: 1700, heading: 318, pitch: 25 }, b: { x: -650, z: -2150, dist: 1500, heading: 300, pitch: 23 },
    caption: ['北海 · 什刹海', '白塔与西城的水'] },
  { id: 'gulou', dur: 6.5, hour: [16.5, 16.55],
    a: { x: -130, z: -3460, dist: 470, heading: 352, pitch: 24 }, b: { x: -115, z: -3520, dist: 400, heading: 16, pitch: 21 },
    caption: ['钟鼓楼', '胡同与四合院'] },
  { id: 'street', dur: 6.5, hour: [15.2, 15.25],
    a: { x: 5960, z: -2300, dist: 230, heading: 12, pitch: 30 }, b: { x: 5995, z: -2335, dist: 180, heading: 40, pitch: 25 },
    caption: ['街坊', '楼、树、车流与屋顶'] },
  { id: 'cbd', dur: 7.5, hour: [16.75, 16.85],
    a: { x: 5500, z: -380, dist: 1900, heading: 292, pitch: 13 }, b: { x: 5560, z: -470, dist: 1350, heading: 314, pitch: 11 },
    caption: ['国贸', '中国尊与央视大楼'] },
  { id: 'olympic', dur: 6.5, hour: [16.5, 16.55],
    a: { x: -250, z: -9500, dist: 1700, heading: 352, pitch: 25 }, b: { x: -250, z: -9550, dist: 1450, heading: 18, pitch: 22 },
    caption: ['奥林匹克公园', '鸟巢与水立方'] },
  { id: 'yiheyuan', dur: 7, hour: [16.6, 16.65],
    a: { x: -10560, z: -9500, dist: 2700, heading: 338, pitch: 21 }, b: { x: -10540, z: -9800, dist: 2200, heading: 350, pitch: 19 },
    caption: ['颐和园', '昆明湖与万寿山'] },
  { id: 'dusk', dur: 10, hour: [17.0, 18.55],
    a: { x: 5000, z: -170, dist: 5400, heading: 282, pitch: 16 }, b: { x: 5000, z: -170, dist: 4900, heading: 290, pitch: 15 },
    caption: ['入夜', '从黄昏到万家灯火'] },
  { id: 'flyover', dur: 6, hour: [20.3, 20.32],
    a: { x: -3560, z: -3690, dist: 300, heading: 322, pitch: 14 }, b: { x: -3580, z: -3710, dist: 260, heading: 338, pitch: 12 },
    caption: ['立交', '夜里的车流'] },
  { id: 'snow', dur: 7, hour: [14.4, 14.45], season: SNOW,
    a: { x: -38, z: -1100, dist: 1500, heading: 8, pitch: 30 }, b: { x: -38, z: -1000, dist: 1300, heading: 352, pitch: 28 },
    caption: ['初雪', '时节可在金秋、初雪、盛夏之间切换'] },
  { id: 'end', dur: 10.5, hour: [17.12, 17.22],
    a: { x: 2300, z: -250, dist: 8600, heading: 270, pitch: 9 }, b: { x: 2500, z: -250, dist: 10800, heading: 275, pitch: 10.5 } },
];

export const DEFAULT_SEASON = AUTUMN;
