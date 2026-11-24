#!/bin/bash
# Rebuild every data file under site/data from the raw downloads in data/raw.
# Run from the project root:  pipeline/build_all.sh
# Raw inputs (fetched by the 0x scripts or by hand, see README):
#   data/raw/osm/shanghai-latest.osm.pbf              Geofabrik extract
#   data/raw/gba/gba_shanghai.parquet                 GlobalBuildingAtlas LoD1   (01_fetch_gba.py)
#   data/raw/overture/{buildings,places}.parquet      Overture Maps              (02_fetch_overture.py)
#   data/raw/cbmf/x/Shanghai.gdb                      CBMF building function     (Zenodo 18595960, unrar)
#   data/raw/sinolc/x/East_Shanghai.tif               SinoLC-1 land cover        (Zenodo 7709370, unzip)
#   data/raw/canopy/1321211{00,01,02,03}.tif          Meta/WRI canopy height v1  (dataforgood-fb-data, forests/v1)
set -euo pipefail
cd "$(dirname "$0")/.."
PY=".venv/bin/python -I"
W="${WORK_DIR:-data/work}"
S="${SITE_DATA:-site/data}"
mkdir -p "$W" "$S" site/assets

$PY pipeline/10_extract_osm.py data/raw/osm/shanghai-latest.osm.pbf "$W"        # OSM layers -> GeoParquet
$PY pipeline/11_rings.py "$W"                                                    # inner / middle / outer ring polygons
$PY pipeline/12_flyovers.py "$W"                                                 # short bridges over roads get their approach ramps (cuts the ways concerned)
$PY pipeline/14_spread_roads.py "$W"                                             # carriageways mapped closer together than their lanes need are moved apart
$PY pipeline/15_prepare_sources.py "$W" data/raw/cbmf/x/Shanghai.gdb            # clip CBMF
$PY pipeline/20_fuse_buildings.py "$W" data/raw/gba/gba_shanghai.parquet data/raw/overture/buildings.parquet
$PY pipeline/21_heights_styles.py "$W"                                           # height model + architectural styles
$PY pipeline/34_landmarks.py "$W" "$S" pipeline/landmark_exclusions.json         # landmark placement + exclusions; the Huangpu and its bridges
$PY pipeline/31_build_ground.py "$W" data/raw/sinolc/x/East_Shanghai.tif         # roadway, pavements, water, land cover, road lines, deck heights
$PY pipeline/29_clip_buildings.py "$W"                                           # no building stands in a street: footprints cut back off roads, pavements, decks
$PY pipeline/36_boats.py "$W" "$S"                                               # vessels mistaken for buildings -> boats
$PY pipeline/30_build_tiles.py "$W" pipeline/landmark_exclusions.json            # building sections (base / mass / detail)
$PY pipeline/32_trees.py "$W" data/raw/canopy                                    # individual trees from canopy height
$PY pipeline/37_traffic.py "$W"                                                  # traffic graph (lanes, signals) + walking loops
$PY pipeline/38_audit.py "$W"                                                    # consistency check: buildings / walkers / signs against the carriageways, lanes against each other
$PY pipeline/39_pack_tiles.py "$W" "$S"                                          # far shells + streaming tiles + manifest
$PY pipeline/33_far_ground.py "$W" "$S"                                          # city-wide water / roads / elevated decks / coarse land cover
$PY pipeline/35_places.py "$W" site                                              # teleport places + mini-map
$PY pipeline/50_textures.py data/raw/textures site/assets 512                    # PBR material arrays (CC0 sets)
$PY pipeline/51_foliage.py site/assets                                           # leaf-cluster atlas
$PY pipeline/52_signs.py site/assets                                             # shop sign atlas
du -sh "$S" site/assets
