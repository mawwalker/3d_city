# Third-Party Notices & Open Data Attributions

This repository (`mawwalker/3d_city`) combines original procedural 3D engines, shaders, GIS data pipelines, and hand-crafted hero landmark models with open geographic datasets, CC0 PBR texture packs, open-source fonts, and MIT/ISC-licensed JavaScript libraries.

**Licensing Summary:**
- Original source code (`*/pipeline/`, `*/site/src/`, `*/tools/`, `*/serve.sh`) is licensed under the **Apache License, Version 2.0 (`Apache-2.0`)** with mandatory attribution under Section 4(d) via [`NOTICE`](./NOTICE) (see [`LICENSE`](./LICENSE)). Both open-source and commercial use are permitted, provided all required copyright and `NOTICE` attributions are retained.
- Documentation and visual showcase covers (`docs/`, `README.md`) are licensed under **CC BY 4.0** (attribution required).
- Derived map, terrain, building, road, water, and land-cover data files under `*/site/data/` and CC0 texture atlases under `*/site/assets/` remain governed by their respective upstream open licenses listed below — including **ODbL 1.0** for OpenStreetMap-derived geographic data, **Copernicus DEM License**, **CC BY 4.0**, and **CC0 1.0**, all harmonized with commercial-permitted open attribution.
- Vendored JavaScript dependencies under `*/site/vendor/` remain under their original **MIT** and **ISC** licenses.

---

## 1. Geographic, Elevation, Building & Land-Cover Datasets

