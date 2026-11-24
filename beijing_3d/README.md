# 北京 · 五环之内

一座可以在浏览器里漫游的北京三维城市模型：五环内外约 98 万栋真实建筑、道路、水系、绿地与西山，
按北京 10 月 18 日的真实太阳方位照明，从清晨到入夜可以连续拖动。

纯静态网站，没有后端；Three.js 已随站点一起打包，不依赖任何 CDN。

## 运行

```bash
./serve.sh            # 然后打开 http://127.0.0.1:8765/
```

任何静态文件服务器都可以（`python3 -m http.server --directory site` 即可）。直接双击 `index.html` 不行，
因为页面要用 ES module 和 Web Worker。

部署：把 `site/` 整个目录（约 43 MB）放到任意静态托管上（Nginx、Cloudflare Pages、Netlify、GitHub Pages 均可）。
数据文件已经预先 gzip 过，页面用 `DecompressionStream` 解压，所以不需要服务器配置压缩；
需要较新的浏览器（Chrome / Edge 80+、Safari 16.4+、Firefox 113+），以及 WebGL 2。

线上地址：https://beijing.smartdeng.com/ （Cloudflare Workers 静态资源，配置见 `wrangler.jsonc`，发布：`./deploy.sh`）。

## 介绍视频

`video/beijing_intro.mp4`（1080p30，96 秒，母版）与 `video/beijing_intro_web.mp4`（约 96 MB，便于分享）。
画面全部由网站本身逐帧渲染；配乐是 `tools/music.py` 用程序合成的原创曲子（拨弦 + 铺底，D 宫五声音阶），无版权问题。
重做：`cd tools && node film.mjs`（镜头表在 `film_shots.mjs`）→ `python music.py ../video/music.wav 96` →
`python film_encode.py ../video/frames ../video/music.wav ../video/beijing_intro.mp4`。

## 操作

| 操作 | 效果 |
|---|---|
| 拖动 | 平移（抓着地面走） |
| 右键拖动，或按住 Shift / Ctrl 拖动 | 旋转、俯仰 |
| 滚轮 / 双指捏合 | 朝光标位置缩放 |
| 双击 | 飞到该处 |
| 底部日晷 | 拖动太阳改变时刻；下面是几个预设时刻 |
| 左下角地名 | 飞到预设视角（数字键 1–9 同效） |
| `H` | 隐藏 / 显示界面（截图用） |
| `L` | 开关地名 |
| 空格 | 开始 / 停止自动巡游 |
| 方向键 / WASD、Q / E | 平移、旋转 |

URL 参数：`?q=low|medium|high|ultra` 指定画质；`?hour=17.1` 指定时刻；
`?cam=x,z,距离,朝向,俯仰` 指定视角（x 向东、z 向南，单位米，原点天安门）；`?season=autumn|snow|summer` 指定时节；`?ui=0` 不显示界面；
`?ao=0` 关闭环境光遮蔽。

## 数据来源与许可

