# 重庆 3D · 山城全景 (Chongqing 3D — 8D Mountain City)

一座可以在浏览器中**第一人称步行漫游**与**自由飞行俯瞰**的重庆 8D 魔幻山城实时 WebGL 2 三维城市：基于真实 WGS-84 地理数据与 Copernicus GLO-30 山地高程，包含 **141,090 栋全真 3D 建筑**、**23 处精雕重庆地标与跨江桥梁工程**、**904 座实体 3D 山体隧道洞门**、动态李子坝轻轨穿楼、长江索道、两江游船、实景车流与零瞬移零穿墙行人系统。

纯静态网站，无后端；Three.js、three-mesh-bvh 与 earcut 已随站点打包，零外部 CDN 依赖。

## 快速运行

```bash
./serve.sh            # 启动本地服务：http://127.0.0.1:8768/
```

或使用任意静态 HTTP 服务器（`python3 -m http.server 8768 --directory site --bind 127.0.0.1`）。请勿直接双击 `index.html`（ES Module 与 Web Worker 需要 HTTP 环境）。需要支持 WebGL 2 与 `DecompressionStream` 的现代浏览器（Chrome / Edge 80+、Firefox 113+、Safari 16.4+）。

## 坐标系统与世界基准

- **世界原点 `(0, 0)`**：人民解放纪念碑（Jiefangbei Monument，OSM way `589752618`）— `106.573357° E, 29.560101° N`（**真实 WGS-84**，非 GCJ-02）。
- **投影**：局部横轴墨卡托（WebGL 坐标系 `x` 东、`y` 上、`z` 南；管线内部 `y` 北）。
- **高程基准**：`WATER_Y_ASL = 168.0 m`（`world_y = elevation_ASL - 168.0`，长江与嘉陵江基准水面 `y = 0.0 m`）。
- **覆盖范围**：`24 km × 22 km`（`X ∈ [-14000, +10000]`，`Y_north ∈ [-10000, +12000]`，`24 × 22 = 528` 张 1 km `'CQT2'` 瓦片）+ `64 km × 64 km` 远景山地轮廓。

## 核心技术与特色

1. **三级山地高程与 2.5 m 核心道路削平（`terrain_core.bin` / `terrain_fine.bin` / `terrain_coarse.bin`）**：
   - 基于 Copernicus DEM GLO-30 融合两江水系雕刻与核心区 `2.5 m` Voronoi 道路台地削平（`terrain_core.bin`），将核心车行道横坡 `>10°` 压降至 `0.29%`、`>5°` 压降至 `1.1%`，消除山地锯齿和道路侧倾。
2. **真三维山城建筑引擎（`buildingGeom.js` + `facadeKit.js` + `buildingMaterial.js`）**：
   - 融合 OSM + GlobalBuildingAtlas LoD1 + Overture Maps 轮廓，每栋楼存储 `ground_z_min` / `ground_z_max`、`podium_h`、`roof_type`、`balcony_mask`、`subtype` 与逐边 `street_front` / `party_wall` 标记。
   - 自动根据地形高差生成石砌堡坎基础（`堡坎`）与巴渝吊脚楼架空木柱，**零悬空建筑**；经过 3 轮 3D 去重与 `0.1 m` 量化锁定（全城 **0 重叠建筑、0 共面 Z-fighting 墙面、0 base/mass 重叠**）。
   - LOD0 真 3D 构件包含凹进窗洞、窗框竖梃、16 套透视室内房间贴图（`interiors.webp`）、3D 阳台/花盆/晾衣杆/防盗网/空调外机/落水管、巴渝小青瓦屋顶与 38 层 `1024×1024` PBR 材质阵列。
3. **23 处重庆精雕地标、跨江大桥与立体奇观（`site/src/world/heroes/`）**：
   - **核心建筑地标**：洪崖洞（1F 滨江路至 11F 沧白路全立体吊脚楼 + 瀑布 + 夜景灯火）、来福士广场（8 栋弧形风帆 + 横跨高空水晶连廊）、解放碑、国泰艺术中心、重庆 WFC（339 m）、陆海国际中心（458 m）、重庆大剧院、人民大礼堂、重庆科技馆、白象居、魁星楼、十八梯、南山一棵树观景台。
   - **魔幻立体交通**：李子坝轻轨穿楼（动态 6 节 CRT 2 号线列车定时进出 6–8 层站台）、长江索道（南北站房 + 双动态缆车轿厢横跨长江）、苏家坝 72 m 螺旋立交、黄桷湾 5 层立交、千厮门/东水门/朝天门/菜园坝/石板坡/黄花园/嘉陵江/渝澳 8 座跨江大桥，以及全城 **904 座实体 3D 山体隧道洞门**（`tunnels.json`）。
4. **零瞬移 / 零穿墙动态仿真与高性能渲染**：
   - 车流沿真实坡道、高架桥面与 3D 山体隧道行驶；行人沿 `4,747 km` 零发夹弯步道（`flags=0` 闭合环 + `flags=1` 平滑往返中线）行走，经 120s 轨迹与碰撞压测达到 **0 瞬移、0 凭空消失、0 穿建筑/地标/隧道墙、30/30 玩家碰撞测试通过**。
   - 延迟渲染管线 + 浮点反向深度 + 4 级级联阴影 + 物理大气散射 + GTAO / TAA / 雨夜湿路面反射；RTX 5080 1080p Ultra 实测 **253–299 FPS**。

## 操作与 URL 参数

| 操作 | 效果 |
|---|---|
| 点击画面 / 拖拽 | 锁定鼠标环顾（`Esc` 释放）/ 旋转视角 |
| `W A S D` / 方向键 | 移动；`Shift` 加速；`Space` 跳跃/上升；`C`/`Q` 下降 |
| `F` / `G` | 步行与飞行切换 / 立即落到脚下地面或桥面 |
| `M` / `1`–`9` | 全城地图瞬移 / 预设地标视角 |
| `H` / `N` | 隐藏 UI / 飞行穿墙开关 |

URL 参数示例：`?pos=40,120,35&look=180,-8&mode=walk&hour=20.5&weather=rain&q=ultra&ui=0`

## 数据重建（`pipeline/`）

详见 `pipeline/build_all.sh`（需先在 `data/raw/` 准备 Geofabrik `chongqing-latest.osm.pbf`、Copernicus GLO-30 DEM、GlobalBuildingAtlas 与 Overture 建筑、CC0 ambientCG/Poly Haven 贴图）：

```bash
pipeline/build_all.sh core    # 快速重建核心 10×7 km（70 瓦片）
pipeline/build_all.sh full    # 全城 24×22 km 重建（528 瓦片）+ 38_audit.py 一致性审计
```

## 许可与数据署名

详见仓库根目录 [`../LICENSE`](../LICENSE)（原创源码采用 **Apache-2.0** + 强制署名 [`../NOTICE`](../NOTICE)，允许开源与商用，须严格保留署名；文档与封面采用 **CC BY 4.0**）与 [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。
- **地图与路网**：`© OpenStreetMap contributors`（ODbL 1.0）。
- **地形高程**：Copernicus DEM GLO-30（`© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved`）。
- **建筑与贴图**：GlobalBuildingAtlas LoD1（CC BY 4.0）、Overture Maps（ODbL / CC BY 4.0）、ambientCG & Poly Haven（CC0 1.0）、Three.js / three-mesh-bvh（MIT）、earcut（ISC）。