### OpenStreetMap (All 3 Cities: Beijing, Shanghai, Chongqing)
- **Data used**: Building footprints & tags (`height`, `building:levels`, `building:part`, `name`, `amenity`, `shop`), road & bridge/tunnel networks, railways/monorail alignments, rivers/lakes/parks/landuse polygons, administrative rings, street/stop names, and landmark coordinates (WGS-84).
- **Extracts**: Regional `.osm.pbf` extracts provided by [Geofabrik](https://download.geofabrik.de/asia/china.html).
- **Attribution**: `© OpenStreetMap contributors` — https://www.openstreetmap.org/copyright
- **License**: **Open Database License (ODbL) 1.0** (https://opendatacommons.org/licenses/odbl/1-0/)

### Copernicus DEM GLO-30 (Beijing & Chongqing)
- **Data used**: 30-meter Digital Surface / Elevation Model tiles (`Copernicus_DSM_COG_10_*`), processed into multi-resolution mountain terrain elevation grids (`terrain_core.bin`, `terrain_fine.bin`, `terrain_coarse.bin` for Chongqing; Western Hills terrain for Beijing).
- **Attribution**: `© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.`
- **Source**: Copernicus Data Space Ecosystem / AWS Open Data (`copernicus-dem-30m`) — https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM
- **License**: **Copernicus DEM License** (free, full, and open access; requires retaining the attribution notice above).

### GlobalBuildingAtlas LoD1 (All 3 Cities: Beijing, Shanghai, Chongqing)
- **Data used**: LoD1 building footprint polygons and remote-sensing building height estimates fused where OpenStreetMap footprints or height tags are absent.
- **Citation**: Zhu, X. X. et al., *GlobalBuildingAtlas: An Open Global and Complete Dataset of Building Polygons, Heights and LoD1 3D Models*, Earth System Science Data (ESSD), 2025. Mirror via [Source Cooperative](https://source.coop/tge-labs/globalbuildingatlas-lod1).
- **Source**: https://github.com/zhu-xlab/GlobalBuildingAtlas
- **License**: **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/)

### Overture Maps Foundation — Buildings Theme (Shanghai & Chongqing)
- **Data used**: Supplemental building footprints fused to fill gaps outside OSM and GlobalBuildingAtlas coverage (including East Asian building footprints derived from Shi et al., Zenodo 8174931).
- **Source**: https://overturemaps.org/
- **License**: **ODbL 1.0** / **CDLA-Permissive-2.0** (upstream Shi et al. East Asia Buildings dataset: **CC BY 4.0**).

### 3D-GloBFP (Beijing)
- **Data used**: Supplemental building footprints and height estimates for Beijing.
- **Citation**: Che, Y. et al., *3D-GloBFP: the first global three-dimensional building footprint dataset*, Earth System Science Data (ESSD), 2024 — https://zenodo.org/records/15487006
- **License**: **CC BY 4.0**

### CMAB — China Multi-Attribute Building Dataset (Beijing)
- **Data used**: Weak building-function prior for architectural style classification in Beijing.
- **Citation**: Zhang et al., *Scientific Data*, 2025 — https://doi.org/10.6084/m9.figshare.27992417
- **License**: **CC BY 4.0**

### CBMF — China Building Morphology & Function Dataset (Shanghai)
- **Data used**: Building function & height features for architectural style classification in Shanghai.
- **Source**: https://zenodo.org/records/18595960
- **License**: **CC BY 4.0**

### SinoLC-1 — 1-Meter National Land Cover Map of China (Shanghai)
- **Data used**: High-resolution 1 m land-cover classification fused with OSM landuse into per-tile ground cover rasters.
- **Citation**: Li, Z. et al., *SinoLC-1: the first 1-meter resolution national-scale land-cover map of China created with the deep learning framework*, Earth System Science Data (ESSD), 2023 — https://zenodo.org/records/7709370
- **License**: **CC BY 4.0**

### Meta / WRI High Resolution Canopy Height Maps v1 (Shanghai)
- **Data used**: 1 m tree canopy height rasters used for individual street/park tree placement in Shanghai.
- **Source**: https://registry.opendata.aws/dataforgood-fb-forests/
- **License**: **CC BY 4.0**

---

## 2. PBR Material Textures (Shanghai & Chongqing)

Packed into `site/assets/mat_albedo.webp` and `site/assets/mat_nr.webp` (alongside procedurally synthesized Chongqing architectural materials such as Bayu grey roof tiles, weathered sandstone retaining walls, ceramic mosaic tiles, bluestone mountain steps, and lacquered timber):

- **ambientCG** (https://ambientcg.com/) — Asphalt, Bricks, Concrete, Corrugated Steel, Granite, Grass, Gravel, Ground, Marble, Metal Plates, Painted Metal, Paving Stones, Planks, Plaster, Rock, Roofing Tiles, Scattered Leaves, Tiles packs.
  - **License**: **CC0 1.0 Universal (Public Domain Dedication)**
- **Poly Haven** (https://polyhaven.com/) — Bark, foliage, bitumen, and architectural surface texture packs.
  - **License**: **CC0 1.0 Universal (Public Domain Dedication)**

---

## 3. Vendored Runtime JavaScript Libraries (`*/site/vendor/`)

Each city site bundles self-contained ESM copies with zero external CDN dependencies. Full upstream license texts are preserved in each city's `site/vendor/*/LICENSE` files:

| Library | Version / Notes | Copyright | License | Used In |
|---|---|---|---|---|
| **Three.js** (`three`) | r187 (`three.module.js`, `three.core.js`) | © 2010–2026 three.js authors | **MIT** | Beijing, Shanghai, Chongqing |
| **three-mesh-bvh** | `index.module.js` | © 2018 Garrett Johnson | **MIT** | Shanghai, Chongqing |
| **earcut** | `earcut.js` | © 2026 Mapbox | **ISC** | Beijing, Shanghai, Chongqing |

---

## 4. Fonts

- **Source Han Serif (思源宋体)** by Adobe (`beijing_3d/site/fonts/jing-serif-{400,600,900}.woff2`, subsetted; full license in `beijing_3d/site/fonts/LICENSE.txt`)
  - **License**: **SIL Open Font License (OFL) 1.1** — https://github.com/adobe-fonts/source-han-serif
- **Build-time rasterized shopfront & title fonts** (used during offline PNG atlas / title card generation in `pipeline/52_signs.py` and `tools/film/titles.py`; no proprietary font files are redistributed in this repository):
  - **Source Han Sans CN / Noto Sans CJK** — **SIL OFL 1.1**
  - **IBM Plex Sans / IBM Plex Sans SC** — **SIL OFL 1.1**
  - **ZCOOL XiaoWei / Ma Shan Zheng / Long Cang** (Google Fonts) — **SIL OFL 1.1**
  - **AR PL UKai / AR PL UMing** — **Arphic Public License**

---

## 5. Offline Build & Audit Tooling (Not Bundled in `site/`)

The optional offline GIS rebuild pipeline (`*/pipeline/`) and headless browser verification/filming tools (`*/tools/`) rely on standard open-source ecosystems:
- **Python stack**: NumPy, SciPy, Pandas, GeoPandas, Shapely, Rasterio, Pyogrio, Pyosmium, LightGBM / scikit-learn, Pillow (BSD / MIT / Apache-2.0).
- **Node.js / Media tools**: Playwright Core (`Apache-2.0`), FFmpeg (`LGPL` / `GPL`), FluidSynth (`LGPL-2.1`, optional).

---

## 6. Disclaimer

All three 3D city models in this repository are **artistic, experimental, and educational real-time 3D visualizations**, **not** official cartographic, cadastral, surveying, or engineering products:
- All geographic coordinates use **true WGS-84** (not GCJ-02 / BD-09).
- Building heights outside explicitly tagged OpenStreetMap records are remote-sensing or ML estimates; facades, shopfront signs, interiors, street furniture, traffic flows, and pedestrian animations are procedurally generated; hero landmarks and bridges are architectural approximations built from public references.
- **Do not use these models or derived data for navigation, surveying, safety-critical analysis, or engineering design.**