| 内容 | 来源 | 许可 |
|---|---|---|
| 建筑轮廓 | [OpenStreetMap](https://www.openstreetmap.org/copyright) 贡献者 | ODbL 1.0 |
| 建筑轮廓与高度 | [GlobalBuildingAtlas LoD1](https://github.com/zhu-xlab/GlobalBuildingAtlas)（Zhu 等，ESSD 2025），经 [Source Cooperative](https://source.coop/tge-labs/globalbuildingatlas-lod1) 的 GeoParquet 镜像获取 | CC BY 4.0 |
| 建筑轮廓与高度（补缺） | [3D-GloBFP](https://zenodo.org/records/15487006)（Che 等，ESSD 2024） | CC BY 4.0 |
| 建筑功能（仅作风格分类的弱先验） | [CMAB](https://doi.org/10.6084/m9.figshare.27992417)（Zhang 等，Scientific Data 2025） | CC BY 4.0 |
| 道路、铁路、水系、绿地、用地、地名 | OpenStreetMap 贡献者（[Geofabrik](https://download.geofabrik.de/asia/china/beijing.html) 北京分片） | ODbL 1.0 |
| 地形 | [Copernicus DEM GLO-30](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)（© DLR e.V. 2010–2014，© Airbus Defence and Space GmbH 2014–2018，由欧盟与 ESA 提供） | Copernicus DEM 免费开放许可 |
| 字体 | 思源宋体 Source Han Serif（按用到的字子集化） | SIL OFL 1.1 |
| 渲染引擎 | three.js r187、earcut | MIT / ISC |

`site/data` 里的建筑、道路等数据是上述数据的衍生品；其中源自 OpenStreetMap 的部分继续遵循 ODbL，
再分发时请保留页面上的署名。

**这是一件作品，不是测绘成果。** 绝大多数建筑的高度是遥感估算值（见下），地标是按公开资料的尺寸程序化建模的近似，
请勿用于导航、测量或工程。

## 它是怎么做出来的

### 数据管线（`pipeline/`，Python）

1. **建筑融合**（`20_fuse_buildings.py`）：以最新的 OSM 建筑为准（几何最干净，带名称、层数等标签），
   再并入 GlobalBuildingAtlas 中不与之重叠的轮廓，最后用 3D-GloBFP 补缺口，去重后约 98 万个多边形。
   所有坐标统一到以天安门为原点的局部横轴墨卡托投影（米）。注意：OSM 是真实 WGS-84；
   网上常见的"天安门 116.3975°E"是 GCJ-02 坐标，偏了约 530 米，不能混用。
2. **高度**（`21_heights_styles.py`）：OSM 标注的高度 / 层数优先（并剔除明显错误的标签）；
   其余建筑用梯度提升模型估算——输入是 GBA 与 3D-GloBFP 的遥感高度、建筑形态、周边环境，
   以 OSM 有实测标签的 7700 栋建筑训练。按空间分块交叉验证，平均绝对误差 8.3 m（直接用 GBA 高度是 11.2 m）。
   遥感高度对超高层系统性偏低，所以 CBD 等处的地标高度都来自 OSM 标签或手工建模。
3. **风格分类**：宫殿、寺庙、胡同四合院、住宅、写字楼、商场、厂房、村庄等 16 类，
   依据 OSM 标签、所在的文保单位范围、用地类型和建筑形态判定，决定屋顶形式与立面材质。
4. **地形**（`12_terrain.py`）：Copernicus 30 m DSM 减去拟合的平原趋势面，并用建筑高度栅格剔除
   高楼在 DSM 上造成的假"山包"，只保留真实的山体（西山、军都山、景山、万寿山、玉泉山……）。
5. **瓦片**（`30_build_tiles.py`）：2 km 网格。大体量建筑进"主体层"（启动时由城市中心向外加载）；
   小建筑先融合成街区体块作远景替身，镜头靠近时再流式加载"细节层"里的真实小建筑和树木。
6. **地面**（`31_build_ground.py`、`32_tree_zones.py`）：道路保留等级、单双向与桥梁信息（车流动画要用），
   并为每座桥推算桥面高度：与别的桥相接的一端保持在空中，自由端做引桥坡道落地；
   林地、公园、行道树线、胡同院落各自生成"哪里长树"的数据。
   另有两样是推断出来的、不是测绘的：五环内的地面路口，每条进口道在路口外侧放一条斑马线（约 3.2 万条）；
   每栋住宅楼朝阳的一侧铺一条楼间绿地并种树（约 6.4 万块，16 km²），已扣除建筑、车行道、水面和硬质场地。

全部重建：`pipeline/build_all.sh`（原始数据的下载位置见脚本开头的注释；`pipeline/explore/` 里是选型阶段的诊断脚本）。

### 前端（`site/src/`，原生 ES module，无构建步骤）

- `engine/`：渲染管线（MSAA HDR → 屏幕空间环境光遮蔽 → 高光溢光 → AgX 色调映射）、按太阳高度角驱动的昼夜光照、
  天空、随视野自适应的阴影贴图、相机控制。环境光遮蔽的采样半径随距离变大：近看是楼脚、女儿墙、
  屋顶设备下的接触阴影，远看是街巷和院落整体变暗；只压暗天光，阳光直射面基本不受影响。
- `world/buildings.js` + `buildingWorker.js`：瓦片调度与 LOD；Worker 里把轮廓挤出成网格，
  并生成硬山 / 庑殿 / 攒尖屋顶、女儿墙与下沉的屋面、裙楼加塔楼的体量、塔楼退台；
  平面不规则的宫殿寺庙（回廊、配殿、宫墙）用向内收坡的琉璃顶。镜头 2.4 km 以内的瓦片会再生成一层屋顶设备：
  电梯机房、通风井、水箱、冷却塔、风管、广告牌、厂房天窗。每个顶点 16 字节。
- `world/buildingMaterial.js`：立面全部是程序化的——窗框与窗洞阴影、阳台、空调外机、底商招牌、
  玻璃幕墙的天空反射与日光闪烁、宫墙与檐下彩画、琉璃瓦垄、入夜后逐户亮起的灯；
  屋面有防水卷材的接缝、太阳能热水器和设备。
- `world/ground.js` + `geoWorker.js`：地表、绿地、水面、道路；车辆是直接在路面着色器里画出来的，
  白天是车身，夜里迎面是白色车灯、背面是红色尾灯；另有斑马线、路缘石和人行道铺装、
  停车场里的车、广场的分仓缝。高架和立交有实体：箱梁、防撞护栏和桥墩，桥墩会避开桥下的车行道、轨道和更低一层的桥。
- `world/trees.js`：树是实例化网格（古柏、银杏、杨树、阔叶树），近处是多团块的树冠加树干，远处退化成单个球冠；
  每个瓦片分成 3×3 块各自裁剪和切换细节。逆光时叶片透光；
  时节可在金秋、初雪、盛夏之间切换（雪会落在一切朝天的表面上，湖面结冰，落叶树只剩枝桠）。
- `world/aircraft.js`：沿首都机场 36R 跑道进近航线下降的客机。
- `world/landmarks/`：用 `landmarkKit.js` 这个小建模库手工搭的地标（天安门、故宫三大殿与角楼、天坛、
  钟鼓楼、中国尊、央视大楼、鸟巢、水立方、佛香阁等）。
- `ui/`：界面。时间控件上的弧线就是当天真实的太阳高度曲线。

## 目录

```
site/            网站本体（部署这个目录）
  data/          管线生成的数据（约 38 MB）
  src/           前端源码
  vendor/        three.js、earcut
pipeline/        数据管线
tools/           无头浏览器截图与回归脚本（开发用：shot / multi / tour / interact / ff）
data/            原始下载与中间文件（很大，不随网站部署）
```

## 已知的不足

- 建筑高度是估算值，个别楼会明显偏高或偏低；OSM 没有标注的新建超高层会偏矮。
- 立交桥和高架是按 OSM 的桥梁标记抬起来的，桥面高度按层级估算；桥墩按固定跨度摆放，不是实际位置。
- 楼间绿地、小区里的树、斑马线、屋顶设备都是按规则推断或随机生成的，位置不代表实况。
- 五环外只做到大约六环一带，细节比五环内少；更远处只有山形。
- 地铁、公交、行人没有做。
