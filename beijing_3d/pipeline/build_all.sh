#!/bin/bash
# Rebuild every data file under site/data from the raw downloads in data/raw.
# Run from the project root:  pipeline/build_all.sh
# Raw inputs (see README for where they come from):
#   data/raw/osm/beijing-latest.osm.pbf          Geofabrik extract
#   data/raw/gba/gba_beijing.parquet             GlobalBuildingAtlas LoD1 (fetched by 01_fetch_gba.py)
#   data/raw/globfp/t*/                          3D-GloBFP tiles 2291, 2292, 2349, 2350
#   data/raw/cmab/北京市/                         CMAB Beijing (only its 'Function' attribute is used, as a weak prior)
#   data/raw/dem/Copernicus_DSM_COG_10_*.tif     Copernicus GLO-30, N39-40 / E115-117
set -euo pipefail
cd "$(dirname "$0")/.."
PY=".venv/bin/python -I"
W="${WORK_DIR:-data/work}"            # intermediate files
S="${SITE_DATA:-site/data}"          # web-ready output
mkdir -p "$W" "$S"

$PY pipeline/10_extract_osm.py data/raw/osm/beijing-latest.osm.pbf "$W"      # OSM layers -> GeoParquet
$PY pipeline/11_rings.py data/raw/osm/beijing-latest.osm.pbf "$W"            # ring-road polygons
$PY pipeline/15_prepare_sources.py "$W" data/raw/globfp "data/raw/cmab/北京市/processed_beijing20230701_all.shp"   # clip 3D-GloBFP + CMAB
$PY pipeline/20_fuse_buildings.py "$W" data/raw/gba/gba_beijing.parquet      # OSM + GBA + 3D-GloBFP, de-duplicated
$PY pipeline/21_heights_styles.py "$W"                                       # height model + architectural styles
$PY pipeline/12_terrain.py data/raw/dem "$W"                                 # hills above the plain
$PY pipeline/33_export_terrain.py "$W" "$S"
$PY pipeline/31_build_ground.py "$W" "$S"                                    # roads, water, land cover
$PY pipeline/32_tree_zones.py "$W" "$S"                                      # where trees grow (+ lawns beside housing blocks)
$PY pipeline/34_landmarks.py "$W" "$S" pipeline/landmark_exclusions.json     # landmark placement + exclusions
mkdir -p "$S/detail"; rm -f "$S"/detail/*.bin
$PY pipeline/30_build_tiles.py "$W" "$S" pipeline/landmark_exclusions.json   # building tiles (base / mass / detail)
$PY pipeline/35_labels.py "$W" "$S"                                          # place names
$PY pipeline/40_fonts.py site                                                # subset the UI font
du -sh "$S"
